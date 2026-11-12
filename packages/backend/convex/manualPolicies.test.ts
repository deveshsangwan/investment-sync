import type { ExactNormalizedImportRow } from "@investment-sync/importers";
import { adaptLegacyRow } from "@investment-sync/importers/exact-adapter";
import { digest, utf8Bytes } from "./model/importLimits";
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

  async function importWorkbook(rows: ExactNormalizedImportRow[]) {
    const current = await owner.query(api.users.current);
    const rowsJson = JSON.stringify(rows);
    const batchId = await t.run(async (ctx) => {
      const batchId = await ctx.db.insert("importBatches", {
        householdId: current.householdId,
        uploaderId: current.id,
        fileName: "portfolio.xlsx",
        sizeBytes: 1,
        status: "parsed",
        attempt: 1,
        createdAt: Date.now(),
        rowCount: rows.length,
        normalizedBytes: utf8Bytes(rowsJson),
        previewRowsJson: rowsJson,
        warnings: [],
        sourceType: "investment_portfolio_xlsx",
        parserVersion: "test-v1",
        contentHash: digest(rowsJson),
        manifest: [
          {
            index: 0,
            count: rows.length,
            bytes: utf8Bytes(rowsJson),
            digest: digest(rowsJson),
          },
        ],
      });
      await ctx.db.insert("sourceFiles", {
        batchId,
        householdId: current.householdId,
        uploaderId: current.id,
        status: "deleted",
        expiresAt: 0,
      });
      await ctx.db.insert("importRowChunks", {
        batchId,
        attempt: 1,
        index: 0,
        count: rows.length,
        bytes: utf8Bytes(rowsJson),
        digest: digest(rowsJson),
        rowsJson,
      });
      return batchId;
    });
    await owner.mutation(api.imports.commit, { batchId });
    await publish(batchId);
    return batchId;
  }

  return { t, owner, publish, importWorkbook };
}

function importedHolding(name: string, sourceDate = "2026-05-15") {
  return adaptLegacyRow({
    kind: "holding",
    sourceType: "investment_portfolio_xlsx",
    accountName: "ULIPs",
    provider: "Manual Workbook",
    instrumentName: name,
    assetClass: "ulip",
    currency: "INR",
    sourceDate,
    investedAmount: 100,
    currentValue: 120,
    metadata: { sourceSheet: "ULIPS" },
  });
}

