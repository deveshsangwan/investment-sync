import * as XLSX from "xlsx";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  adaptExactParseResultToLegacy,
  exactNormalizedImportRowSchema,
  parseExactImportFile,
  parseImportFile,
} from "./index";
import { vestedWorkbook } from "./vested-fixtures";

function writeWorkbook(workbook: XLSX.WorkBook) {
  const content: unknown = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });
  if (!Buffer.isBuffer(content)) throw new Error("Expected workbook bytes");

  return content;
}

describe("instrument-free complete Vested snapshots", () => {
  it.each([
    { holdings: [] },
    { holdings: [["Total", "0", "$0.00", "0", "0"]] },
  ])("retains genuine empty evidence: %j", ({ holdings }) => {
    const file = vestedWorkbook({ holdings });
    const exact = parseExactImportFile(file);
    expect(exact.rows).toHaveLength(1);
    expect(exact.rows[0]).toMatchObject({
      kind: "source_snapshot",
      completeness: "complete",
      sourceGroup: "",
      currency: "USD",
      source: {
        group: "",
        completeness: "complete",
        granularity: "instrument",
      },
      numericProvenance: {},
    });
    expect(exact.rows[0]).not.toHaveProperty("instrumentName");
    expect(exact.rows[0]).not.toHaveProperty("currentValue");
    expect(adaptExactParseResultToLegacy(exact).rows).toEqual(
      parseImportFile(file).rows,
    );
  });

  it.each(
    [
      [["Total", 0, "0.00000001", "0"]],
      [["Total", 0, "0", "0.00000001"]],
      [["Total", 0, "0", "0", "1"]],
      [["Total", "", "", ""]],
      [["", 0, 0, 0]],
    ].map((holdings) => ({ holdings })),
  )("rejects apparent empty data %j", ({ holdings }) => {
    expect(() => parseExactImportFile(vestedWorkbook({ holdings }))).toThrow();
  });

  it("rejects incomplete totals instead of creating authoritative omission evidence", () => {
    expect(() =>
      parseExactImportFile(
        vestedWorkbook({
          holdings: [
            ["FAKE", 1, 10, 12],
            ["Total", 2, 20, 24],
          ],
        }),
      ),
    ).toThrow(/does not reconcile/);
    expect(
      parseExactImportFile(
        vestedWorkbook({
          holdings: [
            ["FAKE", 1, "9007199254740993.01", "9007199254740993.02"],
            ["Total", 1, "9007199254740993.01", "9007199254740993.02"],
          ],
        }),
      ).rows,
    ).toHaveLength(2);
  });

  it("rejects spreadsheet errors before blank-row filtering", () => {
    const workbook = XLSX.read(vestedWorkbook({ holdings: [] }).content);
    const sheet = workbook.Sheets["Unrealized P&L - Summary "];
    if (!sheet) throw new Error("Missing fixture sheet");
    for (const address of ["A2", "B2", "C2", "D2"])
      sheet[address] = { t: "e", v: 23 };
    sheet["!ref"] = "A1:E2";
    expect(() =>
      parseExactImportFile({
        fileName: "errors.xlsx",
        content: writeWorkbook(workbook),
      }),
    ).toThrow(/spreadsheet error/);
  });

  it.each(["A2", "B2", "C2", "D2"])(
    "rejects uncached formulas in %s before they disappear into blank cells",
    (address) => {
      const workbook = XLSX.read(vestedWorkbook({ holdings: [] }).content);
      const sheet = workbook.Sheets["Unrealized P&L - Summary "];
      if (!sheet) throw new Error("Missing fixture sheet");
      sheet[address] = { t: "n", f: "1/0" };
      sheet["!ref"] = "A1:E2";
      expect(() =>
        parseExactImportFile({
          fileName: "uncached.xlsx",
          content: writeWorkbook(workbook),
        }),
      ).toThrow(/unresolved spreadsheet formula/);
    },
  );

  it("preserves valid cached formula zeroes", () => {
    const workbook = XLSX.read(
      vestedWorkbook({ holdings: [["FAKE", 0, 0, 0, 0]] }).content,
    );
    const sheet = workbook.Sheets["Unrealized P&L - Summary "];
    if (!sheet) throw new Error("Missing fixture sheet");
    for (const address of ["B2", "C2", "D2"])
      sheet[address] = { t: "n", f: "1-1", v: 0 };
    expect(
      parseExactImportFile({
        fileName: "cached-zero.xlsx",
        content: writeWorkbook(workbook),
      }).rows[0],
    ).toMatchObject({
      kind: "holding",
      investedAmount: "0",
      currentValue: "0",
    });
  });

  it.each(["A1:E1", "A2:E2", "A1:B2"])(
    "rejects XLSX dimensions %s that hide retained worksheet cells",
    (dimension) => {
      const file = vestedWorkbook();
      // XLSX exposes the ZIP helper as untyped; validate its external contract.
      const library: unknown = XLSX.CFB;
      const cfb = z
        .object({
          read: z
            .function()
            .args(z.unknown(), z.unknown())
            .returns(z.unknown()),
          find: z.function().args(z.unknown(), z.string()).returns(z.unknown()),
          write: z
            .function()
            .args(z.unknown(), z.unknown())
            .returns(z.unknown()),
        })
        .parse(library);
      const archive = cfb.read(file.content, { type: "buffer" });
      const entry = cfb.find(archive, "/xl/worksheets/sheet1.xml");
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("content" in entry) ||
        !(entry.content instanceof Uint8Array)
      )
        throw new Error("Missing generated worksheet XML");

      const xml = Buffer.from(entry.content).toString("utf8");
      expect(xml).toContain('<dimension ref="A1:E2"');
      entry.content = Buffer.from(
        xml.replace('<dimension ref="A1:E2"', `<dimension ref="${dimension}"`),
      );
      const content = cfb.write(archive, {
        fileType: "zip",
        type: "buffer",
      });
      if (!Buffer.isBuffer(content))
        throw new Error("Expected modified workbook bytes");

      expect(() =>
        parseExactImportFile({ fileName: "truncated-dimension.xlsx", content }),
      ).toThrow(/outside worksheet dimensions/);
    },
  );

  it("rejects ambiguous trimmed evidence sheets", () => {
    const workbook = XLSX.read(vestedWorkbook().content);
    const empty = XLSX.read(vestedWorkbook({ holdings: [] }).content).Sheets[
      "Unrealized P&L - Summary "
    ];
    if (!empty) throw new Error("Missing fixture sheet");
    XLSX.utils.book_append_sheet(workbook, empty, "Unrealized P&L - Summary");
    expect(() =>
      parseExactImportFile({
        fileName: "ambiguous.xlsx",
        content: writeWorkbook(workbook),
      }),
    ).toThrow(/ambiguous/);
  });

  it("validates declaration scope and rejects partial completeness at the exact boundary", () => {
    const row = parseExactImportFile(vestedWorkbook({ holdings: [] })).rows[0];
    if (!row || row.kind !== "source_snapshot")
      throw new Error("Missing declaration");
    expect(
      exactNormalizedImportRowSchema.safeParse({
        ...row,
        source: { ...row.source, group: "other" },
      }).success,
    ).toBe(false);
    expect(
      exactNormalizedImportRowSchema.safeParse({
        ...row,
        completeness: "partial",
      }).success,
    ).toBe(false);
  });
});
