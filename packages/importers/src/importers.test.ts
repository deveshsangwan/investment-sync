import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseImportFile } from "./index";

function workbookToBuffer(workbook: XLSX.WorkBook): Buffer {
  const output = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as unknown;
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  if (output instanceof ArrayBuffer) return Buffer.from(output);
  return Buffer.from(String(output));
}

// Builds a minimal Investment Portfolio workbook with just enough sheets
// (Investment Portfolio + Stock Investments + Mutual Funds) to hit the
// importer's detection threshold, so header-mapping tests can override just
// the sheet under test and leave the other with a harmless header-only stub.
function buildWorkbook(options: {
  stockRows?: unknown[][];
  mutualFundRows?: unknown[][];
}): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Date", "Asset Type", "Investment Amount", "Current Value"],
    ]),
    "Investment Portfolio",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(
      options.stockRows ?? [
        ["Security", "Invested Value ₹", "Current Value ₹"],
      ],
    ),
    "Stock Investments",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(
      options.mutualFundRows ?? [
        ["Fund Name", "Invested Amt ₹", "Current Value ₹"],
      ],
    ),
    "Mutual Funds",
  );
  return workbookToBuffer(workbook);
}

describe("Tickertape importers", () => {
  it("parses stock holdings CSV", () => {
    const csv = `,,,Holdings - 16-May-26 IST
Visit: https://tickertape.in/portfolio?tab=holdings

Security,No. of Smallcases,Quantity,Average Cost ₹,Portfolio Weight %,LTP ₹,Invested Value ₹,Current Value ₹,P & L ₹,Net Change %,Daily Change ₹,Daily Change %

Stocks/ETFs

TESTSTOCK,0.00,24.00,100.00,10.22,120.00,2400.00,2880.00,480.00,20.00,1.00,0.84`;

    const result = parseImportFile({
      fileName: "Holdings.csv",
      content: Buffer.from(csv),
    });

    expect(result.sourceType).toBe("tickertape_stock_csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      instrumentName: "TESTSTOCK",
      assetClass: "indian_stock",
      currentValue: 2880,
    });
  });

  it("parses mutual fund holdings CSV", () => {
    const csv = `,,,,,Mutual Funds Holdings - Sat May 16 2026
Visit: https://tickertape.in/portfolio?tab=mfholdings

Fund Name,AMC Name,Category,Sub-Category,Plan Type,Option Type,NAV ₹,Units,Invested Amt ₹,Current Value ₹,Weight %,P&L ₹,P&L %,XIRR %,Invested Since
Example Equity Saver Fund,Example AMC,Equity,ELSS,Direct,Growth,31.53,100.00,1000.00,1100.00,11.49,100.00,10.00,4.05,2023-05-02
Total,,,,,,,,1000.00,1100.00,100,100.00,10.00,,`;

    const result = parseImportFile({
      fileName: "Holdings-mf.csv",
      content: Buffer.from(csv),
    });

    expect(result.sourceType).toBe("tickertape_mutual_fund_csv");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      instrumentName: "Example Equity Saver Fund",
      assetClass: "mutual_fund",
      investedAmount: 1000,
    });
  });
});

