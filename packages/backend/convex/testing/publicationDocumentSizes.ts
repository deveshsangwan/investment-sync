import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { utf8Bytes } from "../model/importLimits";

function projectionRange(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  table: string,
) {
  switch (table) {
    case "portfolioHistoryFacts":
      return ctx.db
        .query(table)
        .withIndex("by_versionId_and_key", (q) => q.eq("versionId", versionId));
    case "portfolioHistoryScopes":
      return ctx.db
        .query(table)
        .withIndex("by_versionId_and_key_and_index", (q) =>
          q.eq("versionId", versionId),
        );
    case "portfolioPositions":
      return ctx.db
        .query(table)
        .withIndex("by_versionId_and_positionKey", (q) =>
          q.eq("versionId", versionId),
        );
    case "portfolioSummaries":
      return ctx.db
        .query(table)
        .withIndex("by_versionId", (q) => q.eq("versionId", versionId));
    case "assetClassSummaries":
      return ctx.db
        .query(table)
        .withIndex("by_versionId_and_assetClass", (q) =>
          q.eq("versionId", versionId),
        );
    case "portfolioTimeline":
      return ctx.db
        .query(table)
        .withIndex("by_versionId_and_assetClass_and_date", (q) =>
          q.eq("versionId", versionId),
        );
    case "publicationReceipts":
      return ctx.db
        .query(table)
        .withIndex("by_versionId_and_stage_and_index", (q) =>
          q.eq("versionId", versionId),
        );
    default:
      throw new Error("Unsupported projection table");
  }
}

export const page = internalQuery({
  args: {
    batchId: v.id("importBatches"),
    table: v.union(
      v.literal("portfolioVersions"),
      v.literal("portfolioHistoryFacts"),
      v.literal("portfolioHistoryScopes"),
      v.literal("portfolioPositions"),
      v.literal("portfolioSummaries"),
      v.literal("assetClassSummaries"),
      v.literal("portfolioTimeline"),
      v.literal("publicationReceipts"),
      v.literal("holdingSnapshots"),
      v.literal("transactions"),
      v.literal("portfolioValuations"),
    ),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    count: v.number(),
    maxSerializedBytes: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    if (process.env.APP_ENV !== "development")
      throw new Error("Document size inspection is restricted to development");
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (
      !batch?.fileName.startsWith("fake-capacity-") ||
      !batch.committedVersionId
    )
      throw new Error("Committed fake capacity batch required");
    const version = await ctx.db.get(
      "portfolioVersions",
      batch.committedVersionId,
    );
    if (
      !version ||
      version.batchId !== batch._id ||
      version.householdId !== batch.householdId
    )
      throw new Error("Capacity version ownership mismatch");

    if (args.table === "portfolioVersions")
      return {
        count: 1,
        maxSerializedBytes: utf8Bytes(JSON.stringify(version)),
        isDone: true,
        continueCursor: "",
      };
    const range =
      args.table === "holdingSnapshots" ||
      args.table === "transactions" ||
      args.table === "portfolioValuations"
        ? ctx.db
            .query(args.table)
            .withIndex("by_batchId", (q) => q.eq("batchId", batch._id))
        : projectionRange(ctx, version._id, args.table);
    const result = await range.paginate({
      cursor: args.cursor,
      numItems: 100,
      maximumBytesRead: 524288,
    });
    return {
      count: result.page.length,
      maxSerializedBytes: result.page.reduce(
        (maximum, doc) => Math.max(maximum, utf8Bytes(JSON.stringify(doc))),
        0,
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
