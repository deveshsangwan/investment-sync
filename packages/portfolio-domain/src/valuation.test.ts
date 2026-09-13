import { describe, expect, it } from "vitest";
import { adaptLegacyRow } from "@investment-sync/importers/exact-adapter";
import type {
  NormalizedHoldingRow,
  NormalizedTransactionRow,
  ExactNormalizedImportRow,
} from "@investment-sync/importers";
import { buildPortfolioPublication } from "./publication";
import { valuePortfolioPublication } from "./valuation";
import type { PortfolioProjection } from "./types";

function holding(overrides: Partial<NormalizedHoldingRow> = {}) {
  return adaptLegacyRow({
    kind: "holding",
    sourceType: "tickertape_stock_csv",
    sourceDate: "2025-01-01",
    accountName: "Broker",
    provider: "Broker",
    instrumentName: "ALPHA",
    symbol: "ALPHA",
    assetClass: "indian_stock",
    currency: "INR",
    investedAmount: 100,
    currentValue: 120,
    metadata: {},
    ...overrides,
  });
}

function transaction(overrides: Partial<NormalizedTransactionRow> = {}) {
  return adaptLegacyRow({
    kind: "transaction",
    sourceType: "tickertape_stock_csv",
    accountName: "Broker",
    provider: "Broker",
    instrumentName: "FOREIGN",
    symbol: "FOREIGN",
    assetClass: "us_stock",
    currency: "USD",
    tradeDate: "2024-01-01",
    type: "buy",
    amount: 100,
    metadata: {},
    ...overrides,
  });
}

function projection(rows: ExactNormalizedImportRow[]) {
  return buildPortfolioPublication({
    existingFacts: [],
    batch: {
      id: "valuation-test",
      parserVersion: "test-v1",
      sequence: 1,
      fallbackDate: "2025-01-01",
      rows,
    },
  }).projection;
}

function positionKey(value: PortfolioProjection, symbol: string) {
  const position = value.positions.find(
    (candidate) => candidate.holding.row.symbol === symbol,
  );
  if (!position) throw new Error(`Missing test position ${symbol}`);

  return position.positionKey;
}

const quote = {
  status: "fresh",
  rate: "80",
  fetchedAt: "2025-01-01T00:00:00.000Z",
  provider: "frankfurter",
} as const;

