"use client";

import type { AppRouter } from "@investment-sync/api";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { ArrowLeft, LineChart, ReceiptText } from "lucide-react";
import { DisplayAmount, HideAmountsButton, Money } from "@/components/amounts";
import { MissingHolding, SetupRequired } from "@/components/dashboard-states";
import { InstrumentMark } from "@/components/instrument-mark";
import { NpsDetailsSections } from "@/components/nps-details-sections";
import { PortfolioTimelineChart } from "@/components/portfolio-charts";
import {
  EmptyState,
  ErrorState,
  PageShell,
  Panel,
  PortfolioContentSkeleton,
  RailStat,
  StatRail,
  toneOf,
} from "@/components/portfolio-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { assetClassLabel } from "@/lib/asset-class-meta";
import {
  formatDate,
  formatPercent,
  formatQuantity,
  formatSignedPercent,
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
      <div className="mb-6 flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2.5">
          <Link href="/holdings">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Holdings
          </Link>
        </Button>
        <HideAmountsButton />
      </div>

      {holding ? (
        <header className="mb-8 flex items-start gap-4">
          <InstrumentMark
            symbol={holding.symbol}
            name={holding.instrumentName}
            assetClass={holding.assetClass}
            size="detail"
          />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              {holding.symbol ?? holding.instrumentName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {holding.symbol ? `${holding.instrumentName} · ` : ""}
              {holding.accountName}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href={`/dashboard/asset-class/${encodeURIComponent(holding.assetClass)}`}
                className="rounded-md border border-border/80 px-2 py-0.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground motion-reduce:transition-none"
              >
                {assetClassLabel(holding.assetClass)}
              </Link>
              {holding.isCurrent === false ? (
                <Badge variant="outline">Not in latest snapshot</Badge>
              ) : null}
              <span className="number text-xs text-muted-foreground">
                Priced {formatDate(holding.snapshotDate)}
              </span>
            </div>
          </div>
        </header>
      ) : (
        <h1 className="mb-8 text-2xl font-semibold tracking-[-0.02em]">
          Holding
        </h1>
      )}

      {!isDataConfigured ? <SetupRequired /> : null}

      {isDataConfigured && detail.isLoading ? (
        <PortfolioContentSkeleton variant="holding" />
      ) : null}

      {isDataConfigured && detail.isError ? (
        <ErrorState
          title="This holding could not be loaded"
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

  const pnlAmount = Number(holding.pnlAmount ?? 0);
  const emptyTransactions = transactionEmptyState(
    Boolean(data.npsDetails),
    holding.xirrDataQuality,
  );

  return (
    <>
      <section className="flex flex-col gap-8 border-b border-border/70 pb-8 xl:flex-row xl:items-end xl:justify-between xl:gap-8">
        <div>
          <DisplayAmount
            value={Number(holding.currentValue ?? 0)}
            currency={holding.currency}
            className="block text-[2.5rem] font-semibold leading-none tracking-[-0.03em]"
          />
          <p className="mt-3 text-sm text-muted-foreground">
            Current value in {holding.currency}
            {holding.currency === "USD" ? ", converted to INR elsewhere" : ""}
          </p>
        </div>

        <StatRail>
          <RailStat
            label="Invested"
            value={
              <Money
                value={Number(holding.investedAmount ?? 0)}
                currency={holding.currency}
              />
            }
          />
          <RailStat
            label="Gain or loss"
            value={
              <Money value={pnlAmount} currency={holding.currency} signed />
            }
            tone={toneOf(pnlAmount)}
          />
          <RailStat
            label="Return"
            value={formatSignedPercent(numberOrUndefined(holding.pnlPercent))}
            tone={toneOf(numberOrUndefined(holding.pnlPercent))}
          />
          <RailStat
            label="XIRR"
            value={formatPercent(holding.xirr)}
            detail={qualityLabel(holding.xirrDataQuality)}
          />
        </StatRail>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title="Value history"
          description="Current value and invested amount in INR across dated imports."
        >
          {data.history.length < 2 ? (
            <EmptyState
              icon={LineChart}
              title="Only one dated snapshot so far"
              description="This position needs a second import from a different date before a trend means anything."
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
        </Panel>

        <Panel title="Position facts">
          <dl className="divide-y divide-hairline text-sm">
            <Fact label="Quantity" value={formatQuantity(holding.quantity)} />
            <Fact
              label="Share of portfolio"
              value={
                holding.isCurrent === false
                  ? "Exited"
                  : formatPercent(holding.portfolioWeight)
              }
            />
            <Fact
              label="Share of portfolio gain"
              value={formatPercent(holding.pnlContribution)}
            />
            <Fact label="Account" value={holding.accountName} />
            <Fact label="Provider" value={labelize(holding.provider)} />
            <Fact label="ISIN" value={holding.isin ?? "N/A"} />
            <Fact label="Exchange" value={holding.exchange ?? "N/A"} />
            <Fact label="Dated snapshots" value={`${data.history.length}`} />
          </dl>
        </Panel>
      </section>

      {data.npsDetails ? (
        <NpsDetailsSections
          details={data.npsDetails}
          currency={holding.currency}
          totalValue={Number(holding.currentValue)}
        />
      ) : null}

      <section className="mt-10">
        <h2 className="text-[0.82rem] font-semibold">Transactions</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Imported cash flows used for return calculations.
        </p>

        {data.transactions.length === 0 ? (
          <EmptyState
            className="mt-3"
            icon={ReceiptText}
            title={emptyTransactions.title}
            description={emptyTransactions.description}
          />
        ) : (
          <>
            <div className="mt-3 hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="number">
                        {formatDate(transaction.tradeDate)}
                      </TableCell>
                      <TableCell>{labelize(transaction.type)}</TableCell>
                      <TableCell className="number text-right">
                        {formatQuantity(transaction.quantity)}
                      </TableCell>
                      <TableCell className="text-right">
                        {transaction.price ? (
                          <Money
                            value={Number(transaction.price)}
                            currency={transaction.currency}
                          />
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <Money
                          value={Number(transaction.amount)}
                          currency={transaction.currency}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="mt-3 divide-y divide-hairline border-t border-hairline md:hidden">
              {data.transactions.map((transaction) => (
                <li
                  key={transaction.id}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {labelize(transaction.type)}
                    </p>
                    <p className="number mt-1 text-xs text-muted-foreground">
                      {formatDate(transaction.tradeDate)} ·{" "}
                      {formatQuantity(transaction.quantity)} units
                    </p>
                  </div>
                  <Money
                    value={Number(transaction.amount)}
                    currency={transaction.currency}
                    className="shrink-0 text-sm font-medium"
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        Figures come from imported statements. Investment Sync does not fetch
        live prices.
      </p>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="number wrap-break-word text-right font-medium">{value}</dd>
    </div>
  );
}

function transactionEmptyState(hasNpsDetails: boolean, dataQuality?: string) {
  if (hasNpsDetails && dataQuality === "source_provided") {
    return {
      title: "No normalized transactions",
      description:
        "Statement activity is partial, so it is not used as complete cash-flow history. The portal-provided XIRR remains the return source.",
    };
  }
  if (hasNpsDetails) {
    return {
      title: "No normalized transactions",
      description:
        "Statement activity is partial and is not used as complete cash-flow history.",
    };
  }
  return {
    title: "No transactions yet",
    description:
      "Importing transactions unlocks an exact cash-flow XIRR and realized gains for this position.",
  };
}
