import { describe, expect, it } from "vitest";
import { summarizePerformance } from "./performance";

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
