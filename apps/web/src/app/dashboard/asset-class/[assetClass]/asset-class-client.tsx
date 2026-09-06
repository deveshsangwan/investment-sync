"use client";

import type { AppRouter } from "@investment-sync/api";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { ArrowLeft, LineChart, Rows3 } from "lucide-react";
import { DisplayAmount, HideAmountsButton, Money } from "@/components/amounts";
import { SetupRequired } from "@/components/dashboard-states";
import { InstrumentMark } from "@/components/instrument-mark";
import { PortfolioTimelineChart } from "@/components/portfolio-charts";
import {
  EmptyState,
  ErrorState,
  Outcome,
  PageShell,
  Panel,
  PortfolioContentSkeleton,
  RailStat,
  ReturnValue,
  StatRail,
  WeightBar,
  toneOf,
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
import { assetClassMeta } from "@/lib/asset-class-meta";
import type { AssetClass } from "@/lib/asset-classes";
import {
  formatDate,
  formatPercent,
  formatSignedPercent,
  numberOrUndefined,
  qualityLabel,
} from "@/lib/format";
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
  const meta = assetClassMeta(assetClass);
  const Icon = meta.icon;

  return (
    <PageShell>
      <div className="mb-6 flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2.5">
          <Link href="/dashboard">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Overview
          </Link>
        </Button>
        <HideAmountsButton />
      </div>

      <header className="mb-8 flex items-center gap-3">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">
          {meta.label}
        </h1>
      </header>

      {!isDataConfigured ? <SetupRequired /> : null}

      {isDataConfigured && detail.isLoading ? (
        <PortfolioContentSkeleton variant="asset" />
      ) : null}

      {isDataConfigured && detail.isError ? (
        <ErrorState
          title="This asset class could not be loaded"
          description="The saved positions are unchanged. Try loading this allocation again."
          onRetry={() => void detail.refetch()}
        />
      ) : null}

      {detail.data ? <AssetClassContent data={detail.data} /> : null}
    </PageShell>
  );
}