describe("manual ULIP policies", () => {
  it.each([false, true])(
    "lists workbook ULIPs and preserves identity and history with reported totals: %s",
    async (hasReportedTotals) => {
      const { t, owner, publish, importWorkbook } = await setup();
      const rows: ExactNormalizedImportRow[] = [
        "Bajaj Allianz Goal Assure",
        "HDFC Click2 Invest",
        "HDFC Sanchay",
      ].map((name) =>
        adaptLegacyRow({
          kind: "holding",
          sourceType: "investment_portfolio_xlsx",
          accountName: "ULIPs",
          provider: "Manual Workbook",
          instrumentName: name,
          assetClass: "ulip",
          currency: "INR",
          sourceDate: "2026-05-15",
          investedAmount: 160000,
          currentValue: 183751,
          pnlAmount: 23751,
          metadata: { sourceSheet: "ULIPS" },
        }),
      );
      if (hasReportedTotals)
        rows.push(
          adaptLegacyRow({
            kind: "valuation",
            sourceType: "investment_portfolio_xlsx",
            valuationDate: "2026-05-15",
            currency: "INR",
            investedAmount: 900000,
            currentValue: 1000000,
            metadata: {},
          }),
        );
      await importWorkbook(rows);

      const original = await owner.query(api.portfolio.positions);
      expect(original.current).toHaveLength(3);
      const policies = await owner.query(api.manualPolicies.list);
      expect(policies).toHaveLength(3);
      const policy = policies.find(
        (item) => item.name === "Bajaj Allianz Goal Assure",
      );
      if (!policy?.entry)
        throw new Error("Expected an editable imported policy");

      const foreign = t.withIdentity({
        ...identity,
        subject: "foreign_imported_policy_owner",
        tokenIdentifier: "test|foreign_imported_policy_owner",
      });
      await foreign.mutation(api.users.ensureCurrent);
      expect(await foreign.query(api.manualPolicies.list)).toEqual([]);
      await expect(
        foreign.mutation(api.manualPolicies.updateValue, {
          ...values,
          provider: policy.provider,
          name: policy.name,
          policyId: policy.id,
          expectedBatchId: policy.entry.id,
          requestId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
      await expect(
        owner.mutation(api.manualPolicies.updateValue, {
          ...values,
          provider: policy.provider,
          name: "Renamed imported holding",
          policyId: policy.id,
          expectedBatchId: policy.entry.id,
          requestId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ data: { code: "VALIDATION" } });

      const updated = await owner.mutation(api.manualPolicies.updateValue, {
        ...values,
        provider: policy.provider,
        name: policy.name,
        policyId: policy.id,
        expectedBatchId: policy.entry.id,
        currentValue: "210000",
        requestId: crypto.randomUUID(),
      });
      await publish(updated.batchId);
      const positions = await owner.query(api.portfolio.positions);
      expect(positions.current).toHaveLength(3);
      expect(positions.current.map((item) => item.id).sort()).toEqual(
        original.current.map((item) => item.id).sort(),
      );
      expect(
        positions.current.find((item) => item.instrumentName === policy.name)
          ?.currentValue,
      ).toBe("210000");
      expect(await owner.query(api.manualPolicies.list)).toHaveLength(3);
      const detail = await owner.query(api.portfolio.holdingDetail, {
        positionKey: policy.id,
      });
      expect(detail?.history).toHaveLength(2);
      const overview = await owner.query(api.portfolio.overview);
      expect(overview.summary.currentValue).toBe(577502);
      expect(overview.timeline.at(-1)?.currentValue).toBe(
        hasReportedTotals ? 1026249 : 577502,
      );

      const next = await owner.mutation(api.manualPolicies.updateValue, {
        ...values,
        provider: policy.provider,
        name: policy.name,
        policyId: updated.policyId,
        expectedBatchId: updated.batchId,
        currentValue: "220000",
        requestId: crypto.randomUUID(),
      });
      await publish(next.batchId);
      expect((await owner.query(api.portfolio.positions)).current).toHaveLength(
        3,
      );
      expect(await owner.query(api.manualPolicies.list)).toHaveLength(3);
    },
  );

  it.each(["Short policy name", "Imported policy ".repeat(20)])(
    "keeps imported names, units, and ISIN when updating values: %s",
    async (name) => {
      const { owner, publish, importWorkbook } = await setup();
      const row = importedHolding(name);
      await importWorkbook([{ ...row, quantity: "7", isin: "INF000000001" }]);
      const policy = (await owner.query(api.manualPolicies.list))[0];
      if (!policy?.entry) throw new Error("Expected imported policy");

      const updated = await owner.mutation(api.manualPolicies.updateValue, {
        ...values,
        provider: policy.provider,
        name: policy.name,
        policyId: policy.id,
        expectedBatchId: policy.entry.id,
        requestId: crypto.randomUUID(),
      });
      await publish(updated.batchId);
      const detail = await owner.query(api.portfolio.holdingDetail, {
        positionKey: policy.id,
      });
      expect(detail?.holding).toMatchObject({
        instrumentName: name.trim(),
        quantity: "7",
        isin: "INF000000001",
      });
      if (name.length > 160) {
        await expect(
          owner.mutation(api.manualPolicies.create, {
            ...values,
            name,
            requestId: crypto.randomUUID(),
          }),
        ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
      }
    },
  );

  it("finds eligible policies after more than 65 exited positions", async () => {
    const { t, owner, importWorkbook } = await setup();
    await importWorkbook([importedHolding("Still current")]);
    await t.run(async (ctx) => {
      const current = await ctx.db.query("portfolioPositions").first();
      if (!current) throw new Error("Expected published position");
      const { _id, _creationTime, ...position } = current;
      await ctx.db.delete("portfolioPositions", _id);
      for (let i = 0; i < 65; i++) {
        await ctx.db.insert("portfolioPositions", {
          ...position,
          positionKey: `exited-${i}`,
          status: "exited",
        });
      }
      await ctx.db.insert("portfolioPositions", position);
    });

    expect(await owner.query(api.manualPolicies.list)).toMatchObject([
      { name: "Still current" },
    ]);
  });

  it("does not revive a linked imported policy after a later workbook exits it", async () => {
    const { owner, publish, importWorkbook } = await setup();
    await importWorkbook([
      importedHolding("To exit"),
      importedHolding("Retained"),
    ]);
    const policy = (await owner.query(api.manualPolicies.list)).find(
      (item) => item.name === "To exit",
    );
    if (!policy?.entry) throw new Error("Expected imported policy");
    const input = {
      ...values,
      provider: policy.provider,
      name: policy.name,
      policyId: policy.id,
      expectedBatchId: policy.entry.id,
      sourceDate: "2026-10-05",
      requestId: crypto.randomUUID(),
    };
    const updated = await owner.mutation(api.manualPolicies.updateValue, input);
    await publish(updated.batchId);
    await importWorkbook([importedHolding("Retained", "2026-10-06")]);
    const positions = await owner.query(api.portfolio.positions);
    expect(positions.exited.some((item) => item.id === policy.id)).toBe(true);
    expect(
      (await owner.query(api.manualPolicies.list)).some(
        (item) => item.id === policy.id,
      ),
    ).toBe(false);
    await expect(
      owner.mutation(api.manualPolicies.updateValue, {
        ...input,
        expectedBatchId: updated.batchId,
        sourceDate: "2026-10-07",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      owner.mutation(api.manualPolicies.updateValue, input),
    ).resolves.toEqual(updated);
  });

  it("updates a saved imported holding whose expired source batch is parsed", async () => {
    const { t, owner, publish, importWorkbook } = await setup();
    const batchId = await importWorkbook([importedHolding("Goal Assure")]);
    await t.run((ctx) =>
      ctx.db.patch("importBatches", batchId, {
        status: "parsed",
        legacyStatus: "expired",
      }),
    );
    const policy = (await owner.query(api.manualPolicies.list))[0];

    if (!policy?.entry) throw new Error("Expected imported policy");

    expect(policy.entry.status).toBe("parsed");
    expect(policy.draftValues).toBeNull();
    expect(policy.values?.currentValue).toBe("120");

    const update = await owner.mutation(api.manualPolicies.updateValue, {
      ...values,
      provider: policy.provider,
      name: policy.name,
      policyId: policy.id,
      expectedBatchId: batchId,
      requestId: crypto.randomUUID(),
    });
    await publish(update.batchId);
    expect((await owner.query(api.portfolio.positions)).current).toMatchObject([
      { instrumentName: "Goal Assure", currentValue: "200718" },
    ]);
  });

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
