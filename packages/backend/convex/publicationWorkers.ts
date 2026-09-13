import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { digest, utf8Bytes } from "./model/importLimits";
import { requirePublication } from "./model/publication";
import { persistFacts, persistIdentities } from "./model/publicationFacts";
import { commitResultValidator } from "./model/portfolioValidators";
import {
  identifiedFactSchema,
  manifestDigest,
  parseJson,
  publicationLimits,
  publicationReceiptValidator,
  stageValidator,
} from "./model/publicationStages";
import { requirePublicationReadBudget } from "./model/publicationReadBudget";
import { writePublicationRecords } from "./model/publicationWriter";

export const seal = internalMutation({
  args: {
    versionId: v.id("portfolioVersions"),
    attempt: v.number(),
    manifest: v.array(publicationReceiptValidator),
    publicationDigest: v.string(),
    factCount: v.number(),
    currentCount: v.number(),
    exitedCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { version, batch } = await requirePublication(
      ctx,
      args.versionId,
      args.attempt,
      Date.now(),
    );
    if (
      !args.manifest.length ||
      args.manifest.length > publicationLimits.receipts
    )
      throw new Error("Publication manifest capacity exceeded");
    const seen = new Set<string>();
    const nextIndex = new Map<string, number>();
    for (const entry of args.manifest) {
      const key = `${entry.stage}:${entry.index}`;
      if (
        seen.has(key) ||
        entry.index !== (nextIndex.get(entry.stage) ?? 0) ||
        !Number.isSafeInteger(entry.count) ||
        entry.count < 1 ||
        entry.count > publicationLimits.chunkRows ||
        entry.bytes < 1 ||
        entry.bytes > publicationLimits.chunkBytes ||
        !/^[a-f0-9]{64}$/.test(entry.digest)
      )
        throw new Error("Invalid publication manifest");
      seen.add(key);
      nextIndex.set(entry.stage, entry.index + 1);
    }
    const base = version.baseVersionId
      ? await ctx.db.get("portfolioVersions", version.baseVersionId)
      : null;
    if (
      args.factCount !== (base?.factCount ?? 0) + batch.rowCount ||
      args.manifest
        .filter((entry) => entry.stage === "facts")
        .reduce((total, entry) => total + entry.count, 0) !== batch.rowCount ||
      args.manifest
        .filter((entry) => entry.stage === "summary")
        .reduce((total, entry) => total + entry.count, 0) !== 1
    )
      throw new Error("Publication manifest totals mismatch");
    const rootDigest = manifestDigest(args.manifest);
    if (
      version.rootDigest &&
      (version.rootDigest !== rootDigest ||
        version.digest !== args.publicationDigest)
    )
      throw new Error("Conflicting publication root manifest");
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
    versionId: v.id("portfolioVersions"),
    attempt: v.number(),
    stage: stageValidator,
    index: v.number(),
    payloadJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { version } = await requirePublication(
      ctx,
      args.versionId,
      args.attempt,
      Date.now(),
    );
    const expected = version.rootManifest?.find(
      (entry) => entry.stage === args.stage && entry.index === args.index,
    );
    if (
      !expected ||
      utf8Bytes(args.payloadJson) !== expected.bytes ||
      digest(args.payloadJson) !== expected.digest
    )
      throw new Error("Publication chunk does not match root manifest");
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
      if (
        existing.attempt !== args.attempt ||
        existing.digest !== expected.digest
      )
        throw new Error("Conflicting publication chunk replay");
      return null;
    }
    const beforeWrite = await ctx.meta.getTransactionMetrics();
    const count = await writePublicationRecords(
      ctx,
      version._id,
      args.stage,
      args.payloadJson,
    );
    if (count !== expected.count)
      throw new Error("Publication chunk count mismatch");
    const afterWrite = await ctx.meta.getTransactionMetrics();
    const modelBytesWritten =
      afterWrite.bytesWritten.used - beforeWrite.bytesWritten.used;
    await ctx.db.insert("publicationReceipts", {
      versionId: version._id,
      attempt: args.attempt,
      ...expected,
      payloadJson: args.stage === "facts" ? args.payloadJson : undefined,
      modelBytesWritten: args.stage === "facts" ? undefined : modelBytesWritten,
    });
    console.info(
      "portfolio.stage.metrics",
      JSON.stringify({
        stage: args.stage,
        index: args.index,
        ...(await ctx.meta.getTransactionMetrics()),
      }),
    );
    return null;
  },
});

