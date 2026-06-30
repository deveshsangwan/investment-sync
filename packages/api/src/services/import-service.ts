import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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
  parseImportFile,
  type ImportFile,
  type NormalizedHoldingRow,
  type NormalizedImportRow,
} from "@investment-sync/importers";
import { getImportBucketName, validateImportFile } from "../config";
import type { ApiContext } from "../context";
import type { MembershipContext } from "./membership";
import { clearHouseholdPortfolioCache } from "./portfolio-cache";
import {
  accountIdentityKey,
  instrumentIdentity,
  instrumentIdentityKey,
  type InstrumentIdentity,
} from "./portfolio/identity";

const IMPORT_TTL_DAYS = 30;
const CLEANUP_BATCH_SIZE = 100;
type ImportDatabase = Pick<
  Database,
  "execute" | "insert" | "select" | "update"
>;

async function ensureImportBucket(ctx: ApiContext) {
  const bucket = getImportBucketName();
  const existing = await ctx.supabase.storage.getBucket(bucket);
  if (!existing.error) return;

  const created = await ctx.supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: "50MB",
  });

  if (
    created.error &&
    !created.error.message.toLowerCase().includes("already exists")
  ) {
    throw created.error;
  }
}

export async function createImportUpload(
  ctx: ApiContext,
  membership: MembershipContext,
  fileName: string,
) {
  validateImportFile({ fileName, sizeBytes: 0 });
  await ensureImportBucket(ctx);
  const bucket = getImportBucketName();
  const expiresAt = new Date(
    Date.now() + IMPORT_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const importId = randomUUID();
  const storagePath = `${membership.userId}/${importId}/${sanitizeFileName(fileName)}`;

  const [batch] = await ctx.db
    .insert(importBatches)
    .values({
      id: importId,
      householdId: membership.householdId,
      uploadedByUserId: membership.appUserId,
      originalFileName: fileName,
      storagePath,
      expiresAt,
      status: "created",
    })
    .returning();

  if (!batch) throw new Error("Failed to create import batch");

  const signed = await ctx.supabase.storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);
  if (signed.error) throw signed.error;

  return {
    importBatchId: batch.id,
    storagePath,
    token: signed.data.token,
    signedUrl: signed.data.signedUrl,
    expiresAt,
  };
}

export async function uploadAndProcessImport(
  ctx: ApiContext,
  membership: MembershipContext,
  input: { fileName: string; mimeType?: string; content: Buffer },
) {
  validateImportFile({
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.content.length,
  });
  const fileHash = createHash("sha256").update(input.content).digest("hex");
  const existing = await ctx.db
    .select({
      id: importBatches.id,
      status: importBatches.status,
      parserVersion: importBatches.parserVersion,
    })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.householdId, membership.householdId),
        eq(importBatches.fileHash, fileHash),
      ),
    )
    .limit(10);

  const committedDuplicate = existing.find(
    (batch) => batch.status === "committed",
  );
  if (committedDuplicate) {
    const parsed = parseImportFile(input);
    const sameParserVersionCommitted = existing.some(
      (batch) =>
        batch.status === "committed" &&
        batch.parserVersion === parsed.parserVersion,
    );
    if (sameParserVersionCommitted) {
      throw new Error("This file has already been imported and committed");
    }
  }

  const upload = await createImportUpload(ctx, membership, input.fileName);
  const bucket = getImportBucketName();
  const storageUpload = await ctx.supabase.storage
    .from(bucket)
    .upload(upload.storagePath, input.content, {
      contentType: input.mimeType,
      upsert: true,
    });

  if (storageUpload.error) {
    await ctx.db
      .update(importBatches)
      .set({ status: "failed", errors: [storageUpload.error.message] })
      .where(eq(importBatches.id, upload.importBatchId));
    throw storageUpload.error;
  }

  return processImport(ctx, membership, {
    importBatchId: upload.importBatchId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    content: input.content,
    fileHash,
  });
}

