"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  FileSpreadsheet,
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
  TrendRow,
} from "@/components/portfolio-ui";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trpc } from "../providers";

const inrCurrency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const usdCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function DashboardClient({
  isDataConfigured,
}: {
  isDataConfigured: boolean;
}) {
  const summary = trpc.portfolio.summary.useQuery(undefined, {
    enabled: isDataConfigured,
  });
  const holdings = trpc.portfolio.holdings.useQuery(undefined, {
    enabled: isDataConfigured,
  });
  const performance = trpc.portfolio.performance.useQuery(undefined, {
    enabled: isDataConfigured,
  });
  const timeline = trpc.portfolio.timeline.useQuery(undefined, {
    enabled: isDataConfigured,
  });
  const hasHoldings = (holdings.data?.length ?? 0) > 0;
  const pnlTone = (summary.data?.pnlAmount ?? 0) >= 0 ? "positive" : "negative";
  const xirrTone = (performance.data?.xirr ?? 0) >= 0 ? "positive" : "negative";

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
      {isDataConfigured && !hasHoldings ? <EmptyPortfolio /> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Wallet}
          label="Current value"
          value={inrCurrency.format(summary.data?.currentValue ?? 0)}
        />
        <MetricCard
          icon={Activity}
          label="Invested"
          value={inrCurrency.format(summary.data?.investedAmount ?? 0)}
        />
        <MetricCard
          icon={TrendingUp}
          label="Gain/Loss"
          value={inrCurrency.format(summary.data?.pnlAmount ?? 0)}
          tone={pnlTone}
        />
        <MetricCard
          icon={LineChart}
          label="Return"
          value={`${summary.data?.pnlPercent ?? 0}%`}
          tone={pnlTone}
        />
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="XIRR"
          value={formatPercent(performance.data?.xirr)}
          tone={xirrTone}
          detail={qualityLabel(performance.data?.dataQuality)}
        />
        <MetricCard
          label="Absolute return"
          value={formatPercent(performance.data?.absoluteReturnPercent)}
          tone={pnlTone}
        />
        <MetricCard
          label="CAGR"
          value={formatPercent(performance.data?.cagr)}
          detail="Valuation trend"
        />
        <MetricCard
          label="XIRR coverage"
          value={formatPercent(performance.data?.sourceXirrCoveragePercent)}
          detail={`${performance.data?.cashFlowCount ?? 0} cash flows`}
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Allocation">
          {(summary.data?.allocationByAssetClass.length ?? 0) === 0 ? (
            <EmptyState
              icon={PieChart}
              title="No allocation yet"
              description="Allocation will appear after your first committed import."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset class</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.data?.allocationByAssetClass.map((item) => (
                  <TableRow key={item.assetClass}>
                    <TableCell>
                      <Link
                        className="font-semibold text-primary hover:underline"
                        href={`/dashboard/asset-class/${encodeURIComponent(item.assetClass)}`}
                      >
                        {labelize(item.assetClass)}
                      </Link>
                    </TableCell>
                    <TableCell>{inrCurrency.format(item.currentValue)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {item.weight}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard title="Top holdings">
          {(holdings.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="No holdings yet"
              description="Holdings will show here once an upload is parsed and committed."
            />
          ) : (
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
                {holdings.data?.slice(0, 8).map((holding) => {
                  const rowTone =
                    Number(holding.pnlAmount ?? 0) >= 0 ? "positive" : "negative";
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
                        {formatCurrency(
                          Number(holding.currentValue),
                          holding.currency,
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${rowTone}`}>
                        {formatCurrency(
                          Number(holding.pnlAmount ?? 0),
                          holding.currency,
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Performance by asset class">
          {(performance.data?.byAssetClass.length ?? 0) === 0 ? (
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
                {performance.data?.byAssetClass.map((item) => {
                  const rowTone = (item.xirr ?? 0) >= 0 ? "positive" : "negative";
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
                      <TableCell>{inrCurrency.format(item.currentValue)}</TableCell>
                      <TableCell className={`font-semibold ${rowTone}`}>
                        {formatPercent(item.xirr)}
                      </TableCell>
                      <TableCell>
                        <QualityBadge value={qualityLabel(item.dataQuality)} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard title="Portfolio trend">
          {(timeline.data?.length ?? 0) < 2 ? (
            <EmptyState
              icon={TrendingUp}
              title="No trend yet"
              description="Upload dated snapshots to build portfolio history."
            />
          ) : (
            <div className="divide-y">
              {timeline.data?.slice(-8).map((point) => {
                const currentValue = Number(point.currentValue);
                const investedAmount = Number(point.investedAmount);
                const width = trendWidth(
                  currentValue,
                  timeline.data.map((item) => Number(item.currentValue)),
                );
                return (
                  <TrendRow
                    key={point.snapshotDate}
                    label={formatDate(point.snapshotDate)}
                    sublabel={inrCurrency.format(investedAmount)}
                    value={inrCurrency.format(currentValue)}
                    width={width}
                  />
                );
              })}
            </div>
          )}
        </SectionCard>
      </section>
    </PageShell>
  );
}

function SetupRequired() {
  return (
    <Alert className="mb-4 border-amber-500/30 bg-amber-500/10">
      <AlertTitle>Connect Supabase before loading portfolio data</AlertTitle>
      <AlertDescription>
        Add DATABASE_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY to
        apps/web/.env.local, then restart the dev server.
      </AlertDescription>
    </Alert>
  );
}

function EmptyPortfolio() {
  return (
    <div className="mb-4">
      <EmptyState
        icon={UploadCloud}
        title="Import your first portfolio file"
        description="Upload a Tickertape holdings CSV, mutual fund CSV, Vested P&L workbook, or your current investment workbook."
        action={
          <Button variant="secondary" asChild>
            <Link href="/uploads">
              Go to uploads
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />
    </div>
  );
}

function labelize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatCurrency(value: number, currency: string) {
  if (currency === "USD") return usdCurrency.format(value);
  return inrCurrency.format(value);
}

function formatPercent(value: number | undefined | null) {
  return value === undefined || value === null ? "N/A" : `${value}%`;
}

function qualityLabel(value: string | undefined) {
  if (value === "exact") return "Exact cash-flow XIRR";
  if (value === "source_provided") return "Source provided";
  if (value === "estimated") return "Estimated from snapshots";
  return "Needs cash flows";
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function trendWidth(value: number, values: number[]) {
  const max = Math.max(...values, 1);
  return Math.max(6, Math.round((value / max) * 100));
}