export const finalize = internalMutation({
  args: { versionId: v.id("portfolioVersions"), attempt: v.number() },
  returns: commitResultValidator,
  handler: async (ctx, args) => {
    const stored = await ctx.db.get("portfolioVersions", args.versionId);
    if (stored?.publicationState === "published")
      return {
        status: "committed" as const,
        versionId: stored._id,
        sequence: stored.sequence,
        digest: stored.digest,
      };
    const { version, batch, household } = await requirePublication(
      ctx,
      args.versionId,
      args.attempt,
      Date.now(),
    );
    const owner = version.ownerUserId;
    if (!owner || household.ownerUserId !== owner)
      throw new Error("Publication owner changed");
    const membership = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdId", household._id).eq("userId", owner),
      )
      .unique();
    if (membership?.role !== "owner")
      throw new Error("Publication owner authority was revoked");
    if (
      !batch.contentHash ||
      !batch.parserVersion ||
      !version.rootManifest ||
      version.rootDigest !== manifestDigest(version.rootManifest)
    )
      throw new Error("Publication root manifest is missing or invalid");
    const receipts = await ctx.db
      .query("publicationReceipts")
      .withIndex("by_versionId_and_stage_and_index", (q) =>
        q.eq("versionId", version._id),
      )
      .take(publicationLimits.receipts + 1);
    if (receipts.length !== version.rootManifest.length)
      throw new Error("Publication receipts are incomplete");
    const expected = new Map(
      version.rootManifest.map((entry) => [
        `${entry.stage}:${entry.index}`,
        entry,
      ]),
    );
    const facts = [];
    for (const receipt of receipts) {
      const entry = expected.get(`${receipt.stage}:${receipt.index}`);
      if (
        !entry ||
        receipt.attempt !== args.attempt ||
        entry.digest !== receipt.digest ||
        entry.bytes !== receipt.bytes ||
        entry.count !== receipt.count
      )
        throw new Error("Publication receipt mismatch");
      expected.delete(`${receipt.stage}:${receipt.index}`);
      if (receipt.stage === "facts") {
        if (
          !receipt.payloadJson ||
          digest(receipt.payloadJson) !== receipt.digest
        )
          throw new Error("Publication fact payload mismatch");
        facts.push(
          ...identifiedFactSchema.array().parse(parseJson(receipt.payloadJson)),
        );
      }
    }
    if (expected.size !== 0)
      throw new Error("Publication receipt keys are incomplete");
    facts.sort(
      (left, right) => left.provenance.rowNumber - right.provenance.rowNumber,
    );
    if (
      facts.length !== batch.rowCount ||
      facts.some(
        (fact, index) =>
          fact.provenance.batchId !== batch._id ||
          fact.provenance.rowNumber !== index + 1 ||
          fact.provenance.sequence !== version.sequence ||
          fact.provenance.parserVersion !== batch.parserVersion,
      )
    )
      throw new Error("Publication fact provenance mismatch");
    const key = `${batch.contentHash}:${batch.parserVersion}`;
    const duplicate = await ctx.db
      .query("importDedupeKeys")
      .withIndex("by_householdId_and_key", (q) =>
        q.eq("householdId", household._id).eq("key", key),
      )
      .unique();
    if (duplicate)
      throw new Error(
        "This file and parser version have already been committed",
      );

    const readBudget = requirePublicationReadBudget(receipts);
    console.info(
      "portfolio.publication.readBudget",
      JSON.stringify(readBudget),
    );

    await persistIdentities(ctx, household._id, facts);
    await persistFacts(ctx, batch, facts);
    await ctx.db.insert("importDedupeKeys", {
      householdId: household._id,
      key,
      batchId: batch._id,
    });
    await ctx.db.patch("importBatches", batch._id, {
      status: "committed",
      committedVersionId: version._id,
      committedAt: Date.now(),
      publishingVersionId: undefined,
      errorMessage: undefined,
    });
    await ctx.db.patch("households", household._id, {
      activePortfolioVersionId: version._id,
      publicationSequence: version.sequence,
      publishingVersionId: undefined,
    });
    await ctx.db.patch("portfolioVersions", version._id, {
      publicationState: "published",
      leaseExpiresAt: undefined,
    });
    if (version.forcedFailure) throw new Error("Forced publication failure");
    console.info(
      "portfolio.finalize.metrics",
      JSON.stringify({
        incomingRows: facts.length,
        factCount: version.factCount,
        ...(await ctx.meta.getTransactionMetrics()),
      }),
    );
    return {
      status: "committed" as const,
      versionId: version._id,
      sequence: version.sequence,
      digest: version.digest,
    };
  },
});

export const fail = internalMutation({
  args: {
    versionId: v.id("portfolioVersions"),
    attempt: v.number(),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("portfolioVersions", args.versionId);
    if (
      !version ||
      version.publicationState !== "building" ||
      version.attempt !== args.attempt
    )
      return null;
    await ctx.db.patch("portfolioVersions", version._id, {
      publicationState: "failed",
      expiresAt: Date.now(),
      leaseExpiresAt: undefined,
    });
    const household = await ctx.db.get("households", version.householdId);
    const batch = await ctx.db.get("importBatches", version.batchId);
    if (household?.publishingVersionId === version._id)
      await ctx.db.patch("households", household._id, {
        publishingVersionId: undefined,
      });
    if (batch?.publishingVersionId === version._id)
      await ctx.db.patch("importBatches", batch._id, {
        status: "parsed",
        publishingVersionId: undefined,
        errorMessage: args.errorMessage.slice(0, 1000),
      });
    await ctx.scheduler.runAfter(
      0,
      internal.publicationCleanup.cleanupVersion,
      { versionId: version._id, stage: 0 },
    );
    return null;
  },
});

export const expire = internalMutation({
  args: { versionId: v.id("portfolioVersions"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("portfolioVersions", args.versionId);
    if (
      version?.publicationState === "building" &&
      version.attempt === args.attempt &&
      (version.leaseExpiresAt ?? Infinity) <= Date.now()
    )
      await ctx.runMutation(internal.publicationWorkers.fail, {
        ...args,
        errorMessage: "Publication timed out; retry this import",
      });
    return null;
  },
});
