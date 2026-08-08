import { describe, expect, it } from "vitest";
import {
  INVESTMENT_PORTFOLIO_SUMMARY_SHEET,
  npsDetailsSchema,
} from "@investment-sync/importers";
import { isAggregateHolding } from "./aggregates";
import type { Currency, CurrentHoldingRow } from "./types";
import {
  aggregateSnapshotTotalsByDate,
  convertToInr,
  toPublicHoldingWithInr,
  filterAggregateRowsBySnapshotGroup,
  npsDetailsFromPayload,
} from "./utils";

describe("toPublicHoldingWithInr", () => {
  it("keeps source payload internal", () => {
    const holding = {
      id: "holding-1",
      accountId: "account-1",
      instrumentId: "instrument-1",
      snapshotDate: "2026-08-08",
      quantity: "1",
      investedAmount: "100",
      currentValue: "110",
      pnlAmount: "10",
      pnlPercent: "10",
      currency: "INR",
      sourcePayload: { private: "metadata" },
      sourceSheet: "NPS",
      accountName: "NPS",
      provider: "NPS",
      instrumentName: "NPS",
      symbol: null,
      assetClass: "nps",
    } satisfies CurrentHoldingRow;

    expect(toPublicHoldingWithInr(holding)).not.toHaveProperty("sourcePayload");
  });
});

describe("npsDetailsFromPayload", () => {
  const details = npsDetailsSchema.parse({
    schemaVersion: 1,
    tier: "I",
    totalContribution: 100,
    totalWithdrawal: 0,
    schemes: [
      {
        code: "E",
        sourceName: "Scheme E",
        currentValue: 110,
        units: 1,
        nav: 110,
      },
    ],
    contributionEvents: [],
    activities: [],
  });

  it("returns typed NPS details without exposing arbitrary payload fields", () => {
    expect(
      npsDetailsFromPayload({
        npsDetails: { ...details, unexpectedSubscriberField: "ignored" },
        unrelated: "ignored",
      }),
    ).toEqual(details);
  });

  it("returns null for absent or malformed details", () => {
    expect(npsDetailsFromPayload()).toBeNull();
    expect(npsDetailsFromPayload({ npsDetails: { tier: "II" } })).toBeNull();
  });
});

describe("isAggregateHolding", () => {
  it("does not treat embedded summary text as an aggregate name suffix", () => {
    expect(
      isAggregateHolding({
        instrumentName: "Something Summary Extra",
      }),
    ).toBe(false);
  });

  it("treats a trailing summary suffix as aggregate", () => {
    expect(
      isAggregateHolding({
        instrumentName: "ABC Summary",
      }),
    ).toBe(true);
  });
});

describe("convertToInr", () => {
  it("returns 0 for USD when no exchange rate is available", () => {
    expect(convertToInr(100, "USD")).toBe(0);
  });

  it("converts USD when a rate is provided", () => {
    expect(convertToInr(100, "USD", 83.5)).toBe(8350);
  });

  it.each(["BTC", "ETH", "OTHER"] as const)(
    "excludes %s instead of counting it as rupees",
    (currency) => {
      expect(convertToInr(100, currency, 83.5)).toBe(0);
    },
  );
});

