import {
  resolveAssetClassXirr,
  resolveHoldingXirr,
  type PerformanceValuationInput,
} from "@investment-sync/analytics";
import { transactions } from "@investment-sync/db";
import { and, eq } from "drizzle-orm";
import {
  assetClassSnapshotRows,
  historyByHoldingPositions,
  transactionsByHoldingPositions,
} from "./data";
import {
  exitedCurrentHoldings,
  holdingById,
  holdingHistory,
  latestCurrentHoldings,
} from "./latest-holdings";
import {
  buildPortfolioSummary,
  buildPortfolioSummaryFromSnapshot,
} from "./summary";
import {
  aggregateSnapshotTotalsByDate,
  convertToInr,
  enrichHoldingWithInr,
  enrichHoldingWithInrAndXirr,
  getUsdInrRateIfNeeded,
  holdingCashFlowKey,
  holdingPositionKey,
  parseDate,
  roundMoney,
  roundPercent,
  sourceXirrFromPayload,
  sum,
} from "./utils";
import type {
  AssetClass,
  Currency,
  InstrumentTransactionRow,
  PortfolioContext,
  SnapshotValuationRow,
} from "./types";

export async function buildHoldingDetail(ctx: PortfolioContext, id: string) {
  const selected = await holdingById(ctx, id);
  if (!selected) return null;

  const [history, latestHoldings, transactionsForHolding] = await Promise.all([
    holdingHistory(ctx, selected),
    latestCurrentHoldings(ctx),
    ctx.db
      .select({
        id: transactions.id,
        tradeDate: transactions.tradeDate,
        type: transactions.type,
        quantity: transactions.quantity,
        price: transactions.price,
        amount: transactions.amount,
        currency: transactions.currency,
        notes: transactions.notes,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, ctx.membership.householdId),
          eq(transactions.accountId, selected.accountId),
          eq(transactions.instrumentId, selected.instrumentId),
          eq(transactions.currency, selected.currency),
        ),
      )
      .orderBy(transactions.tradeDate),
  ]);
  const latest = latestHoldingForSelection(selected, history) ?? selected;
  const usdInrRate = await getUsdInrRateIfNeeded(
    [selected.currency, ...latestHoldings.map((holding) => holding.currency)],
    ctx.db,
  );
  const portfolioSummary = buildPortfolioSummaryFromSnapshot(
    latestHoldings,
    usdInrRate?.rate,
    usdInrRate ? [usdInrRate] : [],
  );
  const portfolioCurrentValue = portfolioSummary.currentValue;
  const portfolioPnl = portfolioSummary.pnlAmount;
  const enrichedLatest = enrichHoldingWithInr(
    {
      ...latest,
      instrumentName: selected.instrumentName,
      symbol: selected.symbol,
      assetClass: selected.assetClass,
    },
    usdInrRate?.rate,
  );
  const latestCurrentValueInInr = enrichedLatest.currentValueInInr;
  const latestPnlInInr = enrichedLatest.pnlAmountInInr ?? 0;
  const isCurrent = latestHoldings.some((holding) => holding.id === latest.id);

  const sourceXirr = sourceXirrFromPayload(latest.sourcePayload);
  const holdingValuations = history.map((point) =>
    toPerformanceValuation(point, usdInrRate?.rate),
  );
  const resolvedXirr = resolveHoldingXirr({
    cashFlows: transactionsForHolding.map((transaction) => ({
      date: parseDate(transaction.tradeDate) ?? new Date(transaction.tradeDate),
      amount: convertToInr(
        Number(transaction.amount),
        transaction.currency,
        usdInrRate?.rate,
      ),
      type: transaction.type,
    })),
    terminalValue: latestCurrentValueInInr,
    asOfDate: parseDate(latest.snapshotDate) ?? new Date(),
    sourceXirr,
    valuations: holdingValuations,
  });

  return {
    holding: {
      ...selected,
      ...latest,
      accountName: selected.accountName,
      provider: selected.provider,
      instrumentName: selected.instrumentName,
      symbol: selected.symbol,
      assetClass: selected.assetClass,
      isin: selected.isin,
      exchange: selected.exchange,
      sourceXirr,
      xirr: resolvedXirr.xirr,
      xirrDataQuality: resolvedXirr.dataQuality,
      isCurrent,
      currentValueInInr: latestCurrentValueInInr,
      investedAmountInInr: enrichedLatest.investedAmountInInr,
      pnlAmountInInr: enrichedLatest.pnlAmountInInr,
      portfolioWeight:
        portfolioCurrentValue === 0
          ? 0
          : roundPercent(
              (latestCurrentValueInInr / portfolioCurrentValue) * 100,
            ),
      pnlContribution:
        portfolioPnl === 0
          ? 0
          : roundPercent((latestPnlInInr / portfolioPnl) * 100),
    },
    history: history.map((point) => {
      const enriched = enrichHoldingWithInr(
        {
          ...point,
          instrumentName: selected.instrumentName,
          symbol: selected.symbol,
          assetClass: selected.assetClass,
        },
        usdInrRate?.rate,
      );

      return {
        ...point,
        currentValueInInr: enriched.currentValueInInr,
        investedAmountInInr: enriched.investedAmountInInr,
        pnlAmountInInr: enriched.pnlAmountInInr ?? 0,
      };
    }),
    transactions: transactionsForHolding.map((transaction) => ({
      ...transaction,
      amount: Number(transaction.amount).toString(),
    })),
  };
}

