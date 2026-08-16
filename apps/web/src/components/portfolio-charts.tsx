"use client";

import Link from "next/link";
import { useMemo } from "react";
import { areaY, defineChart, lineY } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { formatDate, formatInr, formatPercent, labelize } from "../lib/format";
import { cn } from "../lib/utils";

type ChartValue = string | number | null | undefined;

type TimelinePoint = {
  snapshotDate: string | Date;
  currentValue: ChartValue;
  investedAmount?: ChartValue;
};

type AllocationPoint = {
  assetClass: string;
  currentValue: ChartValue;
  weight: ChartValue;
};

/** One timeline datum that survived filtering, keyed by its snapshot date. */
export type TimelineRow = {
  key: string;
  label: string;
  currentValue: number;
  investedAmount?: number;
  origin: TimelinePoint;
};

/** One allocation slice that survived filtering, keyed by its asset class. */
export type AllocationRow = {
  assetClass: string;
  label: string;
  currentValue: number;
  weight?: number;
  color: string;
  origin: AllocationPoint;
};

const currentColor = "hsl(var(--chart-1))";
const investedColor = "hsl(var(--chart-6))";

const allocationColors = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
];

// 264px surface plus the 24px legend row is the original 288px footprint.
const timelineChartHeight = 264;
const allocationChartHeight = 208;
// Recharts drew a 2 degree wedge gap; radians here.
const allocationGapAngle = (2 * Math.PI) / 180;

export function PortfolioTimelineChart({
  data,
  className,
  currentLabel = "Current value",
  investedLabel = "Invested",
  showInvested = true,
}: {
  data: TimelinePoint[];
  className?: string;
  currentLabel?: string;
  investedLabel?: string;
  showInvested?: boolean;
}) {
  const rows = useMemo(() => prepareTimeline(data), [data]);
  const hasInvested =
    showInvested && rows.some((row) => row.investedAmount !== undefined);

  const definition = useMemo(
    () =>
      buildTimelineDefinition(rows, {
        currentLabel,
        investedLabel,
        hasInvested,
      }),
    [rows, hasInvested, currentLabel, investedLabel],
  );

  return (
    <div className={cn("flex w-full flex-col", className)}>
      <div
        className="mb-2 flex flex-wrap justify-end gap-4 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        <span className="inline-flex items-center gap-2">
          <span
            className="h-0.5 w-5"
            style={{ backgroundColor: currentColor }}
          />
          {currentLabel}
        </span>
        {hasInvested ? (
          <span className="inline-flex items-center gap-2">
            <span
              className="w-5 border-t-2 border-dashed"
              style={{ borderColor: investedColor }}
            />
            {investedLabel}
          </span>
        ) : null}
      </div>
      <Chart
        definition={definition}
        height={timelineChartHeight}
        ariaLabel={`${currentLabel}${hasInvested ? ` and ${investedLabel.toLowerCase()}` : ""} over time`}
      />
    </div>
  );
}

