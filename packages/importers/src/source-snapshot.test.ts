import { describe, expect, it } from "vitest";
import {
  adaptExactParseResultToLegacy,
  exactNormalizedImportRowSchema,
  parseExactImportFile,
  parseImportFile,
} from "./index";
import { vestedWorkbook } from "./vested-fixtures";

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
