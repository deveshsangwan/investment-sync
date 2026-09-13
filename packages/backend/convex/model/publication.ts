import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { publicationLimits } from "./publicationStages";

export async function requirePublication(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  attempt: number,
  now?: number,
) {
  const version = await ctx.db.get("portfolioVersions", versionId);
  if (
    !version ||
    version.publicationState !== "building" ||
    version.attempt !== attempt
  )
    throw new Error("Publication attempt is no longer active");
  if (now !== undefined && (version.leaseExpiresAt ?? 0) <= now)
    throw new Error("Publication lease expired");
  const household = await ctx.db.get("households", version.householdId);
  const batch = await ctx.db.get("importBatches", version.batchId);
  if (
    !household ||
    !batch ||
    household.publishingVersionId !== versionId ||
    batch.publishingVersionId !== versionId ||
    batch.status !== "publishing" ||
    household.activePortfolioVersionId !== version.baseVersionId
  )
    throw new Error("Publication base or publishing slot changed");
  return { version, household, batch };
}

export async function commitBatch(
  ctx: MutationCtx,
  batch: Doc<"importBatches">,
  options: { stress?: boolean; forceFailure?: boolean } = {},
) {
  if (batch.status === "committed" && batch.committedVersionId) {
    const version = await ctx.db.get(
      "portfolioVersions",
      batch.committedVersionId,
    );
    if (!version || version.householdId !== batch.householdId)
      throw new Error("Missing committed portfolio version");
    return {
      status: "committed" as const,
      versionId: version._id,
      sequence: version.sequence,
      digest: version.digest,
    };
  }
  if (batch.status === "publishing" && batch.publishingVersionId) {
    const version = await ctx.db.get(
      "portfolioVersions",
      batch.publishingVersionId,
    );
    if (!version) throw new Error("Missing publishing portfolio version");
    await requirePublication(
      ctx,
      version._id,
      version.attempt ?? 0,
      Date.now(),
    );
    return {
      status: "publishing" as const,
      versionId: version._id,
      sequence: version.sequence,
      digest: version.digest,
    };
  }
  if (batch.status !== "parsed" || !batch.contentHash || !batch.parserVersion)
    throw new ConvexError({
      code: "CONFLICT",
      message: "Only a parsed import can be committed",
    });
  const household = await ctx.db.get("households", batch.householdId);
  if (!household) throw new ConvexError({ code: "NOT_FOUND" });
  if (household.publishingVersionId)
    throw new ConvexError({
      code: "PUBLISHING_CONFLICT",
      message: "Another import is publishing. Retry after it completes.",
    });
  const duplicate = await ctx.db
    .query("importDedupeKeys")
    .withIndex("by_householdId_and_key", (q) =>
      q
        .eq("householdId", batch.householdId)
        .eq("key", `${batch.contentHash}:${batch.parserVersion}`),
    )
    .unique();
  if (duplicate)
    throw new ConvexError({
      code: "CONFLICT",
      message: "This file and parser version have already been committed",
    });

  const attempt = (batch.publicationAttempt ?? 0) + 1;
  const sequence = (household.publicationSequence ?? 0) + 1;
  const versionId = await ctx.db.insert("portfolioVersions", {
    householdId: household._id,
    batchId: batch._id,
    sequence,
    digest: "",
    createdAt: Date.now(),
    factCount: 0,
    currentCount: 0,
    exitedCount: 0,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    publicationState: "building",
    cleanupState: "pending",
    ownerUserId: household.ownerUserId,
    baseVersionId: household.activePortfolioVersionId,
    attempt,
    leaseExpiresAt: Date.now() + publicationLimits.leaseMs,
    stress: options.stress,
    forcedFailure: options.forceFailure,
  });
  await ctx.db.patch("households", household._id, {
    publishingVersionId: versionId,
  });
  await ctx.db.patch("importBatches", batch._id, {
    status: "publishing",
    publicationAttempt: attempt,
    publishingVersionId: versionId,
    errorMessage: undefined,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.actions.publishPortfolio.publishPortfolio,
    { versionId, attempt },
  );
  await ctx.scheduler.runAfter(
    publicationLimits.leaseMs,
    internal.publicationWorkers.expire,
    { versionId, attempt },
  );
  return { status: "publishing" as const, versionId, sequence, digest: "" };
}
