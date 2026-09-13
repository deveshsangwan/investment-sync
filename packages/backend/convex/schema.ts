import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  batchStatus,
  fileStatus,
  manifestEntry,
} from "./model/importValidators";

export default defineSchema({
  importBatches: defineTable({
    householdId: v.id("households"),
    uploaderId: v.id("users"),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
    sizeBytes: v.number(),
    status: batchStatus,
    attempt: v.number(),
    createdAt: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    stagingExpiresAt: v.optional(v.number()),
    rowCount: v.number(),
    normalizedBytes: v.number(),
    previewRowsJson: v.string(),
    warnings: v.array(v.string()),
    errorMessage: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    parserVersion: v.optional(v.string()),
    sourceType: v.optional(v.string()),
    manifest: v.optional(v.array(manifestEntry)),
    committedVersionId: v.optional(v.string()),
    processedAt: v.optional(v.number()),
    committedAt: v.optional(v.number()),
  })
    .index("by_householdId", ["householdId"])
    .index("by_status_and_leaseExpiresAt", ["status", "leaseExpiresAt"])
    .index("by_status_and_stagingExpiresAt", ["status", "stagingExpiresAt"]),
  sourceFiles: defineTable({
    batchId: v.id("importBatches"),
    householdId: v.id("households"),
    uploaderId: v.id("users"),
    status: fileStatus,
    storageId: v.optional(v.id("_storage")),
    expiresAt: v.number(),
    sizeBytes: v.optional(v.number()),
    contentHash: v.optional(v.string()),
  })
    .index("by_batchId", ["batchId"])
    .index("by_storageId", ["storageId"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
  importRowChunks: defineTable({
    batchId: v.id("importBatches"),
    attempt: v.number(),
    index: v.number(),
    count: v.number(),
    bytes: v.number(),
    digest: v.string(),
    rowsJson: v.string(),
  }).index("by_batchId_and_attempt_and_index", ["batchId", "attempt", "index"]),
  importDedupeKeys: defineTable({
    householdId: v.id("households"),
    key: v.string(),
    batchId: v.id("importBatches"),
  }).index("by_householdId_and_key", ["householdId", "key"]),
  users: defineTable({
    clerkSubject: v.string(),
    email: v.optional(v.string()),
  }).index("by_clerk_subject", ["clerkSubject"]),
  households: defineTable({
    ownerUserId: v.id("users"),
    name: v.string(),
  }).index("by_owner", ["ownerUserId"]),
  householdMembers: defineTable({
    householdId: v.id("households"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("viewer")),
  })
    .index("by_user", ["userId"])
    .index("by_household_user", ["householdId", "userId"]),
});