// Endpoint selection must not inherit exchange-rate requirements from unrelated views.
describe("portfolio valuation view selection", () => {
  it("serves INR summary and positions despite an unrelated historical USD cash flow", () => {
    const value = projection([holding(), transaction()]);

    expect(
      valuePortfolioPublication(value, undefined, { view: "summary" }),
    ).toMatchObject({ currentValue: 120, exchangeRates: [] });
    expect(
      valuePortfolioPublication(value, undefined, { view: "positions" })
        .current,
    ).toHaveLength(1);
    expect(() =>
      valuePortfolioPublication(value, undefined, { view: "overview" }),
    ).toThrow("unavailable");
  });

  it("only the fallback timeline requires FX when current holdings and cash flows are INR", () => {
    const value = projection([holding()]);
    const historical: PortfolioProjection = {
      ...value,
      timeline: [
        {
          snapshotDate: "2024-01-01",
          totals: [
            {
              currency: "USD",
              investedAmount: "10",
              currentValue: "12",
              pnlAmount: "2",
            },
          ],
        },
      ],
    };

    expect(
      valuePortfolioPublication(historical, undefined, { view: "summary" })
        .currentValue,
    ).toBe(120);
    expect(
      valuePortfolioPublication(historical, undefined, { view: "positions" })
        .current,
    ).toHaveLength(1);
    expect(() =>
      valuePortfolioPublication(historical, undefined, { view: "overview" }),
    ).toThrow("unavailable");
    const overview = valuePortfolioPublication(historical, quote, {
      view: "overview",
    });
    expect(overview.timeline[0]?.currentValue).toBe(960);
    expect(overview.summary.exchangeRates).toEqual([]);
  });

  it("does not require the exited USD position for overview with explicit INR valuations", () => {
    const value = projection([
      holding(),
      holding({
        symbol: "FOREIGN",
        instrumentName: "FOREIGN",
        currency: "USD",
        assetClass: "us_stock",
      }),
    ]);
    const withExit: PortfolioProjection = {
      ...value,
      positions: value.positions.map((position) =>
        position.holding.row.currency === "USD"
          ? { ...position, status: "exited" }
          : position,
      ),
      hasExplicitValuations: true,
      valuations: [
        adaptLegacyRow({
          kind: "valuation",
          sourceType: "investment_portfolio_xlsx",
          currency: "INR",
          valuationDate: "2024-01-01",
          investedAmount: 100,
          currentValue: 110,
          metadata: {},
        }),
      ].flatMap((row) => (row.kind === "valuation" ? [row] : [])),
      timeline: [
        {
          snapshotDate: "2024-01-01",
          totals: [
            {
              currency: "INR",
              investedAmount: "100",
              currentValue: "110",
              pnlAmount: "10",
            },
          ],
        },
      ],
    };

    expect(
      valuePortfolioPublication(withExit, undefined, { view: "overview" })
        .summary.currentValue,
    ).toBe(120);
    expect(
      valuePortfolioPublication(withExit, undefined, { view: "summary" })
        .currentValue,
    ).toBe(120);
    expect(() =>
      valuePortfolioPublication(withExit, undefined, { view: "positions" }),
    ).toThrow("unavailable");
  });

  it("returns absent holding details before looking up FX", () => {
    const value = projection([
      holding({ currency: "USD", assetClass: "us_stock" }),
    ]);

    expect(
      valuePortfolioPublication(value, undefined, {
        view: "holdingDetail",
        positionKey: "missing",
      }),
    ).toBeNull();
  });

  it("requires FX for the selected holding or any current portfolio holding", () => {
    const value = projection([
      holding(),
      holding({
        symbol: "FOREIGN",
        instrumentName: "FOREIGN",
        currency: "USD",
        assetClass: "us_stock",
      }),
    ]);

    expect(() =>
      valuePortfolioPublication(value, undefined, {
        view: "holdingDetail",
        positionKey: positionKey(value, "ALPHA"),
      }),
    ).toThrow("unavailable");
    const withExit: PortfolioProjection = {
      ...value,
      positions: value.positions.map((position) =>
        position.holding.row.currency === "USD"
          ? { ...position, status: "exited" }
          : position,
      ),
    };
    expect(
      valuePortfolioPublication(withExit, undefined, {
        view: "holdingDetail",
        positionKey: positionKey(value, "ALPHA"),
      })?.holding.instrumentName,
    ).toBe("ALPHA");
    expect(() =>
      valuePortfolioPublication(withExit, undefined, {
        view: "holdingDetail",
        positionKey: positionKey(value, "FOREIGN"),
      }),
    ).toThrow("unavailable");
  });

  it("does not require FX for unrelated transactions in holding detail", () => {
    const value = projection([holding(), transaction()]);

    expect(
      valuePortfolioPublication(value, undefined, {
        view: "holdingDetail",
        positionKey: positionKey(value, "ALPHA"),
      })?.transactions,
    ).toEqual([]);
  });

  it("returns an empty asset detail but still values global current holdings for its weight", () => {
    const inr = projection([holding()]);

    expect(
      valuePortfolioPublication(inr, undefined, {
        view: "assetClassDetail",
        assetClass: "nps",
      }),
    ).toMatchObject({
      assetClass: "nps",
      holdings: [],
      exitedHoldings: [],
      timeline: [],
      summary: { currentValue: 0, holdingCount: 0, portfolioWeight: 0 },
    });
    const usd = projection([
      holding({ currency: "USD", assetClass: "us_stock" }),
    ]);
    expect(() =>
      valuePortfolioPublication(usd, undefined, {
        view: "assetClassDetail",
        assetClass: "nps",
      }),
    ).toThrow("unavailable");
  });

  it("only requires exited USD holdings when their asset class is selected", () => {
    const value = projection([
      holding(),
      holding({
        symbol: "FOREIGN",
        instrumentName: "FOREIGN",
        currency: "USD",
        assetClass: "us_stock",
      }),
    ]);
    const withExit: PortfolioProjection = {
      ...value,
      positions: value.positions.map((position) =>
        position.holding.row.currency === "USD"
          ? { ...position, status: "exited" }
          : position,
      ),
    };

    expect(
      valuePortfolioPublication(withExit, undefined, {
        view: "assetClassDetail",
        assetClass: "indian_stock",
      }).holdings,
    ).toHaveLength(1);
    expect(() =>
      valuePortfolioPublication(withExit, undefined, {
        view: "assetClassDetail",
        assetClass: "us_stock",
      }),
    ).toThrow("unavailable");
  });

  it("retains the default all-view contract and unique historical snapshot ids", () => {
    const value = projection([
      holding(),
      holding({ sourceDate: "2025-02-01" }),
    ]);
    const all = valuePortfolioPublication(value);

    expect(all.overview).toEqual(
      valuePortfolioPublication(value, undefined, { view: "overview" }),
    );
    expect(all.positions).toEqual(
      valuePortfolioPublication(value, undefined, { view: "positions" }),
    );
    expect(all.holdingDetails[0]).toEqual(
      valuePortfolioPublication(value, undefined, {
        view: "holdingDetail",
        positionKey: positionKey(value, "ALPHA"),
      }),
    );
    expect(
      new Set(all.holdingDetails[0]?.history.map((point) => point.id)).size,
    ).toBe(2);
  });
});
