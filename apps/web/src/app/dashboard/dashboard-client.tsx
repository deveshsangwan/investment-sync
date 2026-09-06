"use client";

import { useAmountFormatters } from "@/components/amounts";

import Link from "next/link";
import { DisplayAmount, Money } from "@/components/amounts";
import {
  AssetIcon,
  InstrumentIdentity,
} from "@/components/instrument-identity";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Database,
  Minus,
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
  StatRail,
  RailStat,
  toneOf,
} from "@/components/portfolio-ui";
import { Button } from "@/components/ui/button";
import {
  formatDate,
  formatSignedPercent,
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
  const { formatInr } = useAmountFormatters();

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
  const hasUsableXirr =
    performance.xirr !== undefined && Number.isFinite(performance.xirr);

  return (
    <PageShell>
      <DashboardHeader />

      <div className="space-y-8">
        <section
          aria-label="Portfolio summary"
          className="flex flex-col gap-8 border-b pb-8 xl:flex-row xl:items-end xl:justify-between"
        >
          <div className="min-w-0">
            <DisplayAmount
              value={summary.currentValue}
              className="text-4xl font-semibold tracking-tight sm:text-5xl"
            />
            <p className="mt-3 text-sm text-muted-foreground">
              Total value · holdings dated{" "}
              {latestSnapshotDate
                ? formatDate(latestSnapshotDate)
                : "date unavailable"}
            </p>
          </div>
          <StatRail>
            <RailStat
              label="Invested"
              value={<Money value={summary.investedAmount} />}
            />
            <RailStat
              label="Gain or loss"
              value={<Money value={summary.pnlAmount} signed />}
              tone={toneOf(summary.pnlAmount)}
            />
            <RailStat
              label="Return"
              value={formatSignedPercent(performance.absoluteReturnPercent)}
              tone={toneOf(performance.absoluteReturnPercent)}
            />
            <RailStat
              label="XIRR"
              value={formatPercent(performance.xirr)}
              detail={qualityLabel(performance.dataQuality)}
            />
          </StatRail>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 rounded-2xl border bg-card p-5">
            <div className="mb-6 flex items-center justify-between gap-3">
              <h2 className="mono-section-title">Value history</h2>
              <span className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground">
                All snapshots
              </span>
            </div>
            {timeline.length < 2 ? (
              <EmptyState
                icon={TrendingUp}
                title="Your history starts here"
                description="Import another dated snapshot to compare portfolio values."
              />
            ) : (
              <PortfolioTimelineChart data={timeline} />
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Value changes include deposits and withdrawals. Line color
              compares the latest value with invested capital.
            </p>
          </div>
          <div className="min-w-0 rounded-2xl border bg-card p-5">
            <h2 className="mono-section-title mb-6">Asset allocation</h2>
            <AllocationDonutChart data={summary.allocationByAssetClass} />
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="mono-section-title">Your investments</h2>
            <span className="text-xs text-muted-foreground">
              {summary.allocationByAssetClass.length} asset classes
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {summary.allocationByAssetClass.map((item) => {
              const positions = holdings.filter(
                (holding) => holding.assetClass === item.assetClass,
              );
              const invested = positions.reduce(
                (total, holding) => total + holding.investedAmountInInr,
                0,
              );
              const gain = Number(item.currentValue) - invested;
              const rate = performance.byAssetClass.find(
                (asset) => asset.assetClass === item.assetClass,
              );

              return (
                <Link
                  key={item.assetClass}
                  className="mono-asset"
                  href={`/dashboard/asset-class/${encodeURIComponent(item.assetClass)}`}
                >
                  <div className="flex items-center gap-3 border-b px-5 py-4">
                    <AssetIcon assetClass={item.assetClass} />
                    <h3 className="flex-1 text-sm font-medium">
                      {labelize(item.assetClass)}
                    </h3>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                  <div className="p-5">
                    <p className="number text-[28px] font-semibold tracking-tight">
                      {formatInr(Number(item.currentValue))}
                    </p>
                    <dl className="mt-5 space-y-2.5 text-sm">
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">
                          {item.assetClass === "nps"
                            ? "Retirement holdings"
                            : item.assetClass === "mutual_fund"
                              ? "Funds invested in"
                              : "Holdings"}
                        </dt>
                        <dd className="number">{positions.length}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Invested</dt>
                        <dd className="number">{formatInr(invested)}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">
                          {item.assetClass === "nps" ? "XIRR" : "Gain / loss"}
                        </dt>
                        <dd
                          className={cn(
                            "number",
                            item.assetClass !== "nps" &&
                              (gain >= 0 ? "positive" : "negative"),
                          )}
                        >
                          {item.assetClass === "nps"
                            ? formatPercent(rate?.xirr)
                            : `${gain > 0 ? "+" : ""}${formatInr(gain)}`}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="mono-section-title">Largest holdings</h2>
            <Button asChild size="sm" variant="ghost">
              <Link href="/holdings">
                View all <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
          <ul className="divide-y border-y">
            {topHoldings.map((holding) => (
              <li key={holding.id}>
                <Link
                  href={`/dashboard/holdings/${holding.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg py-4 transition-colors hover:bg-muted/40"
                >
                  <InstrumentIdentity
                    name={holding.instrumentName}
                    symbol={holding.symbol}
                    assetClass={holding.assetClass}
                  />
                  <div className="shrink-0 text-right">
                    <p className="number text-sm font-semibold">
                      {formatInr(holding.currentValueInInr)}
                    </p>
                    <div className="mt-1">
                      <PnlValue value={holding.pnlAmountInInr} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Company marks are illustrative. Values are from imported records.
          </p>
        </section>

        <details className="mono-disclosure border-t pt-5">
          <summary className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <Activity className="size-4 text-muted-foreground" />
            Return calculations and source details
            <ChevronDown className="ml-auto size-4" />
          </summary>
          <div className="pt-5">
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
                          <QualityBadge
                            value={qualityLabel(item.dataQuality)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </section>
            <div className="mt-5">
              <ImportSummary
                isLoading={importHistory.isLoading && !importHistory.data}
                isError={importHistory.isError && !importHistory.data}
                source={latestCommittedImport?.sourceType}
                fileName={latestCommittedImport?.originalFileName}
                committedAt={latestCommittedImport?.committedAt}
                sourceFileExpired={
                  latestCommittedImport
                    ? !latestCommittedImport.sourceFileAvailable
                    : false
                }
              />
            </div>
          </div>
        </details>
      </div>
    </PageShell>
  );
}

function DashboardHeader() {
  return (
    <PageHeader
      title="Portfolio"
      action={
        <Button asChild>
          <Link href="/uploads">
            <UploadCloud className="size-4" aria-hidden="true" />
            Import statement
          </Link>
        </Button>
      }
    />
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
  const { formatInr } = useAmountFormatters();

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
