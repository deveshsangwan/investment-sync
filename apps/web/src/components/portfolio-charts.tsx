"use client";

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
import { formatDate, formatInr, labelize } from "@/lib/format";
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
  weight: number;
  color: string;
};

const allocationColors = [
  "hsl(var(--primary))",
  "hsl(199 89% 48%)",
  "hsl(262 83% 58%)",
  "hsl(38 92% 50%)",
  "hsl(142 71% 45%)",
  "hsl(346 77% 49%)",
  "hsl(217 91% 60%)",
  "hsl(24 95% 53%)",
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
  const chartData = data
    .map((point) => ({
      label: formatDate(point.snapshotDate),
      currentValue: numberValue(point.currentValue),
      investedAmount: numberValue(point.investedAmount),
    }))
    .filter((point) => Number.isFinite(point.currentValue));
  const hasInvested =
    showInvested &&
    chartData.some((point) => Number.isFinite(point.investedAmount));

  return (
    <div className={cn("h-72 w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="hsl(var(--primary))"
                stopOpacity={0.28}
              />
              <stop
                offset="95%"
                stopColor="hsl(var(--primary))"
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
            cursor={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.22 }}
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
            stroke="hsl(var(--primary))"
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
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              strokeWidth={1.8}
              dot={false}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AllocationDonutChart({ data }: { data: AllocationPoint[] }) {
  const chartData: AllocationChartPoint[] = data
    .map((item, index) => ({
      assetClass: item.assetClass,
      label: labelize(item.assetClass),
      currentValue: numberValue(item.currentValue),
      weight: numberValue(item.weight),
      color:
        allocationColors[index % allocationColors.length] ??
        "hsl(var(--primary))",
    }))
    .filter((item) => item.currentValue > 0);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(160px,220px)_1fr] md:items-center">
      <div className="h-52 w-full">
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
          <div
            key={item.assetClass}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
          >
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{item.label}</p>
              <p className="text-xs text-muted-foreground">
                {formatInr(item.currentValue)}
              </p>
            </div>
            <p className="text-sm font-semibold">{item.weight}%</p>
          </div>
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
      <p className="mb-2 font-semibold">{String(label ?? "")}</p>
      <TooltipRow label={currentLabel} value={formatInr(point.currentValue)} />
      {hasInvested && Number.isFinite(point.investedAmount) ? (
        <TooltipRow
          label={investedLabel}
          value={formatInr(point.investedAmount ?? 0)}
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
      <p className="mt-1 text-muted-foreground">
        {formatInr(point.currentValue)} · {point.weight}%
      </p>
    </div>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function numberValue(value: ChartValue): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactInr(value: number): string {
  if (Math.abs(value) >= 10000000)
    return `Rs ${Math.round(value / 10000000)}Cr`;
  if (Math.abs(value) >= 100000) return `Rs ${Math.round(value / 100000)}L`;
  if (Math.abs(value) >= 1000) return `Rs ${Math.round(value / 1000)}k`;
  return `Rs ${Math.round(value)}`;
}
