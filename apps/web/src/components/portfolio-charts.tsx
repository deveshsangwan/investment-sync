"use client";

import Link from "next/link";
import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { formatDate, formatInr, formatPercent, labelize } from "@/lib/format";
import { cn } from "@/lib/utils";

type ChartValue = string | number | null | undefined;
type TooltipNameType = string | number;

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

type TimelineChartPoint = {
  label: string;
  currentValue: number;
  investedAmount?: number;
};

type AllocationChartPoint = {
  assetClass: string;
  label: string;
  currentValue: number;
  weight?: number;
  color: string;
};

const allocationColors = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
];

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
  const gradientId = useId().replaceAll(":", "");
  const chartData: TimelineChartPoint[] = data.flatMap((point) => {
    const currentValue = numberValue(point.currentValue);
    if (currentValue === undefined) return [];
    return [
      {
        label: formatDate(point.snapshotDate),
        currentValue,
        investedAmount: numberValue(point.investedAmount),
      },
    ];
  });
  const hasInvested =
    showInvested &&
    chartData.some((point) => point.investedAmount !== undefined);

  return (
    <div
      className={cn("flex h-72 w-full flex-col", className)}
      role="img"
      aria-label={`${currentLabel}${hasInvested ? ` and ${investedLabel.toLowerCase()}` : ""} over time`}
    >
      <div
        className="mb-2 flex flex-wrap justify-end gap-4 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        <span className="inline-flex items-center gap-2">
          <span
            className="h-0.5 w-5"
            style={{ backgroundColor: "hsl(var(--chart-1))" }}
          />
          {currentLabel}
        </span>
        {hasInvested ? (
          <span className="inline-flex items-center gap-2">
            <span
              className="w-5 border-t-2 border-dashed"
              style={{ borderColor: "hsl(var(--chart-6))" }}
            />
            {investedLabel}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="hsl(var(--chart-1))"
                  stopOpacity={0.28}
                />
                <stop
                  offset="95%"
                  stopColor="hsl(var(--chart-1))"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="hsl(var(--border))"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              minTickGap={28}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={72}
              tickFormatter={compactInr}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ stroke: "hsl(var(--chart-1))", strokeOpacity: 0.22 }}
              content={(props) => (
                <TimelineTooltip
                  {...props}
                  currentLabel={currentLabel}
                  investedLabel={investedLabel}
                  hasInvested={hasInvested}
                />
              )}
            />
            <Area
              type="monotone"
              dataKey="currentValue"
              name={currentLabel}
              stroke="hsl(var(--chart-1))"
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
            {hasInvested ? (
              <Line
                type="monotone"
                dataKey="investedAmount"
                name={investedLabel}
                stroke="hsl(var(--chart-6))"
                strokeDasharray="5 5"
                strokeWidth={1.8}
                dot={false}
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function AllocationDonutChart({ data }: { data: AllocationPoint[] }) {
  const chartData: AllocationChartPoint[] = data.flatMap((item, index) => {
    const currentValue = numberValue(item.currentValue);
    if (currentValue === undefined || currentValue <= 0) return [];
    return [
      {
        assetClass: item.assetClass,
        label: labelize(item.assetClass),
        currentValue,
        weight: numberValue(item.weight),
        color:
          allocationColors[index % allocationColors.length] ??
          "hsl(var(--chart-1))",
      },
    ];
  });

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(160px,220px)_1fr] md:items-center">
      <div
        className="h-52 w-full"
        role="img"
        aria-label="Portfolio allocation by asset class"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="currentValue"
              nameKey="label"
              innerRadius="62%"
              outerRadius="86%"
              paddingAngle={2}
              stroke="hsl(var(--card))"
              strokeWidth={3}
            >
              {chartData.map((item) => (
                <Cell key={item.assetClass} fill={item.color} />
              ))}
            </Pie>
            <Tooltip content={(props) => <AllocationTooltip {...props} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-3">
        {chartData.map((item) => (
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

function TimelineTooltip({
  active,
  payload,
  label,
  currentLabel,
  investedLabel,
  hasInvested,
}: TooltipContentProps<TooltipValueType, TooltipNameType> & {
  currentLabel: string;
  investedLabel: string;
  hasInvested: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as TimelineChartPoint | undefined;
  if (!point) return null;

  return (
    <div className="rounded-lg border bg-card p-3 text-sm shadow-sm">
      <p className="number mb-2 font-semibold">{String(label ?? "")}</p>
      <TooltipRow label={currentLabel} value={formatInr(point.currentValue)} />
      {hasInvested && point.investedAmount !== undefined ? (
        <TooltipRow
          label={investedLabel}
          value={formatInr(point.investedAmount)}
        />
      ) : null}
    </div>
  );
}

function AllocationTooltip({
  active,
  payload,
}: TooltipContentProps<TooltipValueType, TooltipNameType>) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as AllocationChartPoint | undefined;
  if (!point) return null;

  return (
    <div className="rounded-lg border bg-card p-3 text-sm shadow-sm">
      <p className="font-semibold">{point.label}</p>
      <div className="mt-1 flex items-center justify-between gap-6 text-muted-foreground">
        <span className="number">{formatInr(point.currentValue)}</span>
        <span className="number">{formatPercent(point.weight)}</span>
      </div>
    </div>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className="number font-semibold">{value}</span>
    </div>
  );
}

function numberValue(value: ChartValue): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactInr(value: number): string {
  if (Math.abs(value) >= 10000000)
    return `Rs ${Math.round(value / 10000000)}Cr`;
  if (Math.abs(value) >= 100000) return `Rs ${Math.round(value / 100000)}L`;
  if (Math.abs(value) >= 1000) return `Rs ${Math.round(value / 1000)}k`;
  return `Rs ${Math.round(value)}`;
}
