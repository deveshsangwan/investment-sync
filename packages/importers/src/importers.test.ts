import { describe, expect, it } from "vitest";
import { parseImportFile } from "./index";

describe("Tickertape importers", () => {
  it("parses stock holdings CSV", () => {
    const csv = `,,,Holdings - 16-May-26 IST
Visit: https://tickertape.in/portfolio?tab=holdings

Security,No. of Smallcases,Quantity,Average Cost ₹,Portfolio Weight %,LTP ₹,Invested Value ₹,Current Value ₹,P & L ₹,Net Change %,Daily Change ₹,Daily Change %

Stocks/ETFs

RELIANCE,0.00,24.00,1479.58,10.22,1336.40,35509.92,32073.60,-3436.32,-9.68,-25.40,-1.87`;

    const result = parseImportFile({
      fileName: "Holdings.csv",
      content: Buffer.from(csv),
    });

    expect(result.sourceType).toBe("tickertape_stock_csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      instrumentName: "RELIANCE",
      assetClass: "indian_stock",
      currentValue: 32073.6,
    });
  });

  it("parses mutual fund holdings CSV", () => {
    const csv = `,,,,,Mutual Funds Holdings - Sat May 16 2026
Visit: https://tickertape.in/portfolio?tab=mfholdings

Fund Name,AMC Name,Category,Sub-Category,Plan Type,Option Type,NAV ₹,Units,Invested Amt ₹,Current Value ₹,Weight %,P&L ₹,P&L %,XIRR %,Invested Since
Parag Parikh ELSS Tax Saver Fund,PPFAS,Equity,ELSS,Direct,Growth,31.53,1903.24,56997.25,60002.21,11.49,3004.96,5.27,4.05,2023-05-02
Total,,,,,,,,56997.25,60002.21,100,3004.96,5.27,,`;

    const result = parseImportFile({
      fileName: "Holdings-mf.csv",
      content: Buffer.from(csv),
    });

    expect(result.sourceType).toBe("tickertape_mutual_fund_csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      instrumentName: "Parag Parikh ELSS Tax Saver Fund",
      assetClass: "mutual_fund",
      investedAmount: 56997.25,
    });
  });
});