export async function buildAssetClassDetail(
  ctx: PortfolioContext,
  assetClass: AssetClass,
) {
  const [
    assetHoldingsRaw,
    assetExitedRaw,
    assetClassSnapshots,
    portfolioSummary,
  ] = await Promise.all([
    latestCurrentHoldings(ctx, assetClass),
    exitedCurrentHoldings(ctx, assetClass),
    assetClassSnapshotRows(ctx, assetClass),
    buildPortfolioSummary(ctx),
  ]);
  const usdInrRate = await getUsdInrRateIfNeeded(
    [
      ...assetHoldingsRaw.map((holding) => holding.currency),
      ...assetExitedRaw.map((holding) => holding.currency),
      ...assetClassSnapshots.map((row) => row.currency),
    ],
    ctx.db,
  );
  const assetHoldings = assetHoldingsRaw
    .map((holding) => enrichHoldingWithInrAndXirr(holding, usdInrRate?.rate))
    .sort((a, b) => b.currentValueInInr - a.currentValueInInr);
  const assetExitedHoldings = assetExitedRaw
    .map((holding) => enrichHoldingWithInrAndXirr(holding, usdInrRate?.rate))
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
  const totalCurrentValue = sum(
    assetHoldings.map((holding) => holding.currentValueInInr),
  );
  const totalInvestedAmount = sum(
    assetHoldings.map((holding) => holding.investedAmountInInr),
  );
  const totalPnlAmount = sum(
    assetHoldings.map((holding) => holding.pnlAmountInInr ?? 0),
  );
  const portfolioCurrentValue = portfolioSummary.currentValue;
  const assetClassValuations = valuationsFromSnapshotRows(
    assetClassSnapshots,
    usdInrRate?.rate,
  );
  const [transactionsByHolding, historyByHolding] = await Promise.all([
    transactionsByHoldingPositions(ctx, assetHoldings),
    historyByHoldingPositions(ctx, assetHoldings),
  ]);
  const assetClassXirr = resolveAssetClassXirr({
    holdings: assetHoldings.map((holding) => ({
      assetClass: holding.assetClass,
      investedAmount: holding.investedAmountInInr,
      currentValue: holding.currentValueInInr,
      sourceXirr: holding.sourceXirr,
    })),
    valuations: assetClassValuations,
  });

  return {
    assetClass,
    holdings: assetHoldings.map((holding) => {
      const resolved = resolvePositionXirr(
        holding,
        historyByHolding,
        transactionsByHolding,
        usdInrRate?.rate,
      );

      return {
        ...holding,
        xirr: resolved.xirr,
        xirrDataQuality: resolved.dataQuality,
        weightInAssetClass:
          totalCurrentValue === 0
            ? 0
            : roundPercent(
                (holding.currentValueInInr / totalCurrentValue) * 100,
              ),
      };
    }),
    summary: {
      currentValue: roundMoney(totalCurrentValue),
      investedAmount: roundMoney(totalInvestedAmount),
      pnlAmount: roundMoney(totalPnlAmount),
      pnlPercent:
        totalInvestedAmount === 0
          ? 0
          : roundPercent((totalPnlAmount / totalInvestedAmount) * 100),
      portfolioWeight:
        portfolioCurrentValue === 0
          ? 0
          : roundPercent((totalCurrentValue / portfolioCurrentValue) * 100),
      holdingCount: assetHoldings.length,
      xirr: assetClassXirr.xirr,
      xirrDataQuality: assetClassXirr.dataQuality,
    },
    timeline: assetClassValuations.map((point) => ({
      snapshotDate: point.date.toISOString(),
      investedAmount: roundMoney(point.investedAmount),
      currentValue: roundMoney(point.currentValue),
    })),
    exitedHoldings: assetExitedHoldings,
  };
}

