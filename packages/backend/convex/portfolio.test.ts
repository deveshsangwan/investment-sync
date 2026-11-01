import { vestedWorkbook } from "../../importers/src/vested-fixtures";
import { adaptLegacyRow } from "@investment-sync/importers/exact-adapter";
import type {
  ExactNormalizedImportRow,
  NormalizedHoldingRow,
  NormalizedTransactionRow,
} from "@investment-sync/importers";
import { parseExactImportFile } from "@investment-sync/importers";
import { parserGoldenFixtures } from "../../importers/src/golden-fixtures";
import {
  buildPortfolioPublication,
  valuePortfolioPublication,
} from "@investment-sync/portfolio-domain";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { chunkRows, digest, parseRows, utf8Bytes } from "./model/importLimits";
import schema from "./schema";
import { activePortfolio, completeProjection } from "./model/portfolioReads";
import { modules } from "./test.setup";

const ownerIdentity = {
  subject: "portfolio_owner",
  issuer: "https://fake.example",
  tokenIdentifier: "fake|portfolio_owner",
};
const quote = {
  status: "fresh",
  rate: "80",
  fetchedAt: "2025-04-01T00:00:00.000Z",
  provider: "frankfurter",
} as const;

function holding(overrides: Partial<NormalizedHoldingRow> = {}) {
  return adaptLegacyRow({
    kind: "holding",
    sourceType: "tickertape_stock_csv",
    sourceDate: "2025-03-01",
    accountName: "Fake Stocks",
    provider: "Fake Broker",
    instrumentName: "ALPHA",
    symbol: "ALPHA",
    assetClass: "indian_stock",
    currency: "INR",
    quantity: 10,
    investedAmount: 100,
    currentValue: 120,
    pnlAmount: 20,
    metadata: {},
    ...overrides,
  });
}

function transaction(overrides: Partial<NormalizedTransactionRow> = {}) {
  return adaptLegacyRow({
    kind: "transaction",
    sourceType: "tickertape_stock_csv",
    accountName: "Fake Stocks",
    provider: "Fake Broker",
    instrumentName: "ALPHA",
    symbol: "ALPHA",
    assetClass: "indian_stock",
    currency: "INR",
    tradeDate: "2024-03-01",
    type: "buy",
    quantity: 10,
    price: 10,
    amount: 100,
    metadata: {},
    ...overrides,
  });
}

async function setupPortfolio(rows: ExactNormalizedImportRow[]) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-04-01T00:00:00.000Z"));
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(ownerIdentity);
  await owner.mutation(api.users.ensureCurrent);
  const blob = new Blob(["fake portfolio fixture"]);
  const reservation = await owner.mutation(api.imports.createUpload, {
    fileName: "fake-portfolio.csv",
    sizeBytes: blob.size,
  });
  const storageId = await t.run((ctx) => ctx.storage.store(blob));
  await owner.mutation(api.imports.attachUpload, {
    batchId: reservation.batchId,
    storageId,
  });
  const input = await t.query(internal.importWorkers.parseInput, {
    batchId: reservation.batchId,
    attempt: 1,
  });
  const manifest = [];
  for (const [index, rowsJson] of chunkRows(rows).entries()) {
    const receipt = {
      index,
      count: parseRows(rowsJson).length,
      bytes: utf8Bytes(rowsJson),
      digest: digest(rowsJson),
    };
    await t.mutation(internal.importWorkers.storeChunk, {
      batchId: reservation.batchId,
      attempt: 1,
      index,
      count: receipt.count,
      digest: receipt.digest,
      rowsJson,
    });
    manifest.push(receipt);
  }
  await t.mutation(internal.importWorkers.finishParse, {
    batchId: reservation.batchId,
    attempt: 1,
    contentHash: input.contentHash,
    parserVersion: "portfolio-query-test-v1",
    sourceType: "tickertape_stock_csv",
    rowCount: rows.length,
    normalizedBytes: utf8Bytes(JSON.stringify(rows)),
    manifest,
    warnings: [],
  });
  const batch = await t.run((ctx) =>
    ctx.db.get("importBatches", reservation.batchId),
  );
  if (!batch) throw new Error("Missing portfolio test batch");
  const publicationResult = await owner.mutation(api.imports.commit, {
    batchId: reservation.batchId,
  });
  await t.action(internal.actions.publishPortfolio.publishPortfolio, {
    versionId: publicationResult.versionId,
    attempt: 1,
  });
  const publication = buildPortfolioPublication({
    existingFacts: [],
    batch: {
      id: reservation.batchId,
      parserVersion: "portfolio-query-test-v1",
      sequence: 1,
      fallbackDate: new Date(batch.createdAt).toISOString().slice(0, 10),
      rows,
    },
  });
  const beginning = await t.mutation(internal.currencyRates.beginRefresh, {});
  await t.mutation(internal.currencyRates.saveQuote, {
    requestRevision: beginning.requestRevision,
    rate: quote.rate,
    fetchedAt: quote.fetchedAt,
  });

  return { t, owner, publication };
}

