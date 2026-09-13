import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseExactImportFile, parseImportFile } from "./index";
import {
  adaptExactParseResultToLegacy,
  adaptLegacyParseResult,
  adaptLegacyRow,
} from "./exact-adapter";
import {
  canonicalDecimalSchema,
  canonicalizeDecimal,
  parseSourceDecimal,
} from "./numeric";
import { parserGoldenFixtures } from "./golden-fixtures";
import { exactNormalizedImportRowSchema } from "./exact-types";

describe("exact financial source contract", () => {
  it.each(parserGoldenFixtures())(
    "keeps $name legacy parser output and version unchanged through the adapter",
    ({ file, expected }) => {
      const legacy = parseImportFile(file);
      expect(legacy).toEqual(expected);
      expect(
        adaptExactParseResultToLegacy(adaptLegacyParseResult(legacy)),
      ).toEqual(legacy);

      const exact = parseExactImportFile(file);
      expect(exact.parserVersion).toBe(`${legacy.parserVersion}-decimal-v1`);
      expect(adaptExactParseResultToLegacy(exact).rows).toEqual(legacy.rows);
      expect(exact.warnings).toEqual(legacy.warnings);
      expect(
        exact.rows.every(
          (row) => exactNormalizedImportRowSchema.safeParse(row).success,
        ),
      ).toBe(true);
    },
  );

  it("preserves decimal CSV text beyond Float64 precision", () => {
    const file = {
      fileName: "stocks.csv",
      content: Buffer.from(
        "Security,Quantity,Average Cost,Invested Value,Current Value,P & L\nFAKE,0.123456789012345678901,1,9007199254740993.01,9007199254740993.02,0.01",
      ),
    };
    const row = parseExactImportFile(file).rows[0];
    expect(row).toMatchObject({
      quantity: "0.123456789012345678901",
      investedAmount: "9007199254740993.01",
      currentValue: "9007199254740993.02",
      pnlAmount: "0.01",
      source: {
        group: "",
        completeness: "complete",
        granularity: "instrument",
        priority: 0,
      },
      numericProvenance: {
        quantity: "source_decimal",
        currentValue: "source_decimal",
      },
    });
  });

  it.each(["1." + "1234567890".repeat(13), "1e128", "1e-128"])(
    "rejects source text outside exact bounds: %s",
    (amount) => {
      const file = {
        fileName: "stocks.csv",
        content: Buffer.from(
          `Security,Quantity,Average Cost,Invested Value,Current Value\nFAKE,1,1,1,${amount}`,
        ),
      };

      expect(parseImportFile(file).rows).toHaveLength(1);
      expect(() => parseExactImportFile(file)).toThrow();
    },
  );

  it("preserves the largest supported canonical integer", () => {
    const amount = "1" + "0".repeat(127);
    const file = {
      fileName: "stocks.csv",
      content: Buffer.from(
        `Security,Quantity,Average Cost,Invested Value,Current Value\nFAKE,1,1,1,${amount}`,
      ),
    };
    expect(parseExactImportFile(file).rows[0]).toMatchObject({
      currentValue: amount,
      numericProvenance: { currentValue: "source_decimal" },
    });
  });

  it.each(["Quantity", "P & L"])(
    "rejects out-of-range optional %s before legacy parsing can drop it",
    (field) => {
      const headers = [
        "Security",
        "Quantity",
        "Average Cost",
        "Invested Value",
        "Current Value",
        "P & L",
      ];
      const cells = ["FAKE", "1", "1", "1", "2", "1"];
      cells[headers.indexOf(field)] = "1e999";
      const file = {
        fileName: "stocks.csv",
        content: Buffer.from(`${headers.join(",")}\n${cells.join(",")}`),
      };

      expect(parseImportFile(file).rows).toHaveLength(1);
      expect(() => parseExactImportFile(file)).toThrow();
    },
  );

  it.each(["-", ""])(
    "preserves NPS blank-zero withdrawal semantics for %s",
    (withdrawal) => {
      const fixture = parserGoldenFixtures().find(
        (fixture) => fixture.expected.sourceType === "nps_csv",
      );
      if (!fixture) throw new Error("Missing NPS fixture");

      const file = {
        ...fixture.file,
        content: Buffer.from(
          fixture.file.content
            .toString()
            .replace(
              "Rs 1000,2,Rs 900,Rs 0,Rs 100",
              `Rs 1000,2,Rs 900,${withdrawal},Rs 100`,
            ),
        ),
      };
      const legacy = parseImportFile(file);
      expect(
        adaptExactParseResultToLegacy(parseExactImportFile(file)).rows,
      ).toEqual(legacy.rows);
    },
  );

  it("distinguishes XLSX text cells from recorded numeric cells", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Security", "Quantity", "Cost Basis (USD)", "Market Value (USD)"],
        ["FAKE", 0.1, "9007199254740993.01", "9007199254740993.02"],
      ]),
      "Unrealized P&L - Summary ",
    );
    const content: unknown = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    if (!Buffer.isBuffer(content)) throw new Error("Expected workbook buffer");

    const row = parseExactImportFile({ fileName: "fake.xlsx", content })
      .rows[0];
    expect(row).toMatchObject({
      investedAmount: "9007199254740993.01",
      quantity: "0.1",
      numericProvenance: {
        investedAmount: "source_decimal",
        quantity: "xlsx_float64",
      },
    });
  });

  it("marks legacy Float64 honestly and preserves shared NPS grouping", () => {
    const fixture = parserGoldenFixtures().find(
      (fixture) => fixture.expected.sourceType === "nps_csv",
    );
    if (!fixture) throw new Error("Missing NPS fixture");
    const legacy = parseImportFile(fixture.file).rows[0];
    if (!legacy) throw new Error("Missing NPS holding");
    expect(adaptLegacyRow(legacy)).toMatchObject({
      source: { group: "NPS", priority: 100 },
      numericProvenance: { investedAmount: "legacy_float64" },
    });
    expect(parseExactImportFile(fixture.file).rows[0]).toMatchObject({
      numericProvenance: {
        investedAmount: "derived_decimal",
        currentValue: "source_decimal",
      },
    });
  });

  it("subtracts NPS source amounts before Float64 conversion", () => {
    const fixture = parserGoldenFixtures().find(
      (fixture) => fixture.expected.sourceType === "nps_csv",
    );
    if (!fixture) throw new Error("Missing NPS fixture");

    const content = Buffer.from(
      fixture.file.content
        .toString()
        .replace(
          "Rs 1000,2,Rs 900,Rs 0,Rs 100",
          "Rs 1000,2,Rs 9007199254740993.01,Rs 9007199254740093,Rs 100",
        ),
    );
    expect(
      parseExactImportFile({ ...fixture.file, content }).rows[0],
    ).toMatchObject({
      investedAmount: "900.01",
      numericProvenance: { investedAmount: "derived_decimal" },
    });
  });

  it("reports precision conflicts that the legacy workbook tolerance collapses", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Date", "Asset Type", "Investment Amount", "Current Value"],
        ["2026-05-16", "Total", 1, 2],
      ]),
      "Investment Portfolio",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Security", "Invested Value", "Current Value"],
        ["FAKE", "9007199254740993.01", "9007199254740993.02"],
        ["FAKE", "9007199254740993.02", "9007199254740993.02"],
      ]),
      "Stock Investments",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([]),
      "Mutual Funds",
    );
    const content: unknown = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    if (!Buffer.isBuffer(content)) throw new Error("Expected workbook buffer");

    const file = { fileName: "fake.xlsx", content };

    expect(parseImportFile(file).warnings).toEqual([]);
    expect(parseExactImportFile(file).warnings).toEqual([
      "Conflicting duplicate holding ignored for FAKE in Stock Investments on 2026-05-16",
    ]);
  });

  it("rejects noncanonical and nonfinite financial values at the boundary", () => {
    for (const value of ["NaN", "Infinity", "-0", "01", "1.0", "1e2", "0."]) {
      expect(canonicalDecimalSchema.safeParse(value).success).toBe(false);
    }
    expect(canonicalizeDecimal("-0.000")).toBe("0");
    expect(canonicalizeDecimal("+1.2500e2")).toBe("125");
    expect(parseSourceDecimal("(₹ 1,234.5600)")).toBe("-1234.56");
    expect(parseSourceDecimal(0.1)).toBeUndefined();
    expect(() => canonicalizeDecimal("1e999999999")).toThrow();
  });
});
