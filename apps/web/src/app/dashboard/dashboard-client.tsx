"use client";

import Link from "next/link";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Database,
  Minus,
  PieChart,
  TrendingUp,
  UploadCloud,
} from "lucide-react";
import { EmptyPortfolio, SetupRequired } from "@/components/dashboard-states";
import {
  AllocationDonutChart,
  PortfolioTimelineChart,
} from "@/components/portfolio-charts";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  PortfolioContentSkeleton,
  QualityBadge,
  SectionCard,
} from "@/components/portfolio-ui";
import { Button } from "@/components/ui/button";
import {
  formatDate,
  formatInr,
  formatPercent,
  labelize,
  qualityLabel,
  sourceLabel,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { trpc } from "../providers";

export function DashboardClient({
  isDataConfigured,
}: {
  isDataConfigured: boolean;
}) {
  const overview = trpc.portfolio.overview.useQuery(undefined, {
    enabled: isDataConfigured,
  });
  const importHistory = trpc.imports.list.useQuery(undefined, {
    enabled: isDataConfigured,
  });

  if (!isDataConfigured) {
    return (
      <PageShell>
        <DashboardHeader />
        <SetupRequired />
      </PageShell>
    );
  }

  if (overview.isError) {
    return (
      <PageShell>
        <DashboardHeader />
        <ErrorState
          title="Portfolio overview is unavailable"
          description="We could not load your latest portfolio data. Your saved holdings have not changed."
          onRetry={() => void overview.refetch()}
        />
      </PageShell>
    );
  }

  if (overview.isLoading || !overview.data) {
    return (
      <PageShell>
        <DashboardHeader />
        <PortfolioContentSkeleton />
      </PageShell>
    );
  }

  const { holdings, performance, summary, timeline } = overview.data;

  if (holdings.length === 0) {
    return (
      <PageShell>
        <DashboardHeader />
        <EmptyPortfolio />
      </PageShell>
    );
  }

  const latestSnapshotDate = holdings.reduce<string | null>(
    (latest, holding) =>
      !latest || holding.snapshotDate > latest ? holding.snapshotDate : latest,
    null,
  );
  const latestCommittedImport = importHistory.data
    ? [...importHistory.data]
        .filter((batch) => batch.committedAt)
        .sort(
          (left, right) =>
            (right.committedAt?.getTime() ?? 0) -
            (left.committedAt?.getTime() ?? 0),
        )[0]
    : undefined;
  const topHoldings = [...holdings]
    .sort((left, right) => right.currentValueInInr - left.currentValueInInr)
    .slice(0, 5);
  const pnlDirection =
    summary.pnlAmount > 0 ? "gain" : summary.pnlAmount < 0 ? "loss" : "flat";
  const absoluteReturnTone =
    performance.absoluteReturnPercent > 0
      ? "positive"
      : performance.absoluteReturnPercent < 0
        ? "negative"
        : undefined;
  const hasUsableXirr =
    performance.xirr !== undefined && Number.isFinite(performance.xirr);

  return (
    <PageShell>
      <DashboardHeader />

      <div className="space-y-4">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,0.65fr)]">
          <SectionCard
            title="Portfolio value"
            description="Current value and invested capital across your household."
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Current value</p>
                <p className="number mt-1 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
                  {formatInr(summary.currentValue)}
                </p>
              </div>
              <div
                className={cn(
                  "flex items-center gap-2 text-sm font-semibold",
                  pnlDirection === "gain" && "positive",
                  pnlDirection === "loss" && "negative",
                  pnlDirection === "flat" && "text-muted-foreground",
                )}
              >
                {pnlDirection === "gain" ? (
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                ) : pnlDirection === "loss" ? (
                  <ArrowDownRight className="size-4" aria-hidden="true" />
                ) : (
                  <Minus className="size-4" aria-hidden="true" />
                )}
                <span>
                  {pnlDirection === "gain"
                    ? "Gain"
                    : pnlDirection === "loss"
                      ? "Loss"
                      : "No change"}
                </span>
                <span className="number">{formatInr(summary.pnlAmount)}</span>
                <span className="number text-muted-foreground">
                  ({formatPercent(summary.pnlPercent)})
                </span>
              </div>
            </div>

            <div className="pt-5">
              {timeline.length < 2 ? (
                <EmptyState
                  icon={TrendingUp}
                  title="Portfolio history is still building"
                  description="Add another dated snapshot to see value and invested capital over time."
                />
              ) : (
                <PortfolioTimelineChart
                  data={timeline}
                  className="h-64 sm:h-72"
                />
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Snapshot"
            description="The numbers behind your latest portfolio value."
          >
            <dl className="divide-y divide-border/70">
              <CompactMetric
                label="Invested capital"
                value={formatInr(summary.investedAmount)}
              />
              <CompactMetric
                label="Absolute return"
                value={formatPercent(performance.absoluteReturnPercent)}
                tone={absoluteReturnTone}
              />
              <CompactMetric
                label="Annualized growth"
                value={formatPercent(performance.cagr)}
                detail="Based on available valuation history"
              />
            </dl>

            <div className="mt-5 space-y-4 rounded-xl bg-muted/40 p-4">
              <div className="flex items-start gap-3">
                <CalendarDays
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    Latest holdings snapshot
                  </p>
                  <p className="number mt-1 text-sm font-semibold">
                    {latestSnapshotDate
                      ? formatDate(latestSnapshotDate)
                      : "Date unavailable"}
                  </p>
                </div>
              </div>

              <ImportSummary
                isLoading={importHistory.isLoading && !importHistory.data}
                isError={importHistory.isError && !importHistory.data}
                source={latestCommittedImport?.sourceType}
                fileName={latestCommittedImport?.originalFileName}
                committedAt={latestCommittedImport?.committedAt}
                sourceFileExpired={latestCommittedImport?.status === "expired"}
              />
            </div>
          </SectionCard>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Allocation"
            description="Select an asset class to inspect its holdings and performance."
          >
            {summary.allocationByAssetClass.length === 0 ? (
              <EmptyState
                icon={PieChart}
                title="Allocation is unavailable"
                description="Asset allocation will appear when categorized holdings are available."
              />
            ) : (
              <AllocationDonutChart data={summary.allocationByAssetClass} />
            )}
          </SectionCard>

          <SectionCard
            title="Top holdings"
            description="Largest positions by current value."
            action={
              <Button asChild size="sm" variant="ghost">
                <Link href="/holdings">
                  View all
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            }
          >
            <ul className="divide-y divide-border/70">
              {topHoldings.map((holding) => (
                <li
                  key={holding.id}
                  className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <Link
                      className="block truncate text-sm font-semibold text-foreground transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      href={`/dashboard/holdings/${holding.id}`}
                    >
                      {holding.symbol ?? holding.instrumentName}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {holding.accountName}
                    </p>
                  </div>
                  <div className="flex items-end justify-between gap-4 sm:flex-col sm:items-end sm:gap-1">
                    <p className="number text-sm font-semibold">
                      {formatInr(holding.currentValueInInr)}
                    </p>
                    <PnlValue value={holding.pnlAmountInInr} />
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <SectionCard
            title="Data health"
            description="How much confidence to place in the return calculations."
          >
            <div
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between",
                hasUsableXirr
                  ? "border-primary/20 bg-accent/40"
                  : "border-warning/25 bg-warning/5",
              )}
            >
              <div className="flex items-start gap-3">
                {hasUsableXirr ? (
                  <CheckCircle2
                    className="mt-0.5 size-5 shrink-0 text-positive"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleAlert
                    className="mt-0.5 size-5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <p className="font-semibold">
                    {hasUsableXirr
                      ? "A portfolio XIRR is available"
                      : "XIRR needs more data"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {xirrExplanation(performance.dataQuality)}
                  </p>
                </div>
              </div>
              <QualityBadge value={qualityLabel(performance.dataQuality)} />
            </div>

            <dl className="mt-5 divide-y divide-border/70">
              <HealthMetric
                label="Portfolio XIRR"
                explanation="Money-weighted annual return that accounts for when money entered and left the portfolio."
                value={<RateValue value={performance.xirr} />}
              />
              <HealthMetric
                label="Source return coverage"
                explanation="Share of current portfolio value with a return supplied directly by its source file."
                value={
                  <span className="number font-semibold">
                    {formatPercent(performance.sourceXirrCoveragePercent)}
                  </span>
                }
              />
              <HealthMetric
                label="Dated cash flows"
                explanation="Deposits, withdrawals, purchases, and sales available for an exact money-weighted return."
                value={
                  <span className="number font-semibold">
                    {performance.cashFlowCount.toLocaleString("en-IN")}
                  </span>
                }
              />
            </dl>
          </SectionCard>

          <SectionCard
            title="Performance by asset class"
            description="Return quality can differ between sources."
          >
            {performance.byAssetClass.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="Asset-class returns are unavailable"
                description="Add source returns or dated cash flows to calculate them."
              />
            ) : (
              <ul className="divide-y divide-border/70">
                {performance.byAssetClass.map((item) => (
                  <li
                    key={item.assetClass}
                    className="space-y-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Link
                          className="truncate text-sm font-semibold text-foreground transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          href={`/dashboard/asset-class/${encodeURIComponent(item.assetClass)}`}
                        >
                          {labelize(item.assetClass)}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Current value
                        </p>
                      </div>
                      <p className="number text-sm font-semibold">
                        {formatInr(item.currentValue)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>XIRR</span>
                        <RateValue value={item.xirr} compact />
                      </div>
                      <QualityBadge value={qualityLabel(item.dataQuality)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </section>
      </div>
    </PageShell>
  );
}

function DashboardHeader() {
  return (
    <PageHeader
      eyebrow="Overview"
      title="Your portfolio"
      description="A current view of household value, performance, allocation, and data quality."
      action={
        <Button asChild>
          <Link href="/uploads">
            <UploadCloud className="size-4" aria-hidden="true" />
            Import data
          </Link>
        </Button>
      }
    />
  );
}

function CompactMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div>
        <dt className="text-sm text-muted-foreground">{label}</dt>
        {detail ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
      <dd
        className={cn(
          "number shrink-0 text-right text-base font-semibold",
          tone === "positive" && "positive",
          tone === "negative" && "negative",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ImportSummary({
  isLoading,
  isError,
  source,
  fileName,
  committedAt,
  sourceFileExpired,
}: {
  isLoading: boolean;
  isError: boolean;
  source?: string;
  fileName?: string;
  committedAt?: Date | null;
  sourceFileExpired: boolean;
}) {
  const Icon = isError ? CircleAlert : committedAt ? CheckCircle2 : Database;

  return (
    <div className="flex items-start gap-3">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          isError
            ? "text-negative"
            : committedAt
              ? "text-positive"
              : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">
          Latest committed import
        </p>
        {isLoading ? (
          <p className="mt-1 text-sm font-semibold">Checking import history</p>
        ) : isError ? (
          <p className="mt-1 text-sm font-semibold">History unavailable</p>
        ) : committedAt ? (
          <>
            <p className="mt-1 text-sm font-semibold">
              {sourceLabel(source)} on{" "}
              <span className="number">{formatDate(committedAt)}</span>
            </p>
            {fileName ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {fileName}
              </p>
            ) : null}
            {sourceFileExpired ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The source file expired; imported portfolio data is retained.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-sm font-semibold">
            No committed import recorded
          </p>
        )}
      </div>
    </div>
  );
}

function HealthMetric({
  label,
  explanation,
  value,
}: {
  label: string;
  explanation: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <dt className="text-sm font-semibold">{label}</dt>
        <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
          {explanation}
        </p>
      </div>
      <dd className="sm:text-right">{value}</dd>
    </div>
  );
}

function RateValue({
  value,
  compact = false,
}: {
  value: number | undefined;
  compact?: boolean;
}) {
  if (value === undefined || !Number.isFinite(value)) {
    return (
      <span className="number font-semibold text-muted-foreground">N/A</span>
    );
  }

  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const label = value > 0 ? "Positive" : value < 0 ? "Negative" : "No change";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold",
        value > 0 && "positive",
        value < 0 && "negative",
        compact ? "text-xs" : "text-sm",
      )}
      aria-label={`${label} ${formatPercent(value)}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="number">{formatPercent(value)}</span>
    </span>
  );
}

function PnlValue({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Minus className="size-3.5" aria-hidden="true" />
        <span className="number">N/A</span>
      </span>
    );
  }

  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const label = value > 0 ? "Gain" : value < 0 ? "Loss" : "No change";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold",
        value > 0 && "positive",
        value < 0 && "negative",
        value === 0 && "text-muted-foreground",
      )}
      aria-label={`${label} ${formatInr(value)}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="number">{formatInr(value)}</span>
    </span>
  );
}

function xirrExplanation(dataQuality: string) {
  if (dataQuality === "exact") {
    return "Calculated from dated cash flows and the latest portfolio value.";
  }
  if (dataQuality === "source_provided") {
    return "Blended from returns supplied by portfolio source files.";
  }
  if (dataQuality === "estimated") {
    return "Estimated from valuation history because complete cash flows are unavailable.";
  }
  return "Add dated cash flows or more valuation history to calculate a portfolio XIRR.";
}
