import { describe, expect, it } from "vitest";
import { buildPortfolioTimelineFromValuations } from "./from-snapshot";

describe("buildPortfolioTimelineFromValuations", () => {
  it("normalizes valuation rows to INR by date", () => {
    expect(
      buildPortfolioTimelineFromValuations(
        [
          {
            valuationDate: "2026-06-01",
            investedAmount: "100",
            currentValue: "110",
            pnlAmount: "10",
            currency: "USD",
          },
          {
            valuationDate: "2026-06-01",
            investedAmount: "50",
            currentValue: "60",
            pnlAmount: "10",
            currency: "INR",
          },
        ],
        80,
      ),
    ).toEqual([
      {
        snapshotDate: "2026-06-01",
        investedAmount: 8050,
        currentValue: 8860,
        pnlAmount: 810,
        currency: "INR",
      },
    ]);
  });
});
