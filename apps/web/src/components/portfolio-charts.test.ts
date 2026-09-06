import { createChartScene, renderChartSvg } from "@tanstack/charts";
import { describe, expect, it } from "vitest";
import {
  buildAllocationDefinition,
  buildTimelineDefinition,
  compactInr,
  prepareAllocation,
  prepareTimeline,
  timelineOutcomeColor,
} from "./portfolio-charts";

const timelineInput = [
  { snapshotDate: "2026-01-31", currentValue: "1200", investedAmount: "1000" },
  { snapshotDate: "2026-02-28", currentValue: null, investedAmount: "1100" },
  { snapshotDate: "2026-03-31", currentValue: 1400, investedAmount: "" },
  { snapshotDate: "2026-04-30", currentValue: "oops", investedAmount: 1200 },
  { snapshotDate: "2026-05-31", currentValue: 1600, investedAmount: 1300 },
];

const allocationInput = [
  { assetClass: "mutual_fund", currentValue: "5000", weight: "50" },
  { assetClass: "us_equity", currentValue: 0, weight: "0" },
  { assetClass: "fixed_deposit", currentValue: "3000", weight: 30 },
  { assetClass: "gold", currentValue: -100, weight: 5 },
  { assetClass: "nps", currentValue: "2000", weight: null },
];

describe("timeline preparation", () => {
  const rows = prepareTimeline(timelineInput);

  it("drops only unusable current values and keeps input order", () => {
    expect(rows.map((row) => row.currentValue)).toEqual([1200, 1400, 1600]);
  });

  it("keys rows by snapshot date rather than filtered position", () => {
    // 1400 is index 2 of the input but index 1 after filtering.
    expect(rows[1]?.key).toBe("2026-03-31");
    expect(rows.map((row) => row.key)).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ]);
  });

  it("keeps source lineage and per-row invested semantics", () => {
    expect(rows[0]?.origin).toBe(timelineInput[0]);
    expect(rows.map((row) => row.investedAmount)).toEqual([
      1000,
      undefined,
      1300,
    ]);
  });

  it("derives a stable key from Date inputs too", () => {
    const date = new Date("2026-06-30T00:00:00.000Z");
    const [row] = prepareTimeline([{ snapshotDate: date, currentValue: 1 }]);
    expect(row?.key).toBe("2026-06-30T00:00:00.000Z");
  });
});

describe("allocation preparation", () => {
  const rows = prepareAllocation(allocationInput);

  it("drops non-positive and invalid values, preserving order and labels", () => {
    expect(rows.map((row) => row.assetClass)).toEqual([
      "mutual_fund",
      "fixed_deposit",
      "nps",
    ]);
    expect(rows[0]?.label).toBe("Mutual funds");
  });

  it("keeps weight and source lineage", () => {
    expect(rows.map((row) => row.weight)).toEqual([50, 30, undefined]);
    expect(rows[2]?.origin).toBe(allocationInput[4]);
  });

  it("colors each slice by its source index, not its filtered position", () => {
    // us_equity (index 1) and gold (index 3) are filtered out, so fixed_deposit
    // stays on chart-3 and nps on chart-5 rather than sliding to chart-2/3.
    expect(rows.map((row) => row.color)).toEqual([
      "hsl(var(--chart-1))",
      "hsl(var(--chart-3))",
      "hsl(var(--chart-5))",
    ]);
  });
});

describe("compact INR axis ticks", () => {
  it("scales across the Indian numbering thresholds", () => {
    expect(compactInr(940)).toBe("Rs 940");
    expect(compactInr(12000)).toBe("Rs 12k");
    expect(compactInr(250000)).toBe("Rs 3L");
    expect(compactInr(-30000000)).toBe("Rs -3Cr");
  });
});

describe("DOM-free chart scenes", () => {
  it("renders finite timeline geometry and an accessible name", () => {
    const rows = prepareTimeline(timelineInput);
    const definition = buildTimelineDefinition(rows, {
      currentLabel: "Current value",
      investedLabel: "Invested",
      hasInvested: true,
    });
    const scene = createChartScene(definition, { width: 640, height: 264 });

    // One point per row on the current series, plus one per row that actually
    // has an invested value. The filled area is decorative and owns no points.
    const invested = rows.filter((row) => row.investedAmount !== undefined);
    expect(invested).toHaveLength(2);
    expect(scene.points).toHaveLength(rows.length + invested.length);
    for (const point of scene.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }

    const svg = renderChartSvg(scene, { ariaLabel: "Current value over time" });
    expect(svg).toContain('aria-label="Current value over time"');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it("renders one finite donut arc per surviving slice", () => {
    const rows = prepareAllocation(allocationInput);
    const scene = createChartScene(buildAllocationDefinition(rows), {
      width: 208,
      height: 208,
    });

    expect(scene.points).toHaveLength(rows.length);
    // A null group would cost the tooltip its automatic asset-class title.
    expect(scene.points.map((point) => point.group)).toEqual(
      rows.map((row) => row.label),
    );
    const svg = renderChartSvg(scene, { ariaLabel: "Portfolio allocation" });
    expect(svg).toContain('aria-label="Portfolio allocation"');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

describe("timeline outcome color", () => {
  it("uses invested capital, even when portfolio value has risen", () => {
    const rows = prepareTimeline([
      { snapshotDate: "2026-01-01", currentValue: 100, investedAmount: 90 },
      { snapshotDate: "2026-02-01", currentValue: 200, investedAmount: 220 },
    ]);
    expect(timelineOutcomeColor(rows)).toBe("hsl(var(--negative))");
  });

  it("uses the latest dated snapshot even when input is unordered", () => {
    const rows = prepareTimeline([
      { snapshotDate: "2026-02-01", currentValue: 200, investedAmount: 180 },
      { snapshotDate: "2026-01-01", currentValue: 100, investedAmount: 110 },
    ]);
    expect(timelineOutcomeColor(rows)).toBe("hsl(var(--positive))");
  });

  it.each([undefined, 200])(
    "stays neutral for missing capital or equal values",
    (investedAmount) => {
      expect(
        timelineOutcomeColor(
          prepareTimeline([
            { snapshotDate: "2026-02-01", currentValue: 200, investedAmount },
          ]),
        ),
      ).toBe("hsl(var(--chart-1))");
    },
  );
});
