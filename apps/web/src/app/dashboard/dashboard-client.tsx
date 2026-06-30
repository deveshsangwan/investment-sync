"use client";

import Link from "next/link";
import {
  Activity,
  LineChart,
  PieChart,
  TrendingUp,
  UploadCloud,
  Wallet,
} from "lucide-react";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageShell,
  QualityBadge,
  SectionCard,
} from "@/components/portfolio-ui";
import {
  AllocationDonutChart,
  PortfolioTimelineChart,
} from "@/components/portfolio-charts";
import { EmptyPortfolio, SetupRequired } from "@/components/dashboard-states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatInr, formatPercent, labelize, qualityLabel } from "@/lib/format";
import { trpc } from "../providers";

export function DashboardClient({
  isDataConfigured,
}: {
  isDataConfigured: boolean;
}) {
  const overview = trpc.portfolio.overview.useQuery(undefined, {
    enabled: isDataConfigured,
  });
  const isOverviewReady = overview.isSuccess;
  const summary = overview.data?.summary;
  const holdings = overview.data?.holdings ?? [];
  const performance = overview.data?.performance;
  const timeline = overview.data?.timeline ?? [];
  const hasHoldings = holdings.length > 0;
  const pnlTone = (summary?.pnlAmount ?? 0) >= 0 ? "positive" : "negative";
  const xirrTone = (performance?.xirr ?? 0) >= 0 ? "positive" : "negative";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Dashboard"
        title="Portfolio overview"
        description="Latest committed holdings across every account in your household."
        action={
          <Button asChild>
            <Link href="/uploads">
              <UploadCloud className="size-4" />
              Upload file
            </Link>
          </Button>
        }
      />

      {!isDataConfigured ? <SetupRequired /> : null}
      {isDataConfigured && isOverviewReady && !hasHoldings ? (
        <EmptyPortfolio />
      ) : null}

      {isOverviewReady && hasHoldings ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={Wallet}
              label="Current value"
              value={formatInr(summary?.currentValue ?? 0)}
            />
            <MetricCard
              icon={Activity}
              label="Invested"
              value={formatInr(summary?.investedAmount ?? 0)}
            />
            <MetricCard
              icon={TrendingUp}
              label="Gain/Loss"
              value={formatInr(summary?.pnlAmount ?? 0)}
              tone={pnlTone}
            />
            <MetricCard
              icon={LineChart}
              label="Return"
              value={`${summary?.pnlPercent ?? 0}%`}
              tone={pnlTone}
            />
          </section>

          <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="XIRR"
              value={formatPercent(performance?.xirr)}
              tone={xirrTone}
              detail={qualityLabel(performance?.dataQuality)}
            />
            <MetricCard
              label="Absolute return"
              value={formatPercent(performance?.absoluteReturnPercent)}
              tone={pnlTone}
            />
            <MetricCard
              label="CAGR"
              value={formatPercent(performance?.cagr)}
              detail="Valuation trend"
            />
            <MetricCard
              label="XIRR coverage"
              value={formatPercent(performance?.sourceXirrCoveragePercent)}
              detail={`${performance?.cashFlowCount ?? 0} cash flows`}
            />
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Allocation"
              description="Current portfolio mix by asset class."
            >
              {(summary?.allocationByAssetClass.length ?? 0) === 0 ? (
                <EmptyState
                  icon={PieChart}
                  title="No allocation yet"
                  description="Allocation will appear after your first committed import."
                />
              ) : (
                <AllocationDonutChart
                  data={summary?.allocationByAssetClass ?? []}
                />
              )}
            </SectionCard>

            <SectionCard title="Top holdings">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.slice(0, 8).map((holding) => {
                    const rowTone =
                      Number(holding.pnlAmount ?? 0) >= 0
                        ? "positive"
                        : "negative";
                    return (
                      <TableRow key={holding.id}>
                        <TableCell>
                          <Link
                            className="font-semibold text-primary hover:underline"
                            href={`/dashboard/holdings/${holding.id}`}
                          >
                            {holding.symbol ?? holding.instrumentName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {holding.accountName}
                        </TableCell>
                        <TableCell>
                          {formatInr(holding.currentValueInInr)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-semibold ${rowTone}`}
                        >
                          {formatInr(holding.pnlAmountInInr ?? 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </SectionCard>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <SectionCard title="Performance by asset class">
              {(performance?.byAssetClass.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="No performance data yet"
                  description="XIRR by asset class appears once source data has returns."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset class</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>XIRR</TableHead>
                      <TableHead>Quality</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performance?.byAssetClass.map((item) => {
                      const rowTone =
                        (item.xirr ?? 0) >= 0 ? "positive" : "negative";
                      return (
                        <TableRow key={item.assetClass}>
                          <TableCell>
                            <Link
                              className="font-semibold text-primary hover:underline"
                              href={`/dashboard/asset-class/${encodeURIComponent(item.assetClass)}`}
                            >
                              {labelize(item.assetClass)}
                            </Link>
                          </TableCell>
                          <TableCell>{formatInr(item.currentValue)}</TableCell>
                          <TableCell className={`font-semibold ${rowTone}`}>
                            {formatPercent(item.xirr)}
                          </TableCell>
                          <TableCell>
                            <QualityBadge
                              value={qualityLabel(item.dataQuality)}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </SectionCard>

            <SectionCard
              title="Portfolio trend"
              description="Current value against invested amount over time."
            >
              {timeline.length < 2 ? (
                <EmptyState
                  icon={TrendingUp}
                  title="No trend yet"
                  description="Upload dated snapshots to build portfolio history."
                />
              ) : (
                <PortfolioTimelineChart data={timeline} />
              )}
            </SectionCard>
          </section>
        </>
      ) : null}
    </PageShell>
  );
}
