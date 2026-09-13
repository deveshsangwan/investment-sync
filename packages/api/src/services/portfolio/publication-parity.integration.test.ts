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
import {
  buildPortfolioPublication,
  canonicalDecimal,
  valuePortfolioPublication,
  type ValuationQuote,
} from "@investment-sync/portfolio-domain";
import { parseImportFile } from "@investment-sync/importers";
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
      expect(semantic(detail)).toEqual(
        semantic(
          await caller.portfolio.assetClassDetail({
            assetClass: detail.assetClass,
          }),
          "",
          true,
        ),
      );
    }

    return { publication, actual };
  }

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

    await assertParity(fixture);
  });

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
