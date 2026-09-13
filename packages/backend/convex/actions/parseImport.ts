"use node";

import { createHash } from "node:crypto";
import { parseExactImportFile } from "@investment-sync/importers";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  chunkRows,
  digest,
  importLimits,
  parseRows,
  utf8Bytes,
} from "../model/importLimits";

export const parseImport = internalAction({
  args: { batchId: v.id("importBatches"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const input = await ctx.runQuery(internal.importWorkers.parseInput, args);
      const blob = await ctx.storage.get(input.storageId);
      if (
        !blob ||
        blob.size !== input.sizeBytes ||
        blob.size > importLimits.fileBytes
      )
        throw new Error(
          "Source file is unavailable or exceeds the import limit",
        );
      const content = Buffer.from(await blob.arrayBuffer());
      const contentHash = createHash("sha256").update(content).digest("hex");
      if (contentHash !== input.contentHash)
        throw new Error("Source file checksum mismatch");
      const result = parseExactImportFile({
        fileName: input.fileName,
        mimeType: input.mimeType,
        content,
      });
      const normalizedBytes = utf8Bytes(JSON.stringify(result.rows));
      if (
        !result.rows.length ||
        result.rows.length > importLimits.rows ||
        normalizedBytes > importLimits.normalizedBytes
      )
        throw new Error(
          "Import exceeds 1100 rows or 512 KiB of normalized data",
        );

      const chunks = chunkRows(result.rows);
      const manifest = [];
      for (const [index, rowsJson] of chunks.entries()) {
        const count = parseRows(rowsJson).length;
        const receipt = {
          index,
          count,
          bytes: utf8Bytes(rowsJson),
          digest: digest(rowsJson),
        };
        await ctx.runMutation(internal.importWorkers.storeChunk, {
          ...args,
          index,
          count,
          digest: receipt.digest,
          rowsJson,
        });
        manifest.push(receipt);
      }

      await ctx.runMutation(internal.importWorkers.finishParse, {
        ...args,
        manifest,
        contentHash,
        sourceType: result.sourceType,
        parserVersion: result.parserVersion,
        rowCount: result.rows.length,
        normalizedBytes,
        warnings: result.warnings,
      });
    } catch (error) {
      await ctx.runMutation(internal.importWorkers.failParse, {
        ...args,
        errorMessage:
          error instanceof Error ? error.message : "Import parsing failed",
      });
    }
    return null;
  },
});
