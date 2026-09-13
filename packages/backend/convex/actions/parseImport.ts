"use node";

import { createHash } from "node:crypto";
import {
  parseExactImportFile,
  type ImportFile,
} from "@investment-sync/importers";
import { ConvexError, v } from "convex/values";
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
        throw new ConvexError(
          "Source file is unavailable or exceeds the import limit",
        );
      const content = Buffer.from(await blob.arrayBuffer());
      const contentHash = createHash("sha256").update(content).digest("hex");
      if (contentHash !== input.contentHash)
        throw new ConvexError("Source file checksum mismatch");
      const result = parseSourceFile({
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
        throw new ConvexError(
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
      console.error("Import parsing failed", error);

      await ctx.runMutation(internal.importWorkers.failParse, {
        ...args,
        errorMessage: parseFailureMessage(error),
      });
    }
    return null;
  },
});

function parseSourceFile(file: ImportFile) {
  try {
    return parseExactImportFile(file);
  } catch (error) {
    // Preserve the parser messages exposed by the legacy upload response.
    throw new ConvexError(
      error instanceof Error ? error.message : "Import file is invalid",
    );
  }
}

function parseFailureMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string")
    return error.data;

  return "This file could not be parsed. Try again or choose another file.";
}
