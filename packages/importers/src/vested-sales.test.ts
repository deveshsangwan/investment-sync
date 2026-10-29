import { vestedWorkbook } from "./vested-fixtures";
import { describe, expect, it } from "vitest";
import { parseExactImportFile, parseImportFile } from "./index";

const lots = [
  [
    "FAKE",
    "2025-03-10",
    "2024-01-01",
    "1.25",
    "25.125",
    "10.0625",
    "15.0625",
    "sale-1",
    "lot-1",
  ],
  [
    "FAKE",
    "2025-03-10",
    "2024-02-01",
    "0.75",
    "15.075",
    "9.0375",
    "6.0375",
    "sale-1",
    "lot-2",
  ],
];
const totals = [
  ["FAKE", "2", "40.2", "19.1", "21.1"],
  ["Total", "2", "40.2", "19.1", "21.1"],
];

describe("Vested realized lots", () => {
  it("imports breakdown once and reconciles summary with exact reported lot values", () => {
    const file = vestedWorkbook({ sales: lots, summary: totals });
    const result = parseExactImportFile(file);
    expect(result.parserVersion).toBe("vested-drivewealth-v2-decimal-v1");
    expect(result.warnings).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1]).toMatchObject({
      kind: "transaction",
      tradeDate: "2025-03-10",
      amount: "25.125",
      quantity: "1.25",
      metadata: {
        realizedSale: {
          acquisitionDate: "2024-01-01",
          costBasis: "10.0625",
          realizedPnl: "15.0625",
          executionId: "sale-1",
          lotId: "lot-1",
        },
      },
    });
    expect(parseImportFile(file).rows[1]).toMatchObject({
      amount: 25.125,
      metadata: { realizedSale: { costBasis: "10.0625" } },
    });
  });

  it("keeps unrealized-only exports compatible", () => {
    expect(parseExactImportFile(vestedWorkbook()).rows).toHaveLength(1);
    expect(parseExactImportFile(vestedWorkbook()).warnings).toEqual([]);
  });

  it("warns when summary reconciliation is unavailable", () => {
    expect(
      parseExactImportFile(vestedWorkbook({ sales: lots })).warnings,
    ).toEqual([
      "Vested realized summary is absent; sale totals could not be reconciled.",
    ]);
  });

  it("rejects mismatched or summary-only nonzero sales", () => {
    expect(() =>
      parseExactImportFile(
        vestedWorkbook({
          sales: lots,
          summary: [["FAKE", 2, 400, 19.1, 21.1]],
        }),
      ),
    ).toThrow(/does not reconcile/);
    expect(() =>
      parseExactImportFile(vestedWorkbook({ summary: totals })),
    ).toThrow(/does not reconcile/);
    expect(
      parseExactImportFile(vestedWorkbook({ summary: [["Total", 0, 0, 0, 0]] }))
        .rows,
    ).toHaveLength(1);
  });

  it.each([3, 4, 5, 6])(
    "rejects missing required realized money or quantity in column %s",
    (column) => {
      const sale = [...(lots[0] ?? [])];
      sale[column] = "";
      expect(() =>
        parseExactImportFile(vestedWorkbook({ sales: [sale] })),
      ).toThrow(/missing or has invalid/);
    },
  );

  it("rejects invalid sale and acquisition dates", () => {
    for (const column of [1, 2]) {
      const sale = [...(lots[0] ?? [])];
      sale[column] = "bad date";
      expect(() =>
        parseExactImportFile(vestedWorkbook({ sales: [sale] })),
      ).toThrow(/Invalid Vested/);
    }
  });
});
