import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

function cleanupRange(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  stage: number,
) {
  switch (stage) {
    case 0:
      return ctx.db
        .query("portfolioPositions")
        .withIndex("by_versionId_and_positionKey", (q) =>
          q.eq("versionId", versionId),
        );
    case 1:
      return ctx.db
        .query("portfolioHistoryScopes")
        .withIndex("by_versionId_and_key_and_index", (q) =>
          q.eq("versionId", versionId),
        );
    case 2:
      return ctx.db
        .query("portfolioHistoryFacts")
        .withIndex("by_versionId_and_key", (q) => q.eq("versionId", versionId));
    case 3:
      return ctx.db
        .query("portfolioSummaries")
        .withIndex("by_versionId", (q) => q.eq("versionId", versionId));
    case 4:
      return ctx.db
        .query("assetClassSummaries")
        .withIndex("by_versionId_and_assetClass", (q) =>
          q.eq("versionId", versionId),
        );
    case 5:
      return ctx.db
        .query("portfolioTimeline")
        .withIndex("by_versionId_and_assetClass_and_date", (q) =>
          q.eq("versionId", versionId),
        );
    case 6:
      return ctx.db
        .query("publicationReceipts")
        .withIndex("by_versionId_and_stage_and_index", (q) =>
          q.eq("versionId", versionId),
        );
    default:
      throw new Error("Invalid publication cleanup stage");
  }
}

export const cleanupVersion = internalMutation({
  args: { versionId: v.id("portfolioVersions"), stage: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("portfolioVersions", args.versionId);
    if (
      !version ||
      version.projectionDeletedAt ||
      version.expiresAt > Date.now() ||
      version.publicationState === "building"
    )
      return null;
    const household = await ctx.db.get("households", version.householdId);
    const candidate = household?.publishingVersionId
      ? await ctx.db.get("portfolioVersions", household.publishingVersionId)
      : null;
    if (
      household?.activePortfolioVersionId === version._id ||
      candidate?.baseVersionId === version._id
    )
      return null;
    const rows = await cleanupRange(ctx, version._id, args.stage).take(100);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 100)
      await ctx.scheduler.runAfter(
        0,
        internal.publicationCleanup.cleanupVersion,
        args,
      );
    else if (args.stage < 6)
      await ctx.scheduler.runAfter(
        0,
        internal.publicationCleanup.cleanupVersion,
        { ...args, stage: args.stage + 1 },
      );
    else
      await ctx.db.patch("portfolioVersions", version._id, {
        projectionDeletedAt: Date.now(),
        cleanupState: "done",
        rootManifest: undefined,
      });
    return null;
  },
});

export const sweep = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("portfolioVersions")
      .withIndex("by_cleanupState_and_expiresAt", (q) =>
        q.eq("cleanupState", "pending").lte("expiresAt", Date.now()),
      )
      .paginate({ cursor: args.cursor, numItems: 20 });
    for (const version of page.page)
      await ctx.scheduler.runAfter(
        0,
        internal.publicationCleanup.cleanupVersion,
        { versionId: version._id, stage: 0 },
      );
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.publicationCleanup.sweep, {
        cursor: page.continueCursor,
      });
    return null;
  },
});
