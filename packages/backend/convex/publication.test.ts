import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { capacityRows } from "./testing/publicationCapacity";
import { buildPortfolioPublication } from "@investment-sync/portfolio-domain";
import { projectionRecords } from "./model/publicationProjection";
import { digest, utf8Bytes } from "./model/importLimits";
import schema from "./schema";
import { modules } from "./test.setup";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function smallPublication(runId: string) {
  vi.stubEnv("APP_ENV", "development");
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const prepared = await t.mutation(
    internal.testing.publicationCapacity.prepare,
    { runId, index: 0 },
  );
  const rows = capacityRows(0).slice(0, 1);
  const rowsJson = JSON.stringify(rows);
  await t.run(async (ctx) => {
    for (const chunk of await ctx.db.query("importRowChunks").collect())
      await ctx.db.delete("importRowChunks", chunk._id);
    const entry = {
      index: 0,
      count: 1,
      bytes: utf8Bytes(rowsJson),
      digest: digest(rowsJson),
    };
    await ctx.db.insert("importRowChunks", {
      batchId: prepared.batchId,
      attempt: 1,
      rowsJson,
      ...entry,
    });
    await ctx.db.patch("importBatches", prepared.batchId, {
      rowCount: 1,
      normalizedBytes: entry.bytes,
      manifest: [entry],
      contentHash: entry.digest,
    });
  });
  const owner = t.withIdentity({
    subject: `user_${runId}`,
    issuer: "https://fake-development.example",
    tokenIdentifier: `fake|${runId}`,
  });
  const pending = await owner.mutation(api.imports.commit, {
    batchId: prepared.batchId,
  });
  const args = { versionId: pending.versionId, attempt: 1 };
  const publication = buildPortfolioPublication({
    existingFacts: [],
    batch: {
      id: prepared.batchId,
      parserVersion: "fake-capacity-decimal-v1",
      sequence: 1,
      fallbackDate: "2025-01-01",
      rows,
    },
  });
  const records = {
    ...projectionRecords(publication.projection),
    facts: publication.factsToPersist,
  };
  const packets = (
    [
      "history",
      "positions",
      "scopes",
      "summary",
      "assets",
      "timeline",
      "facts",
    ] as const
  ).flatMap((stage) => {
    if (!records[stage].length) return [];
    const payloadJson = JSON.stringify(records[stage]);
    return [
      {
        stage,
        index: 0,
        payloadJson,
        count: records[stage].length,
        bytes: utf8Bytes(payloadJson),
        digest: digest(payloadJson),
      },
    ];
  });
  await t.mutation(internal.publicationWorkers.seal, {
    ...args,
    manifest: packets.map(({ stage, index, count, bytes, digest }) => ({
      stage,
      index,
      count,
      bytes,
      digest,
    })),
    publicationDigest: publication.digest,
    factCount: 1,
    currentCount: publication.reconciliation.currentCount,
    exitedCount: publication.reconciliation.exitedCount,
  });
  async function stageAll() {
    for (const { stage, index, payloadJson } of packets)
      await t.mutation(internal.publicationWorkers.stage, {
        ...args,
        stage,
        index,
        payloadJson,
      });
  }
  return { t, owner, prepared, pending, args, packets, stageAll };
}

