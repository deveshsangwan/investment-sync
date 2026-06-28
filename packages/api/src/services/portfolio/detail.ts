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
import { toPerformanceValuation } from "./performance";
import {
  convertToInr,
  filterAggregateRowsBySnapshotGroup,
  getUsdInrRateIfNeeded,
  holdingCashFlowKey,
  holdingPositionKey,
  holdingSnapshotKey,
  parseDate,
  roundMoney,
  roundPercent,
  sourceXirrFromPayload,
  sum,
} from "./utils";
import type {
  AssetClass,
  CurrentHoldingRow,
  InstrumentTransactionRow,
  PortfolioContext,
  SnapshotValuationRow,
} from "./types";

export async function buildHoldingDetail(ctx: PortfolioContext, id: string) {
  const selected = await holdingById(ctx, id);
  if (!selected) return null;

  const history = await holdingHistory(ctx, selected);
  const latestHoldings = await latestCurrentHoldings(ctx);
  const latest = latestHoldingForSelection(selected, history) ?? selected;
  const usdInrRate = await getUsdInrRateIfNeeded(
    [selected.currency, ...latestHoldings.map((holding) => holding.currency)],
    ctx.db,
  );
  const portfolioCurrentValue = sum(
    latestHoldings.map((holding) =>
      convertToInr(
        Number(holding.currentValue),
        holding.currency,
        usdInrRate?.rate,
      ),
    ),
  );
  const portfolioPnl = sum(
    latestHoldings.map((holding) =>
      convertToInr(
        Number(holding.pnlAmount ?? 0),
        holding.currency,
        usdInrRate?.rate,
      ),
    ),
  );
  const latestCurrentValueInInr = convertToInr(
    Number(latest.currentValue),
    latest.currency,
    usdInrRate?.rate,
  );
  const latestPnlInInr = convertToInr(
    Number(latest.pnlAmount ?? 0),
    latest.currency,
    usdInrRate?.rate,
  );
  const isCurrent = latestHoldings.some((holding) => holding.id === latest.id);
  const transactionsForHolding = await ctx.db
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
      ),
    )
    .orderBy(transactions.tradeDate);

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
      investedAmountInInr: convertToInr(
        Number(latest.investedAmount),
        latest.currency,
        usdInrRate?.rate,
      ),
      pnlAmountInInr: latestPnlInInr,
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
    history: history.map((point) => ({
      ...point,
      currentValueInInr: convertToInr(
        Number(point.currentValue),
        point.currency,
        usdInrRate?.rate,
      ),
      investedAmountInInr: convertToInr(
        Number(point.investedAmount),
        point.currency,
        usdInrRate?.rate,
      ),
      pnlAmountInInr: convertToInr(
        Number(point.pnlAmount ?? 0),
        point.currency,
        usdInrRate?.rate,
      ),
    })),
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
  const [latestHoldings, exitedHoldings, assetClassSnapshots] =
    await Promise.all([
      latestCurrentHoldings(ctx),
      exitedCurrentHoldings(ctx),
      assetClassSnapshotRows(ctx, assetClass),
    ]);
  const usdInrRate = await getUsdInrRateIfNeeded(
    [
      ...latestHoldings.map((holding) => holding.currency),
      ...exitedHoldings.map((holding) => holding.currency),
      ...assetClassSnapshots.map((row) => row.currency),
    ],
    ctx.db,
  );
  const converted = latestHoldings.map((holding) =>
    convertHolding(holding, usdInrRate?.rate),
  );
  const convertedExited = exitedHoldings.map((holding) =>
    convertHolding(holding, usdInrRate?.rate),
  );
  const assetHoldings = converted
    .filter((holding) => holding.assetClass === assetClass)
    .sort((a, b) => b.currentValueInInr - a.currentValueInInr);
  const assetExitedHoldings = convertedExited
    .filter((holding) => holding.assetClass === assetClass)
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
  const totalCurrentValue = sum(
    assetHoldings.map((holding) => holding.currentValueInInr),
  );
  const totalInvestedAmount = sum(
    assetHoldings.map((holding) => holding.investedAmountInInr),
  );
  const totalPnlAmount = sum(
    assetHoldings.map((holding) => holding.pnlAmountInInr),
  );
  const portfolioCurrentValue = sum(
    converted.map((holding) => holding.currentValueInInr),
  );
  const [transactionsByHolding, historyByHolding, assetClassValuations] =
    await Promise.all([
      transactionsByHoldingPositions(ctx, assetHoldings),
      historyByHoldingPositions(ctx, assetHoldings),
      Promise.resolve(
        valuationsFromSnapshotRows(assetClassSnapshots, usdInrRate?.rate),
      ),
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
  holding: ReturnType<typeof convertHolding>,
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

function convertHolding(holding: CurrentHoldingRow, usdInrRate?: number) {
  return {
    ...holding,
    currentValueInInr: convertToInr(
      Number(holding.currentValue),
      holding.currency,
      usdInrRate,
    ),
    investedAmountInInr: convertToInr(
      Number(holding.investedAmount),
      holding.currency,
      usdInrRate,
    ),
    pnlAmountInInr: convertToInr(
      Number(holding.pnlAmount ?? 0),
      holding.currency,
      usdInrRate,
    ),
    sourceXirr: sourceXirrFromPayload(holding.sourcePayload),
  };
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
  const eligible = filterAggregateRowsBySnapshotGroup(rows);
  const latestByPositionDate = new Map<string, SnapshotValuationRow>();

  for (const row of eligible) {
    latestByPositionDate.set(holdingSnapshotKey(row), row);
  }

  const totalsByDate = new Map<
    string,
    { investedAmount: number; currentValue: number }
  >();

  for (const row of latestByPositionDate.values()) {
    const investedAmount = convertToInr(
      Number(row.investedAmount),
      row.currency,
      usdInrRate,
    );
    const currentValue = convertToInr(
      Number(row.currentValue),
      row.currency,
      usdInrRate,
    );
    const existing = totalsByDate.get(row.snapshotDate) ?? {
      investedAmount: 0,
      currentValue: 0,
    };
    totalsByDate.set(row.snapshotDate, {
      investedAmount: existing.investedAmount + investedAmount,
      currentValue: existing.currentValue + currentValue,
    });
  }

  return [...totalsByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([snapshotDate, totals]) => ({
      date: parseDate(snapshotDate) ?? new Date(snapshotDate),
      investedAmount: totals.investedAmount,
      currentValue: totals.currentValue,
    }));
}
