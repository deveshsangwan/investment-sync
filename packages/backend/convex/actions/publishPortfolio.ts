"use node";

import { performance } from "node:perf_hooks";
import {
  buildPortfolioPublication,
  type PortfolioFact,
} from "@investment-sync/portfolio-domain";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  digest,
  importLimits,
  parseRows,
  utf8Bytes,
} from "../model/importLimits";
import { decodeFact } from "../model/portfolioEncoding";
import { portfolioLimits } from "../model/portfolioLimits";
import { projectionRecords } from "../model/publicationProjection";
import {
  publicationLimits,
  publicationPayloadChunks,
} from "../model/publicationStages";

export const publishPortfolio = internalAction({
  args: { versionId: v.id("portfolioVersions"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const started = performance.now();
      const input = await ctx.runQuery(internal.publicationInput.header, args);
      const existingFacts: PortfolioFact[] = [];
      let inputBytes = 0;
      for (const table of [
        "holdingSnapshots",
        "transactions",
        "portfolioValuations",
      ] as const) {
        let cursor: string | null = null;
        do {
          const page: {
            page: Array<{ factJson: string }>;
            isDone: boolean;
            continueCursor: string;
          } = await ctx.runQuery(internal.publicationInput.factsPage, {
            ...args,
            table,
            paginationOpts: { cursor, numItems: 200, maximumBytesRead: 524288 },
          });
          for (const fact of page.page) {
            inputBytes += utf8Bytes(fact.factJson);
            if (
              existingFacts.length >= portfolioLimits.facts ||
              inputBytes > portfolioLimits.householdFactBytes
            )
              throw new Error(
                "Household history exceeds the supported publication capacity",
              );
            existingFacts.push(decodeFact(fact.factJson));
          }
          cursor = page.isDone ? null : page.continueCursor;
        } while (cursor !== null);
      }

      const chunks: Doc<"importRowChunks">[] = [];
      let cursor: string | null = null;
      let chunkBytes = 0;
      const normalizedLimit = input.version.stress
        ? 1048576
        : importLimits.normalizedBytes;
      const rowLimit = input.version.stress ? 1348 : importLimits.rows;
      do {
        const page: {
          page: Doc<"importRowChunks">[];
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runQuery(internal.publicationInput.chunksPage, {
          ...args,
          paginationOpts: { cursor, numItems: 20, maximumBytesRead: 524288 },
        });
        for (const chunk of page.page) {
          chunkBytes += utf8Bytes(chunk.rowsJson);
          if (
            chunks.length >= importLimits.chunks ||
            chunkBytes > normalizedLimit + importLimits.chunks
          )
            throw new Error("Import staging capacity exceeded");
          chunks.push(chunk);
        }
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor !== null);
      if (
        !input.batch.manifest ||
        chunks.length !== input.batch.manifest.length
      )
        throw new Error("Import chunk manifest length mismatch");
      const rows: ReturnType<typeof parseRows> = [];
      for (const [index, chunk] of chunks.entries()) {
        const expected = input.batch.manifest[index];
        if (
          !expected ||
          expected.index !== index ||
          chunk.index !== index ||
          expected.digest !== digest(chunk.rowsJson) ||
          chunk.digest !== expected.digest ||
          expected.bytes !== utf8Bytes(chunk.rowsJson) ||
          chunk.bytes !== expected.bytes ||
          chunk.count !== expected.count
        )
          throw new Error("Import chunk manifest mismatch");
        const values = parseRows(chunk.rowsJson);
        if (values.length !== expected.count)
          throw new Error("Import chunk count mismatch");
        rows.push(...values);
      }
      if (
        rows.length !== input.batch.rowCount ||
        rows.length > rowLimit ||
        utf8Bytes(JSON.stringify(rows)) !== input.batch.normalizedBytes ||
        input.batch.normalizedBytes > normalizedLimit ||
        existingFacts.length + rows.length > portfolioLimits.facts
      )
        throw new Error("Publication input capacity or manifest mismatch");
      if (!input.batch.parserVersion) throw new Error("Missing parser version");

      const builderStarted = performance.now();
      const publication = buildPortfolioPublication({
        existingFacts,
        batch: {
          id: input.batch._id,
          parserVersion: input.batch.parserVersion,
          sequence: input.version.sequence,
          fallbackDate: new Date(input.batch.createdAt)
            .toISOString()
            .slice(0, 10),
          rows,
        },
      });
      const resultingFactBytes = publication.factsToPersist.reduce(
        (bytes, fact) =>
          bytes +
          utf8Bytes(
            JSON.stringify({ row: fact.row, provenance: fact.provenance }),
          ),
        inputBytes,
      );
      if (resultingFactBytes > portfolioLimits.householdFactBytes)
        throw new Error(
          "Resulting household history exceeds the supported publication capacity",
        );

      const records = {
        ...projectionRecords(publication.projection),
        facts: publication.factsToPersist,
      };
      console.info(
        "portfolio.builder.metrics",
        JSON.stringify({
          builderMs: performance.now() - builderStarted,
          readMs: builderStarted - started,
          existingFacts: existingFacts.length,
          incomingRows: rows.length,
          inputBytes,
          resultingFactBytes,
          normalizedBytes: input.batch.normalizedBytes,
          factLimit: portfolioLimits.facts,
          byteLimit: portfolioLimits.householdFactBytes,
        }),
      );
      const packets = [];
      for (const stage of [
        "history",
        "positions",
        "scopes",
        "summary",
        "assets",
        "timeline",
        "facts",
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
        throw new Error("Publication manifest capacity exceeded");
      await ctx.runMutation(internal.publicationWorkers.seal, {
        ...args,
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
        await ctx.runMutation(internal.publicationWorkers.stage, {
          ...args,
          stage,
          index,
          payloadJson,
        });
      await ctx.runMutation(internal.publicationWorkers.finalize, args);
    } catch (error) {
      await ctx.runMutation(internal.publicationWorkers.fail, {
        ...args,
        errorMessage:
          error instanceof Error ? error.message : "Publication failed",
      });
    }
    return null;
  },
});
