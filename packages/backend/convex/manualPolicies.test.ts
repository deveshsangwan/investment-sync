import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { decodeFact } from "./model/portfolioEncoding";

const identity = {
  subject: "user_manual_policy_owner",
  issuer: "https://example.clerk.accounts.dev",
  tokenIdentifier: "test|manual_policy_owner",
};
const values = {
  provider: "Bajaj Life",
  name: "Goal Assure",
  investedAmount: "1,80,000",
  currentValue: "2,00,718",
  sourceDate: "2026-10-07",
};

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(identity);
  await owner.mutation(api.users.ensureCurrent);

  async function publish(batchId: Id<"importBatches">) {
    const batch = await t.run((ctx) => ctx.db.get("importBatches", batchId));

    if (!batch?.publishingVersionId) throw new Error("Expected a publication");

    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: batch.publishingVersionId,
      attempt: batch.publicationAttempt ?? 1,
    });
    expect(await owner.query(api.imports.get, { batchId })).toMatchObject({
      status: "committed",
    });
  }

  return { t, owner, publish };
}

describe("manual ULIP policies", () => {
  it("publishes exact values to all portfolio views without inventing payments or a source file", async () => {
    const { t, owner, publish } = await setup();
    const entry = await owner.mutation(api.manualPolicies.create, {
      ...values,
      requestId: crypto.randomUUID(),
    });
    expect((await owner.query(api.manualPolicies.list))[0]?.values).toBeNull();
    await publish(entry.batchId);

    const overview = await owner.query(api.portfolio.overview);
    expect(overview.summary).toMatchObject({
      investedAmount: 180000,
      currentValue: 200718,
      pnlAmount: 20718,
    });
    expect(overview.performance).toMatchObject({
      dataQuality: "insufficient_data",
      cashFlowCount: 0,
    });
    expect(overview.performance.xirr).toBeUndefined();
    expect(overview.holdings[0]).toMatchObject({
      manualPolicyId: entry.policyId,
      pnlPercent: "11.51",
    });
    const detail = await owner.query(api.portfolio.holdingDetail, {
      positionKey: JSON.stringify(["policy", entry.policyId]),
    });
    expect(detail?.transactions).toEqual([]);
    expect(detail?.history).toHaveLength(1);
    expect(detail?.holding.xirrDataQuality).toBe("insufficient_data");
    expect(
      await owner.query(api.portfolio.assetClassDetail, { assetClass: "ulip" }),
    ).toMatchObject({ summary: { currentValue: 200718, holdingCount: 1 } });
    expect(await owner.query(api.manualPolicies.list)).toMatchObject([
      {
        values: {
          investedAmount: "180000",
          currentValue: "200718",
          sourceDate: "2026-10-07",
        },
      },
    ]);
    expect(
      await owner.query(api.imports.get, { batchId: entry.batchId }),
    ).toMatchObject({
      fileAvailable: false,
      expiresAt: null,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("sourceFiles").collect()).toEqual([]);
      expect(await ctx.db.query("transactions").collect()).toEqual([]);
    });
  });

  it("keeps same-name policies distinct, carries values forward, and retains backdated history", async () => {
    const { owner, publish } = await setup();
    const first = await owner.mutation(api.manualPolicies.create, {
      ...values,
      sourceDate: "2026-10-01",
      requestId: crypto.randomUUID(),
    });
    await publish(first.batchId);
    const second = await owner.mutation(api.manualPolicies.create, {
      ...values,
      currentValue: "300000",
      requestId: crypto.randomUUID(),
    });
    await publish(second.batchId);
    const updated = await owner.mutation(api.manualPolicies.updateValue, {
      ...values,
      policyId: first.policyId,
      expectedBatchId: first.batchId,
      currentValue: "210000",
      requestId: crypto.randomUUID(),
    });
    await publish(updated.batchId);
    const older = await owner.mutation(api.manualPolicies.updateValue, {
      ...values,
      policyId: first.policyId,
      expectedBatchId: updated.batchId,
      sourceDate: "2026-10-03",
      currentValue: "205000",
      requestId: crypto.randomUUID(),
    });
    await publish(older.batchId);

    const policies = await owner.query(api.manualPolicies.list);
    expect(policies).toHaveLength(2);
    expect(
      policies.find((policy) => policy.id === first.policyId)?.values,
    ).toMatchObject({ currentValue: "210000", sourceDate: "2026-10-07" });
    const overview = await owner.query(api.portfolio.overview);
    expect(overview.holdings).toHaveLength(2);
    expect(overview.summary.currentValue).toBe(510000);
    expect(
      overview.timeline.map((point) => [
        point.snapshotDate,
        point.currentValue,
      ]),
    ).toEqual([
      ["2026-10-01", 200718],
      ["2026-10-03", 205000],
      ["2026-10-07", 510000],
    ]);
    const detail = await owner.query(api.portfolio.holdingDetail, {
      positionKey: JSON.stringify(["policy", first.policyId]),
    });
    expect(detail?.history).toHaveLength(3);
  });

  it("corrects names and insurers on the same date without duplicating a holding", async () => {
    const { owner, publish } = await setup();
    const first = await owner.mutation(api.manualPolicies.create, {
      ...values,
      requestId: crypto.randomUUID(),
    });
    await publish(first.batchId);
    const updated = await owner.mutation(api.manualPolicies.updateValue, {
      ...values,
      policyId: first.policyId,
      expectedBatchId: first.batchId,
      provider: "HDFC Life",
      name: "Market linked plan",
      currentValue: "185114",
      requestId: crypto.randomUUID(),
    });
    await publish(updated.batchId);

    const positions = await owner.query(api.portfolio.positions);
    expect(positions.current).toHaveLength(1);
    expect(positions.exited).toEqual([]);
    expect(positions.current[0]).toMatchObject({
      id: JSON.stringify(["policy", first.policyId]),
      provider: "HDFC Life",
      instrumentName: "Market linked plan",
      currentValue: "185114",
    });
    const detail = await owner.query(api.portfolio.holdingDetail, {
      positionKey: JSON.stringify(["policy", first.policyId]),
    });
    expect(detail?.history).toHaveLength(1);
    await expect(
      owner.mutation(api.imports.commit, { batchId: first.batchId }),
    ).resolves.toMatchObject({ status: "committed" });
  });

  it("applies backdated name corrections while retaining newer values and original source facts", async () => {
    const { t, owner, publish } = await setup();
    const first = await owner.mutation(api.manualPolicies.create, {
      ...values,
      requestId: crypto.randomUUID(),
    });
    await publish(first.batchId);
    const corrected = await owner.mutation(api.manualPolicies.updateValue, {
      ...values,
      policyId: first.policyId,
      expectedBatchId: first.batchId,
      provider: "HDFC Life",
      name: "Corrected name",
      sourceDate: "2026-10-01",
      currentValue: "185114",
      requestId: crypto.randomUUID(),
    });
    await publish(corrected.batchId);

    const positions = await owner.query(api.portfolio.positions);
    expect(positions.current).toHaveLength(1);
    expect(positions.current[0]).toMatchObject({
      id: JSON.stringify(["policy", first.policyId]),
      provider: "HDFC Life",
      instrumentName: "Corrected name",
      currentValue: "200718",
      snapshotDate: "2026-10-07",
    });
    const detail = await owner.query(api.portfolio.holdingDetail, {
      positionKey: JSON.stringify(["policy", first.policyId]),
    });
    expect(detail?.holding).toMatchObject({
      provider: "HDFC Life",
      instrumentName: "Corrected name",
      currentValue: "200718",
    });
    expect(detail?.history).toHaveLength(2);
    expect((await owner.query(api.manualPolicies.list))[0]).toMatchObject({
      provider: "HDFC Life",
      name: "Corrected name",
      values: { currentValue: "200718", sourceDate: "2026-10-07" },
    });

    await t.run(async (ctx) => {
      const original = await ctx.db
        .query("holdingSnapshots")
        .withIndex("by_batchId", (q) => q.eq("batchId", first.batchId))
        .first();

      if (!original) throw new Error("Expected original policy snapshot");

      expect(decodeFact(original.factJson).row).toMatchObject({
        provider: "Bajaj Life",
        instrumentName: "Goal Assure",
        currentValue: "200718",
      });
    });
  });

  it("replays requests and rejects stale edits, including edits while saving", async () => {
    const { t, owner, publish } = await setup();
    const input = { ...values, requestId: crypto.randomUUID() };
    const first = await owner.mutation(api.manualPolicies.create, input);
    await expect(
      owner.mutation(api.manualPolicies.create, input),
    ).resolves.toEqual(first);
    await expect(
      owner.mutation(api.manualPolicies.create, {
        ...input,
        currentValue: "1",
      }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    const update = {
      ...values,
      policyId: first.policyId,
      expectedBatchId: first.batchId,
      currentValue: "210000",
      requestId: crypto.randomUUID(),
    };
    await expect(
      owner.mutation(api.manualPolicies.updateValue, update),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    await publish(first.batchId);
    const updated = await owner.mutation(
      api.manualPolicies.updateValue,
      update,
    );
    await publish(updated.batchId);
    await expect(
      owner.mutation(api.manualPolicies.updateValue, update),
    ).resolves.toEqual(updated);
    await expect(
      owner.mutation(api.manualPolicies.updateValue, {
        ...update,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("manualPolicies").collect()).toHaveLength(1);
      expect(await ctx.db.query("importBatches").collect()).toHaveLength(2);
    });
  });

  it("restricts writes to owners and isolates household reads and updates", async () => {
    const { t, owner, publish } = await setup();
    const entry = await owner.mutation(api.manualPolicies.create, {
      ...values,
      requestId: crypto.randomUUID(),
    });
    await publish(entry.batchId);
    const foreign = t.withIdentity({
      ...identity,
      subject: "other_owner",
      tokenIdentifier: "test|other",
    });
    await foreign.mutation(api.users.ensureCurrent);
    expect(await foreign.query(api.manualPolicies.list)).toEqual([]);
    await expect(
      foreign.mutation(api.manualPolicies.updateValue, {
        ...values,
        policyId: entry.policyId,
        expectedBatchId: entry.batchId,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(t.query(api.manualPolicies.list)).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(
      t.mutation(api.manualPolicies.create, {
        ...values,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    const current = await owner.query(api.users.current);
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("householdMembers")
        .withIndex("by_user", (q) => q.eq("userId", current.id))
        .unique();
      if (!membership) throw new Error("Expected membership");
      await ctx.db.patch("householdMembers", membership._id, {
        role: "viewer",
      });
    });
    expect(await owner.query(api.manualPolicies.list)).toHaveLength(1);
    await expect(
      owner.mutation(api.manualPolicies.create, {
        ...values,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      owner.mutation(api.manualPolicies.updateValue, {
        ...values,
        policyId: entry.policyId,
        expectedBatchId: entry.batchId,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  it("rejects malformed inputs and future dates before writing and respects the write freeze", async () => {
    const { t, owner } = await setup();
    for (const invalid of [
      { investedAmount: "-1" },
      { currentValue: "NaN" },
      { currentValue: "1,00" },
      { currentValue: "1.234" },
      { currentValue: "1000000000000" },
      { name: " " },
      { sourceDate: "2026-02-30" },
      { sourceDate: "2026-10-08" },
      { requestId: "bad-request" },
    ]) {
      await expect(
        owner.mutation(api.manualPolicies.create, {
          ...values,
          requestId: crypto.randomUUID(),
          ...invalid,
        }),
      ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
    }
    await t.run(async (ctx) => {
      expect(await ctx.db.query("manualPolicies").collect()).toEqual([]);
      expect(await ctx.db.query("importBatches").collect()).toEqual([]);
    });
    vi.stubEnv("MIGRATION_MODE", "production");
    await expect(
      owner.mutation(api.manualPolicies.create, {
        ...values,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it("retains the last saved value after publication failure and rejects a replaced retry", async () => {
    const { t, owner, publish } = await setup();
    const first = await owner.mutation(api.manualPolicies.create, {
      ...values,
      requestId: crypto.randomUUID(),
    });
    await publish(first.batchId);
    const failed = await owner.mutation(api.manualPolicies.updateValue, {
      ...values,
      policyId: first.policyId,
      expectedBatchId: first.batchId,
      currentValue: "210000",
      requestId: crypto.randomUUID(),
    });
    const batch = await t.run(async (ctx) => {
      const batch = await ctx.db.get("importBatches", failed.batchId);
      if (!batch?.publishingVersionId)
        throw new Error("Expected a publication");
      await ctx.db.patch("portfolioVersions", batch.publishingVersionId, {
        forcedFailure: true,
      });
      return batch;
    });
    if (!batch.publishingVersionId) throw new Error("Expected a publication");
    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: batch.publishingVersionId,
      attempt: 1,
    });

    const policy = (await owner.query(api.manualPolicies.list))[0];
    expect(policy?.entry).toMatchObject({ status: "parsed" });
    expect(policy?.values?.currentValue).toBe("200718");
    expect(policy?.draftValues?.currentValue).toBe("210000");
    expect(
      (await owner.query(api.portfolio.overview)).summary.currentValue,
    ).toBe(200718);
    const replacement = await owner.mutation(api.manualPolicies.updateValue, {
      ...values,
      policyId: first.policyId,
      expectedBatchId: failed.batchId,
      currentValue: "220000",
      requestId: crypto.randomUUID(),
    });
    await publish(replacement.batchId);
    await expect(
      owner.mutation(api.imports.commit, { batchId: failed.batchId }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    expect(
      (await owner.query(api.portfolio.overview)).summary.currentValue,
    ).toBe(220000);
  });
});
