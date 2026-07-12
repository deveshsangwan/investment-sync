"use client";

import type { AppRouter } from "@investment-sync/api";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  FileSpreadsheet,
  ReceiptText,
} from "lucide-react";
import {
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  PageShell,
  PortfolioContentSkeleton,
  QualityBadge,
  SectionCard,
} from "@/components/portfolio-ui";
import { PortfolioTimelineChart } from "@/components/portfolio-charts";
import { MissingHolding, SetupRequired } from "@/components/dashboard-states";
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
  formatCurrency,
  formatDate,
  formatPercent,
  formatQuantity,
  labelize,
  numberOrUndefined,
  qualityLabel,
} from "@/lib/format";
import { trpc } from "../../../providers";

type HoldingDetail =
  inferRouterOutputs<AppRouter>["portfolio"]["holdingDetail"];

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
  const holding = detail.data?.holding;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Holding detail"
        title={holding ? (holding.symbol ?? holding.instrumentName) : "Holding"}
        description={
          holding
            ? `${holding.instrumentName} · ${holding.accountName} · ${holding.provider}`
            : "Position history, return, and source quality."
        }
        before={
          <Button variant="ghost" size="sm" asChild className="mb-3 -ml-3">
            <Link href="/holdings">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Holdings
            </Link>
          </Button>
        }
        meta={
          holding ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{labelize(holding.assetClass)}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatAsOfDate(holding.snapshotDate)}
              </span>
            </div>
          ) : null
        }
        action={
          holding ? (
            <Button variant="secondary" asChild>
              <Link
                href={`/dashboard/asset-class/${encodeURIComponent(holding.assetClass)}`}
              >
                View {labelize(holding.assetClass)}
              </Link>
            </Button>
          ) : null
        }
      />

      {!isDataConfigured ? <SetupRequired /> : null}

      {isDataConfigured && detail.isLoading ? (
        <PortfolioContentSkeleton />
      ) : null}

      {isDataConfigured && detail.isError ? (
        <ErrorState
          title="This holding couldn't be loaded"
          description="The position remains saved. Try loading its latest analytics again."
          onRetry={() => void detail.refetch()}
        />
      ) : null}

      {isDataConfigured && detail.isSuccess && !holding ? (
        <MissingHolding />
      ) : null}

      {holding && detail.data ? <HoldingContent data={detail.data} /> : null}
    </PageShell>
  );
}

function HoldingContent({ data }: { data: NonNullable<HoldingDetail> }) {
  const { holding } = data;
  if (!holding) return null;
  const pnlTone = (holding.pnlAmountInInr ?? 0) >= 0 ? "positive" : "negative";
  const PnlIcon = pnlTone === "positive" ? ArrowUpRight : ArrowDownRight;

  return (
    <>
      <Card className="relative overflow-hidden border-primary/20 bg-primary/[0.065]">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
        <CardContent className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.35fr_repeat(3,minmax(0,0.65fr))] lg:items-end">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Current value
            </p>
            <p className="number mt-2 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">
              {formatCurrency(
                Number(holding.currentValue ?? 0),
                holding.currency,
              )}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Shown in {holding.currency}. History is normalized to INR.
            </p>
          </div>
          <HeroStat
            label="Invested"
            value={formatCurrency(
              Number(holding.investedAmount ?? 0),
              holding.currency,
            )}
          />
          <HeroStat
            label="Gain / loss"
            value={formatCurrency(
              Number(holding.pnlAmount ?? 0),
              holding.currency,
            )}
            tone={pnlTone}
            icon={PnlIcon}
          />
          <HeroStat
            label="Return"
            value={formatPercent(numberOrUndefined(holding.pnlPercent))}
            tone={pnlTone}
          />
        </CardContent>
      </Card>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="XIRR"
          value={formatPercent(holding.xirr)}
          detail={qualityLabel(holding.xirrDataQuality)}
        />
        <MetricCard
          label="Portfolio weight"
          value={
            holding.isCurrent === false
              ? "Exited"
              : formatPercent(holding.portfolioWeight)
          }
          detail={
            holding.isCurrent === false
              ? "Not in the latest snapshot"
              : undefined
          }
        />
        <MetricCard
          label="P&L contribution"
          value={formatPercent(holding.pnlContribution)}
          tone={pnlTone}
        />
        <MetricCard label="Snapshots" value={`${data.history.length}`} />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <SectionCard
          title="Value history"
          description="Current value and invested amount in INR across dated imports."
        >
          {data.history.length < 2 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="No history yet"
              description="Another dated import will create a useful trend for this position."
            />
          ) : (
            <PortfolioTimelineChart
              data={data.history.map((point) => ({
                snapshotDate: point.snapshotDate,
                currentValue: point.currentValueInInr,
                investedAmount: point.investedAmountInInr,
              }))}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Holding facts"
          description="Source identifiers and the latest recorded position."
        >
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {[
              ["Quantity", formatQuantity(holding.quantity)],
              ["Last updated", formatDate(holding.snapshotDate)],
              ["Currency", holding.currency ?? "N/A"],
              ["ISIN", holding.isin ?? "N/A"],
              ["Exchange", holding.exchange ?? "N/A"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-muted/35 p-3.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 wrap-break-word text-sm font-semibold">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <QualityBadge value={qualityLabel(holding.xirrDataQuality)} />
          </div>
        </SectionCard>
      </section>

      <SectionCard
        title="Transactions"
        description="Imported cash flows used for return calculations."
        className="mt-4"
      >
        {data.transactions.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No transactions yet"
            description="Transaction imports will unlock exact cash-flow XIRR and realized gains."
          />
        ) : (
          <>
            <div className="hidden md:block">
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
                  {data.transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>{formatDate(transaction.tradeDate)}</TableCell>
                      <TableCell>{labelize(transaction.type)}</TableCell>
                      <TableCell className="number">
                        {formatQuantity(transaction.quantity)}
                      </TableCell>
                      <TableCell className="number">
                        {transaction.price
                          ? formatCurrency(
                              Number(transaction.price),
                              transaction.currency,
                            )
                          : "N/A"}
                      </TableCell>
                      <TableCell className="number font-semibold">
                        {formatCurrency(
                          Number(transaction.amount),
                          transaction.currency,
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="divide-y md:hidden">
              {data.transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="font-medium">{labelize(transaction.type)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(transaction.tradeDate)} ·{" "}
                      {formatQuantity(transaction.quantity)} units
                    </p>
                  </div>
                  <p className="number font-semibold">
                    {formatCurrency(
                      Number(transaction.amount),
                      transaction.currency,
                    )}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>
    </>
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
