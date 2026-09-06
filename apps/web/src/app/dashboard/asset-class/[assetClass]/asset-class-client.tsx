"use client";

import { DisplayAmount, useAmountFormatters } from "@/components/amounts";

import { InstrumentIdentity } from "@/components/instrument-identity";
import type { AppRouter } from "@investment-sync/api";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  PieChart,
} from "lucide-react";
import {
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  PageShell,
  PortfolioContentSkeleton,
  SectionCard,
} from "@/components/portfolio-ui";
import { PortfolioTimelineChart } from "@/components/portfolio-charts";
import { SetupRequired } from "@/components/dashboard-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatAsOfDate,
  formatPercent,
  labelize,
  numberOrUndefined,
  qualityLabel,
} from "@/lib/format";
import type { AssetClass } from "@/lib/asset-classes";
import { trpc } from "../../../providers";

type AssetClassDetail =
  inferRouterOutputs<AppRouter>["portfolio"]["assetClassDetail"];
type AssetPosition =
  | AssetClassDetail["holdings"][number]
  | AssetClassDetail["exitedHoldings"][number];

export function AssetClassClient({
  assetClass,
  isDataConfigured,
}: {
  assetClass: AssetClass;
  isDataConfigured: boolean;
}) {
  const detail = trpc.portfolio.assetClassDetail.useQuery(
    { assetClass },
    { enabled: isDataConfigured },
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Asset class"
        title={labelize(assetClass)}
        description="Exposure, concentration, performance, and position history."
        before={
          <Button variant="ghost" size="sm" asChild className="mb-3 -ml-3">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Overview
            </Link>
          </Button>
        }
        action={
          <Button asChild variant="secondary">
            <Link href="/holdings">Browse holdings</Link>
          </Button>
        }
      />

      {!isDataConfigured ? <SetupRequired /> : null}

      {isDataConfigured && detail.isLoading ? (
        <PortfolioContentSkeleton />
      ) : null}

      {isDataConfigured && detail.isError ? (
        <ErrorState
          title="This asset class couldn't be loaded"
          description="The saved positions are unchanged. Try loading this allocation again."
          onRetry={() => void detail.refetch()}
        />
      ) : null}

      {detail.data ? <AssetClassContent data={detail.data} /> : null}
    </PageShell>
  );
}

