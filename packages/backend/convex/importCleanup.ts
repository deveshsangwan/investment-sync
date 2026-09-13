import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { importLimits } from "./model/importLimits";
import { expireSourceFile } from "./model/importRetention";

export const obsoleteChunks = internalMutation({
  args: { batchId: v.id("importBatches"), beforeAttempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || args.beforeAttempt > batch.attempt)
      throw new Error("Cannot delete current parse provenance");
    const chunks = await ctx.db
      .query("importRowChunks")
      .withIndex("by_batchId_and_attempt_and_index", (q) =>
        q.eq("batchId", args.batchId).lt("attempt", args.beforeAttempt),
      )
      .take(50);
    for (const chunk of chunks)
      await ctx.db.delete("importRowChunks", chunk._id);
    if (chunks.length === 50)
      await ctx.scheduler.runAfter(
        0,
        internal.importCleanup.obsoleteChunks,
        args,
      );
    return null;
  },
});

export const expireFiles = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const status of ["reserved", "stored", "delete_failed"] as const) {
      const files = await ctx.db
        .query("sourceFiles")
        .withIndex("by_status_and_expiresAt", (q) =>
          q.eq("status", status).lte("expiresAt", Date.now()),
        )
        .take(25);
      for (const file of files) await expireSourceFile(ctx, file);
    }
    return null;
  },
});

export const expireFailedStaging = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const batch = await ctx.db
      .query("importBatches")
      .withIndex("by_status_and_stagingExpiresAt", (q) =>
        q
          .eq("status", "failed")
          .gt("stagingExpiresAt", 0)
          .lte("stagingExpiresAt", Date.now()),
      )
      .first();
    if (!batch) return null;

    const chunks = await ctx.db
      .query("importRowChunks")
      .withIndex("by_batchId_and_attempt_and_index", (q) =>
        q.eq("batchId", batch._id),
      )
      .take(50);
    for (const chunk of chunks)
      await ctx.db.delete("importRowChunks", chunk._id);
    if (chunks.length < 50)
      await ctx.db.patch("importBatches", batch._id, {
        stagingExpiresAt: undefined,
      });

    await ctx.scheduler.runAfter(
      0,
      internal.importCleanup.expireFailedStaging,
      {},
    );
    return null;
  },
});

export const expireParseLeases = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const batches = await ctx.db
      .query("importBatches")
      .withIndex("by_status_and_leaseExpiresAt", (q) =>
        q
          .eq("status", "parsing")
          .gt("leaseExpiresAt", 0)
          .lte("leaseExpiresAt", Date.now()),
      )
      .take(50);
    for (const batch of batches)
      await ctx.db.patch("importBatches", batch._id, {
        status: "failed",
        errorMessage: "Parsing timed out; retry this import",
        leaseExpiresAt: undefined,
      });
    return null;
  },
});

export const sweepOrphans = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - importLimits.uploadGraceMs),
      )
      .paginate({ cursor: args.cursor, numItems: 50 });
    for (const object of page.page) {
      const claim = await ctx.db
        .query("sourceFiles")
        .withIndex("by_storageId", (q) => q.eq("storageId", object._id))
        .unique();
      if (!claim) await ctx.storage.delete(object._id);
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.importCleanup.sweepOrphans, {
        cursor: page.continueCursor,
      });
    return null;
  },
});
