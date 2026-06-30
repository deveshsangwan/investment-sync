import { describe, expect, it } from "vitest";
import {
  normalizedHoldingRowSchema,
  normalizedImportRowSchema,
  normalizedTransactionRowSchema,
  normalizedValuationRowSchema,
} from "./types";
import { parseNumber, sourceDateFromText, toIsoDate } from "./utils";

describe("parseNumber", () => {
  it("parses currency, percent, commas, and parenthesized negatives", () => {
    expect(parseNumber("₹ 1,234.50")).toBe(1234.5);
    expect(parseNumber("INR (1,000.25)")).toBe(-1000.25);
    expect(parseNumber("12.5%")).toBe(12.5);
    expect(parseNumber("-")).toBeUndefined();
  });
});

describe("toIsoDate", () => {
  it("parses ISO, Indian date strings, and Date values", () => {
    expect(toIsoDate("2026-06-16")).toBe("2026-06-16");
    expect(toIsoDate("16/06/2026")).toBe("2026-06-16");
    expect(toIsoDate("16-06-26")).toBe("2026-06-16");
    expect(toIsoDate("16-06-99")).toBe("1999-06-16");
    expect(toIsoDate(new Date(2026, 5, 16))).toBe("2026-06-16");
  });

  it("rejects invalid dates", () => {
    expect(toIsoDate("31/02/2026")).toBeUndefined();
    expect(toIsoDate("not a date")).toBeUndefined();
  });

  it("preserves historical two-digit years in source text", () => {
    expect(sourceDateFromText("As of 16-Jun-99")).toBe("1999-06-16");
  });
});

describe("normalizedImportRowSchema", () => {
  it("accepts valid normalized holding rows", () => {
    expect(
      normalizedImportRowSchema.parse({
        kind: "holding",
        sourceType: "tickertape_stock_csv",
        accountName: "Indian Stocks",
        provider: "Tickertape",
        instrumentName: "ABC",
        symbol: "ABC",
        assetClass: "indian_stock",
        currency: "INR",
        investedAmount: 100,
        currentValue: 125,
        metadata: {},
      }),
    ).toMatchObject({ kind: "holding", instrumentName: "ABC" });
  });

  it("rejects invalid normalized rows", () => {
    expect(() =>
      normalizedImportRowSchema.parse({
        kind: "holding",
        sourceType: "tickertape_stock_csv",
        accountName: "",
        provider: "Tickertape",
        instrumentName: "ABC",
        assetClass: "indian_stock",
        currency: "INR",
        investedAmount: Number.NaN,
        currentValue: 125,
        metadata: {},
      }),
    ).toThrow();
  });

  it("rejects malformed or invalid calendar dates", () => {
    expect(
      normalizedHoldingRowSchema.safeParse({
        kind: "holding",
        sourceType: "tickertape_stock_csv",
        sourceDate: "2026-02-30",
        accountName: "Indian Stocks",
        provider: "Tickertape",
        instrumentName: "ABC",
        assetClass: "indian_stock",
        currency: "INR",
        investedAmount: 100,
        currentValue: 125,
        metadata: {},
      }).success,
    ).toBe(false);
    expect(
      normalizedTransactionRowSchema.safeParse({
        kind: "transaction",
        sourceType: "tickertape_stock_csv",
        accountName: "Indian Stocks",
        provider: "Tickertape",
        instrumentName: "ABC",
        assetClass: "indian_stock",
        currency: "INR",
        tradeDate: "16/06/2026",
        type: "buy",
        amount: 100,
        metadata: {},
      }).success,
    ).toBe(false);
    expect(
      normalizedValuationRowSchema.safeParse({
        kind: "valuation",
        sourceType: "manual_snapshot",
        valuationDate: "2026-02-30",
        investedAmount: 100,
        currentValue: 125,
        currency: "INR",
        metadata: {},
      }).success,
    ).toBe(false);
  });
});
