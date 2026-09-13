import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { chunkRows, digest, parseRows, utf8Bytes } from "../model/importLimits";
import { commitBatch } from "../model/publication";
import { commitResultValidator } from "../model/portfolioValidators";
import { ensureUserProvisioned, requireUserMembership } from "../model/users";

export function capacityRows(period: number) {
  const holdings = Array.from({ length: 1320 }, (_, index) => {
    const instrument = index % 182;
    return {
      kind: "holding",
      sourceType: "investment_portfolio_xlsx",
      sourceDate: new Date(Date.UTC(2025, period, Math.floor(index / 182) + 1))
        .toISOString()
        .slice(0, 10),
      accountName: `FAKE account ${instrument % 16}`,
      provider: "FAKE capacity",
      instrumentName: `FAKE instrument ${instrument}`,
      symbol: `FAKE${instrument}`,
      assetClass: instrument >= 164 ? "us_stock" : "indian_stock",
      currency: instrument >= 164 ? "USD" : "INR",
      quantity: "2",
      investedAmount: "200",
      currentValue: "250",
      pnlAmount: "50",
      metadata: { note: "Generated capacity fixture only. ".repeat(5) },
      numericProvenance: {},
      source: {
        group: "FAKE capacity",
        completeness: "complete",
        granularity: "instrument",
        priority: 0,
      },
    };
  });
  const valuations = Array.from({ length: 28 }, (_, index) => ({
    kind: "valuation",
    sourceType: "investment_portfolio_xlsx",
    valuationDate: new Date(Date.UTC(2025, period, index + 1))
      .toISOString()
      .slice(0, 10),
    currency: "INR",
    investedAmount: "200",
    currentValue: "250",
    metadata: {},
    numericProvenance: {},
    source: {
      group: "FAKE capacity",
      completeness: "complete",
      granularity: "portfolio",
      priority: 0,
    },
  }));
  return parseRows(JSON.stringify([...holdings, ...valuations]));
}

function requireDevelopmentFixture() {
  if (process.env.APP_ENV !== "development")
    throw new Error(
      "Publication capacity fixture is restricted to development",
    );
}

export const prepare = internalMutation({
  args: { runId: v.string(), index: v.number() },
  returns: v.object({
    batchId: v.id("importBatches"),
    rows: v.number(),
    bytes: v.number(),
    householdId: v.id("households"),
  }),
  handler: async (ctx, args) => {
    requireDevelopmentFixture();
    if (
      !/^fake-capacity-[a-z0-9-]{1,60}$/.test(args.runId) ||
      !Number.isInteger(args.index) ||
      args.index < 0 ||
      args.index > 4
    )
      throw new Error("Invalid fake capacity fixture selection");
    const userId = await ensureUserProvisioned(ctx, {
      clerkSubject: `user_${args.runId}`,
      email: "fake-capacity@example.invalid",
    });
    const user = await ctx.db.get("users", userId);
    if (!user) throw new Error("Missing fake capacity owner");
    const { household } = await requireUserMembership(ctx, user);
    const historical = [
      ...capacityRows(0),
      ...capacityRows(1),
      ...capacityRows(2).slice(0, 38),
    ];
    const rows =
      args.index === 4
        ? capacityRows(3)
        : historical.slice(args.index * 684, (args.index + 1) * 684);
    const normalizedBytes = utf8Bytes(JSON.stringify(rows));
    const batchId = await ctx.db.insert("importBatches", {
      householdId: household._id,
      uploaderId: userId,
      fileName: `${args.runId}-${args.index}.xlsx`,
      sizeBytes: 1,
      status: "parsed",
      attempt: 1,
      createdAt: Date.now(),
      rowCount: rows.length,
      normalizedBytes,
      previewRowsJson: JSON.stringify(rows.slice(0, 3)),
      warnings: [],
      contentHash: digest(JSON.stringify(rows)),
      parserVersion: "fake-capacity-decimal-v1",
      sourceType: "investment_portfolio_xlsx",
    });
    await ctx.db.insert("sourceFiles", {
      batchId,
      householdId: household._id,
      uploaderId: userId,
      status: "deleted",
      expiresAt: Date.now(),
    });
    const manifest = [];
    for (const [index, rowsJson] of chunkRows(rows).entries()) {
      const entry = {
        index,
        count: parseRows(rowsJson).length,
        bytes: utf8Bytes(rowsJson),
        digest: digest(rowsJson),
      };
      await ctx.db.insert("importRowChunks", {
        batchId,
        attempt: 1,
        rowsJson,
        ...entry,
      });
      manifest.push(entry);
    }
    await ctx.db.patch("importBatches", batchId, { manifest });
    return {
      batchId,
      rows: rows.length,
      bytes: normalizedBytes,
      householdId: household._id,
    };
  },
});

export const execute = internalMutation({
  args: {
    batchId: v.id("importBatches"),
    forceFailure: v.optional(v.boolean()),
  },
  returns: commitResultValidator,
  handler: async (ctx, args) => {
    requireDevelopmentFixture();
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch) throw new Error("Fake capacity batch not found");
    const user = await ctx.db.get("users", batch.uploaderId);
    const household = await ctx.db.get("households", batch.householdId);
    if (
      !user?.clerkSubject.startsWith("user_fake-capacity-") ||
      household?.ownerUserId !== user._id ||
      !batch.fileName.startsWith("fake-capacity-")
    )
      throw new Error("Capacity execution requires an isolated fake Household");
    return commitBatch(ctx, batch, {
      stress: true,
      forceFailure: args.forceFailure,
    });
  },
});

export const inspect = internalQuery({
  args: { batchId: v.id("importBatches") },
  returns: v.object({
    batchStatus: v.string(),
    errorMessage: v.union(v.string(), v.null()),
    activeVersionId: v.union(v.id("portfolioVersions"), v.null()),
    sequence: v.number(),
    publishedFactCount: v.number(),
    versionsForBatch: v.number(),
    factsForBatch: v.number(),
  }),
  handler: async (ctx, args) => {
    requireDevelopmentFixture();
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch?.fileName.startsWith("fake-capacity-"))
      throw new Error("Fake capacity batch required");

    const household = await ctx.db.get("households", batch.householdId);
    const version = household?.activePortfolioVersionId
      ? await ctx.db.get(
          "portfolioVersions",
          household.activePortfolioVersionId,
        )
      : null;
    const versions = await ctx.db
      .query("portfolioVersions")
      .withIndex("by_batchId", (q) => q.eq("batchId", batch._id))
      .take(2);
    let factsForBatch = 0;
    for (const table of [
      "holdingSnapshots",
      "transactions",
      "portfolioValuations",
    ] as const) {
      const facts = await ctx.db
        .query(table)
        .withIndex("by_batchId", (q) => q.eq("batchId", batch._id))
        .take(1349);
      factsForBatch += facts.length;
    }

    return {
      batchStatus: batch.status,
      errorMessage: batch.errorMessage ?? null,
      activeVersionId: household?.activePortfolioVersionId ?? null,
      sequence: household?.publicationSequence ?? 0,
      publishedFactCount: version?.factCount ?? 0,
      versionsForBatch: versions.length,
      factsForBatch,
    };
  },
});
