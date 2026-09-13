import { v } from "convex/values";
import { z } from "zod";
import {
  assetClassSchema,
  currencySchema,
} from "@investment-sync/importers/types";
import { exactNormalizedImportRowSchema } from "@investment-sync/importers/exact-types";
import { provenanceSchema } from "./portfolioEncoding";
import { digest, utf8Bytes } from "./importLimits";

export const stageValidator = v.union(
  v.literal("history"),
  v.literal("positions"),
  v.literal("scopes"),
  v.literal("summary"),
  v.literal("assets"),
  v.literal("timeline"),
  v.literal("facts"),
);
export const publicationReceiptValidator = v.object({
  stage: stageValidator,
  index: v.number(),
  count: v.number(),
  bytes: v.number(),
  digest: v.string(),
});
export const publicationLimits = {
  chunkRows: 100,
  scopeChunkReferences: 500,
  chunkBytes: 65536,
  receipts: 512,
  leaseMs: 15 * 60 * 1000,
} as const;

export function manifestDigest(
  manifest: Array<{
    stage: string;
    index: number;
    count: number;
    bytes: number;
    digest: string;
  }>,
) {
  return digest(
    JSON.stringify(
      manifest.map((entry) => [
        entry.stage,
        entry.index,
        entry.count,
        entry.bytes,
        entry.digest,
      ]),
    ),
  );
}

const totalSchema = z.object({
  currency: currencySchema,
  investedAmount: z.string(),
  currentValue: z.string(),
  pnlAmount: z.string(),
});
export const historyRecordSchema = z.object({
  key: z.string(),
  kind: z.enum(["holding", "transaction", "valuation"]),
  factJson: z.string(),
  assetClass: assetClassSchema.optional(),
  positionKey: z.string().optional(),
  transactionScope: z.string().optional(),
});
export const positionRecordSchema = z.object({
  positionKey: z.string(),
  status: z.enum(["current", "exited", "detail"]),
  assetClass: assetClassSchema,
  holdingJson: z.string(),
  historyScope: z.string(),
  transactionScope: z.string(),
  instrumentHistoryScope: z.string(),
  instrumentTransactionScope: z.string(),
});
export const scopeRecordSchema = z.object({
  key: z.string(),
  index: z.number().int().nonnegative(),
  historyKeys: z.array(z.string()).max(100),
  assetClass: assetClassSchema.optional(),
});
export const summaryRecordSchema = z.object({
  asOfDate: z.string().nullable(),
  totals: z.array(totalSchema),
  hasExplicitValuations: z.boolean(),
  valuationScope: z.string(),
  cashFlowScope: z.string(),
});
export const assetRecordSchema = z.object({
  assetClass: assetClassSchema,
  totals: z.array(totalSchema),
});
export const timelineRecordSchema = z.object({
  assetClass: assetClassSchema.nullable(),
  date: z.string(),
  totals: z.array(totalSchema),
});
const positionIdentity = {
  accountKey: z.string(),
  instrumentKey: z.string(),
  positionKey: z.string(),
};
export const identifiedFactSchema = z.object({
  row: exactNormalizedImportRowSchema,
  provenance: provenanceSchema,
  identity: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("holding"),
      ...positionIdentity,
      sourceGroupKey: z.string(),
      canonicalPositionKey: z.string(),
      snapshotKey: z.string(),
      snapshotDate: z.string(),
    }),
    z.object({
      kind: z.literal("transaction"),
      ...positionIdentity,
      occurrenceKey: z.string(),
    }),
    z.object({ kind: z.literal("valuation"), valuationKey: z.string() }),
  ]),
});

export function parseJson(json: string): unknown {
  return JSON.parse(json);
}

export function publicationPayloadChunks(
  rows: readonly unknown[],
  referenceCounts?: readonly number[],
) {
  if (referenceCounts && referenceCounts.length !== rows.length)
    throw new Error("Publication reference counts do not match rows");
  const chunks: Array<{ payloadJson: string; count: number }> = [];
  let pending: string[] = [];
  let bytes = 2;
  let references = 0;
  for (const [index, row] of rows.entries()) {
    const json = JSON.stringify(row);
    const rowBytes = utf8Bytes(json);
    const rowReferences = referenceCounts?.[index] ?? 0;
    if (
      rowBytes + 2 > publicationLimits.chunkBytes ||
      rowReferences > publicationLimits.scopeChunkReferences
    )
      throw new Error("Publication row exceeds the chunk capacity");
    if (
      pending.length === publicationLimits.chunkRows ||
      bytes + rowBytes + Number(pending.length > 0) >
        publicationLimits.chunkBytes ||
      references + rowReferences > publicationLimits.scopeChunkReferences
    ) {
      chunks.push({
        payloadJson: `[${pending.join(",")}]`,
        count: pending.length,
      });
      pending = [];
      bytes = 2;
      references = 0;
    }
    bytes += rowBytes + Number(pending.length > 0);
    references += rowReferences;
    pending.push(json);
  }
  if (pending.length)
    chunks.push({
      payloadJson: `[${pending.join(",")}]`,
      count: pending.length,
    });
  return chunks;
}