async function commitAdditionalPortfolio(
  state: Pick<Awaited<ReturnType<typeof setupPortfolio>>, "t" | "owner">,
  rows: ExactNormalizedImportRow[],
  existingFacts: ReturnType<typeof buildPortfolioPublication>["facts"],
  sequence: number,
  parserVersion = "portfolio-query-test-v1",
) {
  const blob = new Blob([`fake portfolio fixture ${sequence}`]);
  const reservation = await state.owner.mutation(api.imports.createUpload, {
    fileName: `fake-portfolio-${sequence}.csv`,
    sizeBytes: blob.size,
  });
  const storageId = await state.t.run((ctx) => ctx.storage.store(blob));
  await state.owner.mutation(api.imports.attachUpload, {
    batchId: reservation.batchId,
    storageId,
  });
  const input = await state.t.query(internal.importWorkers.parseInput, {
    batchId: reservation.batchId,
    attempt: 1,
  });
  const manifest = [];
  for (const [index, rowsJson] of chunkRows(rows).entries()) {
    const receipt = {
      index,
      count: parseRows(rowsJson).length,
      bytes: utf8Bytes(rowsJson),
      digest: digest(rowsJson),
    };
    await state.t.mutation(internal.importWorkers.storeChunk, {
      batchId: reservation.batchId,
      attempt: 1,
      index,
      count: receipt.count,
      digest: receipt.digest,
      rowsJson,
    });
    manifest.push(receipt);
  }
  await state.t.mutation(internal.importWorkers.finishParse, {
    batchId: reservation.batchId,
    attempt: 1,
    contentHash: input.contentHash,
    parserVersion,
    sourceType: "tickertape_stock_csv",
    rowCount: rows.length,
    normalizedBytes: utf8Bytes(JSON.stringify(rows)),
    manifest,
    warnings: [],
  });
  const batch = await state.t.run((ctx) =>
    ctx.db.get("importBatches", reservation.batchId),
  );
  if (!batch) throw new Error("Missing additional portfolio test batch");
  const publicationResult = await state.owner.mutation(api.imports.commit, {
    batchId: reservation.batchId,
  });
  await state.t.action(internal.actions.publishPortfolio.publishPortfolio, {
    versionId: publicationResult.versionId,
    attempt: 1,
  });

  return buildPortfolioPublication({
    existingFacts,
    batch: {
      id: reservation.batchId,
      parserVersion,
      sequence,
      fallbackDate: new Date(batch.createdAt).toISOString().slice(0, 10),
      rows,
    },
  });
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("public portfolio reads", () => {
  it("serves post-cutover imports and policy updates to existing and new native sessions in isolated households", async () => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", "true");
    const importedRow = holding();

    if (importedRow.kind !== "holding")
      throw new Error("Expected an imported holding");

    const state = await setupPortfolio([
      {
        ...importedRow,
        investedAmount: "100.25",
        currentValue: "120.75",
        pnlAmount: "20.5",
      },
      holding({
        accountName: "Second fake account",
        symbol: "BETA",
        instrumentName: "BETA",
        currentValue: 30,
        investedAmount: 20,
        pnlAmount: 10,
      }),
    ]);
    const { t, owner } = state;
    const existing = t.withIdentity({
      ...ownerIdentity,
      tokenIdentifier: "fake|new_native_session",
    });
    const newcomer = t.withIdentity({
      ...ownerIdentity,
      subject: "native_new_owner",
      tokenIdentifier: "fake|native_new_owner",
    });

    // The imported identity keeps its original Household; a new identity does
    // not need the retained SQL provisioning path or source write permission.

    const [existingId, newcomerId] = await Promise.all([
      existing.mutation(api.users.ensureCurrent),
      newcomer.mutation(api.users.ensureCurrent),
    ]);
    expect(existingId).not.toBe(newcomerId);
    const [oldProfile, nativeProfile, newProfile] = await Promise.all([
      owner.query(api.users.current),
      existing.query(api.users.current),
      newcomer.query(api.users.current),
    ]);
    expect(nativeProfile.householdId).toBe(oldProfile.householdId);
    expect(newProfile.householdId).not.toBe(oldProfile.householdId);

    const policy = await owner.mutation(api.manualPolicies.create, {
      provider: "Fake Life",
      name: "Fake policy",
      investedAmount: "10.25",
      currentValue: "12.50",
      sourceDate: "2025-03-01",
      requestId: crypto.randomUUID(),
    });
    async function publishPolicy(batchId: typeof policy.batchId) {
      const batch = await t.run((ctx) => ctx.db.get("importBatches", batchId));

      if (!batch?.publishingVersionId)
        throw new Error("Expected policy publication");

      await t.action(internal.actions.publishPortfolio.publishPortfolio, {
        versionId: batch.publishingVersionId,
        attempt: batch.publicationAttempt ?? 1,
      });
    }
    await publishPolicy(policy.batchId);
    const before = await existing.query(api.portfolio.positions);
    expect(before.current).toHaveLength(3);
    const imported = before.current.find(
      (item) => item.accountName === "Fake Stocks",
    );
    expect(imported).toMatchObject({
      currentValue: "120.75",
      currentValueInInr: 120.75,
    });
    expect(new Set(before.current.map((item) => item.id)).size).toBe(3);

    const update = await owner.mutation(api.manualPolicies.updateValue, {
      provider: "Fake Life",
      name: "Fake policy",
      investedAmount: "10.25",
      currentValue: "14.75",
      sourceDate: "2025-03-02",
      requestId: crypto.randomUUID(),
      policyId: policy.policyId,
      expectedBatchId: policy.batchId,
    });
    await publishPolicy(update.batchId);
    const [overview, positions, emptyOverview, emptyPositions] =
      await Promise.all([
        existing.query(api.portfolio.overview),
        existing.query(api.portfolio.positions),
        newcomer.query(api.portfolio.overview),
        newcomer.query(api.portfolio.positions),
      ]);
    expect(overview.summary.currentValue).toBe(165.5);
    expect(
      positions.current.find((item) => item.manualPolicyId === policy.policyId),
    ).toMatchObject({
      currentValue: "14.75",
      currentValueInInr: 14.75,
      snapshotDate: "2025-03-02",
    });
    expect(positions.current.find((item) => item.id === imported?.id)).toEqual(
      imported,
    );
    expect(emptyOverview.summary.currentValue).toBe(0);
    expect(emptyPositions).toEqual({ current: [], exited: [] });
    await expect(t.query(api.portfolio.overview)).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(t.query(api.portfolio.positions)).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });

  it.each([
    {
      name: "gain",
      rows: [holding({ currentValue: 125, pnlAmount: undefined })],
      pnlAmount: 25,
      pnlPercent: 25,
      overviewPnl: 25,
      oldInrPnl: "0",
    },
    {
      name: "loss",
      rows: [holding({ currentValue: 75, pnlAmount: undefined })],
      pnlAmount: -25,
      pnlPercent: -25,
      overviewPnl: -25,
      oldInrPnl: "0",
    },
    {
      name: "zero",
      rows: [holding({ currentValue: 100, pnlAmount: undefined })],
      pnlAmount: 0,
      pnlPercent: 0,
      overviewPnl: 0,
      oldInrPnl: "0",
    },
    {
      name: "reported zero",
      rows: [holding({ currentValue: 125, pnlAmount: 0 })],
      pnlAmount: 0,
      pnlPercent: 0,
      overviewPnl: 25,
      oldInrPnl: "0",
    },
    {
      name: "independent accounts with the same instrument, mixed currencies and reported zero",
      rows: [
        holding({
          accountName: "Broker A",
          currentValue: 125,
          pnlAmount: undefined,
        }),
        holding({
          accountName: "Broker B",
          currentValue: 75,
          pnlAmount: undefined,
        }),
        holding({ accountName: "Broker C", currentValue: 125, pnlAmount: 0 }),
        holding({
          accountName: "US broker",
          currency: "USD",
          investedAmount: 10,
          currentValue: 12.5,
          pnlAmount: undefined,
        }),
      ],
      pnlAmount: 200,
      pnlPercent: 18.18,
      overviewPnl: 225,
      oldInrPnl: "0",
    },
    {
      name: "mixed reported and absent P&L in INR and USD",
      rows: [
        holding({ currentValue: 125, pnlAmount: undefined }),
        holding({
          symbol: "BETA",
          instrumentName: "BETA",
          currentValue: 75,
          pnlAmount: -25,
        }),
        holding({
          symbol: "ZERO",
          instrumentName: "ZERO",
          currentValue: 100,
          pnlAmount: 0,
        }),
        holding({
          symbol: "USD",
          instrumentName: "USD",
          currency: "USD",
          investedAmount: 10,
          currentValue: 12.5,
          pnlAmount: undefined,
        }),
      ],
      pnlAmount: 200,
      pnlPercent: 18.18,
      overviewPnl: 200,
      oldInrPnl: "-25",
    },
  ])(
    "serves corrected $name for new and already-persisted projections",
    async ({ rows, pnlAmount, pnlPercent, overviewPnl, oldInrPnl }) => {
      const state = await setupPortfolio(rows);
      const readViews = () =>
        Promise.all([
          state.owner.query(api.portfolio.overview, {}),
          state.owner.query(api.portfolio.assetClassDetail, {
            assetClass: "indian_stock",
          }),
          state.owner.query(api.portfolio.positions, {}),
        ]);
      const [overview, asset, positions] = await readViews();

      expect(overview.summary.pnlAmount).toBe(overviewPnl);
      expect(asset.summary).toMatchObject({ pnlAmount, pnlPercent });
      expect(asset.summary.investedAmount).toBe(
        overview.summary.investedAmount,
      );
      expect(asset.summary.currentValue).toBe(overview.summary.currentValue);
      expect(asset.holdings.map((row) => row.pnlAmount).sort()).toEqual(
        positions.current.map((row) => row.pnlAmount).sort(),
      );

      // Recreate the old aggregation without changing retained holding rows or
      // facts. A new reader must work before the next Import Batch is committed.
      const persisted = await state.t.run(async (ctx) => {
        const household = await ctx.db.query("households").unique();
        const versionId = household?.activePortfolioVersionId;
        if (!versionId) throw new Error("Missing active test version");

        const version = await ctx.db.get("portfolioVersions", versionId);
        if (!version) throw new Error("Missing test version");

        const summary = await ctx.db
          .query("portfolioSummaries")
          .withIndex("by_versionId", (q) => q.eq("versionId", versionId))
          .unique();
        const assetSummary = await ctx.db
          .query("assetClassSummaries")
          .withIndex("by_versionId_and_assetClass", (q) =>
            q.eq("versionId", versionId).eq("assetClass", "indian_stock"),
          )
          .unique();
        if (!summary || !assetSummary) throw new Error("Missing test summary");

        const oldTotals = summary.totals.map((total) => ({
          ...total,
          pnlAmount: total.currency === "INR" ? oldInrPnl : "0",
        }));
        await ctx.db.patch("portfolioSummaries", summary._id, {
          totals: oldTotals,
        });
        await ctx.db.patch("assetClassSummaries", assetSummary._id, {
          totals: oldTotals,
        });

        return {
          household,
          version,
          positions: await ctx.db.query("portfolioPositions").collect(),
          facts: await ctx.db.query("holdingSnapshots").collect(),
          summaryId: summary._id,
          assetSummaryId: assetSummary._id,
          oldTotals,
        };
      });
      const corrected = await readViews();

      expect(corrected).toEqual([overview, asset, positions]);
      await state.t.run(async (ctx) => {
        expect(await ctx.db.get("households", persisted.household._id)).toEqual(
          persisted.household,
        );
        expect(
          await ctx.db.get("portfolioVersions", persisted.version._id),
        ).toEqual(persisted.version);
        expect(await ctx.db.query("portfolioPositions").collect()).toEqual(
          persisted.positions,
        );
        expect(await ctx.db.query("holdingSnapshots").collect()).toEqual(
          persisted.facts,
        );
        expect(
          (await ctx.db.get("portfolioSummaries", persisted.summaryId))?.totals,
        ).toEqual(persisted.oldTotals);
        expect(
          (await ctx.db.get("assetClassSummaries", persisted.assetSummaryId))
            ?.totals,
        ).toEqual(persisted.oldTotals);
      });
    },
  );

  it("publishes separate account positions, histories, aliases and independent exits", async () => {
    const state = await setupPortfolio([
      holding({ accountName: "Broker A", currentValue: 125.1234 }),
      holding({
        accountName: "Broker B",
        investedAmount: 200,
        currentValue: 210.5678,
      }),
      transaction({ accountName: "Broker A", amount: 100 }),
      transaction({ accountName: "Broker B", amount: 200 }),
    ]);
    const [positions, overview, asset] = await Promise.all([
      state.owner.query(api.portfolio.positions, {}),
      state.owner.query(api.portfolio.overview, {}),
      state.owner.query(api.portfolio.assetClassDetail, {
        assetClass: "indian_stock",
      }),
    ]);

    expect(positions.current).toHaveLength(2);
    expect(overview.summary.currentValue).toBe(335.69);
    expect(overview.summary.investedAmount).toBe(300);
    expect(overview.summary.allocationByAssetClass[0]?.currentValue).toBe(
      335.69,
    );
    expect(asset.summary.holdingCount).toBe(2);
    expect(asset.timeline[0]?.currentValue).toBe(335.69);

    const current = await state.owner.query(api.users.current, {});
    for (const [
      index,
      position,
    ] of state.publication.projection.positions.entries()) {
      const legacyId = `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`;
      await state.t.run((ctx) =>
        ctx.db.insert("legacyHoldingAliases", {
          householdId: current.householdId,
          legacyId,
          positionKey: position.positionKey,
        }),
      );
      const detail = await state.owner.query(api.portfolio.holdingDetail, {
        positionKey: legacyId,
      });
      const assetHolding = asset.holdings.find(
        (holding) => holding.accountName === detail?.holding.accountName,
      );

      expect(detail?.holding.isCurrent).toBe(true);
      expect(detail?.history).toHaveLength(1);
      expect(detail?.history[0]?.accountName).toBe(
        position.holding.row.accountName,
      );
      expect(detail?.transactions).toHaveLength(1);
      expect(detail?.transactions[0]?.amount).toBe(
        position.holding.row.investedAmount,
      );
      expect(assetHolding?.xirr).toBe(detail?.holding.xirr);
    }

    await commitAdditionalPortfolio(
      state,
      [
        holding({
          accountName: "Broker A",
          symbol: "BETA",
          instrumentName: "BETA",
          sourceDate: "2025-03-02",
        }),
        holding({
          accountName: "Broker B",
          investedAmount: 200,
          currentValue: 220,
          sourceDate: "2025-03-02",
        }),
      ],
      state.publication.facts,
      2,
    );
    const next = await state.owner.query(api.portfolio.positions, {});

    expect(
      next.current.map((row) => [row.accountName, row.symbol]).sort(),
    ).toEqual([
      ["Broker A", "BETA"],
      ["Broker B", "ALPHA"],
    ]);
    expect(next.exited).toMatchObject([
      { accountName: "Broker A", symbol: "ALPHA" },
    ]);
    expect(next.exited).toHaveLength(1);
    const brokerB = next.current.find((row) => row.accountName === "Broker B");
    if (!brokerB) throw new Error("Missing Broker B position");

    const detail = await state.owner.query(api.portfolio.holdingDetail, {
      positionKey: brokerB.id,
    });
    expect(detail?.history).toHaveLength(2);
    expect(detail?.holding.isCurrent).toBe(true);
  });

  it("preserves portfolio summation order when hydrating detail views", async () => {
    const state = await setupPortfolio([
      holding({
        instrumentName: "A",
        symbol: "A",
        currentValue: 2 ** 53,
        investedAmount: 2 ** 53,
        pnlAmount: 0,
      }),
      holding({
        instrumentName: "B",
        symbol: "B",
        assetClass: "mutual_fund",
        currentValue: 2,
        investedAmount: 0,
        pnlAmount: 2,
      }),
      holding({
        instrumentName: "C",
        symbol: "C",
        currentValue: 1,
        investedAmount: 0,
        pnlAmount: 1,
      }),
    ]);

    for (const position of state.publication.projection.positions) {
      await expect(
        state.owner.query(api.portfolio.holdingDetail, {
          positionKey: position.positionKey,
        }),
      ).resolves.toEqual(
        valuePortfolioPublication(state.publication.projection, quote, {
          view: "holdingDetail",
          positionKey: position.positionKey,
        }),
      );
    }

    for (const assetClass of ["indian_stock", "mutual_fund"] as const) {
      await expect(
        state.owner.query(api.portfolio.assetClassDetail, { assetClass }),
      ).resolves.toEqual(
        valuePortfolioPublication(state.publication.projection, quote, {
          view: "assetClassDetail",
          assetClass,
        }),
      );
    }
  });

  it.each(parserGoldenFixtures())(
    "matches pure-domain views for the $name parser golden",
    async ({ file }) => {
      const parsed = parseExactImportFile(file);
      const state = await setupPortfolio(parsed.rows);
      const expected = valuePortfolioPublication(
        state.publication.projection,
        quote,
      );

      await expect(
        state.owner.query(api.portfolio.overview, {}),
      ).resolves.toEqual(expected.overview);
      await expect(
        state.owner.query(api.portfolio.positions, {}),
      ).resolves.toEqual(expected.positions);
      for (const position of state.publication.projection.positions) {
        await expect(
          state.owner.query(api.portfolio.holdingDetail, {
            positionKey: position.positionKey,
          }),
        ).resolves.toEqual(
          valuePortfolioPublication(state.publication.projection, quote, {
            view: "holdingDetail",
            positionKey: position.positionKey,
          }),
        );
      }
      for (const asset of state.publication.projection.assetClasses) {
        await expect(
          state.owner.query(api.portfolio.assetClassDetail, {
            assetClass: asset.assetClass,
          }),
        ).resolves.toEqual(
          valuePortfolioPublication(state.publication.projection, quote, {
            view: "assetClassDetail",
            assetClass: asset.assetClass,
          }),
        );
      }
    },
  );

  it("round-trips every public view through the active read model", async () => {
    const rows = [
      holding({ sourceDate: "2025-01-01", quantity: 10 }),
      holding({ sourceDate: "2025-03-01", quantity: 6, currentValue: 72 }),
      holding({
        metadata: { sourceSheet: "Older Source" },
        sourceDate: "2025-02-01",
        currentValue: 110,
      }),
      holding({
        instrumentName: "FAKE US",
        symbol: "FAKEUS",
        assetClass: "us_stock",
        currency: "USD",
        investedAmount: 10,
        currentValue: 12,
        pnlAmount: 2,
      }),
      transaction(),
      transaction(),
      transaction({
        tradeDate: "2025-03-01",
        type: "sell",
        quantity: 4,
        amount: 48,
      }),
      adaptLegacyRow({
        kind: "valuation",
        sourceType: "investment_portfolio_xlsx",
        valuationDate: "2024-03-01",
        currency: "INR",
        investedAmount: 100,
        currentValue: 108,
        metadata: {},
      }),
    ];
    const state = await setupPortfolio(rows);
    const expectedOverview = valuePortfolioPublication(
      state.publication.projection,
      quote,
      { view: "overview" },
    );
    const expectedPositions = valuePortfolioPublication(
      state.publication.projection,
      quote,
      { view: "positions" },
    );

    await expect(
      state.owner.query(api.portfolio.overview, {}),
    ).resolves.toEqual(expectedOverview);
    await expect(
      state.owner.query(api.portfolio.positions, {}),
    ).resolves.toEqual(expectedPositions);
    for (const position of state.publication.projection.positions) {
      await expect(
        state.owner.query(api.portfolio.holdingDetail, {
          positionKey: position.positionKey,
        }),
      ).resolves.toEqual(
        valuePortfolioPublication(state.publication.projection, quote, {
          view: "holdingDetail",
          positionKey: position.positionKey,
        }),
      );
    }
    const suppressed = state.publication.projection.detailPositions?.[0];
    if (!suppressed) throw new Error("Missing suppressed test position");
    await expect(
      state.owner.query(api.portfolio.holdingDetail, {
        positionKey: suppressed.positionKey,
      }),
    ).resolves.toEqual(
      valuePortfolioPublication(state.publication.projection, quote, {
        view: "holdingDetail",
        positionKey: suppressed.positionKey,
      }),
    );
    for (const assetClass of ["indian_stock", "us_stock"] as const) {
      await expect(
        state.owner.query(api.portfolio.assetClassDetail, { assetClass }),
      ).resolves.toEqual(
        valuePortfolioPublication(state.publication.projection, quote, {
          view: "assetClassDetail",
          assetClass,
        }),
      );
    }
    expect(
      expectedPositions.current.find((item) => item.symbol === "ALPHA"),
    ).toMatchObject({ quantity: "6", currentValue: "72" });
    expect(expectedOverview.performance.cashFlowCount).toBe(3);
  });

  it("preserves partial snapshots, aggregate fallback, exits, and overlapping sources", async () => {
    const alpha = holding({ metadata: { sourceSheet: "Group A" } });
    const beta = holding({
      instrumentName: "BETA",
      symbol: "BETA",
      metadata: { sourceSheet: "Group A" },
    });
    const aggregate = holding({
      instrumentName: "Fake Summary",
      symbol: "TOTAL",
      currentValue: 999,
      metadata: { sourceSheet: "Group A" },
    });
    const state = await setupPortfolio([alpha, beta, aggregate]);
    expect(
      (await state.owner.query(api.portfolio.overview, {})).summary,
    ).toMatchObject({ currentValue: 240 });
    const partialAlpha = holding({
      sourceDate: "2025-04-01",
      metadata: { sourceSheet: "Group A" },
    });
    if (partialAlpha.kind !== "holding") throw new Error("Expected holding");
    const partial = await commitAdditionalPortfolio(
      state,
      [
        {
          ...partialAlpha,
          source: { ...partialAlpha.source, completeness: "partial" },
        },
      ],
      state.publication.facts,
      2,
    );
    expect(
      (await state.owner.query(api.portfolio.positions, {})).current,
    ).toHaveLength(2);
    const overlapping = await commitAdditionalPortfolio(
      state,
      [
        holding({
          sourceDate: "2025-05-01",
          metadata: { sourceSheet: "Group B" },
        }),
      ],
      partial.facts,
      3,
    );
    const exited = await commitAdditionalPortfolio(
      state,
      [
        holding({
          instrumentName: "GAMMA",
          symbol: "GAMMA",
          sourceDate: "2025-06-01",
          metadata: { sourceSheet: "Group B" },
        }),
      ],
      overlapping.facts,
      4,
    );
    const expected = valuePortfolioPublication(exited.projection, quote, {
      view: "positions",
    });
    const actual = await state.owner.query(api.portfolio.positions, {});

    expect(actual).toEqual(expected);
    expect(
      actual.current.filter((position) => position.symbol === "ALPHA"),
    ).toHaveLength(1);
    expect(
      actual.exited.filter((position) => position.symbol === "ALPHA"),
    ).toHaveLength(1);
  });

  it.each([false, true])(
    "preserves NPS source priority with portal-first=%s",
    async (portalFirst) => {
      const workbook = holding({
        sourceType: "investment_portfolio_xlsx",
        accountName: "NPS",
        provider: "NPS",
        instrumentName: "NPS",
        symbol: undefined,
        assetClass: "nps",
        currentValue: 110,
        metadata: { sourceSheet: "NPS" },
      });
      const portal = holding({
        sourceType: "nps_csv",
        accountName: "NPS",
        provider: "NPS",
        instrumentName: "NPS",
        symbol: undefined,
        assetClass: "nps",
        currentValue: 125,
        metadata: { sourceSheet: "NPS" },
      });
      const state = await setupPortfolio([portalFirst ? portal : workbook]);
      const publication = await commitAdditionalPortfolio(
        state,
        [portalFirst ? workbook : portal],
        state.publication.facts,
        2,
      );

      await expect(
        state.owner.query(api.portfolio.overview, {}),
      ).resolves.toEqual(
        valuePortfolioPublication(publication.projection, quote, {
          view: "overview",
        }),
      );
      expect(
        (await state.owner.query(api.portfolio.positions, {})).current[0]
          ?.currentValue,
      ).toBe("125");
    },
  );

  it("supports household-scoped legacy aliases and isolates every read", async () => {
    const state = await setupPortfolio([holding()]);
    const position = state.publication.projection.positions[0];
    if (!position) throw new Error("Missing test position");
    const current = await state.owner.query(api.users.current, {});
    await state.t.run(async (ctx) => {
      await ctx.db.insert("legacyHoldingAliases", {
        householdId: current.householdId,
        legacyId: "11111111-1111-4111-8111-111111111111",
        positionKey: position.positionKey,
      });
      const viewerId = await ctx.db.insert("users", {
        clerkSubject: "portfolio_viewer",
      });
      await ctx.db.insert("householdMembers", {
        householdId: current.householdId,
        userId: viewerId,
        role: "viewer",
      });
      const foreignUserId = await ctx.db.insert("users", {
        clerkSubject: "portfolio_foreign",
      });
      const foreignHouseholdId = await ctx.db.insert("households", {
        ownerUserId: foreignUserId,
        name: "Foreign household",
      });
      await ctx.db.insert("householdMembers", {
        householdId: foreignHouseholdId,
        userId: foreignUserId,
        role: "owner",
      });
      await ctx.db.insert("accounts", {
        householdId: foreignHouseholdId,
        key: "foreign-account",
        provider: "Foreign",
        name: "Foreign account",
        accountType: "indian_stock",
        currency: "INR",
      });
    });
    const viewer = state.t.withIdentity({
      subject: "portfolio_viewer",
      issuer: "https://fake.example",
      tokenIdentifier: "fake|portfolio_viewer",
    });
    const foreign = state.t.withIdentity({
      subject: "portfolio_foreign",
      issuer: "https://fake.example",
      tokenIdentifier: "fake|portfolio_foreign",
    });

    await expect(
      viewer.query(api.portfolio.holdingDetail, {
        positionKey: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({ positionKey: position.positionKey });
    const ownerAccounts = await state.owner.query(api.accounts.list, {});
    expect(ownerAccounts).toEqual([
      expect.objectContaining({
        name: "Fake Stocks",
        provider: "Fake Broker",
        accountType: "indian_stock",
        currency: "INR",
      }),
    ]);
    await expect(viewer.query(api.accounts.list, {})).resolves.toEqual(
      ownerAccounts,
    );
    await expect(
      foreign.query(api.portfolio.holdingDetail, {
        positionKey: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toBeNull();
    await expect(foreign.query(api.portfolio.positions, {})).resolves.toEqual({
      current: [],
      exited: [],
    });
    await expect(foreign.query(api.accounts.list, {})).resolves.toEqual([
      {
        id: "foreign-account",
        isArchived: false,
        provider: "Foreign",
        name: "Foreign account",
        accountType: "indian_stock",
        currency: "INR",
      },
    ]);
    await expect(state.t.query(api.portfolio.overview, {})).rejects.toThrow();
    await expect(state.t.query(api.accounts.list, {})).rejects.toThrow();
  });

  it("finds the latest committed batch beyond newer unfinished uploads", async () => {
    const state = await setupPortfolio([holding()]);
    await state.owner.mutation(api.imports.createUpload, {
      fileName: "newer-unfinished.csv",
      sizeBytes: 10,
    });

    await expect(
      state.owner.query(api.imports.latestCommitted, {}),
    ).resolves.toMatchObject({
      fileName: "fake-portfolio.csv",
      status: "committed",
      rowCount: 1,
    });
  });

  it("selects by commit time when upload creation order differs", async () => {
    const state = await setupPortfolio([holding()]);
    const original = await state.owner.query(api.imports.latestCommitted, {});
    if (!original) throw new Error("Missing original committed batch");

    vi.advanceTimersByTime(1000);
    const newer = await state.owner.mutation(api.imports.createUpload, {
      fileName: "newer-upload.csv",
      sizeBytes: 10,
    });
    await state.t.run(async (ctx) => {
      await ctx.db.patch("importBatches", newer.batchId, {
        status: "committed",
        committedAt: Date.now(),
      });
      await ctx.db.patch("importBatches", original.id, {
        committedAt: Date.now() + 1000,
      });
    });

    await expect(
      state.owner.query(api.imports.latestCommitted, {}),
    ).resolves.toMatchObject({ id: original.id });
  });

  it("preserves imported and default account types as stored by Postgres", async () => {
    const state = await setupPortfolio([
      holding(),
      holding({ accountName: "Fake Insurance", assetClass: "ulip" }),
    ]);
    const user = await state.owner.query(api.users.current, {});
    if (!user) throw new Error("Missing test user");

    await state.t.run((ctx) =>
      ctx.db.insert("accounts", {
        householdId: user.householdId,
        key: "default-broker",
        name: "Default Broker",
        provider: "Fake Broker",
        accountType: "broker",
        currency: "INR",
      }),
    );

    const accounts = await state.owner.query(api.accounts.list, {});
    expect(
      accounts.map(({ name, accountType }) => ({ name, accountType })),
    ).toEqual([
      { name: "Default Broker", accountType: "broker" },
      { name: "Fake Insurance", accountType: "ulip" },
      { name: "Fake Stocks", accountType: "indian_stock" },
    ]);
  });

  it("reads active versions created before indexed history metadata existed", async () => {
    const state = await setupPortfolio([holding(), transaction()]);
    await state.t.run(async (ctx) => {
      for (const fact of await ctx.db.query("portfolioHistoryFacts").collect())
        await ctx.db.patch("portfolioHistoryFacts", fact._id, {
          assetClass: undefined,
          positionKey: undefined,
          transactionScope: undefined,
        });
      for (const scope of await ctx.db
        .query("portfolioHistoryScopes")
        .collect())
        await ctx.db.patch("portfolioHistoryScopes", scope._id, {
          assetClass: undefined,
        });
    });
    const position = state.publication.projection.positions[0];
    if (!position) throw new Error("Missing legacy test position");

    await expect(
      state.owner.query(api.portfolio.holdingDetail, {
        positionKey: position.positionKey,
      }),
    ).resolves.toEqual(
      valuePortfolioPublication(state.publication.projection, quote, {
        view: "holdingDetail",
        positionKey: position.positionKey,
      }),
    );
    await expect(
      state.owner.query(api.portfolio.assetClassDetail, {
        assetClass: "indian_stock",
      }),
    ).resolves.toEqual(
      valuePortfolioPublication(state.publication.projection, quote, {
        view: "assetClassDetail",
        assetClass: "indian_stock",
      }),
    );
  });

  it("reacts to persisted FX changes without publishing another version", async () => {
    const state = await setupPortfolio([
      holding({
        instrumentName: "FAKE US",
        symbol: "FAKEUS",
        assetClass: "us_stock",
        currency: "USD",
        investedAmount: 10,
        currentValue: 12,
        pnlAmount: 2,
      }),
    ]);
    const before = await state.owner.query(api.portfolio.overview, {});
    const beginning = await state.t.mutation(
      internal.currencyRates.beginRefresh,
      {},
    );
    await state.t.mutation(internal.currencyRates.saveQuote, {
      requestRevision: beginning.requestRevision,
      rate: "90",
      fetchedAt: "2025-04-01T01:00:00.000Z",
    });
    const after = await state.owner.query(api.portfolio.overview, {});

    expect(before.summary.currentValue).toBe(960);
    expect(after.summary.currentValue).toBe(1080);
    vi.setSystemTime(new Date("2025-04-01T07:00:00.000Z"));
    await state.t.mutation(internal.currencyRates.markStale, {
      quoteRevision: beginning.requestRevision,
    });
    await expect(
      state.owner.query(api.portfolio.overview, {}),
    ).resolves.toMatchObject({
      summary: { exchangeRates: [{ rate: 90, isStale: true }] },
    });
    vi.setSystemTime(new Date("2025-04-08T01:00:00.000Z"));
    await state.t.mutation(internal.currencyRates.markUnavailable, {
      quoteRevision: beginning.requestRevision,
    });
    await expect(state.owner.query(api.portfolio.overview, {})).rejects.toThrow(
      "exchange rate is unavailable",
    );
    await expect(
      state.t.run((ctx) => ctx.db.query("portfolioVersions").collect()),
    ).resolves.toHaveLength(1);
  });
});

describe("Vested realized sale publication", () => {
  function report(
    date: string,
    holdings: unknown[][],
    sales?: unknown[][],
    summary?: unknown[][],
  ) {
    return parseExactImportFile(
      vestedWorkbook({ holdings, sales, summary }),
    ).rows.map((row) =>
      row.kind === "holding" || row.kind === "source_snapshot"
        ? { ...row, sourceDate: date }
        : row,
    );
  }

  const lots = [
    [
      "FAKE",
      "2025-02-15",
      "2024-01-01",
      "1.5",
      "30",
      "15",
      "15",
      "execution-1",
      "lot-1",
    ],
    [
      "FAKE",
      "2025-02-15",
      "2024-02-01",
      "0.5",
      "10",
      "7",
      "3",
      "execution-1",
      "lot-2",
    ],
  ];

  it("publishes partial sales, full exit and reentry, retaining lots across overlaps and parser versions", async () => {
    const state = await setupPortfolio(
      report("2025-01-01", [
        ["FAKE", 10, 100, 120, 20],
        ["OTHER", 1, 10, 11, 1],
      ]),
    );
    let publication = await commitAdditionalPortfolio(
      state,
      report(
        "2025-03-01",
        [
          ["FAKE", 8, 78, 96, 18],
          ["OTHER", 1, 10, 11, 1],
        ],
        lots,
        [["FAKE", 2, 40, 22, 18]],
      ),
      state.publication.facts,
      2,
    );
    const key = publication.projection.positions.find(
      (position) => position.holding.row.symbol === "FAKE",
    )?.positionKey;
    if (!key) throw new Error("Missing fake position");

    let detail = await state.owner.query(api.portfolio.holdingDetail, {
      positionKey: key,
    });
    expect(detail?.holding.isCurrent).toBe(true);
    expect(detail?.sales).toHaveLength(2);
    expect(detail?.sales[0]).toMatchObject({
      saleDate: "2025-02-15",
      acquisitionDate: "2024-01-01",
      proceeds: "30",
      costBasis: "15",
      realizedPnl: "15",
    });
    expect(detail?.holding.xirrDataQuality).not.toBe("exact_cashflows");
    expect(
      (await state.owner.query(api.portfolio.overview, {})).performance
        .cashFlowCount,
    ).toBe(0);

    const finalSale = [
      "FAKE",
      "2025-03-15",
      "2024-01-01",
      "8",
      "160",
      "78",
      "82",
      "execution-2",
      "lot-3",
    ];
    publication = await commitAdditionalPortfolio(
      state,
      report(
        "2025-04-01",
        [["OTHER", 1, 10, 11, 1]],
        [...lots, finalSale],
        [["FAKE", 10, 200, 100, 100]],
      ),
      publication.facts,
      3,
    );
    detail = await state.owner.query(api.portfolio.holdingDetail, {
      positionKey: key,
    });
    expect(detail?.holding.isCurrent).toBe(false);
    expect(detail?.holding.snapshotDate.slice(0, 10)).toBe("2025-03-01");
    expect(detail?.sales).toHaveLength(3);
    expect(detail?.sales.at(-1)).toMatchObject({
      saleDate: "2025-03-15",
      proceeds: "160",
      realizedPnl: "82",
    });
    expect(
      (await state.owner.query(api.portfolio.overview, {})).summary
        .currentValue,
    ).toBe(880);

    publication = await commitAdditionalPortfolio(
      state,
      report("2025-04-01", [["OTHER", 1, 10, 11, 1]], [...lots, finalSale]),
      publication.facts,
      4,
      "vested-next-parser",
    );
    expect(
      (
        await state.owner.query(api.portfolio.holdingDetail, {
          positionKey: key,
        })
      )?.sales,
    ).toHaveLength(3);

    publication = await commitAdditionalPortfolio(
      state,
      report("2025-05-01", [
        ["FAKE", 2, 50, 60, 10],
        ["OTHER", 1, 10, 11, 1],
      ]),
      publication.facts,
      5,
    );
    detail = await state.owner.query(api.portfolio.holdingDetail, {
      positionKey: key,
    });
    expect(detail?.holding).toMatchObject({
      isCurrent: true,
      quantity: "2",
      currentValue: "60",
    });
    expect(detail?.history).toHaveLength(3);
    expect(detail?.sales).toHaveLength(3);

    const stranger = state.t.withIdentity({
      subject: "other",
      issuer: "https://fake.example",
      tokenIdentifier: "fake|other",
    });
    await stranger.mutation(api.users.ensureCurrent);
    expect(
      await stranger.query(api.portfolio.holdingDetail, { positionKey: key }),
    ).toBeNull();
  });

  it("preserves distinct same-day equal-proceeds sales and identical-lot multiplicity", async () => {
    const identical = [
      "FAKE",
      "2025-02-15",
      "2024-01-01",
      "1",
      "20",
      "10",
      "10",
    ];
    const distinct = ["FAKE", "2025-02-15", "2024-02-01", "2", "20", "15", "5"];
    const rows = report(
      "2025-03-01",
      [["FAKE", 6, 60, 72, 12]],
      [identical, identical, distinct],
    );
    const state = await setupPortfolio(rows);
    const key = state.publication.projection.positions[0]?.positionKey;
    if (!key) throw new Error("Missing fake position");

    expect(
      (
        await state.owner.query(api.portfolio.holdingDetail, {
          positionKey: key,
        })
      )?.sales,
    ).toHaveLength(3);
    await commitAdditionalPortfolio(
      state,
      [...rows].reverse(),
      state.publication.facts,
      2,
    );
    expect(
      (
        await state.owner.query(api.portfolio.holdingDetail, {
          positionKey: key,
        })
      )?.sales,
    ).toHaveLength(3);
  });

  it("publishes independent concurrent sale imports without crossing households", async () => {
    const state = await setupPortfolio(
      report("2025-01-01", [["FAKE", 10, 100, 120, 20]]),
    );
    const other = state.t.withIdentity({
      subject: "parallel-owner",
      issuer: "https://fake.example",
      tokenIdentifier: "fake|parallel-owner",
    });
    await other.mutation(api.users.ensureCurrent);
    const rows = report("2025-03-01", [["FAKE", 8, 80, 96, 16]], lots);

    const [first, second] = await Promise.all([
      commitAdditionalPortfolio(state, rows, state.publication.facts, 2),
      commitAdditionalPortfolio({ t: state.t, owner: other }, rows, [], 3),
    ]);
    const key = first.projection.positions[0]?.positionKey;
    if (!key) throw new Error("Missing fake position");

    expect(second.projection.positions[0]?.positionKey).toBe(key);
    const details = await Promise.all([
      state.owner.query(api.portfolio.holdingDetail, { positionKey: key }),
      other.query(api.portfolio.holdingDetail, { positionKey: key }),
    ]);
    expect(details.map((detail) => detail?.sales.length)).toEqual([2, 2]);
    const transactions = await state.t.run((ctx) =>
      ctx.db.query("transactions").collect(),
    );
    expect(transactions).toHaveLength(4);
    expect(
      new Set(transactions.map((transaction) => transaction.householdId)).size,
    ).toBe(2);
  });

  it("keeps sale history limited to the holding account and leaves an exited snapshot fallback without sales", async () => {
    const rows = report("2025-01-01", [
      ["FAKE", 10, 100, 120, 20],
      ["OTHER", 1, 10, 11, 1],
    ]);
    const saleRows = report("2025-02-01", [["OTHER", 1, 10, 11, 1]], lots).map(
      (row) =>
        row.kind === "transaction"
          ? { ...row, accountName: "Another account" }
          : row,
    );
    const state = await setupPortfolio(rows);
    await commitAdditionalPortfolio(
      state,
      saleRows,
      state.publication.facts,
      2,
    );
    const key = state.publication.projection.positions.find(
      (position) => position.holding.row.symbol === "FAKE",
    )?.positionKey;
    if (!key) throw new Error("Missing fake position");

    const detail = await state.owner.query(api.portfolio.holdingDetail, {
      positionKey: key,
    });
    expect(detail?.holding.isCurrent).toBe(false);
    expect(detail?.sales).toEqual([]);
    expect(detail?.holding.currentValue).toBe("120");
  });
});

it("renames without changing import identity; archive immediately changes every portfolio view and restores history", async () => {
  const { t, owner, publication } = await setupPortfolio([
    holding(),
    transaction(),
  ]);
  const before = await owner.query(api.portfolio.overview);
  const beforePositions = await owner.query(api.portfolio.positions);
  const [account] = await owner.query(api.accounts.list);
  if (!account) throw new Error("Missing account");
  const rawBefore = await t.run(async (ctx) => ({
    facts: await ctx.db.query("holdingSnapshots").collect(),
    history: await ctx.db.query("portfolioHistoryFacts").collect(),
  }));
  await owner.mutation(api.accounts.update, {
    accountKey: account.id,
    name: "Renamed portfolio",
  });
  expect(
    (await owner.query(api.portfolio.positions)).current[0]?.accountName,
  ).toBe("Renamed portfolio");
  const renamedKey = beforePositions.current[0]?.id;
  if (!renamedKey) throw new Error("Missing position");
  expect(
    (
      await owner.query(api.portfolio.holdingDetail, {
        positionKey: renamedKey,
      })
    )?.holding.accountName,
  ).toBe("Renamed portfolio");
  await owner.mutation(api.accounts.update, {
    accountKey: account.id,
    isArchived: true,
  });
  expect(await owner.query(api.accounts.list)).toEqual([]);
  expect(await owner.query(api.accounts.listAll)).toMatchObject([
    { name: "Renamed portfolio", isArchived: true },
  ]);
  const archived = await owner.query(api.portfolio.positions);
  expect(archived.current).toEqual([]);
  expect((await owner.query(api.portfolio.overview)).summary.currentValue).toBe(
    0,
  );
  expect(
    (
      await owner.query(api.portfolio.assetClassDetail, {
        assetClass: "indian_stock",
      })
    ).holdings,
  ).toEqual([]);
  const key = beforePositions.current[0]?.id;
  if (!key) throw new Error("Missing position");
  expect(
    await owner.query(api.portfolio.holdingDetail, { positionKey: key }),
  ).toBeNull();
  expect(
    await t.run(async (ctx) => ({
      facts: await ctx.db.query("holdingSnapshots").collect(),
      history: await ctx.db.query("portfolioHistoryFacts").collect(),
    })),
  ).toEqual(rawBefore);
  await owner.mutation(api.accounts.update, {
    accountKey: account.id,
    isArchived: false,
  });
  expect((await owner.query(api.portfolio.overview)).summary).toEqual(
    before.summary,
  );
  expect(
    (await owner.query(api.portfolio.positions)).current[0]?.accountName,
  ).toBe("Renamed portfolio");
  await commitAdditionalPortfolio(
    { t, owner },
    [holding({ currentValue: 140, sourceDate: "2025-04-01" })],
    publication.facts,
    2,
  );
  expect(await owner.query(api.accounts.list)).toHaveLength(1);
});

it("authorizes account changes on the server for owner, viewer and foreign household", async () => {
  const { t, owner } = await setupPortfolio([holding()]);
  const [account] = await owner.query(api.accounts.list);
  if (!account) throw new Error("Missing account");
  const viewerIdentity = {
    subject: "fake_viewer",
    issuer: "https://fake.example",
    tokenIdentifier: "fake|viewer",
    email: "viewer@example.invalid",
    emailVerified: true,
  };
  const viewer = t.withIdentity(viewerIdentity);
  await viewer.mutation(api.users.ensureCurrent);
  await viewer.mutation(
    api.households.acceptInvite,
    await owner.action(api.actions.householdInvites.create, {
      email: viewerIdentity.email,
    }),
  );
  await expect(
    viewer.mutation(api.accounts.update, {
      accountKey: account.id,
      isArchived: true,
    }),
  ).rejects.toThrow();
  const foreign = t.withIdentity({ ...viewerIdentity, subject: "foreign" });
  await foreign.mutation(api.users.ensureCurrent);
  await expect(
    foreign.mutation(api.accounts.update, {
      accountKey: account.id,
      name: "Foreign",
    }),
  ).rejects.toThrow();
  await expect(
    owner.mutation(api.accounts.update, { accountKey: account.id, name: " " }),
  ).rejects.toThrow();
  await expect(
    owner.mutation(api.accounts.update, {
      accountKey: account.id,
      name: "x".repeat(121),
    }),
  ).rejects.toThrow();
});

it("archiving an unrelated account preserves duplicate transaction occurrences across reimports", async () => {
  const state = await setupPortfolio([
    holding(),
    transaction(),
    transaction(),
    holding({ accountName: "Other", symbol: "BETA", instrumentName: "BETA" }),
  ]);
  await commitAdditionalPortfolio(
    state,
    [transaction()],
    state.publication.facts,
    2,
  );
  const positions = await state.owner.query(api.portfolio.positions);
  const alpha = positions.current.find(
    (position) => position.symbol === "ALPHA",
  );
  const account = (await state.owner.query(api.accounts.list)).find(
    (account) => account.name === "Other",
  );
  if (!alpha || !account) throw new Error("Missing fake portfolio");
  const before = await state.owner.query(api.portfolio.holdingDetail, {
    positionKey: alpha.id,
  });
  expect(before?.transactions).toHaveLength(2);
  await state.owner.mutation(api.accounts.update, {
    accountKey: account.id,
    isArchived: true,
  });
  const after = await state.owner.query(api.portfolio.holdingDetail, {
    positionKey: alpha.id,
  });
  expect(after?.transactions).toEqual(before?.transactions);
});

it("archives one account without mixing another account's same-symbol history, aliases or decimal cash flows", async () => {
  const state = await setupPortfolio([
    holding({
      accountName: "Broker A",
      provider: "Broker A",
      currentValue: 125.3,
      investedAmount: 100.1,
      pnlAmount: undefined,
    }),
    holding({
      accountName: "Broker B",
      provider: "Broker B",
      currentValue: 150.7,
      investedAmount: 120.2,
      pnlAmount: undefined,
    }),
    transaction({
      accountName: "Broker A",
      provider: "Broker A",
      amount: 100.1,
    }),
    transaction({
      accountName: "Broker B",
      provider: "Broker B",
      amount: 120.2,
    }),
  ]);
  const accounts = await state.owner.query(api.accounts.list);
  const accountA = accounts.find((account) => account.name === "Broker A");
  const positions = await state.owner.query(api.portfolio.positions);
  const positionA = positions.current.find(
    (position) => position.accountName === "Broker A",
  );
  const positionB = positions.current.find(
    (position) => position.accountName === "Broker B",
  );
  if (!accountA || !positionA || !positionB)
    throw new Error("Missing independent account fixtures");
  const alias = "fake-account-b-alias";
  const current = await state.owner.query(api.users.current);
  await state.t.run((ctx) =>
    ctx.db.insert("legacyHoldingAliases", {
      householdId: current.householdId,
      legacyId: alias,
      positionKey: positionB.id,
    }),
  );
  const beforeB = await state.owner.query(api.portfolio.holdingDetail, {
    positionKey: alias,
  });
  expect(beforeB?.transactions).toHaveLength(1);
  expect(beforeB?.holding.pnlAmount).toBeNull();
  await state.owner.mutation(api.accounts.update, {
    accountKey: accountA.id,
    isArchived: true,
  });

  expect(
    (await state.owner.query(api.portfolio.positions)).current.map(
      (position) => position.id,
    ),
  ).toEqual([positionB.id]);
  expect(
    (await state.owner.query(api.portfolio.overview)).summary,
  ).toMatchObject({
    currentValue: 150.7,
    investedAmount: 120.2,
    pnlAmount: 30.5,
  });
  const afterB = await state.owner.query(api.portfolio.holdingDetail, {
    positionKey: alias,
  });
  expect(afterB?.history).toEqual(beforeB?.history);
  expect(afterB?.transactions).toEqual(beforeB?.transactions);
  expect(
    await state.owner.query(api.portfolio.holdingDetail, {
      positionKey: positionA.id,
    }),
  ).toBeNull();
  await state.owner.mutation(api.accounts.update, {
    accountKey: accountA.id,
    isArchived: false,
  });
  expect(
    (await state.owner.query(api.portfolio.positions)).current,
  ).toHaveLength(2);
});

it("keeps the full archived read model in publication asset-class order and reports its real reads", async () => {
  const { owner, publication } = await setupPortfolio([
    holding({
      accountName: "US",
      assetClass: "us_stock",
      currency: "USD",
      sourceDate: "2025-03-03",
    }),
    holding({
      accountName: "Funds",
      assetClass: "mutual_fund",
      sourceDate: "2025-03-02",
    }),
    holding({ accountName: "Stocks", sourceDate: "2025-03-01" }),
  ]);
  const readModel = await owner.run(async (ctx) => {
    const active = await activePortfolio(ctx);
    if (!active) throw new Error("Missing published portfolio");
    return completeProjection(ctx, active);
  });

  expect(
    readModel.projection.assetClasses.map((asset) => asset.assetClass),
  ).toEqual(
    publication.projection.assetClasses.map((asset) => asset.assetClass),
  );
  expect(readModel.counts).toMatchObject({
    ranges: 5,
    positions: 3,
    historyFacts: 3,
  });
  expect(readModel.counts.timelinePoints).toBe(
    publication.projection.timeline.length,
  );
});

describe("durable complete source declarations", () => {
  function report(
    date: string,
    options: Parameters<typeof vestedWorkbook>[0] = {},
  ) {
    return parseExactImportFile(vestedWorkbook(options)).rows.map((row) =>
      row.kind === "holding" || row.kind === "source_snapshot"
        ? { ...row, sourceDate: date }
        : row,
    );
  }

  it("publishes a sole-position full exit with exact sold lots, retains declarations through cleanup, and reenters", async () => {
    const state = await setupPortfolio(report("2025-01-01"));
    const key = state.publication.projection.positions[0]?.positionKey;
    if (!key) throw new Error("Missing initial fake holding");
    const empty = report("2025-02-02", {
      holdings: [],
      sales: [
        [
          "FAKE",
          "2025-02-01",
          "2024-01-01",
          "10",
          "150.00001",
          "100.00001",
          "50",
        ],
      ],
      summary: [["FAKE", "10", "150.00001", "100.00001", "50"]],
    });
    const exited = await commitAdditionalPortfolio(
      state,
      empty,
      state.publication.facts,
      2,
    );
    expect(await state.owner.query(api.portfolio.positions)).toMatchObject({
      current: [],
      exited: [{ id: key }],
    });
    expect(
      (await state.owner.query(api.portfolio.overview)).summary,
    ).toMatchObject({ currentValue: 0, investedAmount: 0 });
    const detail = await state.owner.query(api.portfolio.holdingDetail, {
      positionKey: key,
    });
    expect(detail?.holding).toMatchObject({
      isCurrent: false,
      currentValue: "120",
    });
    expect(detail?.sales).toMatchObject([
      { proceeds: "150.00001", costBasis: "100.00001", realizedPnl: "50" },
    ]);
    const before = await state.t.run(async (ctx) => ({
      holdings: await ctx.db.query("holdingSnapshots").collect(),
      declarations: await ctx.db.query("sourceSnapshots").collect(),
      transactions: await ctx.db.query("transactions").collect(),
    }));
    expect(before.declarations).toHaveLength(2);
    expect(before.holdings).toHaveLength(1);
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));
    await state.t.mutation(internal.importCleanup.expireFiles);
    await state.t.mutation(internal.publicationCleanup.sweep, { cursor: null });
    await state.t.finishInProgressScheduledFunctions();
    expect(
      await state.t.run(async (ctx) => ({
        holdings: await ctx.db.query("holdingSnapshots").collect(),
        declarations: await ctx.db.query("sourceSnapshots").collect(),
        transactions: await ctx.db.query("transactions").collect(),
      })),
    ).toEqual(before);
    expect((await state.owner.query(api.portfolio.positions)).current).toEqual(
      [],
    );

    await commitAdditionalPortfolio(
      state,
      report("2025-03-01", {
        holdings: [["FAKE", "1", "10.0001", "12.0002", "2.0001"]],
      }),
      exited.facts,
      3,
    );
    const reentered = await state.owner.query(api.portfolio.holdingDetail, {
      positionKey: key,
    });
    expect(reentered?.holding).toMatchObject({
      isCurrent: true,
      currentValue: "12.0002",
    });
    expect(reentered?.history).toHaveLength(2);
    expect(reentered?.sales).toEqual(detail?.sales);
  });

  it("accepts declaration-only reports with zero instruments and remains stable across duplicate commit and parser reprocessing", async () => {
    const rows = report("2025-02-01", { holdings: [] });
    const state = await setupPortfolio(rows);
    expect(
      (await state.owner.query(api.portfolio.overview)).summary,
    ).toMatchObject({ currentValue: 0 });
    expect(
      await state.t.run(async (ctx) => ({
        accounts: (await ctx.db.query("accounts").collect()).length,
        instruments: (await ctx.db.query("instruments").collect()).length,
        holdings: (await ctx.db.query("holdingSnapshots").collect()).length,
        declarations: (await ctx.db.query("sourceSnapshots").collect()).length,
      })),
    ).toEqual({ accounts: 1, instruments: 0, holdings: 0, declarations: 1 });
    const batchId = await state.t.run(async (ctx) => {
      const declaration = await ctx.db.query("sourceSnapshots").first();
      if (!declaration) throw new Error("Missing declaration");
      return declaration.batchId;
    });
    const repeated = await state.owner.mutation(api.imports.commit, {
      batchId,
    });
    expect(repeated.status).toBe("committed");
    await commitAdditionalPortfolio(
      state,
      rows,
      state.publication.facts,
      2,
      "reprocessed-v6-test",
    );
    expect((await state.owner.query(api.portfolio.positions)).current).toEqual(
      [],
    );
    expect(
      await state.t.run((ctx) => ctx.db.query("sourceSnapshots").collect()),
    ).toHaveLength(2);
    const [account] = await state.owner.query(api.accounts.list);
    if (!account) throw new Error("Missing declaration account");
    await state.owner.mutation(api.accounts.update, {
      accountKey: account.id,
      isArchived: true,
    });
    const archived = await state.owner.query(api.portfolio.assetClassDetail, {
      assetClass: "us_stock",
    });
    expect(archived.holdings).toEqual([]);
    await state.owner.mutation(api.accounts.update, {
      accountKey: account.id,
      isArchived: false,
    });
    expect(
      (await state.owner.query(api.portfolio.overview)).summary.currentValue,
    ).toBe(0);
  });

  it("keeps partial sales and sale-only imports current until an authoritative scope boundary arrives", async () => {
    const state = await setupPortfolio(report("2025-01-01"));
    const sale = [["FAKE", "2025-02-01", "2024-01-01", "2", "30", "20", "10"]];
    const salesOnly = report("2025-02-02", {
      holdings: [],
      sales: sale,
    }).filter((row) => row.kind === "transaction");
    const observed = await commitAdditionalPortfolio(
      state,
      salesOnly,
      state.publication.facts,
      2,
    );
    expect(
      (await state.owner.query(api.portfolio.positions)).current[0]
        ?.currentValue,
    ).toBe("120");
    await commitAdditionalPortfolio(
      state,
      report("2025-02-02", {
        holdings: [["FAKE", "8", "80", "96", "16"]],
        sales: sale,
      }),
      observed.facts,
      3,
    );
    expect(
      (await state.owner.query(api.portfolio.positions)).current[0]
        ?.currentValue,
    ).toBe("96");
  });

  it("selects before account visibility, carries independent scopes, and rejects out-of-order resurrection", async () => {
    const independent = holding({
      accountName: "Independent",
      provider: "Independent",
      instrumentName: "OTHER",
      symbol: "OTHER",
      assetClass: "us_stock",
      currency: "USD",
      investedAmount: 250,
      currentValue: 300,
      pnlAmount: 50,
      sourceDate: "2025-01-01",
    });
    const state = await setupPortfolio([...report("2025-01-01"), independent]);
    const empty = await commitAdditionalPortfolio(
      state,
      report("2025-02-01", { holdings: [] }),
      state.publication.facts,
      2,
    );
    expect(
      (await state.owner.query(api.portfolio.positions)).current,
    ).toMatchObject([{ symbol: "OTHER", currentValue: "300" }]);
    expect(
      (await state.owner.query(api.portfolio.overview)).summary.currentValue,
    ).toBe(24000);
    const independentAccount = (
      await state.owner.query(api.accounts.list)
    ).find((account) => account.name === "Independent");
    if (!independentAccount) throw new Error("Missing independent account");
    await state.owner.mutation(api.accounts.update, {
      accountKey: independentAccount.id,
      isArchived: true,
    });
    expect((await state.owner.query(api.portfolio.positions)).current).toEqual(
      [],
    );
    expect(
      (await state.owner.query(api.portfolio.overview)).summary.currentValue,
    ).toBe(0);
    await state.owner.mutation(api.accounts.update, {
      accountKey: independentAccount.id,
      isArchived: false,
    });
    await commitAdditionalPortfolio(
      state,
      report("2025-01-15"),
      empty.facts,
      3,
    );
    expect(
      (await state.owner.query(api.portfolio.positions)).current,
    ).toMatchObject([{ symbol: "OTHER", currentValue: "300" }]);
    const projection = await state.owner.run(async (ctx) => {
      const active = await activePortfolio(ctx);
      if (!active) throw new Error("Missing portfolio");
      return completeProjection(ctx, active);
    });
    expect(
      projection.projection.sourceSnapshots?.map((fact) => fact.snapshotDate),
    ).toEqual(["2025-01-01", "2025-01-15", "2025-02-01"]);
    expect(projection.projection.timeline.at(-1)?.totals).toMatchObject([
      { currentValue: "300" },
    ]);
  });

  it("publishes independent real concurrent household operations without applying a foreign liquidation", async () => {
    const state = await setupPortfolio(report("2025-01-01"));
    const other = state.t.withIdentity({
      subject: "snapshot-other",
      issuer: "https://fake.example",
      tokenIdentifier: "fake|snapshot-other",
    });
    await other.mutation(api.users.ensureCurrent);
    await Promise.all([
      commitAdditionalPortfolio(
        state,
        report("2025-02-01", { holdings: [] }),
        state.publication.facts,
        2,
      ),
      commitAdditionalPortfolio(
        { t: state.t, owner: other },
        report("2025-02-01"),
        [],
        3,
      ),
    ]);
    expect((await state.owner.query(api.portfolio.positions)).current).toEqual(
      [],
    );
    expect((await other.query(api.portfolio.positions)).current).toMatchObject([
      { symbol: "FAKE", currentValue: "120" },
    ]);
    const declarations = await state.t.run((ctx) =>
      ctx.db.query("sourceSnapshots").collect(),
    );
    expect(declarations).toHaveLength(3);
    expect(new Set(declarations.map((fact) => fact.householdId)).size).toBe(2);
  });
});
