import { buildPortfolioPublication } from "@investment-sync/portfolio-domain";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { parseRows } from "./model/importLimits";
import {
  ensureAccount,
  ensureInstrument,
  persistFacts,
  persistIdentities,
} from "./model/publicationFacts";
import { capacityRows } from "./testing/publicationCapacity";
import schema from "./schema";
import { modules } from "./test.setup";

afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  vi.stubEnv("APP_ENV", "development");
  const t = convexTest(schema, modules);
  const prepared = await t.mutation(
    internal.testing.publicationCapacity.prepare,
    { runId: "fake-capacity-uniqueness", index: 0 },
  );
  const allRows = capacityRows(0);
  const holding = allRows[0];
  const valuation = allRows.at(-1);
  if (holding?.kind !== "holding" || valuation?.kind !== "valuation")
    throw new Error("Invalid test fixture");
  const rows = parseRows(
    JSON.stringify([
      holding,
      {
        ...holding,
        kind: "transaction",
        type: "buy",
        tradeDate: "2025-01-01",
        amount: "250",
      },
      valuation,
    ]),
  );
  const facts = buildPortfolioPublication({
    existingFacts: [],
    batch: {
      id: prepared.batchId,
      parserVersion: "fake",
      sequence: 1,
      fallbackDate: "2025-01-01",
      rows,
    },
  }).factsToPersist;
  const account = {
    householdId: prepared.householdId,
    key: JSON.stringify(["fake capacity", "fake account 0"]),
    provider: "FAKE capacity",
    name: "FAKE account 0",
    accountType: "indian_stock",
    currency: "INR" as const,
  };
  const instrument = {
    householdId: prepared.householdId,
    key: JSON.stringify(["indian_stock", "INR", "symbol", "FAKE0"]),
    name: "FAKE instrument 0",
    symbol: "FAKE0",
    assetClass: "indian_stock" as const,
    currency: "INR" as const,
  };
  const batch = await t.run((ctx) =>
    ctx.db.get("importBatches", prepared.batchId),
  );
  if (!batch) throw new Error("Missing test batch");
  return { t, prepared, batch, facts, account, instrument };
}

it("retains first-seen display metadata for canonically identical accounts and instruments", async () => {
  const { t, account, instrument } = await fixture();
  await t.run(async (ctx) => {
    const accountId = await ensureAccount(ctx, account);
    expect(
      await ensureAccount(ctx, {
        ...account,
        name: "fake ACCOUNT 0",
        accountType: "us_stock",
        currency: "USD",
      }),
    ).toBe(accountId);
    const instrumentId = await ensureInstrument(ctx, instrument);
    expect(
      await ensureInstrument(ctx, {
        ...instrument,
        name: "A later display name",
        symbol: "fake0",
      }),
    ).toBe(instrumentId);
    expect(await ctx.db.get("accounts", accountId)).toMatchObject({
      name: account.name,
      accountType: "indian_stock",
      currency: "INR",
    });
    expect(await ctx.db.get("instruments", instrumentId)).toMatchObject({
      name: instrument.name,
      symbol: "FAKE0",
    });
  });
});

it("rejects corrupt identity contents and pre-existing duplicate logical keys", async () => {
  const { t, account, instrument } = await fixture();
  await t.run(async (ctx) => {
    const accountId = await ensureAccount(ctx, account);
    const instrumentId = await ensureInstrument(ctx, instrument);
    await ctx.db.patch("accounts", accountId, { name: "another account" });
    await ctx.db.patch("instruments", instrumentId, { currency: "USD" });
  });
  await expect(t.run((ctx) => ensureAccount(ctx, account))).rejects.toThrow(
    "Conflicting account identity",
  );
  await expect(
    t.run((ctx) => ensureInstrument(ctx, instrument)),
  ).rejects.toThrow("Conflicting instrument identity");
  await t.run((ctx) => ctx.db.insert("accounts", account));
  await expect(t.run((ctx) => ensureAccount(ctx, account))).rejects.toThrow();
  await expect(
    t.run((ctx) => ensureInstrument(ctx, { ...instrument, key: "wrong-key" })),
  ).rejects.toThrow("logical key does not match");
});

