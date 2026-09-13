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
    parserVersion: "portfolio-query-test-v1",
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
      parserVersion: "portfolio-query-test-v1",
      sequence,
      fallbackDate: new Date(batch.createdAt).toISOString().slice(0, 10),
      rows,
    },
  });
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("public portfolio reads", () => {
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
        accountName: "Suppressed Account",
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
    expect(accounts.map(({ name, accountType }) => ({ name, accountType }))).toEqual([
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
    await state.t.mutation(internal.currencyRates.markStale, {
      quoteRevision: beginning.requestRevision,
    });
    await expect(
      state.owner.query(api.portfolio.overview, {}),
    ).resolves.toMatchObject({
      summary: { exchangeRates: [{ rate: 90, isStale: true }] },
    });
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
