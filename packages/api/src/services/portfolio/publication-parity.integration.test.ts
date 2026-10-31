import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  holdingSnapshots,
  transactions,
  type Database,
} from "@investment-sync/db";
import { eq } from "drizzle-orm";
import { FinancialDecimal } from "@investment-sync/importers/numeric";
import {
  buildPortfolioPublication,
  canonicalDecimal,
  valuePortfolioPublication,
  type ValuationQuote,
} from "@investment-sync/portfolio-domain";
import { parseImportFile } from "@investment-sync/importers";
import { vestedWorkbook } from "../../../../importers/src/vested-fixtures";
import { parserGoldenFixtures } from "../../../../importers/src/golden-fixtures";
import { appRouter } from "../../root";
import { commitImport, runImportEffect } from "../import-service";
import {
  contextFor,
  createBatch,
  createFixture,
  holdingRow,
  npsHoldingRow,
  requireTestDatabaseUrlInCi,
  resetDatabase,
  testDatabase,
  testDatabaseUrl,
  transactionRow,
  valuationRow,
  type ImportFixture,
} from "../import-test-support";
import { getUsdInrRate } from "../currency-rates";
import { loadPostgresPublicationFacts } from "./publication-parity-adapter";
import { roundMoney, roundPercent } from "./utils";

vi.mock("../currency-rates", () => ({ getUsdInrRate: vi.fn() }));

requireTestDatabaseUrlInCi();
const describeDb = testDatabaseUrl ? describe : describe.skip;
const fixedTime = "2026-06-20T12:00:00.000Z";
const freshQuote = {
  status: "fresh",
  rate: "83.25",
  fetchedAt: fixedTime,
  provider: "frankfurter",
} as const;

function requireDatabase(): Database {
  const db = testDatabase();
  if (!db) throw new Error("TEST_DATABASE_URL is required");

  return db;
}

// UUIDs and stable publication keys identify the same fixture entities differently.
// Decimal formatting is not semantic; financial values, order and all other fields are.
function semantic(value: unknown, key = "", approximate = false): unknown {
  if (approximate && typeof value === "number" && Number.isFinite(value)) {
    return {
      asymmetricMatch: (actual: unknown) =>
        typeof actual === "number" && Math.abs(actual - value) <= 1e-8,
    };
  }

  if (
    typeof value === "string" &&
    [
      "quantity",
      "price",
      "amount",
      "investedAmount",
      "currentValue",
      "pnlAmount",
      "pnlPercent",
    ].includes(key)
  ) {
    return canonicalDecimal(value);
  }
  if (Array.isArray(value))
    return value.map((item) => semantic(item, "", approximate));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([field, child]) =>
            !["id", "accountId", "instrumentId", "positionKey"].includes(
              field,
            ) && child !== undefined,
        )
        .map(([field, child]) => [field, semantic(child, field, approximate)]),
    );
  }

  return value;
}

