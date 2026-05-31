import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  accounts,
  holdingSnapshots,
  importBatches,
  importRows,
  instruments,
} from "@investment-sync/db";
import {
  parseImportFile,
  type ImportFile,
  type NormalizedHoldingRow,
} from "@investment-sync/importers";
import type { ApiContext } from "../context";
import type { MembershipContext } from "./membership";

const IMPORT_TTL_DAYS = 30;
const IMPORT_BUCKET = process.env.SUPABASE_IMPORT_BUCKET ?? "portfolio-imports";

type AssetClass =
  | "indian_stock"
  | "mutual_fund"
  | "us_stock"
  | "nps"
  | "ulip"
  | "crypto"
  | "cash"
  | "other";
type Currency = "INR" | "USD" | "BTC" | "ETH" | "OTHER";

export async function createImportUpload(
  ctx: ApiContext,
  membership: MembershipContext,
  fileName: string,
) {
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
    .select({ id: importBatches.id, status: importBatches.status })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.householdId, membership.householdId),
        eq(importBatches.fileHash, fileHash),
      ),
    )
    .limit(1);

  if (existing[0]?.status === "committed") {
    throw new Error("This file has already been imported and committed");
  }

  const upload = await createImportUpload(ctx, membership, input.fileName);
  const storageUpload = await ctx.supabase.storage
    .from(IMPORT_BUCKET)
    .upload(upload.storagePath, input.content, {
      contentType: input.mimeType,
      upsert: true,
    });

  if (storageUpload.error) throw storageUpload.error;

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
    if (!isHoldingRow(payload)) continue;

    const accountId = await findOrCreateAccount(
      ctx,
      membership.householdId,
      payload,
    );
    const instrumentId = await findOrCreateInstrument(ctx, payload);
    const snapshotDate =
      payload.sourceDate ?? new Date().toISOString().slice(0, 10);

    await ctx.db.insert(holdingSnapshots).values({
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
    });

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

function isHoldingRow(value: unknown): value is NormalizedHoldingRow {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as NormalizedHoldingRow).kind === "holding",
  );
}

async function findOrCreateAccount(
  ctx: ApiContext,
  householdId: string,
  row: NormalizedHoldingRow,
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
  row: NormalizedHoldingRow,
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
      isin: row.isin,
      assetClass: row.assetClass as AssetClass,
      currency: row.currency as Currency,
    })
    .returning({ id: instruments.id });

  if (!created) throw new Error("Failed to create instrument");
  return created.id;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
