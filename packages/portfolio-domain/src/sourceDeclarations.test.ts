import { describe, expect, it } from "vitest";
import {
  adaptLegacyRow,
  parseExactImportFile,
} from "@investment-sync/importers";
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

  it("values a genuinely empty first statement without requiring FX for synthetic zeroes", () => {
    const empty = report("2025-01-01", { holdings: [] });
    const views = valuePortfolioPublication(empty.projection);
    expect(views.overview.summary.currentValue).toBe(0);
    expect(views.overview.timeline.at(-1)?.currentValue).toBe(0);
    expect(views.assetClassDetails[0]?.summary.currentValue).toBe(0);
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

  it("uses the winning same-date report in both current totals and charts", () => {
    const first = report("2025-01-01");
    const empty = report("2025-01-01", { holdings: [] }, first.facts, 2);
    expect(empty.projection.totals).toEqual([]);
    expect(empty.projection.timeline).toMatchObject([
      { snapshotDate: "2025-01-01", totals: [{ currentValue: "0" }] },
    ]);
  });

  it("carries an independent account across a source liquidation and preserves reentry and out-of-order boundaries", () => {
    const first = report("2025-01-01");
    const other = first.facts.map((fact) => ({
      ...fact,
      row:
        fact.row.kind === "valuation"
          ? fact.row
          : { ...fact.row, provider: "Independent", accountName: "Other" },
      provenance: { ...fact.provenance, batchId: "other" },
    }));
    const empty = report(
      "2025-02-01",
      { holdings: [] },
      [...first.facts, ...other],
      2,
    );
    expect(empty.projection.totals[0]?.currentValue).toBe("120");
    expect(empty.projection.timeline.at(-1)?.totals[0]?.currentValue).toBe(
      "120",
    );
    const old = report("2024-12-01", {}, empty.facts, 3);
    expect(old.projection.totals[0]?.currentValue).toBe("120");
    const reentry = report("2025-03-01", {}, old.facts, 4);
    expect(reentry.projection.totals[0]?.currentValue).toBe("240");
    expect(reentry.projection.timeline.at(-1)?.totals[0]?.currentValue).toBe(
      "240",
    );
  });

  it("does not admit holdings belonging to a rejected lower-priority complete report", () => {
    const parsed = parseExactImportFile(vestedWorkbook());
    const high = buildPortfolioPublication({
      existingFacts: [],
      batch: {
        id: "high",
        sequence: 1,
        parserVersion: "test",
        fallbackDate: "2025-01-01",
        rows: parsed.rows.map((row) => {
          const ranked = structuredClone(row);
          ranked.source.priority = 100;
          return ranked;
        }),
      },
    });
    const low = parseExactImportFile(
      vestedWorkbook({ holdings: [["LOW", 1, 10, 12]] }),
    );
    const result = buildPortfolioPublication({
      existingFacts: high.facts,
      batch: {
        id: "low",
        sequence: 2,
        parserVersion: "test",
        fallbackDate: "2025-01-01",
        rows: low.rows,
      },
    });
    expect(result.projection.totals[0]?.currentValue).toBe("120");
    expect(
      result.projection.positions
        .filter((position) => position.status === "current")
        .map((position) => position.holding.row.symbol),
    ).toEqual(["FAKE"]);
    expect(result.projection.timeline.at(-1)?.totals[0]?.currentValue).toBe(
      "120",
    );
  });

  it("uses the observation order independently of retained SQL holding creation order", () => {
    const first = report("2025-01-01");
    const empty = report("2025-01-01", { holdings: [] }, first.facts, 2);
    const corrected = first.facts.map((fact) => ({
      ...fact,
      provenance: {
        ...fact.provenance,
        batchId: "corrected",
        sourceSequence: 3,
      },
    }));
    const result = buildPortfolioPublication({
      existingFacts: [...empty.facts, ...corrected],
    });
    expect(result.projection.totals[0]?.currentValue).toBe("120");
  });

  it("retains prior explicit valuation history and records later source boundaries without inventing valuation facts", () => {
    const first = report("2025-01-01");
    const prior: PortfolioFact = {
      row: adaptLegacyRow({
        kind: "valuation",
        sourceType: "investment_portfolio_xlsx",
        valuationDate: "2024-12-01",
        investedAmount: 100,
        currentValue: 120,
        currency: "USD",
        metadata: {},
      }),
      provenance: {
        batchId: "valuation",
        parserVersion: "test",
        sequence: 0,
        rowNumber: 1,
        fallbackDate: "2024-12-01",
      },
    };
    const empty = report(
      "2025-02-01",
      { holdings: [] },
      [prior, ...first.facts],
      2,
    );
    expect(
      empty.projection.timeline.map((point) => point.snapshotDate),
    ).toEqual(["2024-12-01", "2025-01-01", "2025-02-01"]);
    expect(empty.projection.timeline.at(-1)?.totals[0]?.currentValue).toBe("0");
    expect(empty.projection.valuations).toHaveLength(1);
  });

  it("preserves historical points before the first retained declaration", () => {
    const legacy = report("2025-01-01").facts.filter(
      (fact) => fact.row.kind !== "source_snapshot",
    );
    const empty = report("2025-02-01", { holdings: [] }, legacy, 2);
    expect(
      empty.projection.timeline.map((point) => point.snapshotDate),
    ).toEqual(["2025-01-01", "2025-02-01"]);
    expect(empty.projection.timeline[0]?.totals[0]?.currentValue).toBe("120");
    expect(empty.projection.timeline[1]?.totals[0]?.currentValue).toBe("0");
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
