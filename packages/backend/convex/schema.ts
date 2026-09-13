import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  publicationReceiptValidator,
  stageValidator,
} from "./model/publicationStages";
import {
  assetClassValidator,
  currencyValidator,
  nativeTotalValidator,
  positionStatusValidator,
} from "./model/portfolioValidators";
import {
  batchStatus,
  fileStatus,
  manifestEntry,
} from "./model/importValidators";

export default defineSchema({
  publicationReceipts: defineTable({
    versionId: v.id("portfolioVersions"),
    attempt: v.number(),
    stage: stageValidator,
    index: v.number(),
    count: v.number(),
    bytes: v.number(),
    digest: v.string(),
    payloadJson: v.optional(v.string()),
    modelBytesWritten: v.optional(v.number()),
  }).index("by_versionId_and_stage_and_index", ["versionId", "stage", "index"]),
  accounts: defineTable({
    householdId: v.id("households"),
    key: v.string(),
    provider: v.string(),
    name: v.string(),
    accountType: v.string(),
    currency: currencyValidator,
  }).index("by_householdId_and_key", ["householdId", "key"]),
  instruments: defineTable({
    householdId: v.id("households"),
    key: v.string(),
    name: v.string(),
    symbol: v.optional(v.string()),
    assetClass: assetClassValidator,
    currency: currencyValidator,
  }).index("by_householdId_and_key", ["householdId", "key"]),
  holdingSnapshots: defineTable({
    householdId: v.id("households"),
    batchId: v.id("importBatches"),
    key: v.string(),
    positionKey: v.string(),
    instrumentKey: v.string(),
    sourceGroupKey: v.string(),
    date: v.string(),
    factJson: v.string(),
  })
    .index("by_householdId_and_key", ["householdId", "key"])
    .index("by_householdId_and_positionKey_and_date", [
      "householdId",
      "positionKey",
      "date",
    ])
    .index("by_householdId_and_sourceGroupKey_and_date", [
      "householdId",
      "sourceGroupKey",
      "date",
    ])
    .index("by_batchId", ["batchId"]),
  transactions: defineTable({
    householdId: v.id("households"),
    batchId: v.id("importBatches"),
    key: v.string(),
    positionKey: v.string(),
    instrumentKey: v.string(),
    occurrenceKey: v.string(),
    date: v.string(),
    factJson: v.string(),
  })
    .index("by_householdId_and_key", ["householdId", "key"])
    .index("by_householdId_and_positionKey_and_date", [
      "householdId",
      "positionKey",
      "date",
    ])
    .index("by_batchId", ["batchId"]),
  portfolioValuations: defineTable({
    householdId: v.id("households"),
    batchId: v.id("importBatches"),
    key: v.string(),
    date: v.string(),
    factJson: v.string(),
  })
    .index("by_householdId_and_key", ["householdId", "key"])
    .index("by_householdId_and_date", ["householdId", "date"])
    .index("by_batchId", ["batchId"]),
  portfolioVersions: defineTable({
    householdId: v.id("households"),
    batchId: v.id("importBatches"),
    sequence: v.number(),
    digest: v.string(),
    createdAt: v.number(),
    factCount: v.number(),
    currentCount: v.number(),
    exitedCount: v.number(),
    expiresAt: v.number(),
    publicationState: v.optional(
      v.union(
        v.literal("building"),
        v.literal("published"),
        v.literal("failed"),
      ),
    ),
    ownerUserId: v.optional(v.id("users")),
    baseVersionId: v.optional(v.id("portfolioVersions")),
    attempt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    stress: v.optional(v.boolean()),
    forcedFailure: v.optional(v.boolean()),
    rootManifest: v.optional(v.array(publicationReceiptValidator)),
    rootDigest: v.optional(v.string()),
    projectionDeletedAt: v.optional(v.number()),
    cleanupState: v.optional(v.union(v.literal("pending"), v.literal("done"))),
  })
    .index("by_householdId_and_sequence", ["householdId", "sequence"])
    .index("by_batchId", ["batchId"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_cleanupState_and_expiresAt", ["cleanupState", "expiresAt"]),
  portfolioPositions: defineTable({
    versionId: v.id("portfolioVersions"),
    positionKey: v.string(),
    status: positionStatusValidator,
    assetClass: assetClassValidator,
    holdingJson: v.string(),
    historyScope: v.string(),
    transactionScope: v.string(),
    instrumentHistoryScope: v.string(),
    instrumentTransactionScope: v.string(),
  })
    .index("by_versionId_and_positionKey", ["versionId", "positionKey"])
    .index("by_versionId_and_status", ["versionId", "status"])
    .index("by_versionId_and_assetClass", ["versionId", "assetClass"]),
  portfolioHistoryFacts: defineTable({
    versionId: v.id("portfolioVersions"),
    key: v.string(),
    kind: v.union(
      v.literal("holding"),
      v.literal("transaction"),
      v.literal("valuation"),
    ),
    factJson: v.string(),
    assetClass: v.optional(assetClassValidator),
    positionKey: v.optional(v.string()),
    transactionScope: v.optional(v.string()),
  })
    .index("by_versionId_and_key", ["versionId", "key"])
    .index("by_versionId_and_kind_and_key", ["versionId", "kind", "key"])
    .index("by_versionId_and_positionKey_and_kind_and_key", [
      "versionId",
      "positionKey",
      "kind",
      "key",
    ])
    .index("by_versionId_and_assetClass_and_key", [
      "versionId",
      "assetClass",
      "key",
    ])
    .index("by_versionId_and_transactionScope_and_kind_and_key", [
      "versionId",
      "transactionScope",
      "kind",
      "key",
    ]),
  portfolioHistoryScopes: defineTable({
    versionId: v.id("portfolioVersions"),
    key: v.string(),
    index: v.number(),
    factIds: v.array(v.id("portfolioHistoryFacts")),
    assetClass: v.optional(assetClassValidator),
  })
    .index("by_versionId_and_key_and_index", ["versionId", "key", "index"])
    .index("by_versionId_and_assetClass_and_key_and_index", [
      "versionId",
      "assetClass",
      "key",
      "index",
    ]),
  portfolioSummaries: defineTable({
    versionId: v.id("portfolioVersions"),
    asOfDate: v.union(v.string(), v.null()),
    totals: v.array(nativeTotalValidator),
    hasExplicitValuations: v.boolean(),
    valuationScope: v.string(),
    cashFlowScope: v.string(),
  }).index("by_versionId", ["versionId"]),
  assetClassSummaries: defineTable({
    versionId: v.id("portfolioVersions"),
    assetClass: assetClassValidator,
    totals: v.array(nativeTotalValidator),
  }).index("by_versionId_and_assetClass", ["versionId", "assetClass"]),
  portfolioTimeline: defineTable({
    versionId: v.id("portfolioVersions"),
    assetClass: v.union(assetClassValidator, v.null()),
    date: v.string(),
    totals: v.array(nativeTotalValidator),
  }).index("by_versionId_and_assetClass_and_date", [
    "versionId",
    "assetClass",
    "date",
  ]),
  legacyHoldingAliases: defineTable({
    householdId: v.id("households"),
    legacyId: v.string(),
    positionKey: v.string(),
  }).index("by_householdId_and_legacyId", ["householdId", "legacyId"]),
  currencyRates: defineTable({
    base: v.literal("USD"),
    quote: v.literal("INR"),
    provider: v.literal("frankfurter"),
    status: v.union(
      v.literal("fresh"),
      v.literal("stale"),
      v.literal("unavailable"),
    ),
    rate: v.optional(v.string()),
    fetchedAt: v.optional(v.string()),
    refreshRevision: v.number(),
    quoteRevision: v.optional(v.number()),
  }).index("by_base_and_quote_and_provider", ["base", "quote", "provider"]),
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
    stagedRows: v.optional(v.number()),
    stagedBytes: v.optional(v.number()),
    stagedChunks: v.optional(v.number()),
    previewRowsJson: v.string(),
    warnings: v.array(v.string()),
    errorMessage: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    parserVersion: v.optional(v.string()),
    sourceType: v.optional(v.string()),
    manifest: v.optional(v.array(manifestEntry)),
    committedVersionId: v.optional(v.id("portfolioVersions")),
    processedAt: v.optional(v.number()),
    committedAt: v.optional(v.number()),
    publicationAttempt: v.optional(v.number()),
    publishingVersionId: v.optional(v.id("portfolioVersions")),
  })
    .index("by_householdId", ["householdId"])
    .index("by_householdId_and_status", ["householdId", "status"])
    .index("by_householdId_and_status_and_committedAt", [
      "householdId",
      "status",
      "committedAt",
    ])
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
    activePortfolioVersionId: v.optional(v.id("portfolioVersions")),
    publishingVersionId: v.optional(v.id("portfolioVersions")),
    publicationSequence: v.optional(v.number()),
  }).index("by_owner", ["ownerUserId"]),
  householdMembers: defineTable({
    householdId: v.id("households"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("viewer")),
  })
    .index("by_user", ["userId"])
    .index("by_household_user", ["householdId", "userId"]),
});
