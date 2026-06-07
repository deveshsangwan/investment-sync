import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  accounts,
  holdingSnapshots,
  importBatches,
  importRows,
  instruments,
  portfolioValuations,
  transactions,
} from "@investment-sync/db";
import {
  parseImportFile,
  type ImportFile,
  type NormalizedHoldingRow,
  type NormalizedTransactionRow,
  type NormalizedValuationRow,
} from "@investment-sync/importers";
import type { ApiContext } from "../context";
import type { MembershipContext } from "./membership";
import { clearHouseholdPortfolioCache } from "./portfolio-cache";

const IMPORT_TTL_DAYS = 30;
const IMPORT_BUCKET = process.env.SUPABASE_IMPORT_BUCKET ?? "portfolio-imports";

async function ensureImportBucket(ctx: ApiContext) {
  const existing = await ctx.supabase.storage.getBucket(IMPORT_BUCKET);
  if (!existing.error) return;

  const created = await ctx.supabase.storage.createBucket(IMPORT_BUCKET, {
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
  await ensureImportBucket(ctx);
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
    .from(IMPORT_BUCKET)
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
  const storageUpload = await ctx.supabase.storage
    .from(IMPORT_BUCKET)
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
  const parsed = parseImportFile(input);

  await ctx.db
    .update(importBatches)
    .set({
      sourceType: parsed.sourceType,
      status: "parsed",
      parserVersion: parsed.parserVersion,
      rowCount: parsed.rows.length,
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

  if (parsed.rows.length > 0) {
    await ctx.db.insert(importRows).values(
      parsed.rows.map((row, index) => ({
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
    rowCount: parsed.rows.length,
    rows: parsed.rows,
    warnings: parsed.warnings,
  };
}

export async function commitImport(
  ctx: ApiContext,
  membership: MembershipContext,
  importBatchId: string,
) {
  clearHouseholdPortfolioCache(membership.householdId);

  const batchRows = await ctx.db
    .select({ id: importRows.id, payload: importRows.normalizedPayload })
    .from(importRows)
    .innerJoin(importBatches, eq(importRows.importBatchId, importBatches.id))
    .where(
      and(
        eq(importRows.importBatchId, importBatchId),
        eq(importBatches.householdId, membership.householdId),
      ),
    );

  let committed = 0;

  for (const row of batchRows) {
    const payload = row.payload as unknown;
    if (isHoldingRow(payload)) {
      const accountId = await findOrCreateAccount(
        ctx,
        membership.householdId,
        payload,
      );
      const instrumentId = await findOrCreateInstrument(ctx, payload);
      const snapshotDate =
        payload.sourceDate ?? new Date().toISOString().slice(0, 10);

      await ctx.db
        .insert(holdingSnapshots)
        .values({
          householdId: membership.householdId,
          accountId,
          instrumentId,
          importBatchId,
          snapshotDate,
          quantity: payload.quantity?.toString(),
          investedAmount: payload.investedAmount.toString(),
          currentValue: payload.currentValue.toString(),
          pnlAmount: payload.pnlAmount?.toString(),
          pnlPercent: payload.pnlPercent?.toString(),
          currency: payload.currency,
          sourcePayload: payload.metadata,
        })
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
            quantity: payload.quantity?.toString(),
            investedAmount: payload.investedAmount.toString(),
            currentValue: payload.currentValue.toString(),
            pnlAmount: payload.pnlAmount?.toString(),
            pnlPercent: payload.pnlPercent?.toString(),
            sourcePayload: payload.metadata,
          },
        });
    } else if (isTransactionRow(payload)) {
      const accountId = await findOrCreateAccount(
        ctx,
        membership.householdId,
        payload,
      );
      const instrumentId = await findOrCreateInstrument(ctx, payload);

      await ctx.db
        .insert(transactions)
        .values({
          householdId: membership.householdId,
          accountId,
          instrumentId,
          importBatchId,
          type: payload.type,
          tradeDate: payload.tradeDate,
          quantity: payload.quantity?.toString(),
          price: payload.price?.toString(),
          amount: payload.amount.toString(),
          currency: payload.currency,
          metadata: payload.metadata,
        })
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
            quantity: payload.quantity?.toString(),
            price: payload.price?.toString(),
            metadata: payload.metadata,
          },
        });
    } else if (isValuationRow(payload)) {
      await ctx.db
        .insert(portfolioValuations)
        .values({
          householdId: membership.householdId,
          valuationDate: payload.valuationDate,
          investedAmount: payload.investedAmount.toString(),
          currentValue: payload.currentValue.toString(),
          pnlAmount: (
            payload.pnlAmount ?? payload.currentValue - payload.investedAmount
          ).toString(),
          currency: payload.currency,
          metadata: payload.metadata,
        })
        .onConflictDoUpdate({
          target: [
            portfolioValuations.householdId,
            portfolioValuations.valuationDate,
          ],
          set: {
            investedAmount: payload.investedAmount.toString(),
            currentValue: payload.currentValue.toString(),
            pnlAmount: (
              payload.pnlAmount ?? payload.currentValue - payload.investedAmount
            ).toString(),
            currency: payload.currency,
            metadata: payload.metadata,
          },
        });
    } else {
      continue;
    }

    await ctx.db
      .update(importRows)
      .set({ isCommitted: true })
      .where(eq(importRows.id, row.id));
    committed += 1;
  }

  await ctx.db
    .update(importBatches)
    .set({ status: "committed", committedAt: new Date() })
    .where(
      and(
        eq(importBatches.id, importBatchId),
        eq(importBatches.householdId, membership.householdId),
      ),
    );

  clearHouseholdPortfolioCache(membership.householdId);

  return { committed };
}

export async function cleanupExpiredImportFiles(ctx: ApiContext) {
  const now = new Date();
  const expired = await ctx.db
    .select({ id: importBatches.id, storagePath: importBatches.storagePath })
    .from(importBatches)
    .where(eq(importBatches.status, "committed"));

  const toDelete = expired.filter((batch) => batch.storagePath);
  let deleted = 0;

  for (const batch of toDelete) {
    const fullBatch = await ctx.db
      .select({ expiresAt: importBatches.expiresAt })
      .from(importBatches)
      .where(eq(importBatches.id, batch.id))
      .limit(1);
    if (!fullBatch[0] || fullBatch[0].expiresAt > now || !batch.storagePath)
      continue;

    const removed = await ctx.supabase.storage
      .from(IMPORT_BUCKET)
      .remove([batch.storagePath]);
    if (!removed.error) {
      await ctx.db
        .update(importBatches)
        .set({ status: "expired", storagePath: null })
        .where(eq(importBatches.id, batch.id));
      deleted += 1;
    }
  }

  return { deleted };
}

export async function dedupePortfolioData(
  ctx: ApiContext,
  membership: MembershipContext,
) {
  clearHouseholdPortfolioCache(membership.householdId);

  const deletedAggregateHoldingSnapshots = await ctx.db.execute(sql`
    delete from ${holdingSnapshots}
    using ${instruments}
    where ${holdingSnapshots.instrumentId} = ${instruments.id}
      and ${holdingSnapshots.householdId} = ${membership.householdId}
      and (
        ${holdingSnapshots.sourcePayload}->>'isAggregate' = 'true'
        or ${holdingSnapshots.sourcePayload}->>'sourceSheet' = 'Investment Portfolio'
        or ${instruments.name} ilike '% Summary'
      )
    returning ${holdingSnapshots.id}
  `);

  const deletedHoldingSnapshots = await ctx.db.execute(sql`
    with ranked as (
      select
        id,
        row_number() over (
          partition by
            household_id,
            account_id,
            instrument_id,
            snapshot_date,
            currency
          order by created_at desc, id desc
        ) as duplicate_rank
      from ${holdingSnapshots}
      where household_id = ${membership.householdId}
    )
    delete from ${holdingSnapshots}
    using ranked
    where ${holdingSnapshots.id} = ranked.id
      and ranked.duplicate_rank > 1
    returning ${holdingSnapshots.id}
  `);

  const deletedSemanticHoldingSnapshots = await ctx.db.execute(sql`
    with ranked as (
      select
        ${holdingSnapshots.id} as id,
        row_number() over (
          partition by
            ${holdingSnapshots.householdId},
            lower(${accounts.name}),
            lower(${accounts.provider}),
            ${holdingSnapshots.snapshotDate},
            ${holdingSnapshots.currency},
            coalesce(${holdingSnapshots.sourcePayload}->>'sourceSheet', ''),
            coalesce(upper(${instruments.symbol}), lower(${instruments.name}))
          order by ${holdingSnapshots.createdAt} desc, ${holdingSnapshots.id} desc
        ) as duplicate_rank
      from ${holdingSnapshots}
      inner join ${accounts} on ${holdingSnapshots.accountId} = ${accounts.id}
      inner join ${instruments} on ${holdingSnapshots.instrumentId} = ${instruments.id}
      where ${holdingSnapshots.householdId} = ${membership.householdId}
    )
    delete from ${holdingSnapshots}
    using ranked
    where ${holdingSnapshots.id} = ranked.id
      and ranked.duplicate_rank > 1
    returning ${holdingSnapshots.id}
  `);

  const deletedCrossSourceStockSnapshots = await ctx.db.execute(sql`
    with ranked as (
      select
        ${holdingSnapshots.id} as id,
        row_number() over (
          partition by
            ${holdingSnapshots.householdId},
            ${instruments.assetClass},
            coalesce(upper(${instruments.symbol}), lower(${instruments.name})),
            ${holdingSnapshots.currency},
            ${holdingSnapshots.quantity},
            ${holdingSnapshots.investedAmount},
            ${holdingSnapshots.currentValue}
          order by
            ${holdingSnapshots.snapshotDate} desc,
            case
              when ${holdingSnapshots.sourcePayload} ? 'sourceSheet' then 0
              else 1
            end,
            ${holdingSnapshots.createdAt} desc,
            ${holdingSnapshots.id} desc
        ) as duplicate_rank
      from ${holdingSnapshots}
      inner join ${instruments} on ${holdingSnapshots.instrumentId} = ${instruments.id}
      where ${holdingSnapshots.householdId} = ${membership.householdId}
        and ${instruments.assetClass} in ('indian_stock', 'us_stock')
    )
    delete from ${holdingSnapshots}
    using ranked
    where ${holdingSnapshots.id} = ranked.id
      and ranked.duplicate_rank > 1
    returning ${holdingSnapshots.id}
  `);

  const deletedTransactions = await ctx.db.execute(sql`
    with ranked as (
      select
        id,
        row_number() over (
          partition by household_id, account_id, instrument_id, trade_date, type, amount, currency
          order by created_at desc, id desc
        ) as duplicate_rank
      from ${transactions}
      where household_id = ${membership.householdId}
    )
    delete from ${transactions}
    using ranked
    where ${transactions.id} = ranked.id
      and ranked.duplicate_rank > 1
    returning ${transactions.id}
  `);

  clearHouseholdPortfolioCache(membership.householdId);

  return {
    deletedAggregateHoldingSnapshots: deletedAggregateHoldingSnapshots.length,
    deletedHoldingSnapshots: deletedHoldingSnapshots.length,
    deletedSemanticHoldingSnapshots: deletedSemanticHoldingSnapshots.length,
    deletedCrossSourceStockSnapshots: deletedCrossSourceStockSnapshots.length,
    deletedTransactions: deletedTransactions.length,
  };
}

function isHoldingRow(value: unknown): value is NormalizedHoldingRow {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as NormalizedHoldingRow).kind === "holding",
  );
}

