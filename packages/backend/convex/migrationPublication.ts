"use node";

import {
  buildPortfolioPublication,
  type PortfolioFact,
} from "@investment-sync/portfolio-domain";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { digest, utf8Bytes } from "./model/importLimits";
import { parseJson } from "./model/migrationValidators";
import { decodeFact } from "./model/portfolioEncoding";
import { portfolioLimits } from "./model/portfolioLimits";
import { projectionRecords } from "./model/publicationProjection";
import {
  publicationLimits,
  publicationPayloadChunks,
} from "./model/publicationStages";

export const publish = internalAction({
  args: { runKey: v.string(), legacyHouseholdId: v.string() },
  returns: v.id("portfolioVersions"),
  handler: async (ctx, args) => {
    const prepared: {
      versionId: import("./_generated/dataModel").Id<"portfolioVersions">;
      published: boolean;
    } = await ctx.runMutation(
      internal.migrationProjectionWorkers.prepare,
      args,
    );
    const versionArgs = { runKey: args.runKey, versionId: prepared.versionId };
    if (prepared.published) {
      await linkCommittedBatches(ctx, versionArgs);
      return prepared.versionId;
    }
    const facts: PortfolioFact[] = [];
    let bytes = 0;
    for (const table of [
      "holdingSnapshots",
      "transactions",
      "portfolioValuations",
    ] as const) {
      let cursor: string | null = null;
      do {
        const page: {
          pageJson: string;
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runQuery(internal.migrationProjectionWorkers.factsPage, {
          ...versionArgs,
          table,
          paginationOpts: { cursor, numItems: 200, maximumBytesRead: 524288 },
        });
        for (const record of z
          .array(z.object({ factJson: z.string() }))
          .parse(parseJson(page.pageJson))) {
          bytes += utf8Bytes(record.factJson);
          if (
            facts.length >= portfolioLimits.facts ||
            bytes > portfolioLimits.householdFactBytes
          )
            throw new Error(
              "Legacy household exceeds supported publication capacity",
            );
          facts.push(decodeFact(record.factJson));
        }
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor !== null);
    }
    const publication = buildPortfolioPublication({ existingFacts: facts });
    const records = projectionRecords(publication.projection);
    const packets = [];
    for (const stage of [
      "history",
      "positions",
      "scopes",
      "summary",
      "assets",
      "timeline",
    ] as const) {
      const chunks = publicationPayloadChunks(
        records[stage],
        stage === "scopes"
          ? records.scopes.map((scope) => scope.historyKeys.length)
          : undefined,
      );
      for (const [index, chunk] of chunks.entries())
        packets.push({
          stage,
          index,
          ...chunk,
          bytes: utf8Bytes(chunk.payloadJson),
          digest: digest(chunk.payloadJson),
        });
    }
    if (packets.length > publicationLimits.receipts)
      throw new Error("Legacy publication exceeds supported receipt capacity");
    await ctx.runMutation(internal.migrationProjectionWorkers.seal, {
      ...versionArgs,
      manifest: packets.map(({ stage, index, count, bytes, digest }) => ({
        stage,
        index,
        count,
        bytes,
        digest,
      })),
      publicationDigest: publication.digest,
      factCount: publication.facts.length,
      currentCount: publication.reconciliation.currentCount,
      exitedCount: publication.reconciliation.exitedCount,
    });
    for (const { stage, index, payloadJson } of packets)
      await ctx.runMutation(internal.migrationProjectionWorkers.stage, {
        ...versionArgs,
        stage,
        index,
        payloadJson,
      });
    await ctx.runMutation(
      internal.migrationProjectionWorkers.finalize,
      versionArgs,
    );
    await linkCommittedBatches(ctx, versionArgs);

    return prepared.versionId;
  },
});

async function linkCommittedBatches(
  ctx: import("./_generated/server").ActionCtx,
  versionArgs: {
    runKey: string;
    versionId: import("./_generated/dataModel").Id<"portfolioVersions">;
  },
) {
  let cursor: string | null = null;
  do {
    const page: { pageJson: string; isDone: boolean; continueCursor: string } =
      await ctx.runQuery(
        internal.migrationProjectionWorkers.committedBatchesPage,
        {
          ...versionArgs,
          paginationOpts: { cursor, numItems: 200, maximumBytesRead: 524288 },
        },
      );
    for (const batch of z
      .array(z.object({ legacyBatchId: z.string() }))
      .parse(parseJson(page.pageJson)))
      await ctx.runMutation(
        internal.migrationProjectionWorkers.linkCommittedBatch,
        { ...versionArgs, legacyBatchId: batch.legacyBatchId },
      );
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);
}
