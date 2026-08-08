import { and, asc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import {
  accounts,
  holdingSnapshots,
  importBatches,
  importRows,
  instruments,
  portfolioValuations,
  transactions,
  type Database,
} from "@investment-sync/db";
import {
  normalizedImportRowSchema,
  type NormalizedHoldingRow,
  type NormalizedImportRow,
} from "@investment-sync/importers";
import { Clock, Effect } from "effect";
import {
  duplicateImportError,
  importEffect,
  ImportConflictError,
  type ImportDependencies,
  ImportNotFoundError,
  ImportPersistenceError,
} from "./import-errors";
import {
  cleanupExpiredImportFilesPromise,
  listImportsPromise,
  uploadAndProcessImportPromise,
} from "./import-lifecycle";
import type { MembershipContext } from "./membership";
import { clearHouseholdPortfolioCache } from "./portfolio-cache";
import {
  accountIdentityKey,
  instrumentIdentity,
  instrumentIdentityKey,
  type InstrumentIdentity,
} from "./portfolio/identity";

type ImportDatabase = Pick<
  Database,
  "execute" | "insert" | "select" | "update"
>;

export * from "./import-errors";

export function uploadAndProcessImport(
  dependencies: ImportDependencies,
  membership: MembershipContext,
  input: { fileName: string; mimeType?: string; content: Buffer },
) {
  return Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      importEffect(() =>
        uploadAndProcessImportPromise(
          dependencies,
          membership,
          input,
          new Date(now),
        ),
      ),
    ),
  );
}

export function commitImport(
  dependencies: ImportDependencies,
  membership: MembershipContext,
  importBatchId: string,
) {
  return Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      importEffect(() =>
        commitImportPromise(
          dependencies,
          membership,
          importBatchId,
          new Date(now),
        ),
      ),
    ),
  );
}

export function listImports(
  dependencies: ImportDependencies,
  membership: MembershipContext,
) {
  return importEffect(() => listImportsPromise(dependencies, membership));
}

export function cleanupExpiredImportFiles(dependencies: ImportDependencies) {
  return Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      importEffect(() =>
        cleanupExpiredImportFilesPromise(dependencies, new Date(now)),
      ),
    ),
  );
}