describe("Investment workbook importer", () => {
  it("parses valuations and detailed holdings from the personal workbook layout", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          "Date",
          "Asset Type",
          "Investment Amount",
          "Current Value",
          "Gain/Loss",
          "Percentage Change",
        ],
        [new Date("2024-07-28"), "Stocks", 1000, 1100, 100, 10],
        [new Date("2024-07-28"), "US Stock", 500, 550, 50, 10],
        [new Date("2024-07-28"), "Total", 1000, 1100, 100, 10],
      ]),
      "Investment Portfolio",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          "Security",
          "No. of Smallcases",
          "Quantity",
          "Average Cost ₹",
          "Portfolio Weight %",
          "LTP ₹",
          "Invested Value ₹",
          "Current Value ₹",
          "P & L ₹",
          "Net Change %",
        ],
        ["ABC", 0, 2, 500, 100, 550, 1000, 1100, 100, 10],
      ]),
      "Stock Investments",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          "Fund Name",
          "AMC Name",
          "Category",
          "Sub-Category",
          "Plan Type",
          "Option Type",
          "NAV ₹",
          "Units",
          "Invested Amt ₹",
          "Current Value ₹",
          "Weight %",
          "P&L ₹",
          "P&L %",
          "XIRR %",
        ],
        [
          "Fund A",
          "AMC",
          "Equity",
          "Large",
          "Direct",
          "Growth",
          10,
          10,
          100,
          125,
          100,
          25,
          25,
          12.5,
        ],
      ]),
      "Mutual Funds",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Value", "Count", "Contribution"],
        ["Rs 1100", 1, "Rs 1000"],
      ]),
      "NPS",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Name", "Invested", "Returns", "Current Value"],
      ]),
      "ULIPS",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Name", "Units", "Invested", "Returns", "Total Asset Value"],
      ]),
      "Crypto",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Name", "Quantity", "Current Value", "Invested", "Returns", "%"],
        ["USSTOCK", 1, 200, 150, 50, 33.33],
        ["USSTOCK", 1, 200, 150, 50, 33.33],
      ]),
      "US stocks",
    );

    const content = workbookToBuffer(workbook);
    const result = parseImportFile({
      fileName: "Personal Workbook.xlsx",
      content,
    });

    expect(result.sourceType).toBe("investment_portfolio_xlsx");
    expect(
      result.rows.some(
        (row) =>
          row.kind === "holding" && row.instrumentName.includes("Summary"),
      ),
    ).toBe(false);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "valuation", currentValue: 1100 }),
        expect.objectContaining({
          kind: "holding",
          instrumentName: "ABC",
          assetClass: "indian_stock",
          currentValue: 1100,
        }),
        expect.objectContaining({
          kind: "holding",
          instrumentName: "Fund A",
          assetClass: "mutual_fund",
        }),
        expect.objectContaining({
          kind: "holding",
          instrumentName: "USSTOCK",
          assetClass: "us_stock",
          currentValue: 200,
        }),
      ]),
    );
    const fundARow = result.rows.find(
      (row) => row.kind === "holding" && row.instrumentName === "Fund A",
    );
    expect(fundARow).toBeDefined();
    if (fundARow && fundARow.kind === "holding") {
      expect(fundARow.metadata).toMatchObject({ xirr: 12.5 });
    }
    expect(
      result.rows.filter(
        (row) => row.kind === "holding" && row.instrumentName === "USSTOCK",
      ),
    ).toHaveLength(1);
  });
});

