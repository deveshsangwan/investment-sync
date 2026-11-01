import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseExactImportFile, parseImportFile } from "./index";

const requiredHeaders = [
  "Security",
  "Quantity",
  "Cost Basis (USD)",
  "Market Value (USD)",
];
const validRow = ["ALPHA", 2, 100, 125];

function vestedFile(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Unrealized P&L - Summary ",
  );

  const content: unknown = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });

  if (!Buffer.isBuffer(content)) {
    throw new Error("Expected generated workbook buffer");
  }

  return { fileName: "fake-vested.xlsx", content };
}

describe.each([
  { name: "legacy", parse: parseImportFile },
  { name: "exact", parse: parseExactImportFile },
])("Vested unrealized validation through $name parsing", ({ parse }) => {
  it("finds the header after a Security report preamble", () => {
    const file = vestedFile([
      ["Security holdings report"],
      requiredHeaders,
      validRow,
    ]);

    expect(parse(file).rows).toHaveLength(2);
  });

  it("reports physical sheet row numbers after leading blank rows", () => {
    const file = vestedFile([[], [], requiredHeaders, ["ALPHA", 2, "", 125]]);

    expect(() => parse(file)).toThrow(
      "row 4: Cost Basis (USD) must contain a valid number",
    );
  });

  it.each(requiredHeaders)("rejects missing %s header", (missing) => {
    const index = requiredHeaders.indexOf(missing);
    const file = vestedFile([
      requiredHeaders.filter((_, column) => column !== index),
      validRow.filter((_, column) => column !== index),
    ]);

    expect(() => parse(file)).toThrow(missing);
  });

  it.each(requiredHeaders)(
    "rejects ambiguous duplicate %s headers",
    (header) => {
      const file = vestedFile([
        [...requiredHeaders, `  ${header.toUpperCase()}  `],
        [...validRow, 999],
      ]);

      expect(() => parse(file)).toThrow(`duplicate column(s): ${header}`);
    },
  );

  it.each(["Cost Basis (USD)", "Market Value (USD)"])(
    "requires the supported USD header for %s",
    (header) => {
      for (const replacement of [
        header.replace("USD", "INR"),
        header.split(" (")[0],
      ]) {
        const file = vestedFile([
          requiredHeaders.map((value) =>
            value === header ? replacement : value,
          ),
          validRow,
        ]);

        expect(() => parse(file)).toThrow(
          `missing required column(s): ${header}`,
        );
      }
    },
  );

  describe.each(["Cost Basis (USD)", "Market Value (USD)"])(
    "%s cells",
    (field) => {
      it.each([
        undefined,
        null,
        "",
        "   ",
        "-",
        "not-a-number",
        "$",
        "NaN",
        "Infinity",
        true,
        "0x10",
        "12%",
        "1,2,3",
        "1(2)",
        "(12)3",
        "1e128",
      ])("rejects blank or malformed required value %j", (value) => {
        const row = [...validRow];
        const cells: unknown[] = row;
        cells[requiredHeaders.indexOf(field)] = value;
        const file = vestedFile([
          ["Synthetic report"],
          [],
          requiredHeaders,
          cells,
        ]);

        expect(() => parse(file)).toThrow(
          `Vested unrealized P&L summary row 4: ${field} must contain a valid number`,
        );
      });
    },
  );

  it("keeps parser errors actionable without echoing source data", () => {
    const file = vestedFile([
      requiredHeaders,
      ["PRIVATE-FAKE-SYMBOL", 2, "PRIVATE-FAKE-CELL", 125],
    ]);

    expect(() =>
      parse({ ...file, fileName: "PRIVATE-FAKE-FILE.xlsx" }),
    ).toThrow(
      /^Vested unrealized P&L summary row 2: Cost Basis \(USD\) must contain a valid number$/,
    );
  });

  it("ignores empty and total rows while keeping optional fields optional", () => {
    const result = parse(
      vestedFile([
        requiredHeaders,
        [],
        ["Total", "", "", ""],
        ["ALPHA", "", 100, 125],
      ]),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ symbol: "ALPHA", metadata: {} });
    expect(result.rows[0]).not.toHaveProperty("quantity", expect.anything());
    expect(result.rows[0]).not.toHaveProperty("pnlAmount", expect.anything());
    expect(result.warnings).toEqual([]);
  });

  it("rejects an invalid later holding instead of returning a partial snapshot", () => {
    expect(() =>
      parse(vestedFile([requiredHeaders, validRow, ["BETA", 1, "", 50]])),
    ).toThrow("row 3: Cost Basis (USD) must contain a valid number");
  });
});

describe("Vested unrealized valid values", () => {
  it.each([0, "0", "$0.00"])(
    "preserves explicit zero %j with its provenance",
    (zero) => {
      const file = vestedFile([requiredHeaders, ["ALPHA", 0, zero, zero]]);
      const exact = parseExactImportFile(file);

      expect(exact.parserVersion).toBe("vested-drivewealth-v5-decimal-v1");
      expect(exact.rows[0]).toMatchObject({
        investedAmount: "0",
        currentValue: "0",
        quantity: "0",
        numericProvenance: {
          investedAmount:
            typeof zero === "number" ? "xlsx_float64" : "source_decimal",
          currentValue:
            typeof zero === "number" ? "xlsx_float64" : "source_decimal",
        },
      });
      expect(parseImportFile(file)).toMatchObject({
        parserVersion: "vested-drivewealth-v5",
        rows: [
          { investedAmount: 0, currentValue: 0, quantity: 0 },
          { kind: "source_snapshot", completeness: "complete" },
        ],
        warnings: [],
      });
    },
  );

  it("maps normalized reordered headers and preserves exact source decimals", () => {
    const file = vestedFile([
      ["Synthetic Vested report"],
      [
        "  Market   Value (USD) ",
        "Security",
        "Cost Basis (USD)",
        "Quantity",
        "Profit/Loss (USD)",
      ],
      ["9007199254740993.02", "ALPHA", "9007199254740993.01", "0.125", "0.01"],
    ]);

    expect(parseExactImportFile(file)).toMatchObject({
      rows: [
        {
          symbol: "ALPHA",
          quantity: "0.125",
          investedAmount: "9007199254740993.01",
          currentValue: "9007199254740993.02",
          pnlAmount: "0.01",
          numericProvenance: {
            investedAmount: "source_decimal",
            currentValue: "source_decimal",
          },
        },
        { kind: "source_snapshot", completeness: "complete" },
      ],
      warnings: [],
    });
  });

  it("retains formatted monetary values and optional reported P&L", () => {
    const file = vestedFile([
      [
        ...requiredHeaders,
        "Profit/Loss (USD)",
        "Profit/Loss (%)",
        "Profit/Loss (INR)",
      ],
      ["ALPHA", 2, "$1,000.25", "($125.50)", "-1125.75", -112.5, -90000],
    ]);

    expect(parseExactImportFile(file).rows[0]).toMatchObject({
      investedAmount: "1000.25",
      currentValue: "-125.5",
      pnlAmount: "-1125.75",
      pnlPercent: -112.5,
      metadata: { profitLossInr: -90000 },
    });
  });
});