describe("publication capacity candidate", () => {
  it("preserves every measured stress fixture axis", () => {
    const rows = capacityRows(3);
    const holdings = rows.filter((row) => row.kind === "holding");
    expect(rows).toHaveLength(1348);
    expect(holdings).toHaveLength(1320);
    expect(rows.filter((row) => row.kind === "valuation")).toHaveLength(28);
    expect(new Set(holdings.map((row) => row.accountName)).size).toBe(16);
    expect(new Set(holdings.map((row) => row.instrumentName)).size).toBe(182);
    expect(rows.filter((row) => row.currency === "INR")).toHaveLength(1222);
    expect(rows.filter((row) => row.currency === "USD")).toHaveLength(126);
    expect(utf8Bytes(JSON.stringify(rows))).toBeGreaterThanOrEqual(672180);
  });

  it("rejects fixture use outside development", async () => {
    vi.stubEnv("APP_ENV", "production");
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.testing.publicationCapacity.prepare, {
        runId: "fake-capacity-test",
        index: 0,
      }),
    ).rejects.toThrow("restricted to development");
  });

  it("publishes atomically, preserves immutable facts and replays the original result", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const runId = "fake-capacity-atomic-test";
    const prepared = await t.mutation(
      internal.testing.publicationCapacity.prepare,
      { runId, index: 0 },
    );
    const failed = await t.mutation(
      internal.testing.publicationCapacity.execute,
      {
        batchId: prepared.batchId,
        forceFailure: true,
      },
    );
    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: failed.versionId,
      attempt: 1,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(0);
      expect(await ctx.db.query("accounts").collect()).toHaveLength(0);
      expect(
        await ctx.db.get("households", prepared.householdId),
      ).not.toHaveProperty("activePortfolioVersionId");
      expect(await ctx.db.get("importBatches", prepared.batchId)).toMatchObject(
        { status: "parsed", errorMessage: "Forced publication failure" },
      );
    });

    const owner = t.withIdentity({
      subject: `user_${runId}`,
      issuer: "https://fake-development.example",
      tokenIdentifier: `fake|${runId}`,
    });
    const pending = await owner.mutation(api.imports.commit, {
      batchId: prepared.batchId,
    });
    await expect(
      owner.mutation(api.imports.commit, { batchId: prepared.batchId }),
    ).resolves.toEqual(pending);
    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: pending.versionId,
      attempt: 2,
    });
    const result = await owner.mutation(api.imports.commit, {
      batchId: prepared.batchId,
    });
    expect(result.status).toBe("committed");
    await expect(
      owner.mutation(api.imports.commit, { batchId: prepared.batchId }),
    ).resolves.toEqual(result);
    await expect(
      owner.query(api.imports.get, { batchId: prepared.batchId }),
    ).resolves.toMatchObject({
      status: "committed",
      committedVersionId: result.versionId,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(
        684,
      );
      expect(await ctx.db.query("portfolioVersions").collect()).toHaveLength(2);
      expect(
        await ctx.db.get("households", prepared.householdId),
      ).toMatchObject({
        activePortfolioVersionId: result.versionId,
        publicationSequence: 1,
      });
    });
  }, 30000);
});

