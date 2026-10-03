import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseExactImportFile, parseImportFile } from "./index";
import { adaptExactParseResultToLegacy } from "./exact-adapter";

const sections = [
  {
    sheet: "Mutual Funds",
    assetClass: "mutual_fund",
    currency: "INR",
    hasQuantity: true,
  },
  { sheet: "NPS", assetClass: "nps", currency: "INR", hasQuantity: false },
  { sheet: "ULIPS", assetClass: "ulip", currency: "INR", hasQuantity: false },
  { sheet: "Crypto", assetClass: "crypto", currency: "INR", hasQuantity: true },
  {
    sheet: "US stocks",
    assetClass: "us_stock",
    currency: "USD",
    hasQuantity: true,
  },
];

function workbookFixture(hasExtraPrecision: boolean) {
  const invested = hasExtraPrecision ? "9007199254740993.01" : "100.25";
  const current = hasExtraPrecision ? "9007199254740993.02" : "110.75";
  const quantity = hasExtraPrecision ? "0.123456789012345678901" : "0.125";
  const gain = hasExtraPrecision ? "0.010000000000000000001" : "10.5";
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Date", "Asset Type", "Investment Amount", "Current Value"],
      ["2026-05-16", "Total", 100, 120],
    ]),
    "Investment Portfolio",
  );

  const sheets = [
    {
      name: "Mutual Funds",
      rows: [
        [
          "Date",
          "Current Value ₹",
          "Fund Name",
          "Units",
          "Invested Amount",
          "P&L ₹",
        ],
        ["", current, "FAKE FUND", quantity, invested, gain],
        ["2026-05-17"],
        ["", 150.5, "FAKE FUND", 2.5, 125.25, 25.25],
      ],
    },
    {
      name: "NPS",
      rows: [
        ["Date", "Current Value", "Investment Amount", "PnL"],
        ["", current, invested, gain],
        ["2026-05-17"],
        ["", 150.5, 125.25, 25.25],
      ],
    },
    {
      name: "ULIPS",
      rows: [
        ["Date", "Name", "Invested", "Current Value", "Returns"],
        ["", "FAKE POLICY", invested, current, gain],
        ["2026-05-17"],
        ["", "FAKE POLICY", 125.25, 150.5, 25.25],
      ],
    },
    {
      name: "Crypto",
      rows: [
        ["Date", "Name", "Units", "Invested", "Total Asset Value", "Returns"],
        ["", "FAKE COIN", quantity, invested, current, gain],
        ["2026-05-17"],
        ["", "FAKE COIN", 2.5, 125.25, 150.5, 25.25],
      ],
    },
    {
      name: "US stocks",
      rows: [
        [
          "Date",
          "Name",
          "Quantity",
          "Invested",
          "Current Value",
          "Returns",
          "%",
        ],
        ["", "FAKEUS", quantity, invested, current, gain, 10],
        ["2026-05-17"],
        ["", "FAKEUS", 2.5, 125.25, 150.5, 25.25, 20],
      ],
    },
  ];

  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(sheet.rows),
      sheet.name,
    );
  }

  const content: unknown = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });
  if (!Buffer.isBuffer(content))
    throw new Error("Expected generated workbook buffer");

  return { fileName: "fake-exact-sections.xlsx", content };
}

describe("exact workbook section financial cells", () => {
  it.each(sections)(
    "preserves $sheet text precision and identifies numeric cells",
    ({ sheet, assetClass, currency, hasQuantity }) => {
      const parsed = parseExactImportFile(workbookFixture(true));
      const holdings = parsed.rows.filter(
        (row) => row.kind === "holding" && row.metadata.sourceSheet === sheet,
      );

      expect(parsed.warnings).toEqual([]);
      expect(holdings).toHaveLength(2);
      expect(holdings[0]).toMatchObject({
        sourceDate: "2026-05-16",
        assetClass,
        currency,
        investedAmount: "9007199254740993.01",
        currentValue: "9007199254740993.02",
        pnlAmount: "0.010000000000000000001",
        source: {
          group: sheet,
          completeness: "complete",
          granularity: "instrument",
          priority: 0,
        },
        numericProvenance: {
          investedAmount: "source_decimal",
          currentValue: "source_decimal",
          pnlAmount: "source_decimal",
        },
        ...(hasQuantity ? { quantity: "0.123456789012345678901" } : {}),
      });
      expect(holdings[1]).toMatchObject({
        sourceDate: "2026-05-17",
        investedAmount: "125.25",
        currentValue: "150.5",
        pnlAmount: "25.25",
        numericProvenance: {
          investedAmount: "xlsx_float64",
          currentValue: "xlsx_float64",
          pnlAmount: "xlsx_float64",
        },
        ...(hasQuantity ? { quantity: "2.5" } : {}),
      });

      if (hasQuantity) {
        expect(holdings[0]?.numericProvenance.quantity).toBe("source_decimal");
        expect(holdings[1]?.numericProvenance.quantity).toBe("xlsx_float64");
      }
    },
  );

  it("preserves legacy financial meaning for representable text and numeric cells in every section", () => {
    const file = workbookFixture(false);
    const legacy = parseImportFile(file);
    const exact = parseExactImportFile(file);
    const adapted = adaptExactParseResultToLegacy(exact);

    expect(legacy.parserVersion).toBe("investment-portfolio-workbook-v5");
    expect(legacy.rows).toHaveLength(11);
    expect(adapted.rows).toEqual(legacy.rows);
    expect(adapted.warnings).toEqual(legacy.warnings);

    for (const section of sections) {
      const holdings = legacy.rows.filter(
        (row) =>
          row.kind === "holding" && row.metadata.sourceSheet === section.sheet,
      );
      expect(holdings[0]).toMatchObject({
        investedAmount: 100.25,
        currentValue: 110.75,
        pnlAmount: 10.5,
      });
      expect(holdings[1]).toMatchObject({
        investedAmount: 125.25,
        currentValue: 150.5,
        pnlAmount: 25.25,
      });
    }
  });
});
