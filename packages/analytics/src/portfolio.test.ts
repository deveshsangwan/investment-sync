import { describe, expect, it } from "vitest";
import { summarizePortfolio } from "./portfolio";

describe("summarizePortfolio", () => {
  it("computes portfolio totals and allocation", () => {
    const summary = summarizePortfolio([
      { assetClass: "indian_stock", investedAmount: 100, currentValue: 125 },
      { assetClass: "mutual_fund", investedAmount: 100, currentValue: 75 },
    ]);

    expect(summary).toMatchObject({
      investedAmount: 200,
      currentValue: 200,
      pnlAmount: 0,
      pnlPercent: 0,
    });
    expect(summary.allocationByAssetClass).toEqual([
      { assetClass: "indian_stock", currentValue: 125, weight: 62.5 },
      { assetClass: "mutual_fund", currentValue: 75, weight: 37.5 },
    ]);
  });

  it("summarizes pre-normalized mixed-currency holdings", () => {
    const usdInrRate = 80;
    const summary = summarizePortfolio([
      { assetClass: "mutual_fund", investedAmount: 1000, currentValue: 1200 },
      {
        assetClass: "us_stock",
        investedAmount: 10 * usdInrRate,
        currentValue: 15 * usdInrRate,
      },
    ]);

    expect(summary).toMatchObject({
      investedAmount: 1800,
      currentValue: 2400,
      pnlAmount: 600,
      pnlPercent: 33.33,
    });
    expect(summary.allocationByAssetClass).toEqual([
      { assetClass: "mutual_fund", currentValue: 1200, weight: 50 },
      { assetClass: "us_stock", currentValue: 1200, weight: 50 },
    ]);
  });
});