async function commitImportPromise(
  ctx: ImportDependencies,
  membership: MembershipContext,
  importBatchId: string,
  committedAt: Date,
) {
  const committed = await ctx.db.transaction(async (tx) => {
    const db: ImportDatabase = tx;
    // ponytail: the constant key serializes every import commit to prevent
    // identity races; scope by normalized identities when throughput requires it.
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtext('investment-sync-import-commit'))`,
    );
    const [batch] = await db
      .select({
        status: importBatches.status,
        rowCount: importBatches.rowCount,
        fileHash: importBatches.fileHash,
        parserVersion: importBatches.parserVersion,
        uploadedAt: importBatches.uploadedAt,
      })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.id, importBatchId),
          eq(importBatches.householdId, membership.householdId),
        ),
      )
      .limit(1)
      .for("update");
    if (!batch) {
      throw new ImportNotFoundError({ message: "Import Batch was not found" });
    }
    if (batch.status === "committed") return batch.rowCount;
    if (batch.status !== "parsed") {
      throw new ImportConflictError({
        message: "Import Batch is not ready to commit",
      });
    }
    if (batch.fileHash && batch.parserVersion) {
      const [duplicate] = await db
        .select({ id: importBatches.id })
        .from(importBatches)
        .where(
          and(
            eq(importBatches.householdId, membership.householdId),
            eq(importBatches.fileHash, batch.fileHash),
            eq(importBatches.parserVersion, batch.parserVersion),
            eq(importBatches.status, "committed"),
            ne(importBatches.id, importBatchId),
          ),
        )
        .limit(1);
      if (duplicate) throw duplicateImportError();
    }

    const batchRows = await db
      .select({ id: importRows.id, payload: importRows.normalizedPayload })
      .from(importRows)
      .innerJoin(importBatches, eq(importRows.importBatchId, importBatches.id))
      .where(
        and(
          eq(importRows.importBatchId, importBatchId),
          eq(importBatches.householdId, membership.householdId),
        ),
      )
      .orderBy(asc(importRows.rowNumber));

    if (batchRows.length === 0 || batchRows.length !== batch.rowCount) {
      throw new ImportPersistenceError({
        message: "Import Batch rows are incomplete",
      });
    }
    const parsedRows = batchRows.map((row, index) => {
      const parsed = normalizedImportRowSchema.safeParse(row.payload);
      if (!parsed.success) {
        throw new ImportPersistenceError({
          message: `Import Batch row ${index + 1} is invalid`,
          cause: parsed.error,
        });
      }
      return { id: row.id, payload: parsed.data };
    });
    const accountRows: AccountImportRow[] = [];
    for (const row of parsedRows) {
      if (
        row.payload.kind === "holding" ||
        row.payload.kind === "transaction"
      ) {
        accountRows.push(row.payload);
      }
    }
    const accountIds = await ensureAccounts(
      db,
      membership.householdId,
      accountRows,
    );
    const instrumentIds = await ensureInstruments(db, accountRows);

    const holdingValues = parsedRows.flatMap(({ payload }) => {
      if (payload.kind !== "holding") return [];
      return [
        {
          householdId: membership.householdId,
          accountId: requiredMapValue(
            accountIds,
            accountKey(payload),
            "account",
          ),
          instrumentId: requiredMapValue(
            instrumentIds,
            instrumentKey(payload),
            "instrument",
          ),
          importBatchId,
          sourceType: payload.sourceType,
          snapshotDate:
            payload.sourceDate ?? batch.uploadedAt.toISOString().slice(0, 10),
          quantity: payload.quantity?.toString(),
          investedAmount: payload.investedAmount.toString(),
          currentValue: payload.currentValue.toString(),
          pnlAmount: payload.pnlAmount?.toString(),
          pnlPercent: payload.pnlPercent?.toString(),
          currency: payload.currency,
          sourcePayload: payload.metadata,
        },
      ];
    });

    if (holdingValues.length > 0) {
      await db
        .insert(holdingSnapshots)
        .values(holdingValues)
        .onConflictDoUpdate({
          target: [
            holdingSnapshots.householdId,
            holdingSnapshots.accountId,
            holdingSnapshots.instrumentId,
            holdingSnapshots.snapshotDate,
            holdingSnapshots.currency,
          ],
          set: {
            importBatchId,
            sourceType: sql`excluded.source_type`,
            quantity: sql`excluded.quantity`,
            investedAmount: sql`excluded.invested_amount`,
            currentValue: sql`excluded.current_value`,
            pnlAmount: sql`excluded.pnl_amount`,
            pnlPercent: sql`excluded.pnl_percent`,
            sourcePayload: sql`excluded.source_payload`,
          },
          // The portal statement contains richer NPS detail than the workbook.
          // All other same-day source pairs retain last-write-wins behavior.
          setWhere: sql`
            excluded.source_type = 'nps_csv'
              or ${holdingSnapshots.sourceType} <> 'nps_csv'
          `,
        });
    }

    const transactionValues = parsedRows.flatMap(({ payload }) => {
      if (payload.kind !== "transaction") return [];
      return [
        {
          householdId: membership.householdId,
          accountId: requiredMapValue(
            accountIds,
            accountKey(payload),
            "account",
          ),
          instrumentId: requiredMapValue(
            instrumentIds,
            instrumentKey(payload),
            "instrument",
          ),
          importBatchId,
          type: payload.type,
          tradeDate: payload.tradeDate,
          quantity: payload.quantity?.toString(),
          price: payload.price?.toString(),
          amount: payload.amount.toString(),
          currency: payload.currency,
          metadata: payload.metadata,
        },
      ];
    });

    if (transactionValues.length > 0) {
      await db
        .insert(transactions)
        .values(transactionValues)
        .onConflictDoUpdate({
          target: [
            transactions.householdId,
            transactions.accountId,
            transactions.instrumentId,
            transactions.tradeDate,
            transactions.type,
            transactions.amount,
            transactions.currency,
          ],
          set: {
            importBatchId,
            quantity: sql`excluded.quantity`,
            price: sql`excluded.price`,
            metadata: sql`excluded.metadata`,
          },
        });
    }

    const valuationValues = parsedRows.flatMap(({ payload }) => {
      if (payload.kind !== "valuation") return [];
      return [
        {
          householdId: membership.householdId,
          valuationDate: payload.valuationDate,
          investedAmount: payload.investedAmount.toString(),
          currentValue: payload.currentValue.toString(),
          pnlAmount: (
            payload.pnlAmount ?? payload.currentValue - payload.investedAmount
          ).toString(),
          currency: payload.currency,
          metadata: payload.metadata,
        },
      ];
    });

    if (valuationValues.length > 0) {
      await db
        .insert(portfolioValuations)
        .values(valuationValues)
        .onConflictDoUpdate({
          target: [
            portfolioValuations.householdId,
            portfolioValuations.valuationDate,
          ],
          set: {
            investedAmount: sql`excluded.invested_amount`,
            currentValue: sql`excluded.current_value`,
            pnlAmount: sql`excluded.pnl_amount`,
            currency: sql`excluded.currency`,
            metadata: sql`excluded.metadata`,
          },
        });
    }

    const committedRowIds = parsedRows.map((row) => row.id);
    if (committedRowIds.length > 0) {
      await db
        .update(importRows)
        .set({ isCommitted: true })
        .where(inArray(importRows.id, committedRowIds));
    }

    await db
      .update(importBatches)
      .set({ status: "committed", committedAt })
      .where(
        and(
          eq(importBatches.id, importBatchId),
          eq(importBatches.householdId, membership.householdId),
        ),
      );

    return parsedRows.length;
  });

  clearHouseholdPortfolioCache(membership.householdId);

  return { committed };
}

type AccountImportRow = NormalizedHoldingRow | NormalizedTransactionRow;
type NormalizedTransactionRow = Extract<
  NormalizedImportRow,
  { kind: "transaction" }
>;

async function ensureAccounts(
  db: ImportDatabase,
  householdId: string,
  rows: AccountImportRow[],
): Promise<Map<string, string>> {
  const existing = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      provider: accounts.provider,
    })
    .from(accounts)
    .where(eq(accounts.householdId, householdId))
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
  const existingByKey = new Map(
    existing.map((account) => [accountIdentityKey(account), account.id]),
  );
  const missing = uniqueByKey(
    rows.filter((row) => !existingByKey.has(accountKey(row))),
    accountKey,
  );

  if (missing.length > 0) {
    await db
      .insert(accounts)
      .values(
        missing.map((row) => ({
          householdId,
          name: row.accountName.trim(),
          provider: row.provider.trim(),
          accountType: row.assetClass,
          currency: row.currency,
        })),
      )
      .onConflictDoNothing();
  }

  const allAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      provider: accounts.provider,
    })
    .from(accounts)
    .where(eq(accounts.householdId, householdId))
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
  const ids = new Map(
    allAccounts.map((account) => [accountIdentityKey(account), account.id]),
  );

  for (const row of rows) {
    requiredMapValue(ids, accountKey(row), "account");
  }
  return ids;
}

async function ensureInstruments(
  db: ImportDatabase,
  rows: AccountImportRow[],
): Promise<Map<string, string>> {
  const identities = uniqueByKey(
    rows.map((row) =>
      instrumentIdentity({
        assetClass: row.assetClass,
        currency: row.currency,
        symbol: row.symbol ?? null,
        name: row.instrumentName,
      }),
    ),
    (identity) => identity.key,
  );
  if (identities.length === 0) return new Map();

  const existing = await db
    .select({
      id: instruments.id,
      name: instruments.name,
      symbol: instruments.symbol,
      assetClass: instruments.assetClass,
      currency: instruments.currency,
    })
    .from(instruments)
    .where(instrumentIdentityWhere(identities))
    .orderBy(asc(instruments.createdAt), asc(instruments.id));
  const existingByKey = new Map(
    existing.map((instrument) => [
      instrumentIdentityKey(instrument),
      instrument.id,
    ]),
  );
  const missing = uniqueByKey(
    rows.filter((row) => !existingByKey.has(instrumentKey(row))),
    instrumentKey,
  );

  if (missing.length > 0) {
    await db
      .insert(instruments)
      .values(
        missing.map((row) => ({
          name: row.instrumentName.trim(),
          symbol: cleanOptionalText(row.symbol),
          isin: "isin" in row ? cleanOptionalText(row.isin) : undefined,
          assetClass: row.assetClass,
          currency: row.currency,
        })),
      )
      .onConflictDoNothing();
  }

  const batchInstruments = await db
    .select({
      id: instruments.id,
      name: instruments.name,
      symbol: instruments.symbol,
      assetClass: instruments.assetClass,
      currency: instruments.currency,
    })
    .from(instruments)
    .where(instrumentIdentityWhere(identities))
    .orderBy(asc(instruments.createdAt), asc(instruments.id));
  const ids = new Map(
    batchInstruments.map((instrument) => [
      instrumentIdentityKey(instrument),
      instrument.id,
    ]),
  );

  for (const row of rows) {
    requiredMapValue(ids, instrumentKey(row), "instrument");
  }
  return ids;
}

function accountKey(row: AccountImportRow): string {
  return accountIdentityKey({
    provider: row.provider,
    name: row.accountName,
  });
}

function instrumentKey(row: AccountImportRow): string {
  return instrumentIdentityKey({
    assetClass: row.assetClass,
    currency: row.currency,
    symbol: row.symbol ?? null,
    name: row.instrumentName,
  });
}

function instrumentIdentityWhere(identities: InstrumentIdentity[]): SQL {
  const conditions = identities
    .map((identity) => {
      const identityCondition = identity.symbol
        ? eq(sql<string>`upper(trim(${instruments.symbol}))`, identity.symbol)
        : and(
            sql`nullif(trim(${instruments.symbol}), '') is null`,
            eq(sql<string>`lower(trim(${instruments.name}))`, identity.name),
          );

      return and(
        eq(instruments.assetClass, identity.assetClass),
        eq(instruments.currency, identity.currency),
        identityCondition,
      );
    })
    .filter((condition): condition is SQL => Boolean(condition));

  return or(...conditions) ?? sql`false`;
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueByKey<T>(rows: T[], keyFor: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyFor(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requiredMapValue(
  values: Map<string, string>,
  key: string,
  label: string,
): string {
  const value = values.get(key);
  if (!value) throw new Error(`Failed to resolve ${label} for import row`);
  return value;
}
