import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requirePublication } from "./model/publication";
import schema from "./schema";

export const header = internalQuery({
  args: { versionId: v.id("portfolioVersions"), attempt: v.number() },
  returns: v.object({
    version: schema.doc("portfolioVersions"),
    batch: schema.doc("importBatches"),
  }),
  handler: async (ctx, args) => {
    const { version, batch } = await requirePublication(
      ctx,
      args.versionId,
      args.attempt,
    );
    return { version, batch };
  },
});

export const factsPage = internalQuery({
  args: {
    versionId: v.id("portfolioVersions"),
    attempt: v.number(),
    table: v.union(
      v.literal("holdingSnapshots"),
      v.literal("transactions"),
      v.literal("portfolioValuations"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(v.object({ factJson: v.string() })),
  handler: async (ctx, args) => {
    const { household } = await requirePublication(
      ctx,
      args.versionId,
      args.attempt,
    );
    if (args.paginationOpts.numItems > 200)
      throw new Error("Publication read page exceeds 200 rows");
    const result = await ctx.db
      .query(args.table)
      .withIndex("by_householdId_and_key", (q) =>
        q.eq("householdId", household._id),
      )
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(({ factJson }) => ({ factJson })),
    };
  },
});

export const chunksPage = internalQuery({
  args: {
    versionId: v.id("portfolioVersions"),
    attempt: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("importRowChunks")),
  handler: async (ctx, args) => {
    const { batch } = await requirePublication(
      ctx,
      args.versionId,
      args.attempt,
    );
    if (args.paginationOpts.numItems > 20)
      throw new Error("Publication read page exceeds 20 chunks");
    return ctx.db
      .query("importRowChunks")
      .withIndex("by_batchId_and_attempt_and_index", (q) =>
        q.eq("batchId", batch._id).eq("attempt", batch.attempt),
      )
      .paginate(args.paginationOpts);
  },
});