function resolvePositionXirr(
  holding: ReturnType<typeof enrichHoldingWithInrAndXirr>,
  historyByHolding: Map<string, SnapshotValuationRow[]>,
  transactionsByHolding: Map<string, InstrumentTransactionRow[]>,
  usdInrRate?: number,
) {
  const positionHistory = historyByHolding.get(holdingPositionKey(holding)) ?? [
    holding,
  ];
  const positionTransactions =
    transactionsByHolding.get(holdingCashFlowKey(holding)) ?? [];

  return resolveHoldingXirr({
    cashFlows: positionTransactions.map((transaction) => ({
      date: parseDate(transaction.tradeDate) ?? new Date(transaction.tradeDate),
      amount: convertToInr(
        Number(transaction.amount),
        transaction.currency,
        usdInrRate,
      ),
      type: transaction.type,
    })),
    terminalValue: holding.currentValueInInr,
    asOfDate: parseDate(holding.snapshotDate) ?? new Date(),
    sourceXirr: holding.sourceXirr,
    valuations: positionHistory.map((point) =>
      toPerformanceValuation(point, usdInrRate),
    ),
  });
}

function latestHoldingForSelection<
  T extends {
    snapshotDate: string;
  },
>(selected: T, history: T[]): T | undefined {
  return history
    .filter((row) => row.snapshotDate >= selected.snapshotDate)
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0];
}

function valuationsFromSnapshotRows(
  rows: SnapshotValuationRow[],
  usdInrRate?: number,
): PerformanceValuationInput[] {
  return [...aggregateSnapshotTotalsByDate(rows, usdInrRate).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([snapshotDate, totals]) => ({
      date: parseDate(snapshotDate) ?? new Date(snapshotDate),
      investedAmount: totals.investedAmount,
      currentValue: totals.currentValue,
    }));
}

function toPerformanceValuation(
  point: {
    snapshotDate: string;
    investedAmount: string | number;
    currentValue: string | number;
    currency: Currency;
  },
  usdInrRate?: number,
): PerformanceValuationInput {
  return {
    date: parseDate(point.snapshotDate) ?? new Date(point.snapshotDate),
    investedAmount: convertToInr(
      Number(point.investedAmount),
      point.currency,
      usdInrRate,
    ),
    currentValue: convertToInr(
      Number(point.currentValue),
      point.currency,
      usdInrRate,
    ),
  };
}