describeDb("Postgres portfolio publication parity", () => {
  let db: Database;

  beforeAll(() => {
    db = requireDatabase();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    vi.spyOn(Date, "now").mockReturnValue(new Date(fixedTime).getTime());
    mockQuote(freshQuote);
  });

  afterEach(() => vi.restoreAllMocks());

  async function commit(fixture: ImportFixture, batchId = fixture.batchId) {
    await runImportEffect(
      commitImport(contextFor(db, fixture), fixture.membership, batchId),
    );
  }

  function usHolding(symbol: string, sourceDate: string, isWorkbook = false) {
    return {
      ...holdingRow({ symbol, instrumentName: symbol, sourceDate }),
      sourceType: isWorkbook
        ? "investment_portfolio_xlsx"
        : "vested_drivewealth_xlsx",
      accountName: "US Stocks",
      provider: isWorkbook ? "Manual Workbook" : "Vested / DriveWealth",
      assetClass: "us_stock",
      currency: "USD",
      metadata: isWorkbook ? { sourceSheet: "US stocks" } : {},
    };
  }

  async function assertParity(
    fixture: ImportFixture,
    quote: ValuationQuote = freshQuote,
  ) {
    mockQuote(quote);
    const facts = await loadPostgresPublicationFacts(
      db,
      fixture.membership.householdId,
    );
    const publication = buildPortfolioPublication({ existingFacts: facts });
    const actual = valuePortfolioPublication(publication.projection, quote);
    const caller = appRouter.createCaller(contextFor(db, fixture));
    const overview = await caller.portfolio.overview();
    const positions = await caller.portfolio.positions();

    expect(semantic(actual.overview)).toEqual(semantic(overview, "", true));
    expect(semantic(actual.overview.holdings)).toEqual(
      semantic(await caller.portfolio.holdings(), "", true),
    );
    expect(semantic(actual.overview.summary)).toEqual(
      semantic(await caller.portfolio.summary(), "", true),
    );
    expect(semantic(actual.positions)).toEqual(semantic(positions, "", true));
    for (const detail of actual.holdingDetails) {
      const holding = [...positions.current, ...positions.exited].find(
        (candidate) =>
          candidate.instrumentName === detail.holding.instrumentName &&
          candidate.accountName === detail.holding.accountName &&
          candidate.sourceSheet === detail.holding.sourceSheet &&
          candidate.currency === detail.holding.currency,
      );
      expect(holding).toBeDefined();
      if (!holding) throw new Error("Missing legacy position");

      expect(semantic(detail)).toEqual(
        semantic(
          await caller.portfolio.holdingDetail({ id: holding.id }),
          "",
          true,
        ),
      );
    }
    for (const detail of actual.assetClassDetails) {
      const legacyDetail = await caller.portfolio.assetClassDetail({
        assetClass: detail.assetClass,
      });
      if (
        legacyDetail.holdings.every((holding) => holding.pnlAmount !== null)
      ) {
        expect(semantic(detail)).toEqual(semantic(legacyDetail, "", true));

        continue;
      }

      // Issue 60 corrects the legacy zero fallback for absent P&L. Compute the
      // approved totals from SQL's selected rows and compare every other field.
      const corrected = legacyDetail.holdings.reduce(
        (totals, holding) => {
          const rate =
            holding.currency === "INR"
              ? "1"
              : holding.currency === "USD" && quote.status !== "unavailable"
                ? quote.rate
                : "0";
          const pnl =
            holding.pnlAmount === null
              ? new FinancialDecimal(holding.currentValue).minus(
                  holding.investedAmount,
                )
              : new FinancialDecimal(holding.pnlAmount);

          return {
            invested: totals.invested.plus(
              new FinancialDecimal(holding.investedAmount).times(rate),
            ),
            pnl: totals.pnl.plus(pnl.times(rate)),
          };
        },
        { invested: new FinancialDecimal(0), pnl: new FinancialDecimal(0) },
      );
      const expectedSummary = {
        ...legacyDetail.summary,
        pnlAmount: roundMoney(corrected.pnl.toNumber()),
        pnlPercent: corrected.invested.isZero()
          ? 0
          : roundPercent(
              corrected.pnl.div(corrected.invested).times(100).toNumber(),
            ),
      };

      expect(semantic(detail)).toEqual(
        semantic({ ...legacyDetail, summary: expectedSummary }, "", true),
      );
    }

    return { publication, actual };
  }

  it("derives absent P&L while retaining every other legacy field", async () => {
    const fixture = await createFixture(db, [
      holdingRow({ currentValue: 125 }),
    ]);
    await commit(fixture);
    const { actual } = await assertParity(fixture);
    const legacyDetail = await appRouter
      .createCaller(contextFor(db, fixture))
      .portfolio.assetClassDetail({ assetClass: "indian_stock" });

    expect(legacyDetail.summary).toMatchObject({ pnlAmount: 0, pnlPercent: 0 });
    expect(actual.assetClassDetails[0]?.summary).toMatchObject({
      pnlAmount: 25,
      pnlPercent: 25,
    });
    expect(actual.overview.summary).toMatchObject({
      pnlAmount: 25,
      pnlPercent: 25,
    });
    expect(actual.assetClassDetails[0]?.holdings[0]?.pnlAmount).toBeNull();
  });

  it.each(parserGoldenFixtures())(
    "matches committed parser golden: $name",
    async (golden) => {
      const parsed = parseImportFile(golden.file);
      const fixture = await createFixture(
        db,
        parsed.rows.map((row) => ({ ...row })),
        parsed.sourceType,
      );
      await commit(fixture);

      await assertParity(fixture);
    },
  );

  it("matches reported realized lots across same-day fills, overlapping reports and corrections", async () => {
    const rows = parseImportFile(
      vestedWorkbook({
        sales: [
          [
            "FAKE",
            "2025-02-15",
            "2024-01-01",
            "1",
            "20.123456",
            "10",
            "10.123456",
            "execution-z",
            "lot-z",
          ],
          [
            "FAKE",
            "2025-02-15",
            "2024-02-01",
            "2",
            "20.123456",
            "15",
            "5.123456",
            "execution-a",
            "lot-a",
          ],
          [
            "FAKE",
            "2025-02-15",
            "2024-03-01",
            "1",
            "20.123456",
            "10",
            "10.123456",
          ],
          [
            "FAKE",
            "2025-02-15",
            "2024-03-01",
            "1",
            "20.123456",
            "10",
            "10.123456",
          ],
        ],
      }),
    ).rows;
    const fixture = await createFixture(db, rows, "vested_drivewealth_xlsx");
    await commit(fixture);
    const first = await assertParity(fixture);
    const detail = first.actual.holdingDetails[0];
    expect(detail?.holding.isCurrent).toBe(true);
    expect(detail?.sales).toHaveLength(4);
    expect(detail?.sales.map((sale) => sale.proceeds)).toEqual(
      Array(4).fill("20.1235"),
    );
    expect(detail?.sales.map((sale) => sale.realizedPnl)).toContain("5.123456");

    const sale = rows.find(
      (row) =>
        row.kind === "transaction" &&
        row.metadata.realizedSale?.executionId === "execution-z",
    );
    const identical = rows.find(
      (row) =>
        row.kind === "transaction" && !row.metadata.realizedSale?.executionId,
    );
    if (!sale || sale.kind !== "transaction" || !identical)
      throw new Error("Missing generated sale lots");
    const buy = {
      ...sale,
      type: "buy",
      metadata: { sourceSheet: sale.metadata.sourceSheet },
    };
    const mixed = await createBatch(
      db,
      fixture.membership,
      [buy],
      "vested_drivewealth_xlsx",
    );
    await commit(fixture, mixed);
    const mixedResult = await assertParity(fixture);
    expect(mixedResult.actual.holdingDetails[0]?.transactions[0]?.type).toBe(
      "buy",
    );

    const overlap = await createBatch(
      db,
      fixture.membership,
      [sale, identical],
      "vested_drivewealth_xlsx",
      { parserVersion: "overlapping-report" },
    );
    await commit(fixture, overlap);
    expect(
      (await assertParity(fixture)).actual.holdingDetails[0]?.sales,
    ).toHaveLength(4);

    const correction = {
      ...sale,
      amount: 25.123456,
      metadata: {
        ...sale.metadata,
        realizedSale: {
          ...sale.metadata.realizedSale,
          costBasis: "10",
          realizedPnl: "15.123456",
        },
      },
    };
    const corrected = await createBatch(
      db,
      fixture.membership,
      [correction],
      "vested_drivewealth_xlsx",
      { parserVersion: "corrected-report" },
    );
    await commit(fixture, corrected);
    const result = await assertParity(fixture);
    expect(result.actual.holdingDetails[0]?.sales).toHaveLength(4);
    expect(result.actual.holdingDetails[0]?.sales).toContainEqual(
      expect.objectContaining({
        executionId: "execution-z",
        proceeds: "25.1235",
        costBasis: "10",
        realizedPnl: "15.123456",
      }),
    );
  });

  it("returns an empty sales contract without exposing internal transaction metadata", async () => {
    const fixture = await createFixture(db, [holdingRow(), transactionRow()]);
    await commit(fixture);
    await assertParity(fixture);
    const caller = appRouter.createCaller(contextFor(db, fixture));
    const [position] = await caller.portfolio.holdings();
    if (!position) throw new Error("Missing generated holding");

    const detail = await caller.portfolio.holdingDetail({ id: position.id });
    expect(detail?.sales).toEqual([]);
    expect(detail?.transactions[0]).not.toHaveProperty("metadata");
  });

  it.each([false, true])(
    "matches source priority and NPS details, portal first=%s",
    async (portalFirst) => {
      const portal = npsHoldingRow("nps_csv", 200);
      const workbook = npsHoldingRow("investment_portfolio_xlsx", 110);
      const first = portalFirst ? portal : workbook;
      const second = portalFirst ? workbook : portal;
      const fixture = await createFixture(db, [first], first.sourceType);
      await commit(fixture);
      await commit(
        fixture,
        await createBatch(db, fixture.membership, [second], second.sourceType),
      );

      await assertParity(fixture);
    },
  );

  it("retains unrelated workbook positions through partial imports, exit and reentry", async () => {
    const fixture = await createFixture(db, [
      {
        ...holdingRow(),
        sourceType: "investment_portfolio_xlsx",
        accountName: "EPF",
        provider: "Manual Workbook",
        instrumentName: "EPF Summary",
        symbol: "EPF",
        assetClass: "other",
        metadata: { isAggregate: true, sourceSheet: "Investment Portfolio" },
      },
      holdingRow(),
      holdingRow({ instrumentName: "BETA", symbol: "BETA" }),
      transactionRow({ tradeDate: "2025-06-16", amount: 100 }),
      valuationRow({
        valuationDate: "2025-06-16",
        investedAmount: 300,
        currentValue: 310,
      }),
    ]);
    await commit(fixture);
    await assertParity(fixture);
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        holdingRow({
          instrumentName: "BETA",
          symbol: "BETA",
          sourceDate: "2026-06-17",
        }),
      ]),
    );
    const omitted = await assertParity(fixture);
    expect(
      omitted.actual.positions.exited.map((holding) => holding.symbol),
    ).toEqual(["ABC"]);
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        holdingRow({ sourceDate: "2026-06-18" }),
        holdingRow({
          instrumentName: "BETA",
          symbol: "BETA",
          sourceDate: "2026-06-18",
        }),
      ]),
    );
    expect((await assertParity(fixture)).actual.positions.exited).toEqual([]);
  });

  it("matches aggregate fallback before and after detailed holdings", async () => {
    const fixture = await createFixture(db, [
      holdingRow({
        instrumentName: "Stocks Summary",
        symbol: "SUMMARY",
        metadata: { isAggregate: true },
      }),
    ]);
    await commit(fixture);
    await assertParity(fixture);
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        holdingRow({ sourceDate: "2026-06-17" }),
        holdingRow({
          instrumentName: "Stocks Summary",
          symbol: "SUMMARY",
          sourceDate: "2026-06-17",
          metadata: { isAggregate: true },
        }),
      ]),
    );
    await assertParity(fixture);
  });

  it("matches shared workbook/Vested omissions, workbook-only symbols and re-entry", async () => {
    const fixture = await createFixture(db, [
      usHolding("ALPHA", "2026-01-01", true),
      usHolding("OLD", "2026-01-01", true),
    ]);
    await commit(fixture);
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        usHolding("ALPHA", "2026-02-01"),
        usHolding("BETA", "2026-02-01"),
      ]),
    );
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        usHolding("BETA", "2026-03-01"),
      ]),
    );
    const omitted = await assertParity(fixture);

    expect(omitted.actual.positions.current.map((row) => row.symbol)).toEqual([
      "BETA",
    ]);
    expect(omitted.actual.positions.exited.map((row) => row.symbol)).toEqual([
      "ALPHA",
      "OLD",
    ]);
    expect(omitted.publication.reconciliation.holdingCount).toBe(5);

    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        usHolding("ALPHA", "2026-03-02", true),
        usHolding("BETA", "2026-03-02", true),
      ]),
    );
    const restored = await assertParity(fixture);
    expect(restored.actual.positions.current.map((row) => row.symbol)).toEqual([
      "ALPHA",
      "BETA",
    ]);
    expect(restored.actual.positions.exited.map((row) => row.symbol)).toEqual([
      "OLD",
    ]);
  });

  it.each([false, true])(
    "matches same-date Vested priority and omissions, workbook first=%s",
    async (workbookFirst) => {
      const workbook = [
        usHolding("ALPHA", "2026-03-01", true),
        usHolding("BETA", "2026-03-01", true),
      ];
      const vested = [
        { ...usHolding("BETA", "2026-03-01"), currentValue: 250 },
      ];
      const fixture = await createFixture(
        db,
        workbookFirst ? workbook : vested,
      );
      await commit(fixture);
      await commit(
        fixture,
        await createBatch(
          db,
          fixture.membership,
          workbookFirst ? vested : workbook,
        ),
      );
      const matched = await assertParity(fixture);

      expect(matched.actual.positions.current).toMatchObject([
        {
          symbol: "BETA",
          provider: "Vested / DriveWealth",
          currentValue: "250",
        },
      ]);
      expect(matched.actual.positions.exited.map((row) => row.symbol)).toEqual([
        "ALPHA",
      ]);
    },
  );

  it.each([
    { accountName: "Other US Account" },
    { provider: "Other Broker" },
    { sourceType: "manual_snapshot" },
    { assetClass: "other" },
    { currency: "INR" },
    { metadata: { sourceSheet: "Other US stocks" } },
  ])("matches an independent workbook source %j", async (overrides) => {
    const fixture = await createFixture(db, [
      { ...usHolding("ALPHA", "2026-01-01", true), ...overrides },
    ]);
    await commit(fixture);
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        usHolding("ALPHA", "2026-02-01"),
      ]),
    );
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        usHolding("BETA", "2026-03-01"),
      ]),
    );
    const matched = await assertParity(fixture);

    expect(matched.actual.positions.current.map((row) => row.symbol)).toEqual([
      "BETA",
      "ALPHA",
    ]);
    expect(matched.actual.positions.exited.map((row) => row.symbol)).toEqual([
      "ALPHA",
    ]);
  });

  it("preserves independent account rows alongside Vested in final display order", async () => {
    const fixture = await createFixture(db, [
      {
        ...usHolding("ALPHA", "2026-03-01", true),
        accountName: "Other US Account",
        instrumentName: "Zebra",
      },
      {
        ...usHolding("BETA", "2026-03-01", true),
        accountName: "Other US Account",
        instrumentName: "Aardvark",
      },
      usHolding("ALPHA", "2026-03-01"),
    ]);
    await commit(fixture);
    const matched = await assertParity(fixture);

    expect(matched.actual.positions.current.map((row) => row.symbol)).toEqual([
      "BETA",
      "ALPHA",
      "ALPHA",
    ]);
    expect(
      matched.actual.positions.current
        .filter((row) => row.symbol === "ALPHA")
        .map((row) => row.provider)
        .sort(),
    ).toEqual(["Manual Workbook", "Vested / DriveWealth"]);
  });

  it("keeps aggregate eligibility tied to physical source groups", async () => {
    const fixture = await createFixture(db, [
      {
        ...usHolding("SUMMARY", "2026-03-01", true),
        metadata: { sourceSheet: "US stocks", isAggregate: true },
      },
      usHolding("ALPHA", "2026-03-01"),
    ]);
    await commit(fixture);
    const matched = await assertParity(fixture);

    expect(matched.actual.positions.current.map((row) => row.symbol)).toEqual([
      "ALPHA",
    ]);
    expect(matched.actual.positions.exited.map((row) => row.symbol)).toEqual([
      "SUMMARY",
    ]);
    expect(matched.publication.reconciliation.holdingCount).toBe(2);
  });

  it.each(["fresh", "stale"] as const)(
    "matches mixed-currency holdings, transactions and timelines with a %s quote",
    async (status) => {
      const fixture = await createFixture(db, [
        holdingRow(),
        {
          ...holdingRow({
            accountName: "US Broker",
            instrumentName: "US Equity",
            symbol: "US",
            investedAmount: 1234.56,
            currentValue: 1567.89,
          }),
          currency: "USD",
          assetClass: "us_stock",
        },
        {
          ...transactionRow({
            tradeDate: "2025-06-16",
            instrumentName: "US Equity",
            symbol: "US",
            amount: 1234.56,
          }),
          accountName: "US Broker",
          currency: "USD",
          assetClass: "us_stock",
        },
        valuationRow({ valuationDate: "2025-06-16" }),
        {
          ...valuationRow({
            valuationDate: "2026-01-16",
            investedAmount: 12,
            currentValue: 14,
          }),
          currency: "USD",
        },
      ]);
      await commit(fixture);
      await assertParity(fixture, { ...freshQuote, status });
    },
  );

  it("fails both valuations when a required USD quote is unavailable", async () => {
    const fixture = await createFixture(db, [
      { ...holdingRow(), currency: "USD", assetClass: "us_stock" },
    ]);
    await commit(fixture);
    mockQuote({ status: "unavailable" });
    const facts = await loadPostgresPublicationFacts(
      db,
      fixture.membership.householdId,
    );
    const publication = buildPortfolioPublication({ existingFacts: facts });

    expect(() =>
      valuePortfolioPublication(publication.projection, {
        status: "unavailable",
      }),
    ).toThrow("unavailable");
    await expect(
      appRouter.createCaller(contextFor(db, fixture)).portfolio.overview(),
    ).rejects.toThrow("unavailable");
  });

  it("preserves legacy symbol-or-name ranking for distinct stored instruments", async () => {
    const fixture = await createFixture(db, [
      holdingRow({
        symbol: "XYZ",
        instrumentName: "Symbol holding",
        accountName: "Broker A",
      }),
      holdingRow({
        symbol: undefined,
        instrumentName: "XYZ",
        accountName: "Broker B",
      }),
    ]);
    await commit(fixture);

    await assertParity(fixture);
  });

  it("rejects persisted transactions without instruments instead of dropping them", async () => {
    const fixture = await createFixture(db, [holdingRow(), transactionRow()]);
    await commit(fixture);
    await db.update(transactions).set({ instrumentId: null });

    expect(await db.select().from(transactions)).toHaveLength(1);
    await expect(
      loadPostgresPublicationFacts(db, fixture.membership.householdId),
    ).rejects.toThrow("without an instrument");
  });

  it("matches overlapping source groups when the newest group omits an instrument", async () => {
    const fixture = await createFixture(db, [
      holdingRow({
        sourceDate: "2026-06-15",
        metadata: { sourceSheet: "Group A" },
      }),
    ]);
    await commit(fixture);
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        holdingRow({
          sourceDate: "2026-06-16",
          metadata: { sourceSheet: "Group B" },
        }),
      ]),
    );
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        holdingRow({
          instrumentName: "BETA",
          symbol: "BETA",
          sourceDate: "2026-06-17",
          metadata: { sourceSheet: "Group B" },
        }),
      ]),
    );

    await assertParity(fixture);
  });

  it("matches duplicate instrument identities across accounts and same-date ranking", async () => {
    const fixture = await createFixture(db, [
      holdingRow({ accountName: "Broker A", currentValue: 125 }),
      holdingRow({
        accountName: "Broker B",
        investedAmount: 200,
        currentValue: 210,
      }),
    ]);
    await commit(fixture);

    const result = await assertParity(fixture);
    expect(result.actual.positions.current).toHaveLength(2);
    expect(result.actual.overview.summary.currentValue).toBe(335);
  });

  it("keeps concurrent independent account updates and exits isolated", async () => {
    const fixture = await createFixture(db, [
      holdingRow({ accountName: "Broker A", currentValue: 125.1234 }),
      holdingRow({
        accountName: "Broker B",
        investedAmount: 200,
        currentValue: 210.5678,
      }),
    ]);
    await commit(fixture);
    const initial = await assertParity(fixture);

    expect(initial.actual.positions.current).toHaveLength(2);
    expect(initial.publication.projection.totals[0]?.currentValue).toBe(
      "335.6912",
    );
    expect(initial.actual.overview.summary.currentValue).toBe(335.69);

    const batches = await Promise.all([
      createBatch(db, fixture.membership, [
        holdingRow({
          accountName: "Broker A",
          symbol: "BETA",
          instrumentName: "BETA",
          sourceDate: "2026-06-19",
        }),
      ]),
      createBatch(db, fixture.membership, [
        holdingRow({
          accountName: "Broker B",
          sourceDate: "2026-06-19",
          investedAmount: 200,
          currentValue: 220,
        }),
      ]),
    ]);
    await Promise.all(batches.map((batchId) => commit(fixture, batchId)));
    const next = await assertParity(fixture);

    expect(
      next.actual.positions.current
        .map((row) => [row.accountName, row.symbol])
        .sort(),
    ).toEqual([
      ["Broker A", "BETA"],
      ["Broker B", "ABC"],
    ]);
    expect(next.actual.positions.exited).toMatchObject([
      { accountName: "Broker A", symbol: "ABC" },
    ]);
    expect(next.actual.positions.exited).toHaveLength(1);
    expect(next.actual.overview.summary.currentValue).toBe(345);
    expect(await db.select().from(holdingSnapshots)).toHaveLength(4);
  });

  it.each([false, true])(
    "keeps account performance isolated with cash flows=%s",
    async (hasCashFlows) => {
      const fixture = await createFixture(db, [
        holdingRow({
          accountName: "Broker A",
          sourceDate: "2025-06-16",
          currentValue: 100,
        }),
        holdingRow({
          accountName: "Broker B",
          sourceDate: "2025-06-16",
          investedAmount: 200,
          currentValue: 200,
        }),
        holdingRow({
          accountName: "Broker A",
          sourceDate: "2026-06-16",
          currentValue: 120,
        }),
        holdingRow({
          accountName: "Broker B",
          sourceDate: "2026-06-16",
          investedAmount: 200,
          currentValue: 220,
        }),
        ...(hasCashFlows
          ? [100, 200].map((amount, index) => ({
              ...transactionRow({ tradeDate: "2025-06-16", amount }),
              accountName: index === 0 ? "Broker A" : "Broker B",
            }))
          : []),
      ]);
      await commit(fixture);
      const { actual } = await assertParity(fixture);
      const asset = actual.assetClassDetails[0];

      expect(asset?.holdings).toHaveLength(2);
      for (const detail of actual.holdingDetails) {
        const assetHolding = asset?.holdings.find(
          (holding) => holding.accountName === detail.holding.accountName,
        );

        expect(detail.history).toHaveLength(2);
        expect(detail.transactions).toHaveLength(hasCashFlows ? 1 : 0);
        expect(assetHolding?.xirr).toBeCloseTo(
          detail.holding.accountName === "Broker A" ? 20 : 10,
          2,
        );
        expect(assetHolding?.xirr).toBe(detail.holding.xirr);
        expect(assetHolding?.xirrDataQuality).toBe(
          hasCashFlows ? "exact" : "estimated",
        );
      }
    },
  );

  it("retains explicit pnl, source returns, instrument metadata and transaction history", async () => {
    const fixture = await createFixture(db, [
      {
        ...holdingRow(),
        isin: "INE123456789",
        pnlAmount: 20,
        pnlPercent: 20,
        metadata: { exchange: "NSE", xirr: 12.3 },
      },
      transactionRow({ tradeDate: "2025-06-16", type: "buy", amount: 100 }),
      transactionRow({ tradeDate: "2026-01-16", type: "dividend", amount: 3 }),
      transactionRow({ tradeDate: "2026-03-16", type: "sell", amount: 10 }),
    ]);
    await commit(fixture);
    await db
      .update(transactions)
      .set({ notes: "Imported trade note" })
      .where(eq(transactions.householdId, fixture.membership.householdId));
    await assertParity(fixture);
    await commit(
      fixture,
      await createBatch(db, fixture.membership, [
        {
          ...holdingRow({ sourceDate: "2026-06-19", currentValue: 140 }),
          isin: "INE123456789",
          pnlAmount: 33,
          pnlPercent: 33,
          metadata: { exchange: "NSE", xirr: 13 },
        },
      ]),
    );

    await assertParity(fixture);
  });

  it("preserves stored decimal authority beyond binary64 precision", async () => {
    const fixture = await createFixture(db);
    await commit(fixture);
    await db
      .update(holdingSnapshots)
      .set({
        investedAmount: "9007199254740993.1234",
        currentValue: "9007199254740994.1234",
      })
      .where(eq(holdingSnapshots.householdId, fixture.membership.householdId));
    const facts = await loadPostgresPublicationFacts(
      db,
      fixture.membership.householdId,
    );
    const holding = facts.find((fact) => fact.row.kind === "holding")?.row;

    expect(holding).toMatchObject({
      investedAmount: "9007199254740993.1234",
      currentValue: "9007199254740994.1234",
    });
  });
});

function mockQuote(quote: ValuationQuote) {
  if (quote.status === "unavailable") {
    vi.mocked(getUsdInrRate).mockRejectedValue(
      new Error("USD/INR exchange rate is unavailable"),
    );
    return;
  }

  vi.mocked(getUsdInrRate).mockResolvedValue({
    base: "USD",
    quote: "INR",
    rate: Number(quote.rate),
    fetchedAt: quote.fetchedAt,
    provider: quote.provider,
    isStale: quote.status === "stale",
  });
}