function AssetClassContent({ data }: { data: AssetClassDetail }) {
  const { summary } = data;
  const meta = assetClassMeta(data.assetClass);
  const asOfDate = data.holdings[0]?.snapshotDate;

  return (
    <>
      <section className="flex flex-col gap-8 border-b border-border/70 pb-8 xl:flex-row xl:items-end xl:justify-between xl:gap-8">
        <div>
          <DisplayAmount
            value={summary.currentValue}
            className="block text-[2.5rem] font-semibold leading-none tracking-[-0.03em]"
          />
          <p className="mt-3 text-sm text-muted-foreground">
            {summary.holdingCount} {meta.unit}
            {asOfDate ? ` · dated ${formatDate(asOfDate)}` : ""}
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
            value={formatSignedPercent(summary.pnlPercent)}
            tone={toneOf(summary.pnlPercent)}
          />
          <RailStat
            label="Share of portfolio"
            value={formatPercent(summary.portfolioWeight)}
          />
          <RailStat
            label="XIRR"
            value={formatPercent(summary.xirr)}
            detail={qualityLabel(summary.xirrDataQuality)}
          />
        </StatRail>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title="Value history"
          description="Value and invested amount in INR across dated imports."
        >
          {data.timeline.length < 2 ? (
            <EmptyState
              icon={LineChart}
              title="History needs a second dated import"
              description="Import another statement from a different date to see how this allocation moved."
            />
          ) : (
            <PortfolioTimelineChart data={data.timeline} />
          )}
        </Panel>

        <Panel
          title="Concentration"
          description="Largest positions inside this allocation."
        >
          {data.holdings.length === 0 ? (
            <EmptyState
              icon={Rows3}
              title="No current positions"
              description="No positions from this asset class appear in the latest snapshot."
            />
          ) : (
            <ul className="space-y-3">
              {data.holdings.slice(0, 5).map((holding) => (
                <li key={holding.id}>
                  <Link
                    href={`/dashboard/holdings/${holding.id}`}
                    className="-mx-2 block rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-secondary/70 motion-reduce:transition-none"
                  >
                    <span className="flex items-center justify-between gap-4">
                      <span className="flex min-w-0 items-center gap-3">
                        <InstrumentMark
                          symbol={holding.symbol}
                          name={holding.instrumentName}
                          assetClass={holding.assetClass}
                        />
                        <span className="truncate text-sm">
                          {holding.symbol ?? holding.instrumentName}
                        </span>
                      </span>
                      <span className="number shrink-0 text-sm font-medium">
                        {formatPercent(holding.weightInAssetClass)}
                      </span>
                    </span>
                    <WeightBar
                      value={holding.weightInAssetClass}
                      className="mt-2"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <PositionsSection
        title="Current positions"
        description="Latest positions ordered by value."
        holdings={data.holdings}
      />
      <PositionsSection
        title="Exited positions"
        description="Present in earlier imports but absent from the latest snapshot."
        holdings={data.exitedHoldings}
        exited
      />
    </>
  );
}

function PositionsSection({
  title,
  description,
  holdings,
  exited = false,
}: {
  title: string;
  description: string;
  holdings: AssetPosition[];
  exited?: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-[0.82rem] font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>

      {holdings.length === 0 ? (
        <EmptyState
          className="mt-3"
          icon={Rows3}
          title={exited ? "No exited positions" : "No current positions"}
          description={
            exited
              ? "Nothing has left this allocation between imports."
              : "No positions were found for this asset class."
          }
        />
      ) : (
        <>
          <div className="mt-3 hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Holding</TableHead>
                  <TableHead>{exited ? "Last seen" : "Account"}</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Gain or loss</TableHead>
                  <TableHead className="text-right">Return</TableHead>
                  {exited ? null : (
                    <TableHead className="text-right">Weight</TableHead>
                  )}
                  {exited ? null : (
                    <TableHead className="text-right">XIRR</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((holding) => (
                  <PositionRow
                    key={holding.id}
                    holding={holding}
                    exited={exited}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="mt-3 md:hidden">
            {holdings.map((holding) => (
              <li key={holding.id} className="border-b border-hairline">
                <PositionCard holding={holding} exited={exited} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PositionRow({
  holding,
  exited,
}: {
  holding: AssetPosition;
  exited: boolean;
}) {
  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/dashboard/holdings/${holding.id}`}
          className="flex items-center gap-3"
        >
          <InstrumentMark
            symbol={holding.symbol}
            name={holding.instrumentName}
            assetClass={holding.assetClass}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {holding.symbol ?? holding.instrumentName}
            </span>
            {holding.symbol ? (
              <span className="mt-0.5 block max-w-[24rem] truncate text-xs text-muted-foreground">
                {holding.instrumentName}
              </span>
            ) : null}
          </span>
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {exited ? (
          <span className="number">{formatDate(holding.snapshotDate)}</span>
        ) : (
          holding.accountName
        )}
      </TableCell>
      <TableCell className="text-right font-medium">
        <Money
          value={Number(holding.currentValue)}
          currency={holding.currency}
        />
      </TableCell>
      <TableCell className="text-right">
        <Outcome
          amount={Number(holding.pnlAmount ?? 0)}
          currency={holding.currency}
        />
      </TableCell>
      <TableCell className="text-right">
        <ReturnValue value={numberOrUndefined(holding.pnlPercent)} />
      </TableCell>
      {exited ? null : (
        <TableCell className="number text-right text-muted-foreground">
          {formatPercent(
            "weightInAssetClass" in holding
              ? holding.weightInAssetClass
              : undefined,
          )}
        </TableCell>
      )}
      {exited ? null : (
        <TableCell className="text-right">
          <span className="number block">
            {formatPercent("xirr" in holding ? holding.xirr : undefined)}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {qualityLabel(
              "xirrDataQuality" in holding
                ? holding.xirrDataQuality
                : undefined,
            )}
          </span>
        </TableCell>
      )}
    </TableRow>
  );
}

function PositionCard({
  holding,
  exited,
}: {
  holding: AssetPosition;
  exited: boolean;
}) {
  return (
    <Link
      href={`/dashboard/holdings/${holding.id}`}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3.5"
    >
      <InstrumentMark
        symbol={holding.symbol}
        name={holding.instrumentName}
        assetClass={holding.assetClass}
        className="row-span-3 mt-0.5"
      />
      <span className="truncate font-medium">
        {holding.symbol ?? holding.instrumentName}
      </span>
      <Money
        value={Number(holding.currentValue)}
        currency={holding.currency}
        className="text-right font-medium"
      />
      <span className="truncate text-xs text-muted-foreground">
        {holding.accountName}
      </span>
      <Outcome
        amount={Number(holding.pnlAmount ?? 0)}
        currency={holding.currency}
        className="text-xs"
      />
      <span className="number col-span-2 text-xs text-muted-foreground">
        {exited ? "Last seen " : "Priced "}
        {formatDate(holding.snapshotDate)}
      </span>
    </Link>
  );
}
