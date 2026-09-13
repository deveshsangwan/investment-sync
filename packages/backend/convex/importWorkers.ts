import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  digest,
  importLimits,
  parseRows,
  utf8Bytes,
  validateIdentityCapacity,
} from "./model/importLimits";
import { currentAttempt, readVerifiedRows, sourceFile } from "./model/imports";
import { manifestEntry } from "./model/importValidators";

export const parseInput = internalQuery({
  args: { batchId: v.id("importBatches"), attempt: v.number() },
  returns: v.object({
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    sizeBytes: v.number(),
    contentHash: v.string(),
  }),
  handler: async (ctx, args) => {
    const batch = await currentAttempt(ctx, args.batchId, args.attempt);
    const file = await sourceFile(ctx, batch._id);
    if (!file.storageId || !file.contentHash || file.status !== "stored")
      throw new Error("Source file is unavailable");
    return {
      storageId: file.storageId,
      fileName: batch.fileName,
      mimeType: batch.mimeType,
      sizeBytes: batch.sizeBytes,
      contentHash: file.contentHash,
    };
  },
});

export const storeChunk = internalMutation({
  args: {
    batchId: v.id("importBatches"),
    attempt: v.number(),
    index: v.number(),
    count: v.number(),
    digest: v.string(),
    rowsJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await currentAttempt(ctx, args.batchId, args.attempt);
    const bytes = utf8Bytes(args.rowsJson);
    if (
      !Number.isSafeInteger(args.index) ||
      args.index < 0 ||
      args.index >= importLimits.chunks ||
      bytes > importLimits.chunkBytes
    )
      throw new Error("Chunk capacity exceeded");
    const rows = parseRows(args.rowsJson);
    if (
      !rows.length ||
      rows.length > importLimits.chunkRows ||
      rows.length !== args.count ||
      digest(args.rowsJson) !== args.digest
    )
      throw new Error("Invalid chunk receipt");
    const existing = await ctx.db
      .query("importRowChunks")
      .withIndex("by_batchId_and_attempt_and_index", (q) =>
        q
          .eq("batchId", args.batchId)
          .eq("attempt", args.attempt)
          .eq("index", args.index),
      )
      .unique();
    if (existing) {
      if (
        existing.digest !== args.digest ||
        existing.rowsJson !== args.rowsJson ||
        existing.count !== args.count
      )
        throw new Error("Conflicting chunk replay");
      return null;
    }

    let stagedRows = batch.stagedRows ?? 0;
    let stagedBytes = batch.stagedBytes ?? 0;
    let stagedChunks = batch.stagedChunks ?? 0;
    if (batch.stagedRows === undefined) {
      const prior = ctx.db
        .query("importRowChunks")
        .withIndex("by_batchId_and_attempt_and_index", (q) =>
          q.eq("batchId", args.batchId).eq("attempt", args.attempt),
        );
      for await (const chunk of prior) {
        stagedRows += chunk.count;
        stagedBytes += chunk.bytes;
        stagedChunks++;
        if (
          stagedRows > importLimits.rows ||
          stagedBytes - stagedChunks + 1 > importLimits.normalizedBytes
        )
          throw new Error("Import capacity exceeded");
      }
    }
    stagedRows += args.count;
    stagedBytes += bytes;
    stagedChunks++;
    if (
      stagedRows > importLimits.rows ||
      stagedBytes - stagedChunks + 1 > importLimits.normalizedBytes
    )
      throw new Error("Import capacity exceeded");

    await ctx.db.insert("importRowChunks", { ...args, bytes });
    await ctx.db.patch("importBatches", batch._id, {
      stagedRows,
      stagedBytes,
      stagedChunks,
    });
    return null;
  },
});

export const finishParse = internalMutation({
  args: {
    batchId: v.id("importBatches"),
    attempt: v.number(),
    contentHash: v.string(),
    parserVersion: v.string(),
    sourceType: v.string(),
    rowCount: v.number(),
    normalizedBytes: v.number(),
    manifest: v.array(manifestEntry),
    warnings: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await currentAttempt(ctx, args.batchId, args.attempt);
    if (
      args.rowCount > importLimits.rows ||
      args.rowCount < 1 ||
      args.normalizedBytes > importLimits.normalizedBytes ||
      args.manifest.length > importLimits.chunks ||
      args.warnings.length > 100 ||
      utf8Bytes(JSON.stringify(args.warnings)) > 16384
    )
      throw new Error("Import capacity exceeded");
    const rows = await readVerifiedRows(ctx, { ...batch, ...args });
    validateIdentityCapacity(rows);
    const file = await sourceFile(ctx, batch._id);
    if (file.contentHash !== args.contentHash)
      throw new Error("Source file checksum mismatch");
    const duplicate = await ctx.db
      .query("importDedupeKeys")
      .withIndex("by_householdId_and_key", (q) =>
        q
          .eq("householdId", batch.householdId)
          .eq("key", `${args.contentHash}:${args.parserVersion}`),
      )
      .unique();
    if (duplicate)
      throw new Error(
        "This file and parser version have already been committed",
      );

    await ctx.db.patch("importBatches", args.batchId, {
      contentHash: args.contentHash,
      parserVersion: args.parserVersion,
      sourceType: args.sourceType,
      rowCount: args.rowCount,
      normalizedBytes: args.normalizedBytes,
      manifest: args.manifest,
      warnings: args.warnings,
      status: "parsed",
      previewRowsJson: JSON.stringify(rows.slice(0, 3)),
      processedAt: Date.now(),
      leaseExpiresAt: undefined,
      stagingExpiresAt: undefined,
    });
    console.info(
      "import.staging.metrics",
      JSON.stringify(await ctx.meta.getTransactionMetrics()),
    );
    return null;
  },
});

export const failParse = internalMutation({
  args: {
    batchId: v.id("importBatches"),
    attempt: v.number(),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (batch?.attempt === args.attempt && batch.status === "parsing")
      await ctx.db.patch("importBatches", batch._id, {
        status: "failed",
        errorMessage: args.errorMessage.slice(0, 1000),
        leaseExpiresAt: undefined,
      });
    return null;
  },
});
