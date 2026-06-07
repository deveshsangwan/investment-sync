"use client";

import Link from "next/link";
import {
  ArrowLeft,
  FileSpreadsheet,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageShell,
  SectionCard,
  TrendRow,
} from "@/components/portfolio-ui";
import { MissingHolding, SetupRequired } from "@/components/dashboard-states";
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
  formatPercent,
  labelize,
  numberOrUndefined,
  qualityLabel,
  trendWidth,
} from "@/lib/format";
import { trpc } from "../../../providers";

export function HoldingDetailClient({
  id,
  isDataConfigured,
}: {
  id: string;
  isDataConfigured: boolean;
}) {
  const detail = trpc.portfolio.holdingDetail.useQuery(
    { id },
    { enabled: isDataConfigured },
  );
  const data = detail.data;
  const holding = data?.holding;
  const pnlTone = (holding?.pnlAmountInInr ?? 0) >= 0 ? "positive" : "negative";
  const historyValues =
    data?.history.map((point) => point.currentValueInInr) ?? [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Holding"
        title={holding ? (holding.symbol ?? holding.instrumentName) : "Holding"}
        description={
          holding
            ? `${labelize(holding.assetClass)} · ${holding.accountName} · ${holding.provider}`
            : "Loading holding analytics"
        }
        before={
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-3">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" />
              Dashboard
            </Link>
          </Button>
        }
        action={
          holding ? (
            <Button variant="secondary" asChild>
              <Link
                href={`/dashboard/asset-class/${encodeURIComponent(holding.assetClass)}`}
              >
                {labelize(holding.assetClass)}
              </Link>
            </Button>
          ) : null
        }
      />

      {!isDataConfigured ? <SetupRequired /> : null}
      {isDataConfigured && !detail.isLoading && !holding ? (
        <MissingHolding />
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Wallet}
          label="Current value"
          value={formatCurrency(
            Number(holding?.currentValue ?? 0),
            holding?.currency ?? "INR",
          )}
        />
        <MetricCard
          label="Invested"
          value={formatCurrency(
            Number(holding?.investedAmount ?? 0),
            holding?.currency ?? "INR",
          )}
        />
        <MetricCard
          icon={TrendingUp}
          label="Gain/Loss"
          value={formatCurrency(
            Number(holding?.pnlAmount ?? 0),
            holding?.currency ?? "INR",
          )}
          tone={pnlTone}
        />
        <MetricCard
          label="Return"
          value={formatPercent(numberOrUndefined(holding?.pnlPercent))}
          tone={pnlTone}
        />
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="XIRR"
          value={formatPercent(holding?.xirr)}
          detail={qualityLabel(holding?.xirrDataQuality)}
        />
        <MetricCard
          label="Portfolio weight"
          value={
            holding?.isCurrent === false
              ? "Exited"
              : formatPercent(holding?.portfolioWeight)
          }
          detail={
            holding?.isCurrent === false
              ? "Absent from latest snapshot"
              : undefined
          }
        />
        <MetricCard
          label="P&L contribution"
          value={formatPercent(holding?.pnlContribution)}
          tone={pnlTone}
        />
        <MetricCard label="Snapshots" value={`${data?.history.length ?? 0}`} />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Value history">
          {(data?.history.length ?? 0) < 2 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="No history yet"
              description="More dated uploads will build this holding history."
            />
          ) : (
            <div className="divide-y">
              {data?.history.slice(-10).map((point) => (
                <TrendRow
                  key={point.id}
                  label={formatDate(point.snapshotDate)}
                  sublabel={`${point.accountName} · ${point.provider} · invested ${formatCurrency(
                    Number(point.investedAmount),
                    point.currency,
                  )}`}
                  value={formatCurrency(
                    Number(point.currentValue),
                    point.currency,
                  )}
                  width={trendWidth(point.currentValueInInr, historyValues)}
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Holding facts">
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ["Quantity", holding?.quantity ?? "N/A"],
              [
                "Last updated",
                holding ? formatDate(holding.snapshotDate) : "N/A",
              ],
              ["Currency", holding?.currency ?? "N/A"],
              ["ISIN", holding?.isin ?? "N/A"],
              ["Exchange", holding?.exchange ?? "N/A"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-muted/30 p-3">
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-1 wrap-break-word text-sm font-semibold">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </section>

      <SectionCard title="Transactions" className="mt-4">
        {(data?.transactions.length ?? 0) === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No transactions yet"
            description="Transaction imports will unlock exact XIRR and realized gains."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>{formatDate(transaction.tradeDate)}</TableCell>
                  <TableCell>{labelize(transaction.type)}</TableCell>
                  <TableCell>{transaction.quantity ?? "N/A"}</TableCell>
                  <TableCell>
                    {transaction.price
                      ? formatCurrency(
                          Number(transaction.price),
                          transaction.currency,
                        )
                      : "N/A"}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {formatCurrency(
                      Number(transaction.amount),
                      transaction.currency,
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </PageShell>
  );
}
