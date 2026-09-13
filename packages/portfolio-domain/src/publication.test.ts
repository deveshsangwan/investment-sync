import { describe, expect, it } from "vitest";
import { adaptLegacyRow } from "@investment-sync/importers/exact-adapter";
import type {
  ExactNormalizedImportRow,
  NormalizedHoldingRow,
  NormalizedTransactionRow,
} from "@investment-sync/importers";
import {
  buildPortfolioPublication,
  valuePortfolioPublication,
  type PortfolioFact,
  type PublicationInput,
} from "./index";

function holding(overrides: Partial<NormalizedHoldingRow> = {}) {
  return adaptLegacyRow({
    kind: "holding",
    sourceType: "tickertape_stock_csv",
    sourceDate: "2025-01-01",
    accountName: "Fake Stocks",
    provider: "Fake Broker",
    instrumentName: "ALPHA",
    symbol: "ALPHA",
    assetClass: "indian_stock",
    currency: "INR",
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
    tradeDate: "2024-01-01",
    type: "buy",
    amount: 100,
    metadata: {},
    ...overrides,
  });
}

function publish(
  rows: ExactNormalizedImportRow[],
  existingFacts: PortfolioFact[] = [],
  sequence = 1,
) {
  return buildPortfolioPublication({
    existingFacts,
    batch: {
      id: `fake-batch-${sequence}`,
      parserVersion: "fake-v1",
      sequence,
      fallbackDate: "2025-01-01",
      rows,
    },
  });
}

const quote = {
  status: "fresh" as const,
  rate: "80",
  fetchedAt: "2025-01-01T00:00:00.000Z",
  provider: "frankfurter" as const,
};