function AssetClassContent({ data }: { data: AssetClassDetail }) {
  const { formatInr, formatCurrency } = useAmountFormatters();

  const { summary } = data;
  const pnlTone = summary.pnlAmount >= 0 ? "positive" : "negative";
  const PnlIcon = pnlTone === "positive" ? ArrowUpRight : ArrowDownRight;
  const asOfDate = data.holdings[0]?.snapshotDate;
  const largestHolding = data.holdings[0];

  return (
    <>
      <Card className="overflow-hidden rounded-none border-0 border-b bg-transparent">
        <CardContent className="mono-detail-summary grid grid-cols-3 gap-3 px-0 py-5 lg:grid-cols-[1.35fr_repeat(3,minmax(0,0.65fr))] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                Current value
              </p>
              {asOfDate ? (
                <Badge variant="secondary">{formatAsOfDate(asOfDate)}</Badge>
              ) : null}
            </div>
            <p className="number mt-2 text-4xl font-semibold tracking-[-0.055em] sm:text-[40px]">
              <DisplayAmount value={summary.currentValue} />
            </p>
          </div>
          <HeroStat
            label="Invested"
            value={formatInr(summary.investedAmount)}
          />
          <HeroStat
            label="Gain / loss"
            value={formatInr(summary.pnlAmount)}
            tone={pnlTone}
            icon={PnlIcon}
          />
          <HeroStat
            label="Return"
            value={formatPercent(summary.pnlPercent)}
            tone={pnlTone}
          />
        </CardContent>
      </Card>

      <section className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Portfolio weight"
          value={formatPercent(summary.portfolioWeight)}
        />
        <MetricCard
          label="Current holdings"
          value={`${summary.holdingCount}`}
        />
        <MetricCard
          label="Largest position"
          value={formatPercent(largestHolding?.weightInAssetClass)}
          detail={
            largestHolding?.symbol ??
            largestHolding?.instrumentName ??
            "No position"
          }
        />
        <MetricCard
          label="XIRR"
          value={formatPercent(summary.xirr)}
          detail={qualityLabel(summary.xirrDataQuality)}
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <SectionCard
          title="Value history"
          description="Asset-class value and invested amount in INR across dated imports."
        >
          {data.timeline.length < 2 ? (
            <EmptyState
              icon={BarChart3}
              title="No history yet"
              description="Another dated import will create a useful trend for this allocation."
            />
          ) : (
            <PortfolioTimelineChart data={data.timeline} />
          )}
        </SectionCard>
        <SectionCard
          title="Concentration"
          description="The largest positions inside this allocation."
        >
          {data.holdings.length === 0 ? (
            <EmptyState
              icon={PieChart}
              title="No current holdings"
              description="No positions from this asset class appear in the latest snapshot."
            />
          ) : (
            <div className="space-y-2">
              {data.holdings.slice(0, 5).map((holding) => (
                <Link
                  key={holding.id}
                  href={`/dashboard/holdings/${holding.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent bg-muted/30 p-3.5 transition-colors hover:border-border hover:bg-muted/55"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      <InstrumentIdentity
                        name={holding.instrumentName}
                        symbol={holding.symbol}
                        assetClass={holding.assetClass}
                      />
                    </p>
                    <p className="number mt-1 truncate text-xs text-muted-foreground">
                      {formatCurrency(
                        Number(holding.currentValue),
                        holding.currency,
                      )}
                    </p>
                  </div>
                  <p className="number text-sm font-semibold">
                    {formatPercent(holding.weightInAssetClass)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </section>

      <HoldingsTable title="Current holdings" holdings={data.holdings} />
      <HoldingsTable
        title="Exited holdings"
        holdings={data.exitedHoldings}
        exited
      />
    </>
  );
}

function HoldingsTable({
  title,
  holdings,
  exited = false,
}: {
  title: string;
  holdings: AssetPosition[];
  exited?: boolean;
}) {
  return (
    <SectionCard
      title={title}
      description={
        exited
          ? "Positions present historically but absent from the latest source snapshot."
          : "Latest positions ordered by value."
      }
      className="mt-4"
    >
      {holdings.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={exited ? "No exited holdings" : "No current holdings"}
          description={
            exited
              ? "No historical positions have left this allocation."
              : "No positions were found for this asset class."
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Holding</TableHead>
                  <TableHead>{exited ? "Last seen" : "Account"}</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>P&amp;L</TableHead>
                  <TableHead>Return</TableHead>
                  {!exited ? <TableHead>Weight</TableHead> : null}
                  {!exited ? <TableHead>XIRR</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((holding) => (
                  <AssetPositionRow
                    key={holding.id}
                    holding={holding}
                    exited={exited}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y md:hidden">
            {holdings.map((holding) => (
              <AssetPositionCard
                key={holding.id}
                holding={holding}
                exited={exited}
              />
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

function AssetPositionRow({
  holding,
  exited,
}: {
  holding: AssetPosition;
  exited: boolean;
}) {
  const { formatCurrency } = useAmountFormatters();

  const pnlInInr = Number(holding.pnlAmountInInr ?? 0);
  const tone = pnlInInr >= 0 ? "positive" : "negative";
  return (
    <TableRow>
      <TableCell>
        <Link
          className="font-semibold hover:text-primary"
          href={`/dashboard/holdings/${holding.id}`}
        >
          <InstrumentIdentity
            name={holding.instrumentName}
            symbol={holding.symbol}
            assetClass={holding.assetClass}
          />
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">
          {holding.accountName}
        </p>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {exited ? formatAsOfDate(holding.snapshotDate) : holding.provider}
      </TableCell>
      <TableCell className="number font-medium">
        {formatCurrency(Number(holding.currentValue), holding.currency)}
      </TableCell>
      <TableCell className={`number font-medium ${tone}`}>
        {formatCurrency(Number(holding.pnlAmount ?? 0), holding.currency)}
      </TableCell>
      <TableCell className={`number font-medium ${tone}`}>
        {formatPercent(numberOrUndefined(holding.pnlPercent))}
      </TableCell>
      {!exited ? (
        <TableCell className="number">
          {formatPercent(
            "weightInAssetClass" in holding
              ? holding.weightInAssetClass
              : undefined,
          )}
        </TableCell>
      ) : null}
      {!exited ? (
        <TableCell>
          <p className="number">
            {formatPercent("xirr" in holding ? holding.xirr : undefined)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {qualityLabel(
              "xirrDataQuality" in holding
                ? holding.xirrDataQuality
                : undefined,
            )}
          </p>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function AssetPositionCard({
  holding,
  exited,
}: {
  holding: AssetPosition;
  exited: boolean;
}) {
  const { formatCurrency } = useAmountFormatters();

  const tone =
    Number(holding.pnlAmountInInr ?? 0) >= 0 ? "positive" : "negative";
  return (
    <Link
      className="block py-4 transition-colors hover:bg-muted/30"
      href={`/dashboard/holdings/${holding.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            <InstrumentIdentity
              name={holding.instrumentName}
              symbol={holding.symbol}
              assetClass={holding.assetClass}
            />
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {holding.accountName} /{" "}
            {exited ? formatAsOfDate(holding.snapshotDate) : holding.provider}
          </p>
        </div>
        <p className="number shrink-0 font-semibold">
          {formatCurrency(Number(holding.currentValue), holding.currency)}
        </p>
      </div>
      <p className={`number mt-3 text-sm font-medium ${tone}`}>
        {formatPercent(numberOrUndefined(holding.pnlPercent))} return
      </p>
    </Link>
  );
}

function HeroStat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  icon?: typeof ArrowUpRight;
}) {
  return (
    <div className="border-t border-border/70 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`number mt-1.5 flex items-center gap-1 text-lg font-semibold ${tone ?? ""}`}
      >
        {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
        {value}
      </p>
    </div>
  );
}
