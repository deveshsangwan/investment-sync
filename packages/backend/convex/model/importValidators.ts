import { v } from "convex/values";

export const batchStatus = v.union(
  v.literal("awaiting_upload"),
  v.literal("uploaded"),
  v.literal("parsing"),
  v.literal("parsed"),
  v.literal("failed"),
  v.literal("committed"),
);
export const fileStatus = v.union(
  v.literal("reserved"),
  v.literal("stored"),
  v.literal("delete_failed"),
  v.literal("deleted"),
);
export const manifestEntry = v.object({
  index: v.number(),
  count: v.number(),
  bytes: v.number(),
  digest: v.string(),
});
export const batchView = v.object({
  id: v.id("importBatches"),
  fileName: v.string(),
  status: batchStatus,
  createdAt: v.number(),
  rowCount: v.number(),
  previewRowsJson: v.string(),
  warnings: v.array(v.string()),
  errorMessage: v.union(v.string(), v.null()),
  parserVersion: v.union(v.string(), v.null()),
  sourceType: v.union(v.string(), v.null()),
  fileAvailable: v.boolean(),
  expiresAt: v.number(),
  processedAt: v.union(v.number(), v.null()),
  committedAt: v.union(v.number(), v.null()),
});