function isTransactionRow(value: unknown): value is NormalizedTransactionRow {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as NormalizedTransactionRow).kind === "transaction",
  );
}

function isValuationRow(value: unknown): value is NormalizedValuationRow {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as NormalizedValuationRow).kind === "valuation",
  );
}

type AccountImportRow = NormalizedHoldingRow | NormalizedTransactionRow;

async function findOrCreateAccount(
  ctx: ApiContext,
  householdId: string,
  row: AccountImportRow,
): Promise<string> {
  const existing = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.name, row.accountName),
        eq(accounts.provider, row.provider),
      ),
    )
    .limit(1);

  if (existing[0]) return existing[0].id;

  const [created] = await ctx.db
    .insert(accounts)
    .values({
      householdId,
      name: row.accountName,
      provider: row.provider,
      accountType: row.assetClass,
      currency: row.currency,
    })
    .returning({ id: accounts.id });

  if (!created) throw new Error("Failed to create account");
  return created.id;
}

async function findOrCreateInstrument(
  ctx: ApiContext,
  row: AccountImportRow,
): Promise<string> {
  const existing = await ctx.db
    .select({ id: instruments.id })
    .from(instruments)
    .where(
      row.symbol
        ? eq(instruments.symbol, row.symbol)
        : eq(instruments.name, row.instrumentName),
    )
    .limit(1);

  if (existing[0]) return existing[0].id;

  const [created] = await ctx.db
    .insert(instruments)
    .values({
      name: row.instrumentName,
      symbol: row.symbol,
      isin: "isin" in row ? row.isin : undefined,
      assetClass: row.assetClass,
      currency: row.currency,
    })
    .returning({ id: instruments.id });

  if (!created) throw new Error("Failed to create instrument");
  return created.id;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
