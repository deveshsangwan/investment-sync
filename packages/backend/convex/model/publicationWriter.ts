import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  assetRecordSchema,
  historyRecordSchema,
  identifiedFactSchema,
  parseJson,
  positionRecordSchema,
  scopeRecordSchema,
  publicationLimits,
  summaryRecordSchema,
  timelineRecordSchema,
} from "./publicationStages";

export async function writePublicationRecords(
  ctx: MutationCtx,
  versionId: Id<"portfolioVersions">,
  stage:
    | "history"
    | "positions"
    | "scopes"
    | "summary"
    | "assets"
    | "timeline"
    | "facts",
  json: string,
) {
  const input = parseJson(json);
  switch (stage) {
    case "history": {
      const rows = historyRecordSchema.array().parse(input);
      for (const row of rows) {
        const existing = await ctx.db
          .query("portfolioHistoryFacts")
          .withIndex("by_versionId_and_key", (q) =>
            q.eq("versionId", versionId).eq("key", row.key),
          )
          .unique();
        if (existing) throw new Error("Duplicate publication history key");
        await ctx.db.insert("portfolioHistoryFacts", { versionId, ...row });
      }
      return rows.length;
    }
    case "positions": {
      const rows = positionRecordSchema.array().parse(input);
      for (const row of rows) {
        const existing = await ctx.db
          .query("portfolioPositions")
          .withIndex("by_versionId_and_positionKey", (q) =>
            q.eq("versionId", versionId).eq("positionKey", row.positionKey),
          )
          .unique();
        if (existing) throw new Error("Duplicate publication position key");
        await ctx.db.insert("portfolioPositions", { versionId, ...row });
      }
      return rows.length;
    }
    case "scopes": {
      const rows = scopeRecordSchema
        .array()
        .max(publicationLimits.chunkRows)
        .parse(input);
      if (
        rows.reduce((total, row) => total + row.historyKeys.length, 0) >
        publicationLimits.scopeChunkReferences
      )
        throw new Error("Publication scope reference capacity exceeded");
      for (const { historyKeys, ...row } of rows) {
        const existing = await ctx.db
          .query("portfolioHistoryScopes")
          .withIndex("by_versionId_and_key_and_index", (q) =>
            q
              .eq("versionId", versionId)
              .eq("key", row.key)
              .eq("index", row.index),
          )
          .unique();
        if (existing) throw new Error("Duplicate publication scope key");
        const factIds = [];
        for (const key of historyKeys) {
          const fact = await ctx.db
            .query("portfolioHistoryFacts")
            .withIndex("by_versionId_and_key", (q) =>
              q.eq("versionId", versionId).eq("key", key),
            )
            .unique();
          if (!fact) throw new Error("Missing candidate history fact");
          factIds.push(fact._id);
        }
        await ctx.db.insert("portfolioHistoryScopes", {
          versionId,
          ...row,
          factIds,
        });
      }
      return rows.length;
    }
    case "summary": {
      const rows = summaryRecordSchema.array().max(1).parse(input);
      for (const row of rows) {
        const existing = await ctx.db
          .query("portfolioSummaries")
          .withIndex("by_versionId", (q) => q.eq("versionId", versionId))
          .unique();
        if (existing) throw new Error("Duplicate publication summary");
        await ctx.db.insert("portfolioSummaries", { versionId, ...row });
      }
      return rows.length;
    }
    case "assets": {
      const rows = assetRecordSchema.array().parse(input);
      for (const row of rows) {
        const existing = await ctx.db
          .query("assetClassSummaries")
          .withIndex("by_versionId_and_assetClass", (q) =>
            q.eq("versionId", versionId).eq("assetClass", row.assetClass),
          )
          .unique();
        if (existing) throw new Error("Duplicate publication asset summary");
        await ctx.db.insert("assetClassSummaries", { versionId, ...row });
      }
      return rows.length;
    }
    case "timeline": {
      const rows = timelineRecordSchema.array().parse(input);
      for (const row of rows) {
        const existing = await ctx.db
          .query("portfolioTimeline")
          .withIndex("by_versionId_and_assetClass_and_date", (q) =>
            q
              .eq("versionId", versionId)
              .eq("assetClass", row.assetClass)
              .eq("date", row.date),
          )
          .unique();
        if (existing) throw new Error("Duplicate publication timeline date");
        await ctx.db.insert("portfolioTimeline", { versionId, ...row });
      }
      return rows.length;
    }
    case "facts":
      return identifiedFactSchema.array().parse(input).length;
  }
}
