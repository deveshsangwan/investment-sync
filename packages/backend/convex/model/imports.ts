import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireCurrentMembership, requireOwner } from "./auth";
import { digest, importLimits, parseRows, utf8Bytes } from "./importLimits";

export async function requireBatch(
  ctx: QueryCtx,
  batchId: Id<"importBatches">,
  owner = false,
) {
  const current = owner
    ? await requireOwner(ctx)
    : await requireCurrentMembership(ctx);
  const batch = await ctx.db.get("importBatches", batchId);

  if (!batch || batch.householdId !== current.household._id)
    throw new ConvexError({ code: "NOT_FOUND" });
  return batch;
}

export async function sourceFile(ctx: QueryCtx, batchId: Id<"importBatches">) {
  const file = await ctx.db
    .query("sourceFiles")
    .withIndex("by_batchId", (q) => q.eq("batchId", batchId))
    .unique();
  if (!file)
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Source file reservation not found",
    });
  return file;
}

export async function currentAttempt(
  ctx: QueryCtx,
  batchId: Id<"importBatches">,
  attempt: number,
) {
  const batch = await ctx.db.get("importBatches", batchId);
  if (!batch || batch.attempt !== attempt || batch.status !== "parsing")
    throw new Error("Parse attempt is no longer active");
  return batch;
}

export async function readVerifiedRows(
  ctx: QueryCtx,
  batch: Doc<"importBatches">,
  limits: { rows: number; normalizedBytes: number } = importLimits,
) {
  if (!batch.manifest) throw new Error("Missing chunk manifest");
  const chunks = await ctx.db
    .query("importRowChunks")
    .withIndex("by_batchId_and_attempt_and_index", (q) =>
      q.eq("batchId", batch._id).eq("attempt", batch.attempt),
    )
    .take(importLimits.chunks + 1);
  if (chunks.length !== batch.manifest.length)
    throw new Error("Chunk manifest length mismatch");

  const rows: ReturnType<typeof parseRows> = [];
  let bytes = 0;
  for (const [index, chunk] of chunks.entries()) {
    const expected = batch.manifest[index];
    if (
      !expected ||
      chunk.index !== index ||
      expected.index !== index ||
      expected.digest !== digest(chunk.rowsJson) ||
      expected.digest !== chunk.digest ||
      expected.count !== chunk.count ||
      expected.bytes !== chunk.bytes ||
      chunk.bytes !== utf8Bytes(chunk.rowsJson)
    )
      throw new Error("Chunk manifest mismatch");
    const values = parseRows(chunk.rowsJson);
    if (values.length !== chunk.count)
      throw new Error("Chunk row count mismatch");
    rows.push(...values);
    bytes += chunk.bytes;
    if (
      rows.length > limits.rows ||
      bytes > limits.normalizedBytes + importLimits.chunks
    )
      throw new Error("Import capacity exceeded");
  }

  if (
    rows.length !== batch.rowCount ||
    utf8Bytes(JSON.stringify(rows)) !== batch.normalizedBytes
  )
    throw new Error("Normalized manifest totals mismatch");
  return rows;
}

export async function batchToView(ctx: QueryCtx, batch: Doc<"importBatches">) {
  const file = await sourceFile(ctx, batch._id);
  return {
    id: batch._id,
    fileName: batch.fileName,
    status: batch.status,
    createdAt: batch.createdAt,
    rowCount: batch.rowCount,
    previewRowsJson: batch.previewRowsJson,
    warnings: batch.warnings,
    errorMessage: batch.errorMessage ?? null,
    parserVersion: batch.parserVersion ?? null,
    sourceType: batch.sourceType ?? null,
    fileAvailable: Boolean(file.storageId && file.status === "stored"),
    expiresAt: file.expiresAt,
    processedAt: batch.processedAt ?? null,
    committedAt: batch.committedAt ?? null,
    committedVersionId: batch.committedVersionId ?? null,
  };
}

export async function beginParse(
  ctx: MutationCtx,
  batch: Doc<"importBatches">,
) {
  const attempt = batch.attempt + 1;
  await ctx.db.patch("importBatches", batch._id, {
    status: "parsing",
    attempt,
    leaseExpiresAt: Date.now() + importLimits.parseLeaseMs,
    stagingExpiresAt: Date.now() + importLimits.retentionMs,
    errorMessage: undefined,
    manifest: undefined,
    rowCount: 0,
    normalizedBytes: 0,
    stagedRows: 0,
    stagedBytes: 0,
    stagedChunks: 0,
    previewRowsJson: "[]",
    warnings: [],
  });
  return attempt;
}