export async function processImport(
  ctx: ApiContext,
  membership: MembershipContext,
  input: ImportFile & { importBatchId: string; fileHash?: string },
) {
  validateImportFile({
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.content.length,
  });

  let parsed: ReturnType<typeof parseImportFile>;
  let validatedRows: NormalizedImportRow[];
  try {
    parsed = parseImportFile(input);
    validatedRows = parsed.rows.map((row) =>
      normalizedImportRowSchema.parse(row),
    );
  } catch (error) {
    await ctx.db
      .update(importBatches)
      .set({
        status: "failed",
        errors: [error instanceof Error ? error.message : "Import failed"],
        processedAt: new Date(),
      })
      .where(
        and(
          eq(importBatches.id, input.importBatchId),
          eq(importBatches.householdId, membership.householdId),
        ),
      );
    throw error;
  }

  await ctx.db
    .update(importBatches)
    .set({
      sourceType: parsed.sourceType,
      status: "parsed",
      parserVersion: parsed.parserVersion,
      rowCount: validatedRows.length,
      warnings: parsed.warnings,
      fileHash: input.fileHash,
      processedAt: new Date(),
    })
    .where(
      and(
        eq(importBatches.id, input.importBatchId),
        eq(importBatches.householdId, membership.householdId),
      ),
    );

  if (validatedRows.length > 0) {
    await ctx.db.insert(importRows).values(
      validatedRows.map((row, index) => ({
        importBatchId: input.importBatchId,
        rowNumber: index + 1,
        normalizedPayload: row as unknown as Record<string, unknown>,
      })),
    );
  }

  return {
    importBatchId: input.importBatchId,
    sourceType: parsed.sourceType,
    parserVersion: parsed.parserVersion,
    rowCount: validatedRows.length,
    rows: validatedRows,
    warnings: parsed.warnings,
  };
}

export async function commitImport(
  ctx: ApiContext,
  membership: MembershipContext,
  importBatchId: string,
) {
  const committed = await ctx.db.transaction(async (tx) => {
    const db: ImportDatabase = tx;
    const batchRows = await db
      .select({ id: importRows.id, payload: importRows.normalizedPayload })
      .from(importRows)
      .innerJoin(importBatches, eq(importRows.importBatchId, importBatches.id))
      .where(
        and(
          eq(importRows.importBatchId, importBatchId),
          eq(importBatches.householdId, membership.householdId),
        ),
      );

    const parsedRows = batchRows.map((row) => ({
      id: row.id,
      payload: normalizedImportRowSchema.parse(row.payload),
    }));
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
          snapshotDate:
            payload.sourceDate ?? new Date().toISOString().slice(0, 10),
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
            quantity: sql`excluded.quantity`,
            investedAmount: sql`excluded.invested_amount`,
            currentValue: sql`excluded.current_value`,
            pnlAmount: sql`excluded.pnl_amount`,
            pnlPercent: sql`excluded.pnl_percent`,
            sourcePayload: sql`excluded.source_payload`,
          },
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
      .set({ status: "committed", committedAt: new Date() })
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

export async function cleanupExpiredImportFiles(ctx: ApiContext) {
  const now = new Date();
  const expired = await ctx.db
    .select({ id: importBatches.id, storagePath: importBatches.storagePath })
    .from(importBatches)
    .where(
      and(
        isNotNull(importBatches.storagePath),
        lte(importBatches.expiresAt, now),
      ),
    )
    .limit(CLEANUP_BATCH_SIZE);

  const toDelete = expired.filter(
    (batch): batch is { id: string; storagePath: string } =>
      typeof batch.storagePath === "string" && batch.storagePath.length > 0,
  );
  if (toDelete.length === 0) return { deleted: 0 };

  const bucket = getImportBucketName();
  let deleted = 0;

  const removed = await ctx.supabase.storage
    .from(bucket)
    .remove(toDelete.map((batch) => batch.storagePath));
  if (!removed.error) {
    await ctx.db
      .update(importBatches)
      .set({ status: "expired", storagePath: null })
      .where(
        inArray(
          importBatches.id,
          toDelete.map((batch) => batch.id),
        ),
      );
    deleted = toDelete.length;
  }

  return { deleted };
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
          name: row.accountName,
          provider: row.provider,
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
          name: row.instrumentName,
          symbol: row.symbol,
          isin: "isin" in row ? row.isin : undefined,
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
        ? eq(sql<string>`upper(${instruments.symbol})`, identity.symbol)
        : and(
            isNull(instruments.symbol),
            eq(sql<string>`lower(${instruments.name})`, identity.name),
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

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