describe("staged publication fences", () => {
  it("keeps staged data invisible, replays chunks, and rejects a changed payload", async () => {
    const { t, prepared, args, packets, stageAll } = await smallPublication(
      "fake-capacity-replay",
    );
    await stageAll();
    await stageAll();
    const first = packets[0];
    if (!first) throw new Error("Missing test packet");
    await expect(
      t.mutation(internal.publicationWorkers.stage, {
        ...args,
        stage: first.stage,
        index: first.index,
        payloadJson: `${first.payloadJson} `,
      }),
    ).rejects.toThrow("does not match root manifest");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("portfolioPositions").collect()).toHaveLength(
        1,
      );
      expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(0);
      expect(await ctx.db.query("accounts").collect()).toHaveLength(0);
      expect(await ctx.db.query("instruments").collect()).toHaveLength(0);
      expect(await ctx.db.query("publicationReceipts").collect()).toHaveLength(
        packets.length,
      );
      expect(
        await ctx.db.get("households", prepared.householdId),
      ).not.toHaveProperty("activePortfolioVersionId");
    });
    await t.mutation(internal.publicationWorkers.finalize, args);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(1);
      expect(await ctx.db.query("accounts").collect()).toHaveLength(1);
      expect(
        await ctx.db.get("households", prepared.householdId),
      ).toMatchObject({ activePortfolioVersionId: args.versionId });
    });
  });

  it("requires every distinct receipt even when a duplicate preserves total count", async () => {
    const { t, args, stageAll } = await smallPublication(
      "fake-capacity-corrupt",
    );
    await expect(
      t.mutation(internal.publicationWorkers.finalize, args),
    ).rejects.toThrow("receipts are incomplete");
    await stageAll();
    await t.run(async (ctx) => {
      const receipts = await ctx.db.query("publicationReceipts").collect();
      const [first, second] = receipts;
      if (!first || !second) throw new Error("Missing test receipts");
      await ctx.db.delete("publicationReceipts", second._id);
      await ctx.db.insert("publicationReceipts", {
        versionId: first.versionId,
        attempt: first.attempt,
        stage: first.stage,
        index: first.index,
        count: first.count,
        bytes: first.bytes,
        digest: first.digest,
        payloadJson: first.payloadJson,
      });
    });
    await expect(
      t.mutation(internal.publicationWorkers.finalize, args),
    ).rejects.toThrow("receipt mismatch");
  });

  it("fences revoked ownership and stale active versions before publication", async () => {
    const { t, prepared, args, stageAll } = await smallPublication(
      "fake-capacity-authority",
    );
    await stageAll();
    await t.run(async (ctx) => {
      const membership = await ctx.db.query("householdMembers").first();
      if (!membership) throw new Error("Missing test membership");
      await ctx.db.delete("householdMembers", membership._id);
    });
    await expect(
      t.mutation(internal.publicationWorkers.finalize, args),
    ).rejects.toThrow("authority was revoked");
    await t.run(async (ctx) => {
      await ctx.db.patch("households", prepared.householdId, {
        activePortfolioVersionId: args.versionId,
      });
    });
    await expect(
      t.mutation(internal.publicationWorkers.finalize, args),
    ).rejects.toThrow("base or publishing slot changed");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(0);
    });
  });

  it("rejects a second batch, expires the lease, and fences a failed worker after retry", async () => {
    const runId = "fake-capacity-lease";
    const { t, owner, prepared, pending, args, stageAll } =
      await smallPublication(runId);
    await expect(
      owner.mutation(api.imports.commit, { batchId: prepared.batchId }),
    ).resolves.toMatchObject({
      versionId: pending.versionId,
      status: "publishing",
    });
    const other = await t.mutation(
      internal.testing.publicationCapacity.prepare,
      { runId, index: 1 },
    );
    await expect(
      owner.query(api.imports.get, { batchId: other.batchId }),
    ).resolves.toMatchObject({ publicationAttempt: 0 });
    await expect(
      owner.mutation(api.imports.commit, { batchId: other.batchId }),
    ).rejects.toThrow("Another import is publishing");
    await stageAll();
    await t.run(async (ctx) =>
      ctx.db.patch("portfolioVersions", args.versionId, {
        leaseExpiresAt: Date.now() - 1,
      }),
    );
    await expect(
      t.mutation(internal.publicationWorkers.finalize, args),
    ).rejects.toThrow("lease expired");
    await t.mutation(internal.publicationWorkers.expire, args);
    await expect(
      owner.query(api.imports.get, { batchId: prepared.batchId }),
    ).resolves.toMatchObject({ status: "parsed", publicationAttempt: 1 });
    const retry = await owner.mutation(api.imports.commit, {
      batchId: prepared.batchId,
    });
    expect(retry.versionId).not.toBe(args.versionId);
    await expect(
      t.mutation(internal.publicationWorkers.finalize, args),
    ).rejects.toThrow("no longer active");
    await t.mutation(internal.publicationWorkers.fail, {
      ...args,
      errorMessage: "late failure",
    });
    await expect(
      owner.query(api.imports.get, { batchId: prepared.batchId }),
    ).resolves.toMatchObject({ status: "publishing", publicationAttempt: 2 });
    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: retry.versionId,
      attempt: 2,
    });
    await expect(
      owner.query(api.imports.get, { batchId: prepared.batchId }),
    ).resolves.toMatchObject({
      status: "committed",
      committedVersionId: retry.versionId,
      publicationAttempt: 2,
    });
  });

  it("preserves committed receipts when an inactive projection is cleaned up", async () => {
    const { t, owner, prepared, args, stageAll } = await smallPublication(
      "fake-capacity-cleanup",
    );
    await stageAll();
    const result = await t.mutation(internal.publicationWorkers.finalize, args);
    await t.run(async (ctx) => {
      await ctx.db.patch("portfolioVersions", args.versionId, {
        expiresAt: Date.now() - 1,
      });
    });
    await t.mutation(internal.publicationCleanup.cleanupVersion, {
      versionId: args.versionId,
      stage: 0,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("portfolioPositions").collect()).toHaveLength(
        1,
      );
    });
    await t.run(async (ctx) =>
      ctx.db.patch("households", prepared.householdId, {
        activePortfolioVersionId: undefined,
      }),
    );
    for (let stage = 0; stage < 8; stage++)
      await t.mutation(internal.publicationCleanup.cleanupVersion, {
        versionId: args.versionId,
        stage,
      });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("portfolioPositions").collect()).toHaveLength(
        0,
      );
      expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(1);
      expect(
        await ctx.db.get("portfolioVersions", args.versionId),
      ).toMatchObject({ cleanupState: "done" });
    });
    await expect(
      owner.mutation(api.imports.commit, { batchId: prepared.batchId }),
    ).resolves.toEqual(result);
  });
});