it("replays immutable holdings, transactions and valuations despite JSON property order", async () => {
  const { t, batch, facts } = await fixture();
  await t.run((ctx) => persistFacts(ctx, batch, facts));
  await t.run(async (ctx) => {
    for (const table of [
      "holdingSnapshots",
      "transactions",
      "portfolioValuations",
    ] as const) {
      const stored = await ctx.db.query(table).first();
      if (!stored) throw new Error("Missing test fact");
      const value: unknown = JSON.parse(stored.factJson);
      if (!value || typeof value !== "object")
        throw new Error("Invalid test fact");
      await ctx.db.patch(table, stored._id, {
        factJson: JSON.stringify(
          Object.fromEntries(Object.entries(value).reverse()),
        ),
      });
    }
  });
  await t.run((ctx) => persistFacts(ctx, batch, facts));
  await t.run(async (ctx) => {
    for (const table of [
      "holdingSnapshots",
      "transactions",
      "portfolioValuations",
    ] as const)
      expect(await ctx.db.query(table).collect()).toHaveLength(1);
  });
});

it("rejects conflicting immutable source data and duplicate stored fact keys", async () => {
  const { t, batch, facts } = await fixture();
  await t.run((ctx) => persistFacts(ctx, batch, facts));
  const conflictingFacts = facts.map((fact) => ({
    ...fact,
    row: { ...fact.row, metadata: { changed: true } },
  }));
  await expect(
    t.run((ctx) => persistFacts(ctx, batch, conflictingFacts)),
  ).rejects.toThrow("Conflicting immutable portfolio fact");
  await t.run(async (ctx) => {
    const stored = await ctx.db.query("transactions").first();
    if (!stored) throw new Error("Missing test transaction");
    await ctx.db.patch("transactions", stored._id, {
      occurrenceKey: "conflicting-occurrence",
    });
  });
  await expect(t.run((ctx) => persistFacts(ctx, batch, facts))).rejects.toThrow(
    "Conflicting immutable portfolio fact",
  );
  await t.run(async (ctx) => {
    const stored = await ctx.db.query("holdingSnapshots").first();
    if (!stored) throw new Error("Missing test holding");
    await ctx.db.insert("holdingSnapshots", {
      householdId: stored.householdId,
      batchId: stored.batchId,
      key: stored.key,
      factJson: stored.factJson,
      positionKey: stored.positionKey,
      instrumentKey: stored.instrumentKey,
      sourceGroupKey: stored.sourceGroupKey,
      date: stored.date,
    });
  });
  await expect(
    t.run((ctx) => persistFacts(ctx, batch, facts)),
  ).rejects.toThrow();
});

it("serializes concurrent identity and immutable-fact replays to one logical document", async () => {
  const { t, batch, facts, account, instrument } = await fixture();
  const ids = await Promise.all(
    Array.from({ length: 2 }, () =>
      t.run(async (ctx) => {
        const accountId = await ensureAccount(ctx, account);
        const instrumentId = await ensureInstrument(ctx, instrument);
        await persistFacts(ctx, batch, facts);
        return { accountId, instrumentId };
      }),
    ),
  );
  expect(ids[0]).toEqual(ids[1]);
  await t.run(async (ctx) => {
    for (const table of [
      "accounts",
      "instruments",
      "holdingSnapshots",
      "transactions",
      "portfolioValuations",
    ] as const)
      expect(await ctx.db.query(table).collect()).toHaveLength(1);
  });
});

it("rejects a corrupt duplicate in the bounded identity inventory before writing new identities", async () => {
  const { t, prepared, facts, account } = await fixture();
  await t.run(async (ctx) => {
    await ctx.db.insert("accounts", account);
    await ctx.db.insert("accounts", account);
  });
  await expect(
    t.run((ctx) => persistIdentities(ctx, prepared.householdId, facts)),
  ).rejects.toThrow("Duplicate stored portfolio identity");
});
