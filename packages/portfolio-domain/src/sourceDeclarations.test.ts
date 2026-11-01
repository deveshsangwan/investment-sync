import { describe, expect, it } from "vitest";
import { parseExactImportFile } from "@investment-sync/importers";
import { vestedWorkbook } from "../../importers/src/vested-fixtures";
import {
  buildPortfolioPublication,
  valuePortfolioPublication,
  type PortfolioFact,
} from "./index";

function report(
  date: string,
  options: Parameters<typeof vestedWorkbook>[0] = {},
  existingFacts: PortfolioFact[] = [],
  sequence = 1,
) {
  const parsed = parseExactImportFile(vestedWorkbook(options));
  return buildPortfolioPublication({
    existingFacts,
    batch: {
      id: `report-${sequence}`,
      parserVersion: parsed.parserVersion,
      sequence,
      fallbackDate: date,
      rows: parsed.rows,
    },
  });
}
const sale = ["FAKE", "2025-02-01", "2024-01-01", "10", "150", "100", "50"];

describe("complete source snapshot declarations", () => {
  it("closes the sole position from a valid empty report while retaining reported sale lots and holding history", () => {
    const first = report("2025-01-01");
    const second = report(
      "2025-02-02",
      {
        holdings: [],
        sales: [sale],
        summary: [["FAKE", "10", "150", "100", "50"]],
      },
      first.facts,
      2,
    );
    expect(
      second.projection.positions.filter(
        (position) => position.status === "current",
      ),
    ).toEqual([]);
    expect(second.projection.positions[0]?.status).toBe("exited");
    expect(second.projection.positions[0]?.history).toHaveLength(1);
    expect(second.projection.asOfDate).toBe("2025-02-02");
    expect(second.projection.timeline.at(-1)).toMatchObject({
      snapshotDate: "2025-02-02",
      totals: [{ currency: "USD", currentValue: "0" }],
    });
    const detail = valuePortfolioPublication(
      second.projection,
      {
        status: "fresh",
        rate: "80",
        provider: "frankfurter",
        fetchedAt: "2025-02-02T00:00:00Z",
      },
      {
        view: "holdingDetail",
        positionKey: second.projection.positions[0]?.positionKey ?? "",
      },
    );
    expect(detail?.sales[0]).toMatchObject({
      saleDate: "2025-02-01",
      proceeds: "150",
      costBasis: "100",
      realizedPnl: "50",
    });
  });

  it("retains a meaningful empty declaration without inventing holdings, transactions or valuations", () => {
    const first = report("2025-01-01");
    const second = report("2025-02-02", { holdings: [] }, first.facts, 2);
    expect(
      second.facts
        .filter((fact) => fact.provenance.batchId === "report-2")
        .map((fact) => fact.row.kind),
    ).toEqual(["source_snapshot"]);
    expect(
      second.projection.positions.filter(
        (position) => position.status === "current",
      ),
    ).toEqual([]);
    expect(second.projection.positions[0]?.transactions).toEqual([]);
    expect(second.projection.hasExplicitValuations).toBe(false);
  });

  it("keeps a partial-sale remainder current and never treats sales alone as completeness evidence", () => {
    const first = report("2025-01-01");
    const partial = report(
      "2025-02-02",
      {
        holdings: [["FAKE", "8", "80", "96", "16"]],
        sales: [["FAKE", "2025-02-01", "2024-01-01", "2", "30", "20", "10"]],
      },
      first.facts,
      2,
    );
    expect(partial.projection.positions[0]?.status).toBe("current");
    expect(partial.projection.totals[0]?.currentValue).toBe("96");
    const onlySales = parseExactImportFile(
      vestedWorkbook({ holdings: [], sales: [sale] }),
    ).rows.filter((row) => row.kind === "transaction");
    const withoutEvidence = buildPortfolioPublication({
      existingFacts: first.facts,
      batch: {
        id: "sales-only",
        parserVersion: "test",
        sequence: 2,
        fallbackDate: "2025-02-02",
        rows: onlySales,
      },
    });
    expect(withoutEvidence.projection.positions[0]?.status).toBe("current");
    expect(withoutEvidence.projection.totals[0]?.currentValue).toBe("120");
  });

  it.each([
    { holdings: [["Total", "10", "100", "120", "20"]] },
    { holdings: [["", "10", "100", "120", "20"]] },
    { holdings: [["Partial report"]] },
  ])(
    "rejects apparent empty reports containing nonzero totals or incomplete rows: %j",
    ({ holdings }) => {
      expect(() =>
        parseExactImportFile(vestedWorkbook({ holdings })),
      ).toThrow();
    },
  );
});
