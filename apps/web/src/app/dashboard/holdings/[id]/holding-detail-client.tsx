"use client";

import { api } from "@investment-sync/backend/api";
import type { FunctionReturnType } from "convex/server";
import { useCachedQuery } from "@/app/query-cache-provider";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, LineChart, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { DisplayAmount, HideAmountsButton, Money } from "@/components/amounts";
import { MissingHolding } from "@/components/dashboard-states";
import { InstrumentMark } from "@/components/instrument-mark";
import { NpsDetailsSections } from "@/components/nps-details-sections";
import { PortfolioTimelineChart } from "@/components/portfolio-charts";
import {
  EmptyState,
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
import { positionKeyFromHoldingPathname } from "@/lib/holding-route";
import { ConvexSessionGate } from "../../../convex-provider";
import { ConvexQueryBoundary } from "@/components/convex-query-boundary";

type HoldingDetail = FunctionReturnType<typeof api.portfolio.holdingDetail>;

export function HoldingDetailClient() {
  const pathname = usePathname();
  const positionKey = positionKeyFromHoldingPathname(pathname);

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

      <ConvexSessionGate
        errorHeader={<HoldingFallbackHeading />}
        loading={
          <HoldingFallback>
            <PortfolioContentSkeleton variant="holding" />
          </HoldingFallback>
        }
      >
        {positionKey ? (
          <ConvexQueryBoundary
            key={positionKey}
            title="This holding could not be loaded"
            description="The position remains saved. Try loading its latest analytics again."
            renderFallback={(fallback) => (
              <HoldingFallback>{fallback}</HoldingFallback>
            )}
          >
            <HoldingData positionKey={positionKey} />
          </ConvexQueryBoundary>
        ) : (
          <HoldingFallback>
            <MissingHolding />
          </HoldingFallback>
        )}
      </ConvexSessionGate>
    </PageShell>
  );
}

function HoldingData({ positionKey }: { positionKey: string }) {
  const detail = useCachedQuery(api.portfolio.holdingDetail, { positionKey });
  const current = useCachedQuery(api.users.current, {});

  if (detail === undefined)
    return (
      <HoldingFallback>
        <PortfolioContentSkeleton variant="holding" />
      </HoldingFallback>
    );
  if (!detail)
    return (
      <HoldingFallback>
        <MissingHolding />
      </HoldingFallback>
    );

  const { holding } = detail;

  return (
    <>
      <header className="mb-8 flex flex-wrap items-start gap-4">
        <InstrumentMark
          symbol={holding.symbol}
          isin={holding.isin}
          exchange={holding.exchange}
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
        {holding.manualPolicyId && current?.role === "owner" ? (
          <Button variant="outline" asChild className="ml-auto">
            <Link
              href={`/holdings/manual?policy=${encodeURIComponent(holding.manualPolicyId)}`}
            >
              Update value
            </Link>
          </Button>
        ) : null}
      </header>
      <HoldingContent data={detail} />
    </>
  );
}

function HoldingFallbackHeading() {
  return (
    <h1 className="mb-8 text-2xl font-semibold tracking-[-0.02em]">Holding</h1>
  );
}

function HoldingFallback({ children }: { children: ReactNode }) {
  return (
    <>
      <HoldingFallbackHeading />
      {children}
    </>
  );
}

function HoldingContent({ data }: { data: NonNullable<HoldingDetail> }) {
  const { holding } = data;
  if (!holding) return null;

  const pnlAmount = Number(holding.pnlAmount ?? 0);
  const emptyTransactions = transactionEmptyState(
    Boolean(data.npsDetails),
    holding.xirrDataQuality,
    Boolean(holding.manualPolicyId),
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
            {holding.isCurrent
              ? "Current value"
              : "Last observed snapshot value"}{" "}
            in {holding.currency}
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
            label={
              holding.isCurrent
                ? "Unrealized gain or loss"
                : "Last snapshot gain or loss"
            }
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
          description="Current value and invested amount in INR across dated updates."
        >
          {data.history.length < 2 ? (
            <EmptyState
              icon={LineChart}
              title="Only one dated snapshot so far"
              description="Add a value from another date to see a trend."
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
            {holding.manualPolicyId ? null : (
              <Fact label="Quantity" value={formatQuantity(holding.quantity)} />
            )}
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
            {holding.manualPolicyId ? null : (
              <>
                <Fact label="ISIN" value={holding.isin ?? "N/A"} />
                <Fact label="Exchange" value={holding.exchange ?? "N/A"} />
              </>
            )}
            <Fact label="Dated snapshots" value={`${data.history.length}`} />
          </dl>
        </Panel>
      </section>

      <section className="mt-8">
        <h2 className="text-[0.82rem] font-semibold">Realized sales</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Reported sale proceeds, cost basis and realized gain or loss in the
          statement currency. Each row is a sold acquisition lot. Sale dates are
          separate from holding snapshot dates.
        </p>
        {data.sales.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No reported sale details are available.{" "}
            {holding.isCurrent
              ? "Holding values come from the latest snapshot."
              : "The values above are from the last observed holding snapshot and do not establish sale proceeds or realized gains."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sold</TableHead>
                  <TableHead>Acquired</TableHead>
                  <TableHead>Execution / lot</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Proceeds</TableHead>
                  <TableHead className="text-right">Cost basis</TableHead>
                  <TableHead className="text-right">
                    Realized gain or loss
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="number whitespace-nowrap">
                      {formatDate(sale.saleDate)}
                    </TableCell>
                    <TableCell className="number whitespace-nowrap">
                      {sale.acquisitionDate
                        ? formatDate(sale.acquisitionDate)
                        : "Not reported"}
                    </TableCell>
                    <TableCell>
                      {[sale.executionId, sale.lotId]
                        .filter(Boolean)
                        .join(" / ") || "Not reported"}
                    </TableCell>
                    <TableCell className="number text-right">
                      {formatQuantity(sale.quantity)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money
                        value={Number(sale.proceeds)}
                        currency={sale.currency}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money
                        value={Number(sale.costBasis)}
                        currency={sale.currency}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money
                        value={Number(sale.realizedPnl)}
                        currency={sale.currency}
                        signed
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
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
          {holding.manualPolicyId
            ? "Manual values do not include individual payments."
            : "Imported cash flows. Realized sale reports provide partial activity and are excluded from XIRR calculations."}
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
                        {transaction.price != null ? (
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
        Figures come from statements and manual entries. Investment Sync does
        not fetch live prices.
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

function transactionEmptyState(
  hasNpsDetails: boolean,
  dataQuality?: string,
  hasManualPolicy = false,
) {
  if (hasManualPolicy) {
    return {
      title: "Payment dates not recorded",
      description:
        "This policy records values only. Payment dates are needed to calculate XIRR.",
    };
  }

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
      "Complete dated cash flows are needed to calculate XIRR for this position.",
  };
}
