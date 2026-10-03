import { z } from "zod";
import { exactNormalizedImportRowSchema } from "@investment-sync/importers/exact-types";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { digest, importLimits, parseRows, utf8Bytes } from "./importLimits";
import { canonicalJson, parseJson } from "./migrationValidators";

const manifestSchema = z
  .array(
    z.object({
      index: z.number().int().nonnegative(),
      count: z.number().int().positive(),
      bytes: z.number().int().positive(),
      digest: z.string(),
    }),
  )
  .max(importLimits.chunks);
const sourceRowsSchema = z.array(
  z.object({
    rowNumber: z.number().int().positive(),
    row: exactNormalizedImportRowSchema,
  }),
);
const chunksSchema = z.array(
  z.object({
    index: z.number().int().nonnegative(),
    count: z.number().int().positive(),
    bytes: z.number().int().positive(),
    digest: z.string(),
    rowsJson: z.string(),
  }),
);

export async function auditPackedNormalizedRows(
  ctx: ActionCtx,
  args: { runKey: string; legacyBatchId: string },
) {
  const state: {
    rowCount: number;
    normalizedBytes: number;
    previewRowsJson: string;
    manifestJson: string;
  } = await ctx.runQuery(internal.migrationAudit.normalizedBatchState, args);
  const manifest = manifestSchema.parse(parseJson(state.manifestJson));
  const expectedRows: ReturnType<typeof parseRows> = [];
  let cursor: string | null = null;
  let previousRowNumber = 0;
  let sourceBytes = 2;
  do {
    const page: { rowsJson: string; isDone: boolean; continueCursor: string } =
      await ctx.runQuery(internal.migrationAudit.sourceNormalizedRowsPage, {
        ...args,
        paginationOpts: { cursor, numItems: 20, maximumBytesRead: 524288 },
      });
    for (const { rowNumber, row } of sourceRowsSchema.parse(
      parseJson(page.rowsJson),
    )) {
      if (rowNumber <= previousRowNumber)
        throw new Error("Normalized source row order is not unique");
      previousRowNumber = rowNumber;
      sourceBytes +=
        utf8Bytes(JSON.stringify(row)) + Number(expectedRows.length > 0);
      expectedRows.push(row);
      if (
        expectedRows.length > importLimits.rows ||
        sourceBytes > importLimits.normalizedBytes
      )
        throw new Error("Normalized source rows exceed supported capacity");
    }
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);

  const actualRows: ReturnType<typeof parseRows> = [];
  cursor = null;
  let chunkIndex = 0;
  let actualBytes = 2;
  do {
    const page: {
      chunksJson: string;
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(internal.migrationAudit.packedChunksPage, {
      ...args,
      paginationOpts: { cursor, numItems: 10, maximumBytesRead: 524288 },
    });
    for (const chunk of chunksSchema.parse(parseJson(page.chunksJson))) {
      const expected = manifest[chunkIndex];
      if (
        !expected ||
        chunk.index !== chunkIndex ||
        expected.index !== chunkIndex ||
        chunk.digest !== digest(chunk.rowsJson) ||
        chunk.digest !== expected.digest ||
        chunk.bytes !== utf8Bytes(chunk.rowsJson) ||
        chunk.bytes !== expected.bytes ||
        chunk.bytes > importLimits.chunkBytes ||
        chunk.count !== expected.count ||
        chunk.count > importLimits.chunkRows
      )
        throw new Error("Normalized chunk integrity mismatch");
      const rows = parseRows(chunk.rowsJson);
      if (rows.length !== chunk.count)
        throw new Error("Normalized chunk row count mismatch");
      for (const row of rows) {
        actualBytes +=
          utf8Bytes(JSON.stringify(row)) + Number(actualRows.length > 0);
        actualRows.push(row);
        if (
          actualRows.length > importLimits.rows ||
          actualBytes > importLimits.normalizedBytes
        )
          throw new Error("Normalized packed rows exceed supported capacity");
      }
      chunkIndex += 1;
    }
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);

  if (
    chunkIndex !== manifest.length ||
    actualRows.length !== state.rowCount ||
    actualBytes !== state.normalizedBytes
  )
    throw new Error("Normalized chunk manifest coverage or totals mismatch");
  if (canonicalJson(actualRows) !== canonicalJson(expectedRows))
    throw new Error(
      "Packed normalized rows differ from authoritative source payloads or row order",
    );
  if (
    canonicalJson(parseJson(state.previewRowsJson)) !==
    canonicalJson(expectedRows.slice(0, 10))
  )
    throw new Error(
      "Normalized preview differs from authoritative source payloads",
    );
}
