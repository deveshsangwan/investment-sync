import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireCurrentMembership, requireOwner } from "./model/auth";
import { importLimits, storageChecksumToHex } from "./model/importLimits";
import {
  batchToView,
  beginParse,
  requireBatch,
  sourceFile,
} from "./model/imports";
import { batchView } from "./model/importValidators";

export const createUpload = mutation({
  args: {
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    sizeBytes: v.number(),
  },
  returns: v.object({ batchId: v.id("importBatches"), uploadUrl: v.string() }),
  handler: async (ctx, args) => {
    const { user, household } = await requireOwner(ctx);
    if (
      !args.fileName.trim() ||
      args.fileName.length > 255 ||
      !/\.(csv|xlsx)$/i.test(args.fileName)
    )
      throw new ConvexError({
        code: "VALIDATION",
        message: "Import files must be CSV or XLSX files",
      });
    if (
      !Number.isSafeInteger(args.sizeBytes) ||
      args.sizeBytes < 1 ||
      args.sizeBytes > importLimits.fileBytes
    )
      throw new ConvexError({
        code: "CAPACITY",
        message: "Import files must be 256 KiB or smaller",
      });
    const mimeType = args.mimeType?.trim().toLowerCase();
    if (
      mimeType &&
      ![
        "text/csv",
        "application/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ].includes(mimeType)
    )
      throw new ConvexError({
        code: "VALIDATION",
        message: "Import file type is not supported",
      });

    const batchId = await ctx.db.insert("importBatches", {
      ...args,
      mimeType,
      householdId: household._id,
      uploaderId: user._id,
      status: "awaiting_upload",
      attempt: 0,
      createdAt: Date.now(),
      rowCount: 0,
      normalizedBytes: 0,
      previewRowsJson: "[]",
      warnings: [],
    });
    await ctx.db.insert("sourceFiles", {
      batchId,
      householdId: household._id,
      uploaderId: user._id,
      status: "reserved",
      expiresAt: Date.now() + importLimits.uploadGraceMs,
    });
    return { batchId, uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const attachUpload = mutation({
  args: { batchId: v.id("importBatches"), storageId: v.id("_storage") },
  returns: v.id("importBatches"),
  handler: async (ctx, args) => {
    const batch = await requireBatch(ctx, args.batchId, true);
    const file = await sourceFile(ctx, batch._id);
    if (file.storageId === args.storageId) return batch._id;
    if (
      batch.status !== "awaiting_upload" ||
      file.status !== "reserved" ||
      file.expiresAt <= Date.now()
    )
      throw new ConvexError({
        code: "CONFLICT",
        message: "Upload reservation has expired or already been used",
      });
    const claimed = await ctx.db
      .query("sourceFiles")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (claimed) throw new ConvexError({ code: "NOT_FOUND" });
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (
      !metadata ||
      metadata._creationTime < batch.createdAt ||
      metadata.size !== batch.sizeBytes ||
      metadata.size > importLimits.fileBytes ||
      (batch.mimeType && metadata.contentType !== batch.mimeType)
    )
      throw new ConvexError({
        code: "VALIDATION",
        message: "Uploaded file metadata does not match the reservation",
      });

    await ctx.db.patch("sourceFiles", file._id, {
      storageId: args.storageId,
      status: "stored",
      expiresAt: Date.now() + importLimits.retentionMs,
      sizeBytes: metadata.size,
      contentHash: storageChecksumToHex(metadata.sha256),
    });
    const attempt = await beginParse(ctx, batch);
    await ctx.scheduler.runAfter(0, internal.actions.parseImport.parseImport, {
      batchId: batch._id,
      attempt,
    });
    return batch._id;
  },
});

export const retryParse = mutation({
  args: { batchId: v.id("importBatches") },
  returns: v.id("importBatches"),
  handler: async (ctx, { batchId }) => {
    const batch = await requireBatch(ctx, batchId, true);
    if (
      batch.status !== "failed" &&
      !(
        batch.status === "parsing" &&
        (batch.leaseExpiresAt ?? Infinity) <= Date.now()
      )
    )
      throw new ConvexError({
        code: "CONFLICT",
        message: "Only a failed or timed-out parse can be retried",
      });
    const file = await sourceFile(ctx, batchId);
    if (
      !file.storageId ||
      file.status !== "stored" ||
      file.expiresAt <= Date.now()
    )
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Source file is no longer available",
      });
    const attempt = await beginParse(ctx, batch);
    await ctx.scheduler.runAfter(0, internal.actions.parseImport.parseImport, {
      batchId,
      attempt,
    });
    await ctx.scheduler.runAfter(0, internal.importCleanup.obsoleteChunks, {
      batchId,
      beforeAttempt: attempt,
    });
    return batchId;
  },
});

export const get = query({
  args: { batchId: v.id("importBatches") },
  returns: batchView,
  handler: async (ctx, { batchId }) =>
    batchToView(ctx, await requireBatch(ctx, batchId)),
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(batchView),
  handler: async (ctx, args) => {
    const { household } = await requireCurrentMembership(ctx);
    if (args.paginationOpts.numItems > 50)
      throw new ConvexError({
        code: "CAPACITY",
        message: "Page size must not exceed 50",
      });
    const result = await ctx.db
      .query("importBatches")
      .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((batch) => batchToView(ctx, batch)),
      ),
    };
  },
});