describe("portfolio publication", () => {
  it("hashes canonical immutable inputs, including metadata and provenance", () => {
    const first = publish([
      holding({ metadata: { note: "first", nested: { a: 1, b: 2 } } }),
    ]);
    const reordered = publish([
      holding({ metadata: { nested: { b: 2, a: 1 }, note: "first" } }),
    ]);
    const changedMetadata = publish([
      holding({ metadata: { note: "second", nested: { a: 1, b: 2 } } }),
    ]);
    const changedValue = publish([
      holding({
        currentValue: 121,
        metadata: { note: "first", nested: { a: 1, b: 2 } },
      }),
    ]);
    const changedProvenance = buildPortfolioPublication({
      existingFacts: first.facts.map((fact) => ({
        ...fact,
        provenance: { ...fact.provenance, parserVersion: "fake-v2" },
      })),
    });

    expect(reordered.digest).toBe(first.digest);
    expect(reordered.projection).toEqual(first.projection);
    expect(changedMetadata.reconciliation).toEqual(first.reconciliation);
    expect(changedMetadata.digest).not.toBe(first.digest);
    expect(changedValue.digest).not.toBe(first.digest);
    expect(changedProvenance.digest).not.toBe(first.digest);
  });

  it("resolves details for a position suppressed by cross-account ranking", () => {
    const publication = publish([
      holding({ accountName: "First account" }),
      holding({ accountName: "Second account", sourceDate: "2025-02-01" }),
    ]);
    expect(publication.projection.positions).toHaveLength(1);
    const suppressed = publication.projection.detailPositions?.[0];
    if (!suppressed) throw new Error("Expected a detail-only position");
    const detail = valuePortfolioPublication(publication.projection, quote, {
      view: "holdingDetail",
      positionKey: suppressed.positionKey,
    });
    expect(detail?.holding).toMatchObject({
      accountName: "First account",
      isCurrent: false,
    });
    expect(detail?.history).toHaveLength(1);
  });
  it("publishes exact native totals and keeps raw source precision", () => {
    const first = holding();
    const second = holding({ symbol: "BETA", instrumentName: "BETA" });
    if (first.kind !== "holding" || second.kind !== "holding")
      throw new Error("Expected holdings");

    const publication = publish([
      { ...first, currentValue: "9007199254740993.12345" },
      { ...second, currentValue: "0.00015" },
    ]);
    expect(publication.reconciliation.nativeTotals[0]?.currentValue).toBe(
      "9007199254740993.1237",
    );
    expect(publication.facts[0]?.row).toMatchObject({
      currentValue: "9007199254740993.12345",
    });
  });

  it("replays unchanged immutable facts with the same digest and no new writes", () => {
    const rows = [holding(), transaction()];
    const first = publish(rows);
    const replay = publish(rows, first.facts);
    const rebuilt = buildPortfolioPublication({
      existingFacts: [...first.facts].reverse(),
    });

    expect(replay.factsToPersist).toEqual([]);
    expect(replay.digest).toBe(first.digest);
    expect(rebuilt.digest).toBe(first.digest);
    expect(() =>
      publish([holding({ currentValue: 999 }), transaction()], first.facts),
    ).toThrow("Conflicting content");
  });

  it("retries and rebuilds cloned persistence output without digest drift", () => {
    const rows = [holding(), transaction()];
    const first = publish(rows);
    const persisted = structuredClone(first.factsToPersist);
    const replay = publish(rows, persisted);
    const rebuilt = buildPortfolioPublication({ existingFacts: persisted });

    expect(replay.factsToPersist).toEqual([]);
    expect(replay.digest).toBe(first.digest);
    expect(rebuilt.digest).toBe(first.digest);
    expect(rebuilt.identifiedFacts).toEqual(first.identifiedFacts);
    expect(() =>
      publish([holding({ currentValue: 999 }), transaction()], persisted),
    ).toThrow("Conflicting content");
  });

  it("preserves distinct stored identities with legacy symbol-or-name ranking", () => {
    const first = publish([
      holding({ accountName: " b|c ", provider: "A", symbol: " xyz " }),
      holding({
        accountName: "c",
        provider: "a|b",
        instrumentName: "XYZ",
        symbol: undefined,
      }),
    ]);
    expect(first.projection.positions).toHaveLength(1);
    expect(
      new Set(
        first.identifiedFacts.map((fact) =>
          fact.identity.kind === "valuation"
            ? undefined
            : fact.identity.accountKey,
        ),
      ).size,
    ).toBe(2);

    const next = publish(
      [
        holding({
          accountName: "B|C",
          provider: "a",
          symbol: "XYZ",
          sourceDate: "2025-02-01",
        }),
      ],
      first.facts,
      2,
    );
    expect(
      next.projection.positions.filter(
        (position) => position.status === "current",
      ),
    ).toHaveLength(1);
  });

  it.each([
    { currentValue: "1000000000000000000000000" },
    { quantity: "1000000000000000000" },
    { currentValue: "999999999999999999999999.99995" },
    { pnlPercent: 1000000 },
  ])(
    "rejects values beyond effective Postgres numeric capacity: %j",
    (overrides) => {
      const row = holding();
      if (row.kind !== "holding") throw new Error("Expected holding");

      expect(() => publish([{ ...row, ...overrides }])).toThrow("capacity");
    },
  );

  it("preserves current and exited entries across overlapping source groups", () => {
    const first = publish([holding({ metadata: { sourceSheet: "Group A" } })]);
    const second = publish(
      [
        holding({
          sourceDate: "2025-02-01",
          metadata: { sourceSheet: "Group B" },
        }),
      ],
      first.facts,
      2,
    );
    const third = publish(
      [
        holding({
          symbol: "BETA",
          instrumentName: "BETA",
          sourceDate: "2025-03-01",
          metadata: { sourceSheet: "Group B" },
        }),
      ],
      second.facts,
      3,
    );
    const alpha = third.projection.positions.filter(
      (position) => position.holding.row.symbol === "ALPHA",
    );

    expect(alpha.map((position) => position.status)).toEqual([
      "current",
      "exited",
    ]);
    expect(new Set(alpha.map((position) => position.positionKey)).size).toBe(2);
    expect(
      alpha.map((position) =>
        position.history.map((fact) => fact.row.source.group),
      ),
    ).toEqual([["Group A"], ["Group B"]]);
  });

  it.each([false, true])(
    "keeps same-date NPS portal priority with reversed commit order %s",
    (portalFirst) => {
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
        metadata: { sourceSheet: "NPS", npsDetails: { schemaVersion: 1 } },
      });
      const first = publish([portalFirst ? portal : workbook]);
      const result = publish([portalFirst ? workbook : portal], first.facts, 2);

      expect(result.projection.positions[0]?.holding.row.currentValue).toBe(
        "125",
      );
      expect(result.reconciliation.holdingCount).toBe(1);
      expect(result.reconciliation.factCount).toBe(2);
    },
  );

  it("exits omissions only in the same complete source group and restores re-entry", () => {
    const first = publish([
      holding(),
      holding({ instrumentName: "BETA", symbol: "BETA" }),
      holding({
        instrumentName: "EPF Summary",
        symbol: undefined,
        assetClass: "other",
        provider: "Workbook",
        metadata: { sourceSheet: "Investment Portfolio" },
      }),
    ]);
    const omitted = publish(
      [holding({ sourceDate: "2025-02-01" })],
      first.facts,
      2,
    );
    expect(
      omitted.projection.positions
        .filter((position) => position.status === "current")
        .map((position) => position.holding.row.instrumentName)
        .sort(),
    ).toEqual(["ALPHA", "EPF Summary"]);
    expect(
      omitted.projection.positions.find(
        (position) => position.status === "exited",
      )?.holding.row.symbol,
    ).toBe("BETA");

    const restored = publish(
      [
        holding({ sourceDate: "2025-03-01" }),
        holding({
          sourceDate: "2025-03-01",
          instrumentName: "BETA",
          symbol: "BETA",
        }),
      ],
      omitted.facts,
      3,
    );
    expect(restored.reconciliation.exitedCount).toBe(0);
  });

  it("does not apply omission-as-exit to explicitly partial snapshots", () => {
    const first = publish([
      holding(),
      holding({ instrumentName: "BETA", symbol: "BETA" }),
    ]);
    const row = holding({ sourceDate: "2025-02-01" });
    const next = publish(
      [{ ...row, source: { ...row.source, completeness: "partial" } }],
      first.facts,
      2,
    );

    expect(next.reconciliation.currentCount).toBe(2);
    expect(next.reconciliation.exitedCount).toBe(0);
  });

  it("keeps a partially sold holding current with its remaining quantity and sale history", () => {
    const first = publish([
      holding({ quantity: 10, investedAmount: 1000, currentValue: 1200 }),
      transaction({ quantity: 10, amount: 1000 }),
    ]);
    const next = publish(
      [
        holding({
          sourceDate: "2025-02-01",
          quantity: 6,
          investedAmount: 600,
          currentValue: 720,
        }),
        transaction({
          tradeDate: "2025-02-01",
          type: "sell",
          quantity: 4,
          amount: 480,
        }),
      ],
      first.facts,
      2,
    );
    const views = valuePortfolioPublication(next.projection);

    expect(views.positions.current).toHaveLength(1);
    expect(views.positions.current[0]?.quantity).toBe("6");
    expect(views.positions.exited).toEqual([]);
    expect(
      views.holdingDetails[0]?.history.map((point) => point.quantity),
    ).toEqual(["10", "6"]);
    expect(
      views.holdingDetails[0]?.transactions.map((flow) => [
        flow.type,
        flow.quantity,
      ]),
    ).toEqual([
      ["buy", "10"],
      ["sell", "4"],
    ]);
  });

  it("suppresses aggregates only for details in the same group and date", () => {
    const result = publish([
      holding(),
      holding({
        instrumentName: "Fake Summary",
        symbol: "TOTAL",
        currentValue: 999,
      }),
      holding({
        instrumentName: "Other Summary",
        symbol: "OTHER",
        accountName: "Other Account",
        currentValue: 50,
      }),
    ]);
    expect(result.reconciliation.currentCount).toBe(2);
    expect(result.reconciliation.nativeTotals[0]?.currentValue).toBe("170");
    expect(result.projection.timeline[0]?.totals[0]?.currentValue).toBe("170");
  });

  it("preserves identical same-day transaction occurrences while deduping repeated statements", () => {
    const first = publish([holding(), transaction(), transaction()]);
    const repeated = publish([transaction(), transaction()], first.facts, 2);

    expect(first.reconciliation.transactionCount).toBe(2);
    expect(repeated.reconciliation.transactionCount).toBe(2);
    expect(
      new Set(repeated.projection.cashFlows.map((fact) => fact.occurrenceKey))
        .size,
    ).toBe(2);
  });

  it("keeps transaction occurrence namespaces separate across source streams", () => {
    const result = publish([
      transaction(),
      transaction({ sourceType: "manual_snapshot" }),
    ]);
    expect(result.reconciliation.transactionCount).toBe(2);
  });

  it("applies a new quote without regrouping or changing the publication digest", () => {
    const publication = publish([
      holding(),
      holding({
        instrumentName: "US Fake",
        symbol: "USFAKE",
        currency: "USD",
        assetClass: "us_stock",
      }),
    ]);
    const frozen = JSON.stringify(publication);
    const first = valuePortfolioPublication(publication.projection, quote);
    const second = valuePortfolioPublication(publication.projection, {
      ...quote,
      rate: "90",
      status: "stale",
    });

    expect(first.overview.summary.currentValue).toBe(9720);
    expect(second.overview.summary.currentValue).toBe(10920);
    expect(second.overview.summary.exchangeRates[0]?.isStale).toBe(true);
    expect(JSON.stringify(publication)).toBe(frozen);
    expect(() => valuePortfolioPublication(publication.projection)).toThrow(
      "USD/INR exchange rate is unavailable",
    );
  });

  it("does not count unsupported currencies as rupees", () => {
    const publication = publish([
      holding(),
      holding({ currency: "BTC", symbol: "BTC", assetClass: "crypto" }),
    ]);
    expect(
      valuePortfolioPublication(publication.projection).overview.summary
        .currentValue,
    ).toBe(120);
    expect(
      publication.reconciliation.nativeTotals.map((total) => total.currency),
    ).toEqual(["BTC", "INR"]);
  });

  it("uses explicit valuations for history and appends the current portfolio point", () => {
    const valuation = adaptLegacyRow({
      kind: "valuation",
      sourceType: "investment_portfolio_xlsx",
      valuationDate: "2024-01-01",
      investedAmount: 80,
      currentValue: 90,
      currency: "INR",
      metadata: {},
    });
    const result = valuePortfolioPublication(
      publish([holding(), valuation]).projection,
    );
    expect(result.overview.timeline).toEqual([
      {
        snapshotDate: "2024-01-01",
        investedAmount: 80,
        currentValue: 90,
        pnlAmount: 10,
        currency: "INR",
      },
      {
        snapshotDate: "2025-01-01",
        investedAmount: 100,
        currentValue: 120,
        pnlAmount: 20,
        currency: "INR",
      },
    ]);
  });

  it("resolves cash-flow, source, and historical XIRR through existing analytics", () => {
    const exact = valuePortfolioPublication(
      publish([holding(), transaction()]).projection,
    );
    expect(exact.overview.performance.dataQuality).toBe("exact");
    expect(exact.holdingDetails[0]?.holding.xirrDataQuality).toBe("exact");

    const source = valuePortfolioPublication(
      publish([holding({ metadata: { xirr: 12 } })]).projection,
    );
    expect(source.overview.performance).toMatchObject({
      dataQuality: "source_provided",
      xirr: 12,
    });

    const previous = publish([holding({ sourceDate: "2023-01-01" })]);
    const historical = valuePortfolioPublication(
      publish([holding()], previous.facts, 2).projection,
    );
    expect(historical.holdingDetails[0]?.holding.xirrDataQuality).toBe(
      "estimated",
    );
  });

  it("rejects invalid source dates and conflicting provenance", () => {
    const invalid = holding();
    if (invalid.kind !== "holding") throw new Error("Expected holding");
    expect(() => publish([{ ...invalid, sourceDate: "2025-02-30" }])).toThrow(
      "Invalid financial date",
    );
    const input: PublicationInput = {
      existingFacts: [],
      batch: {
        id: "fake",
        parserVersion: "v1",
        sequence: -1,
        fallbackDate: "2025-01-01",
        rows: [invalid],
      },
    };
    expect(() => buildPortfolioPublication(input)).toThrow(
      "Invalid import provenance",
    );
  });

  it("builds a deterministic empty publication", () => {
    const result = buildPortfolioPublication({ existingFacts: [] });
    expect(result.reconciliation.factCount).toBe(0);
    expect(
      valuePortfolioPublication(result.projection).overview.summary,
    ).toMatchObject({ investedAmount: 0, currentValue: 0, asOfDate: null });
  });
});
