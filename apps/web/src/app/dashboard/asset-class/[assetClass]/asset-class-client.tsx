"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  PieChart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageShell,
  SectionCard,
} from "@/components/portfolio-ui";
import { SetupRequired } from "@/components/dashboard-states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCurrency,
  formatDate,
  formatInr,
  formatPercent,
  labelize,
  numberOrUndefined,
  qualityLabel,
} from "@/lib/format";
import type { AssetClass } from "@/lib/asset-classes";
import { trpc } from "../../../providers";

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
  const summary = detail.data?.summary;
  const pnlTone = (summary?.pnlAmount ?? 0) >= 0 ? "positive" : "negative";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Asset class"
        title={labelize(assetClass)}
        description="Holdings, contribution, and concentration."
        before={
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-3">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" />
              Dashboard
            </Link>
          </Button>
        }
      />

      {!isDataConfigured ? <SetupRequired /> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Wallet}
          label="Current value"
          value={formatInr(summary?.currentValue ?? 0)}
        />
        <MetricCard
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
          icon={PieChart}
          label="Return"
          value={formatPercent(summary?.pnlPercent)}
          tone={pnlTone}
        />
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Portfolio weight"
          value={formatPercent(summary?.portfolioWeight)}
        />
        <MetricCard label="Holdings" value={`${summary?.holdingCount ?? 0}`} />
        <MetricCard
          label="Largest holding"
          value={formatPercent(detail.data?.holdings[0]?.weightInAssetClass)}
          detail={
            detail.data?.holdings[0]?.symbol ??
            detail.data?.holdings[0]?.instrumentName
          }
        />
        <MetricCard
          label="XIRR"
          value={formatPercent(summary?.xirr)}
          detail={qualityLabel(summary?.xirrDataQuality)}
        />
      </section>

      <HoldingsTable title="Holdings" holdings={detail.data?.holdings ?? []} />
      <HoldingsTable
        title="Exited holdings"
        holdings={detail.data?.exitedHoldings ?? []}
        exited
      />
    </PageShell>
  );
}

function HoldingsTable({
  title,
  holdings,
  exited = false,
}: {
  title: string;
  holdings: Array<{
    id: string;
    symbol: string | null;
    instrumentName: string;
    accountName: string;
    currentValue: string | number;
    currency: string;
    pnlAmount?: string | number | null;
    pnlAmountInInr?: number | null;
    pnlPercent?: string | number | null;
    weightInAssetClass?: number | null;
    xirr?: number | null;
    xirrDataQuality?: string;
    snapshotDate?: string | Date;
  }>;
  exited?: boolean;
}) {
  return (
    <SectionCard title={title} className="mt-4">
      {holdings.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={exited ? "No exited holdings" : "No holdings found"}
          description={
            exited
              ? "No exited holdings found from historical snapshots."
              : "No holdings found for this asset class."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {exited ? <TableHead>Last seen</TableHead> : null}
              <TableHead>Value</TableHead>
              <TableHead>P&L</TableHead>
              <TableHead>Return</TableHead>
              {!exited ? <TableHead>Weight</TableHead> : null}
              {!exited ? <TableHead>XIRR</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.map((holding) => {
              const rowTone =
                Number(holding.pnlAmountInInr ?? 0) >= 0
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
                    <div className="mt-1 text-xs text-muted-foreground">
                      {holding.accountName}
                    </div>
                  </TableCell>
                  {exited ? (
                    <TableCell>
                      {holding.snapshotDate
                        ? formatDate(holding.snapshotDate)
                        : "N/A"}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {formatCurrency(
                      Number(holding.currentValue),
                      holding.currency,
                    )}
                  </TableCell>
                  <TableCell className={`font-semibold ${rowTone}`}>
                    {formatCurrency(
                      Number(holding.pnlAmount ?? 0),
                      holding.currency,
                    )}
                  </TableCell>
                  <TableCell className={`font-semibold ${rowTone}`}>
                    {formatPercent(numberOrUndefined(holding.pnlPercent))}
                  </TableCell>
                  {!exited ? (
                    <TableCell>
                      {formatPercent(holding.weightInAssetClass)}
                    </TableCell>
                  ) : null}
                  {!exited ? (
                    <TableCell>
                      <div>{formatPercent(holding.xirr)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {qualityLabel(holding.xirrDataQuality)}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