describe("Investment workbook importer - header mapping", () => {
  it("Stock Investments: parses correctly when columns are reordered", () => {
    const result = parseImportFile({
      fileName: "Personal Workbook.xlsx",
      content: buildWorkbook({
        stockRows: [
          [
            "Current Value ₹",
            "Security",
            "P & L ₹",
            "Quantity",
            "Invested Value ₹",
            "Net Change %",
          ],
          [1100, "ABC", 100, 2, 1000, 10],
        ],
      }),
    });

    const abc = result.rows.find(
      (row) => row.kind === "holding" && row.instrumentName === "ABC",
    );
    expect(abc).toMatchObject({
      currentValue: 1100,
      investedAmount: 1000,
      quantity: 2,
    });
  });

  it("Stock Investments: keeps a reordered row whose first cell parses as a date", () => {
    // 2024 reaches `new Date("2024")` and yields a valid date, so a reordered
    // sheet with a money column first used to be swallowed as a date marker.
    const result = parseImportFile({
      fileName: "Personal Workbook.xlsx",
      content: buildWorkbook({
        stockRows: [
          [
            "Current Value \u20b9",
            "Security",
            "Quantity",
            "Invested Value \u20b9",
          ],
          [2024, "ABC", 2, 1000],
        ],
      }),
    });

    expect(
      result.rows.find(
        (row) => row.kind === "holding" && row.instrumentName === "ABC",
      ),
    ).toMatchObject({ currentValue: 2024, investedAmount: 1000 });
  });

  it("Stock Investments: throws when a required column appears twice", () => {
    expect(() =>
      parseImportFile({
        fileName: "Personal Workbook.xlsx",
        content: buildWorkbook({
          stockRows: [
            [
              "Security",
              "Quantity",
              "Invested Value \u20b9",
              "Current Value \u20b9",
              "Current Value \u20b9",
            ],
            ["ABC", 2, 1000, 1100, 9999],
          ],
        }),
      }),
    ).toThrow(/duplicate column/i);
  });

  it("Stock Investments: drops rows whose amounts are both zero", () => {
    const result = parseImportFile({
      fileName: "Personal Workbook.xlsx",
      content: buildWorkbook({
        stockRows: [
          [
            "Security",
            "Quantity",
            "Invested Value \u20b9",
            "Current Value \u20b9",
          ],
          ["Grand Total", 0, 0, 0],
          ["ABC", 2, 1000, 1100],
        ],
      }),
    });

    const names = result.rows
      .filter((row) => row.kind === "holding")
      .map((row) => row.instrumentName);
    expect(names).toContain("ABC");
    expect(names).not.toContain("Grand Total");
  });

  it("Stock Investments: parses correctly with an extra inserted column", () => {
    const result = parseImportFile({
      fileName: "Personal Workbook.xlsx",
      content: buildWorkbook({
        stockRows: [
          [
            "Security",
            "Sector",
            "Quantity",
            "Invested Value ₹",
            "Current Value ₹",
          ],
          ["ABC", "Technology", 2, 1000, 1100],
        ],
      }),
    });

    const abc = result.rows.find(
      (row) => row.kind === "holding" && row.instrumentName === "ABC",
    );
    expect(abc).toMatchObject({
      currentValue: 1100,
      investedAmount: 1000,
      quantity: 2,
    });
  });

  it("Stock Investments: throws a schema error when a required column is missing", () => {
    expect(() =>
      parseImportFile({
        fileName: "Personal Workbook.xlsx",
        content: buildWorkbook({
          stockRows: [
            ["Security", "Quantity", "Current Value ₹"],
            ["ABC", 2, 1100],
          ],
        }),
      }),
    ).toThrow(/Stock Investments.*Invested Value/);
  });

  it("Stock Investments: throws a schema error when a required column is renamed", () => {
    expect(() =>
      parseImportFile({
        fileName: "Personal Workbook.xlsx",
        content: buildWorkbook({
          stockRows: [
            ["Security", "Quantity", "Invested Value ₹", "Value ₹"],
            ["ABC", 2, 1000, 1100],
          ],
        }),
      }),
    ).toThrow(/Stock Investments.*Current Value/);
  });

  it("Stock Investments: throws instead of dropping the sheet when the anchor column is renamed", () => {
    // requireColumns never runs if the header row can't be found at all, so
    // renaming the anchor is the one schema change that could still lose every
    // holding on the sheet silently.
    expect(() =>
      parseImportFile({
        fileName: "Personal Workbook.xlsx",
        content: buildWorkbook({
          stockRows: [
            ["Ticker", "Quantity", "Invested Value ₹", "Current Value ₹"],
            ["ABC", 2, 1000, 1100],
          ],
        }),
      }),
    ).toThrow(/Stock Investments.*no header row.*Security/);
  });

  it("Mutual Funds: parses correctly when columns are reordered", () => {
    const result = parseImportFile({
      fileName: "Personal Workbook.xlsx",
      content: buildWorkbook({
        mutualFundRows: [
          [
            "Current Value ₹",
            "Fund Name",
            "P&L ₹",
            "Units",
            "Invested Amt ₹",
            "P&L %",
          ],
          [125, "Fund A", 25, 10, 100, 25],
        ],
      }),
    });

    const fundA = result.rows.find(
      (row) => row.kind === "holding" && row.instrumentName === "Fund A",
    );
    expect(fundA).toMatchObject({
      currentValue: 125,
      investedAmount: 100,
      quantity: 10,
    });
  });

  it("Mutual Funds: parses correctly with an extra inserted column", () => {
    const result = parseImportFile({
      fileName: "Personal Workbook.xlsx",
      content: buildWorkbook({
        mutualFundRows: [
          [
            "Fund Name",
            "Category",
            "AMC Name",
            "Invested Amt ₹",
            "Current Value ₹",
          ],
          ["Fund A", "Equity", "AMC", 100, 125],
        ],
      }),
    });

    const fundA = result.rows.find(
      (row) => row.kind === "holding" && row.instrumentName === "Fund A",
    );
    expect(fundA).toMatchObject({
      currentValue: 125,
      investedAmount: 100,
    });
  });

  it("Mutual Funds: throws a schema error when a required column is missing", () => {
    expect(() =>
      parseImportFile({
        fileName: "Personal Workbook.xlsx",
        content: buildWorkbook({
          mutualFundRows: [
            ["Fund Name", "Units", "Current Value ₹"],
            ["Fund A", 10, 125],
          ],
        }),
      }),
    ).toThrow(/Mutual Funds.*Invested Amount/);
  });

  it("Mutual Funds: throws a schema error when a required column is renamed", () => {
    expect(() =>
      parseImportFile({
        fileName: "Personal Workbook.xlsx",
        content: buildWorkbook({
          mutualFundRows: [
            ["Fund Name", "Units", "Invested Amt ₹", "Value ₹"],
            ["Fund A", 10, 100, 125],
          ],
        }),
      }),
    ).toThrow(/Mutual Funds.*Current Value/);
  });
});