export function AllocationDonutChart({ data }: { data: AllocationPoint[] }) {
  const rows = useMemo(() => prepareAllocation(data), [data]);

  const definition = useMemo(() => buildAllocationDefinition(rows), [rows]);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(160px,220px)_1fr] md:items-center">
      <Chart
        definition={definition}
        height={allocationChartHeight}
        className="w-full"
        ariaLabel="Portfolio allocation by asset class"
      />
      <div className="space-y-3">
        {rows.map((item) => (
          <Link
            key={item.assetClass}
            href={`/dashboard/asset-class/${encodeURIComponent(item.assetClass)}`}
            className="group -mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold group-hover:text-primary">
                {item.label}
              </p>
              <p className="number text-xs text-muted-foreground">
                {formatInr(item.currentValue)}
              </p>
            </div>
            <p className="number text-sm font-semibold">
              {formatPercent(item.weight)}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Drops points with no usable current value, keeping input order and lineage. */
export function prepareTimeline(data: TimelinePoint[]): TimelineRow[] {
  return data.flatMap((point) => {
    const currentValue = numberValue(point.currentValue);
    if (currentValue === undefined) return [];
    return [
      {
        key: timelineKey(point.snapshotDate),
        label: formatDate(point.snapshotDate),
        currentValue,
        investedAmount: numberValue(point.investedAmount),
        origin: point,
      },
    ];
  });
}

/** Drops slices with no positive current value, keeping input order and lineage. */
export function prepareAllocation(data: AllocationPoint[]): AllocationRow[] {
  return data.flatMap((item, index) => {
    const currentValue = numberValue(item.currentValue);
    if (currentValue === undefined || currentValue <= 0) return [];
    return [
      {
        assetClass: item.assetClass,
        label: labelize(item.assetClass),
        currentValue,
        weight: numberValue(item.weight),
        // Keyed to the source index so filtering cannot shift palette colors.
        color:
          allocationColors[index % allocationColors.length] ?? currentColor,
        origin: item,
      },
    ];
  });
}

/** Complete timeline definition; memoize it against exactly these arguments. */
export function buildTimelineDefinition(
  rows: TimelineRow[],
  {
    currentLabel,
    investedLabel,
    hasInvested,
  }: { currentLabel: string; investedLabel: string; hasInvested: boolean },
) {
  // Empty invested rows render no second series; populated rows keep null gaps.
  const investedRows = hasInvested ? rows : [];
  return defineChart({
    marks: [
      decorative(
        areaY(rows, {
          x: "label",
          y: "currentValue",
          key: "key",
          color: () => currentLabel,
          fill: "url(#timeline-area)",
          fillOpacity: 1,
        }),
      ),
      lineY(rows, {
        x: "label",
        y: "currentValue",
        key: "key",
        color: () => currentLabel,
        strokeWidth: 2.5,
      }),
      lineY(investedRows, {
        x: "label",
        y: "investedAmount",
        key: "key",
        color: () => investedLabel,
        strokeWidth: 1.8,
        strokeDasharray: "5 5",
      }),
    ],
    x: {
      scale: () => scalePoint<string>(),
      axis: { line: false, ticks: { size: 0 }, tickLabels: { thin: true } },
    },
    y: {
      scale: scaleLinear,
      nice: true,
      grid: true,
      axis: { line: false, ticks: { size: 0, format: compactInr } },
    },
    color: {
      domain: [currentLabel, investedLabel],
      range: [currentColor, investedColor],
    },
    gradients: [
      {
        id: "timeline-area",
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 1,
        stops: [
          { offset: 0.05, color: currentColor, opacity: 0.28 },
          { offset: 0.95, color: currentColor, opacity: 0.02 },
        ],
      },
    ],
    focus: "group-x",
    tooltip: {
      use: tooltip,
      items: [
        "x",
        { channel: "y", text: (point) => formatInr(point.yValue) },
        "group",
      ],
    },
  });
}

/** Complete donut definition; memoize it against exactly these rows. */
export function buildAllocationDefinition(rows: AllocationRow[]) {
  const slices = pie(rows, {
    value: "currentValue",
    gapAngle: allocationGapAngle,
  });
  return defineChart({
    marks: [
      polar({
        inset: 4,
        radiusRatio: 0.86,
        marks: [
          radialArc(slices, {
            key: "assetClass",
            // `z` is what populates point.group; without it the tooltip drops
            // its automatic asset-class title even though color is set.
            z: "label",
            color: "label",
            // 62% / 86% of the Recharts outer radius.
            innerRadius: ({ radius }) => radius * 0.72,
            stroke: "hsl(var(--card))",
            strokeWidth: 3,
          }),
        ],
      }),
    ],
    color: {
      domain: rows.map((row) => row.label),
      range: rows.map((row) => row.color),
    },
    tooltip: {
      use: tooltip,
      items: [
        { id: "value", text: (point) => formatInr(point.datum.currentValue) },
        { id: "weight", text: (point) => formatPercent(point.datum.weight) },
      ],
    },
  });
}

/** Stable across filtering because it never reads a filtered-array index. */
function timelineKey(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function numberValue(value: ChartValue): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function compactInr(value: number): string {
  if (Math.abs(value) >= 10000000)
    return `Rs ${Math.round(value / 10000000)}Cr`;
  if (Math.abs(value) >= 100000) return `Rs ${Math.round(value / 100000)}L`;
  if (Math.abs(value) >= 1000) return `Rs ${Math.round(value / 1000)}k`;
  return `Rs ${Math.round(value)}`;
}