describe("commit authorization and content dedupe", () => {
  it("rejects anonymous, foreign and viewer commits", async () => {
    const { t, owner, prepared } = await smallPublication("fake-capacity-auth");
    await expect(
      t.mutation(api.imports.commit, { batchId: prepared.batchId }),
    ).rejects.toThrow();
    const otherRun = "fake-capacity-foreign";
    const other = await t.mutation(
      internal.testing.publicationCapacity.prepare,
      { runId: otherRun, index: 0 },
    );
    await expect(
      owner.mutation(api.imports.commit, { batchId: other.batchId }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("householdMembers")
        .withIndex("by_household_user", (q) =>
          q.eq("householdId", prepared.householdId),
        )
        .first();
      if (!membership) throw new Error("Missing test membership");
      await ctx.db.patch("householdMembers", membership._id, {
        role: "viewer",
      });
    });
    await expect(
      owner.mutation(api.imports.commit, { batchId: prepared.batchId }),
    ).rejects.toThrow();
  });

  it("rejects a separately staged duplicate only after the first batch commits", async () => {
    const runId = "fake-capacity-dedupe";
    const { t, owner, prepared, args, stageAll } =
      await smallPublication(runId);
    const duplicate = await t.mutation(
      internal.testing.publicationCapacity.prepare,
      { runId, index: 1 },
    );
    await t.run(async (ctx) => {
      const original = await ctx.db.get("importBatches", prepared.batchId);
      if (!original) throw new Error("Missing test batch");
      await ctx.db.patch("importBatches", duplicate.batchId, {
        contentHash: original.contentHash,
        parserVersion: original.parserVersion,
      });
    });
    await stageAll();
    await t.mutation(internal.publicationWorkers.finalize, args);
    await expect(
      owner.mutation(api.imports.commit, { batchId: duplicate.batchId }),
    ).rejects.toThrow("already been committed");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("importDedupeKeys").collect()).toHaveLength(1);
      expect(
        await ctx.db.get("importBatches", duplicate.batchId),
      ).toMatchObject({ status: "parsed" });
    });
  });
});

it("rejects an older incomplete candidate without read-budget receipts", async () => {
  const { t, args, stageAll } = await smallPublication(
    "fake-capacity-old-receipt",
  );
  await stageAll();
  await t.run(async (ctx) => {
    const receipt = await ctx.db
      .query("publicationReceipts")
      .withIndex("by_versionId_and_stage_and_index", (q) =>
        q.eq("versionId", args.versionId).eq("stage", "positions"),
      )
      .first();
    if (!receipt) throw new Error("Missing test receipt");
    await ctx.db.patch("publicationReceipts", receipt._id, {
      modelBytesWritten: undefined,
    });
  });
  await expect(
    t.mutation(internal.publicationWorkers.finalize, args),
  ).rejects.toThrow("read budget receipt is missing");
});
