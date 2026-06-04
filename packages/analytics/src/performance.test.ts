import { describe, expect, it } from "vitest";
import {
  resolveAssetClassXirr,
  resolveHoldingXirr,
  summarizePerformance,
  xirrFromValuationDeltas,
} from "./performance";

describe("summarizePerformance", () => {
  it("uses exact cash-flow XIRR when transactions exist", () => {
    const summary = summarizePerformance({
      asOfDate: new Date("2025-01-01"),
      holdings: [
        {
          assetClass: "mutual_fund",
          investedAmount: 1000,
          currentValue: 1210,
        },
      ],
      cashFlows: [
        {
          date: new Date("2024-01-01"),
          amount: 1000,
          type: "buy",
        },
      ],
      valuations: [],
    });

    expect(summary.dataQuality).toBe("exact");
    expect(summary.xirr).toBeCloseTo(21, 0);
  });

  it("falls back to source-provided weighted XIRR", () => {
    const summary = summarizePerformance({
      asOfDate: new Date("2025-01-01"),
      holdings: [
        {
          assetClass: "mutual_fund",
          investedAmount: 1000,
          currentValue: 1000,
          sourceXirr: 12,
        },
        {
          assetClass: "mutual_fund",
          investedAmount: 1000,
          currentValue: 3000,
          sourceXirr: 16,
        },
      ],
      cashFlows: [],
      valuations: [],
    });

    expect(summary.dataQuality).toBe("source_provided");
    expect(summary.xirr).toBe(15);
    expect(summary.sourceXirrCoveragePercent).toBe(100);
  });
});

describe("xirrFromValuationDeltas", () => {
  it("estimates XIRR from invested deltas and terminal value", () => {
    const rate = xirrFromValuationDeltas([
      { date: new Date("2024-07-27"), investedAmount: 366.18, currentValue: 304.47 },
      { date: new Date("2025-08-14"), investedAmount: 521.8, currentValue: 701.38 },
      { date: new Date("2026-05-31"), investedAmount: 716.81, currentValue: 1100.78 },
    ]);

    expect(rate).toBeDefined();
    expect((rate ?? 0) * 100).toBeCloseTo(42, 0);
  });
});

describe("resolveHoldingXirr", () => {
  it("prefers exact cash-flow XIRR over source and estimated values", () => {
    const resolved = resolveHoldingXirr({
      asOfDate: new Date("2025-01-01"),
      terminalValue: 1210,
      sourceXirr: 12,
      valuations: [
        { date: new Date("2024-01-01"), investedAmount: 1000, currentValue: 900 },
        { date: new Date("2025-01-01"), investedAmount: 1000, currentValue: 1210 },
      ],
      cashFlows: [
        { date: new Date("2024-01-01"), amount: 1000, type: "buy" },
      ],
    });

    expect(resolved.dataQuality).toBe("exact");
    expect(resolved.xirr).toBeCloseTo(21, 0);
  });

  it("falls back to source XIRR when cash flows are missing", () => {
    const resolved = resolveHoldingXirr({
      asOfDate: new Date("2025-01-01"),
      terminalValue: 1200,
      sourceXirr: 14.5,
      valuations: [
        { date: new Date("2024-01-01"), investedAmount: 1000, currentValue: 900 },
        { date: new Date("2025-01-01"), investedAmount: 1000, currentValue: 1200 },
      ],
      cashFlows: [],
    });

    expect(resolved.dataQuality).toBe("source_provided");
    expect(resolved.xirr).toBe(14.5);
  });

  it("estimates XIRR from valuations when source XIRR is missing", () => {
    const resolved = resolveHoldingXirr({
      asOfDate: new Date("2026-05-31"),
      terminalValue: 1100.78,
      valuations: [
        { date: new Date("2024-07-27"), investedAmount: 366.18, currentValue: 304.47 },
        { date: new Date("2025-08-14"), investedAmount: 521.8, currentValue: 701.38 },
        { date: new Date("2026-05-31"), investedAmount: 716.81, currentValue: 1100.78 },
      ],
      cashFlows: [],
    });

    expect(resolved.dataQuality).toBe("estimated");
    expect(resolved.xirr).toBeCloseTo(42, 0);
  });
});

describe("resolveAssetClassXirr", () => {
  it("uses weighted source XIRR before estimated valuations", () => {
    const resolved = resolveAssetClassXirr({
      holdings: [
        {
          assetClass: "mutual_fund",
          investedAmount: 1000,
          currentValue: 1000,
          sourceXirr: 10,
        },
        {
          assetClass: "mutual_fund",
          investedAmount: 1000,
          currentValue: 3000,
          sourceXirr: 18,
        },
      ],
      valuations: [
        { date: new Date("2024-01-01"), investedAmount: 2000, currentValue: 1800 },
        { date: new Date("2025-01-01"), investedAmount: 2000, currentValue: 4000 },
      ],
    });

    expect(resolved.dataQuality).toBe("source_provided");
    expect(resolved.xirr).toBe(16);
  });

  it("estimates asset-class XIRR from valuations when source data is missing", () => {
    const resolved = resolveAssetClassXirr({
      holdings: [
        {
          assetClass: "us_stock",
          investedAmount: 716.81,
          currentValue: 1100.78,
        },
      ],
      valuations: [
        { date: new Date("2024-07-27"), investedAmount: 366.18, currentValue: 304.47 },
        { date: new Date("2026-05-31"), investedAmount: 716.81, currentValue: 1100.78 },
      ],
    });

    expect(resolved.dataQuality).toBe("estimated");
    expect(resolved.xirr).toBeDefined();
  });
});
