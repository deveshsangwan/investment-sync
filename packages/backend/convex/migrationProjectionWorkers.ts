import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { digest, utf8Bytes } from "./model/importLimits";
import { migrationTarget, requireMigration } from "./model/migration";
import {
  manifestDigest,
  publicationLimits,
  publicationReceiptValidator,
  stageValidator,
} from "./model/publicationStages";
import { writePublicationRecords } from "./model/publicationWriter";
import { requirePublicationReadBudget } from "./model/publicationReadBudget";

const versionArguments = {
  runKey: v.string(),
  versionId: v.id("portfolioVersions"),
};

export const prepare = internalMutation({
  args: { runKey: v.string(), legacyHouseholdId: v.string() },
  returns: v.object({
    versionId: v.id("portfolioVersions"),
    published: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const run = await requireMigration(ctx, args.runKey);
    if (!run.inputSealed)
      throw new Error("Migration input must be sealed before publication");
    const household = await migrationTarget(
      ctx,
      args.runKey,
      "households",
      args.legacyHouseholdId,
      "households",
    );
    const sequence = Math.max(1, run.maximumFactSequence);
    const existing = await ctx.db
      .query("portfolioVersions")
      .withIndex("by_householdId_and_sequence", (q) =>
        q.eq("householdId", household._id).eq("sequence", sequence),
      )
      .unique();
    if (existing) {
      if (existing.migrationRunKey !== args.runKey)
        throw new Error("Conflicting initial portfolio publication");
      return {
        versionId: existing._id,
        published: existing.publicationState === "published",
      };
    }
    if (household.activePortfolioVersionId || household.publishingVersionId)
      throw new Error(
        "Migration household already has a portfolio publication",
      );
    // Stored Postgres facts use their creation instant as ordering sequence.
    // The next ordinary Commit must sort after that history, including when
    // it corrects a holding on the same financial date.
    const versionId = await ctx.db.insert("portfolioVersions", {
      householdId: household._id,
      sequence,
      digest: "",
      createdAt: Date.parse(run.evaluationTime),
      factCount: 0,
      currentCount: 0,
      exitedCount: 0,
      expiresAt: Date.now() + 30 * 86400000,
      publicationState: "building",
      cleanupState: "pending",
      ownerUserId: household.ownerUserId,
      attempt: 1,
      migrationRunKey: args.runKey,
    });
    await ctx.db.patch("households", household._id, {
      publishingVersionId: versionId,
    });

    return { versionId, published: false };
  },
});

export const factsPage = internalQuery({
  args: {
    ...versionArguments,
    table: v.union(
      v.literal("holdingSnapshots"),
      v.literal("transactions"),
      v.literal("portfolioValuations"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    pageJson: v.string(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const version = await ctx.db.get("portfolioVersions", args.versionId);
    if (!version || version.migrationRunKey !== args.runKey)
      throw new Error("Migration publication does not belong to run");
    if (args.paginationOpts.numItems > 200)
      throw new Error("Migration fact page exceeds 200 records");
    const result = await ctx.db
      .query(args.table)
      .withIndex("by_householdId_and_key", (q) =>
        q.eq("householdId", version.householdId),
      )
      .paginate(args.paginationOpts);
    return {
      pageJson: JSON.stringify(
        result.page.map(({ factJson }) => ({ factJson })),
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const seal = internalMutation({
  args: {
    ...versionArguments,
    manifest: v.array(publicationReceiptValidator),
    publicationDigest: v.string(),
    factCount: v.number(),
    currentCount: v.number(),
    exitedCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const version = await ctx.db.get("portfolioVersions", args.versionId);
    if (
      !version ||
      version.migrationRunKey !== args.runKey ||
      version.publicationState !== "building"
    )
      throw new Error("Migration publication is not building");
    if (
      !args.manifest.length ||
      args.manifest.length > publicationLimits.receipts ||
      !/^[a-f0-9]{64}$/.test(args.publicationDigest)
    )
      throw new Error("Invalid migration publication manifest");
    const next = new Map<string, number>();
    for (const entry of args.manifest) {
      if (
        entry.stage === "facts" ||
        entry.index !== (next.get(entry.stage) ?? 0) ||
        !Number.isSafeInteger(entry.count) ||
        entry.count < 1 ||
        entry.count > publicationLimits.chunkRows ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 1 ||
        entry.bytes > publicationLimits.chunkBytes ||
        !/^[a-f0-9]{64}$/.test(entry.digest)
      )
        throw new Error("Invalid migration publication chunk manifest");
      next.set(entry.stage, entry.index + 1);
    }
    if (
      args.manifest
        .filter((entry) => entry.stage === "summary")
        .reduce((total, entry) => total + entry.count, 0) !== 1
    )
      throw new Error("Migration publication requires one summary");
    const rootDigest = manifestDigest(args.manifest);
    if (
      version.rootDigest &&
      (version.rootDigest !== rootDigest ||
        version.digest !== args.publicationDigest)
    )
      throw new Error("Conflicting migration publication replay");
    await ctx.db.patch("portfolioVersions", version._id, {
      rootManifest: args.manifest,
      rootDigest,
      digest: args.publicationDigest,
      factCount: args.factCount,
      currentCount: args.currentCount,
      exitedCount: args.exitedCount,
    });

    return null;
  },
});

export const stage = internalMutation({
  args: {
    ...versionArguments,
    stage: stageValidator,
    index: v.number(),
    payloadJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const version = await ctx.db.get("portfolioVersions", args.versionId);
    if (
      !version ||
      version.migrationRunKey !== args.runKey ||
      version.publicationState !== "building" ||
      args.stage === "facts"
    )
      throw new Error("Migration publication is not building");
    const expected = version.rootManifest?.find(
      (entry) => entry.stage === args.stage && entry.index === args.index,
    );
    if (
      !expected ||
      digest(args.payloadJson) !== expected.digest ||
      utf8Bytes(args.payloadJson) !== expected.bytes
    )
      throw new Error("Migration publication chunk mismatch");
    const existing = await ctx.db
      .query("publicationReceipts")
      .withIndex("by_versionId_and_stage_and_index", (q) =>
        q
          .eq("versionId", version._id)
          .eq("stage", args.stage)
          .eq("index", args.index),
      )
      .unique();
    if (existing) {
      if (existing.digest !== expected.digest)
        throw new Error("Conflicting migration publication receipt");
      return null;
    }
    const before = await ctx.meta.getTransactionMetrics();
    const count = await writePublicationRecords(
      ctx,
      version._id,
      args.stage,
      args.payloadJson,
    );
    if (count !== expected.count)
      throw new Error("Migration publication chunk count mismatch");
    const after = await ctx.meta.getTransactionMetrics();
    await ctx.db.insert("publicationReceipts", {
      versionId: version._id,
      attempt: 1,
      ...expected,
      modelBytesWritten: after.bytesWritten.used - before.bytesWritten.used,
    });

    return null;
  },
});

export const finalize = internalMutation({
  args: versionArguments,
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const version = await ctx.db.get("portfolioVersions", args.versionId);
    if (!version || version.migrationRunKey !== args.runKey)
      throw new Error("Migration publication does not belong to run");
    if (version.publicationState === "published") return null;
    const household = await ctx.db.get("households", version.householdId);
    if (
      !household ||
      household.activePortfolioVersionId ||
      household.publishingVersionId !== version._id ||
      household.ownerUserId !== version.ownerUserId ||
      !version.rootManifest ||
      !version.rootDigest
    )
      throw new Error("Migration publication base, owner, or manifest changed");
    const member = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdId", household._id).eq("userId", household.ownerUserId),
      )
      .unique();
    if (member?.role !== "owner")
      throw new Error("Migration household owner membership is missing");
    const receipts = await ctx.db
      .query("publicationReceipts")
      .withIndex("by_versionId_and_stage_and_index", (q) =>
        q.eq("versionId", version._id),
      )
      .take(publicationLimits.receipts + 1);
    if (receipts.length !== version.rootManifest.length)
      throw new Error("Migration publication receipts incomplete");
    const expected = new Map(
      version.rootManifest.map((entry) => [
        `${entry.stage}:${entry.index}`,
        entry,
      ]),
    );
    for (const receipt of receipts) {
      const entry = expected.get(`${receipt.stage}:${receipt.index}`);
      if (
        !entry ||
        entry.digest !== receipt.digest ||
        entry.count !== receipt.count ||
        entry.bytes !== receipt.bytes
      )
        throw new Error("Migration publication receipt mismatch");
      expected.delete(`${receipt.stage}:${receipt.index}`);
    }
    if (expected.size)
      throw new Error("Migration publication receipt keys incomplete");
    requirePublicationReadBudget(receipts);
    await ctx.db.patch("portfolioVersions", version._id, {
      publicationState: "published",
    });
    await ctx.db.patch("households", household._id, {
      activePortfolioVersionId: version._id,
      publicationSequence: version.sequence,
      publishingVersionId: undefined,
    });

    return null;
  },
});

export const committedBatchesPage = internalQuery({
  args: { ...versionArguments, paginationOpts: paginationOptsValidator },
  returns: v.object({
    pageJson: v.string(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const version = await ctx.db.get("portfolioVersions", args.versionId);
    if (!version || version.migrationRunKey !== args.runKey)
      throw new Error("Migration publication does not belong to run");
    if (args.paginationOpts.numItems > 200)
      throw new Error("Migration batch page exceeds 200 records");
    const page = await ctx.db
      .query("importBatches")
      .withIndex("by_householdId_and_status", (q) =>
        q.eq("householdId", version.householdId).eq("status", "committed"),
      )
      .paginate(args.paginationOpts);
    return {
      pageJson: JSON.stringify(
        page.page
          .filter((batch) => batch.legacyId)
          .map((batch) => ({ legacyBatchId: batch.legacyId })),
      ),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const linkCommittedBatch = internalMutation({
  args: { ...versionArguments, legacyBatchId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const version = await ctx.db.get("portfolioVersions", args.versionId);
    const batch = await migrationTarget(
      ctx,
      args.runKey,
      "import_batches",
      args.legacyBatchId,
      "importBatches",
    );
    if (
      !version ||
      version.migrationRunKey !== args.runKey ||
      version.publicationState !== "published" ||
      batch.householdId !== version.householdId ||
      batch.legacyStatus !== "committed"
    )
      throw new Error("Invalid migrated commit receipt");
    if (batch.committedVersionId && batch.committedVersionId !== version._id)
      throw new Error("Conflicting migrated commit receipt");
    await ctx.db.patch("importBatches", batch._id, {
      committedVersionId: version._id,
    });
    return null;
  },
});