describe("filterAggregateRowsBySnapshotGroup", () => {
  it("only suppresses aggregates when details exist in the same snapshot group", () => {
    const rows = [
      snapshotRow({ instrumentName: "ABC" }),
      snapshotRow({ instrumentName: "ABC Summary" }),
      snapshotRow({
        accountId: "account-2",
        accountName: "Broker B",
        instrumentName: "Broker B Summary",
      }),
    ];

    expect(
      filterAggregateRowsBySnapshotGroup(rows).map((row) => row.instrumentName),
    ).toEqual(["ABC", "Broker B Summary"]);
  });

  it("retains Investment Portfolio sourceSheet rows when no detail shares their snapshot group", () => {
    const rows = [
      snapshotRow({ instrumentName: "ABC", sourceSheet: "Stock Investments" }),
      snapshotRow({
        instrumentName: "Investment Portfolio Total",
        sourceSheet: INVESTMENT_PORTFOLIO_SUMMARY_SHEET,
      }),
      snapshotRow({
        accountId: "account-2",
        accountName: "Broker B",
        instrumentName: "Broker B Total",
        sourceSheet: INVESTMENT_PORTFOLIO_SUMMARY_SHEET,
      }),
    ];

    expect(
      filterAggregateRowsBySnapshotGroup(rows).map((row) => row.instrumentName),
    ).toEqual(["ABC", "Investment Portfolio Total", "Broker B Total"]);
  });

  it("treats Investment Portfolio sourceSheet as aggregate via isAggregateHolding", () => {
    expect(
      isAggregateHolding({
        instrumentName: "Portfolio Total",
        sourceSheet: INVESTMENT_PORTFOLIO_SUMMARY_SHEET,
      }),
    ).toBe(true);
  });
});

describe("aggregateSnapshotTotalsByDate", () => {
  it("keeps the last row per position key when summing by snapshot date", () => {
    const rows = [
      snapshotRow({
        instrumentId: "inst-1",
        snapshotDate: "2026-06-01",
        investedAmount: "100",
        currentValue: "110",
      }),
      snapshotRow({
        instrumentId: "inst-1",
        snapshotDate: "2026-06-01",
        investedAmount: "999",
        currentValue: "999",
      }),
      snapshotRow({
        instrumentId: "inst-2",
        snapshotDate: "2026-06-01",
        investedAmount: "50",
        currentValue: "60",
      }),
    ];

    const totals = aggregateSnapshotTotalsByDate(rows);
    expect(totals.get("2026-06-01")).toEqual({
      investedAmount: 1049,
      currentValue: 1059,
    });
  });

  it("sums INR and USD but never unsupported currencies", () => {
    const rows = [
      snapshotRow({
        instrumentId: "inr-1",
        investedAmount: "100",
        currentValue: "110",
      }),
      snapshotRow({
        instrumentId: "usd-1",
        currency: "USD",
        investedAmount: "10",
        currentValue: "20",
      }),
      snapshotRow({
        instrumentId: "btc-1",
        currency: "BTC",
        investedAmount: "5",
        currentValue: "9",
      }),
      snapshotRow({
        instrumentId: "other-1",
        currency: "OTHER",
        investedAmount: "7",
        currentValue: "8",
      }),
    ];

    // 100 + 10*80 invested, 110 + 20*80 current; BTC and OTHER contribute
    // nothing rather than adding 5/7 and 9/8 rupees.
    expect(aggregateSnapshotTotalsByDate(rows, 80).get("2026-06-16")).toEqual({
      investedAmount: 900,
      currentValue: 1710,
    });
  });
});

function snapshotRow(
  overrides: Partial<{
    accountId: string;
    accountName: string;
    provider: string;
    assetClass: string;
    currency: Currency;
    sourceSheet: string;
    snapshotDate: string;
    instrumentName: string;
    instrumentId: string;
    investedAmount: string;
    currentValue: string;
    sourcePayload: Record<string, unknown>;
  }> = {},
) {
  return {
    accountId: overrides.accountId ?? "account-1",
    instrumentId: overrides.instrumentId ?? "instrument-1",
    accountName: overrides.accountName ?? "Broker A",
    provider: overrides.provider ?? "Tickertape",
    assetClass: overrides.assetClass ?? "indian_stock",
    currency: overrides.currency ?? "INR",
    sourceSheet: overrides.sourceSheet ?? "",
    snapshotDate: overrides.snapshotDate ?? "2026-06-16",
    instrumentName: overrides.instrumentName ?? "ABC",
    investedAmount: overrides.investedAmount ?? "100",
    currentValue: overrides.currentValue ?? "100",
    sourcePayload: overrides.sourcePayload ?? {},
  };
}
