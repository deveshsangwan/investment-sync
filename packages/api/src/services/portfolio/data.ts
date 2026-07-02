import {
  accounts,
  holdingSnapshots,
  instruments,
  portfolioValuations,
  transactions,
} from "@investment-sync/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { cachedPortfolioData } from "./cache";
import {
  aggregateSnapshotTotalsByDate,
  getUsdInrRateIfNeeded,
  roundMoney,
} from "./utils";
import type {
  AssetClass,
  CashFlowRow,
  CurrentHoldingRow,
  InstrumentTransactionRow,
  PortfolioContext,
  PortfolioValuationRow,
  SnapshotValuationRow,
} from "./types";

export async function portfolioValuationRows(
  ctx: PortfolioContext,
): Promise<PortfolioValuationRow[]> {
  return cachedPortfolioData(ctx, "portfolio.valuations", () =>
    ctx.db
      .select({
        valuationDate: portfolioValuations.valuationDate,
        investedAmount: portfolioValuations.investedAmount,
        currentValue: portfolioValuations.currentValue,
        pnlAmount: portfolioValuations.pnlAmount,
        currency: portfolioValuations.currency,
      })
      .from(portfolioValuations)
      .where(eq(portfolioValuations.householdId, ctx.membership.householdId))
      .orderBy(portfolioValuations.valuationDate),
  );
}

export async function cashFlowRows(
  ctx: PortfolioContext,
): Promise<CashFlowRow[]> {
  return cachedPortfolioData(ctx, "portfolio.cashFlows", () =>
    ctx.db
      .select({
        tradeDate: transactions.tradeDate,
        amount: transactions.amount,
        type: transactions.type,
        currency: transactions.currency,
      })
      .from(transactions)
      .where(eq(transactions.householdId, ctx.membership.householdId)),
  );
}

export async function holdingSnapshotTimelineRows(ctx: PortfolioContext) {
  return cachedPortfolioData(ctx, "portfolio.holdingSnapshotTimeline", () =>
    holdingSnapshotTimelineRowsUncached(ctx),
  );
}

async function holdingSnapshotTimelineRowsUncached(ctx: PortfolioContext) {
  const rows = await ctx.db
    .select({
      accountId: holdingSnapshots.accountId,
      instrumentId: holdingSnapshots.instrumentId,
      snapshotDate: holdingSnapshots.snapshotDate,
      investedAmount: holdingSnapshots.investedAmount,
      currentValue: holdingSnapshots.currentValue,
      currency: holdingSnapshots.currency,
      sourcePayload: holdingSnapshots.sourcePayload,
      sourceSheet: sql<string>`coalesce(${holdingSnapshots.sourcePayload}->>'sourceSheet', '')`,
      accountName: accounts.name,
      provider: accounts.provider,
      instrumentName: instruments.name,
      assetClass: instruments.assetClass,
    })
    .from(holdingSnapshots)
    .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
    .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
    .where(eq(holdingSnapshots.householdId, ctx.membership.householdId))
    .orderBy(
      holdingSnapshots.snapshotDate,
      holdingSnapshots.createdAt,
      holdingSnapshots.id,
    );
  const usdInrRate = await getUsdInrRateIfNeeded(
    rows.map((row) => row.currency),
    ctx.db,
  );
  const totalsByDate = aggregateSnapshotTotalsByDate(rows, usdInrRate?.rate);

  return [...totalsByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([snapshotDate, totals]) => ({
      snapshotDate,
      investedAmount: roundMoney(totals.investedAmount),
      currentValue: roundMoney(totals.currentValue),
      currency: "INR" as const,
    }));
}

export async function assetClassSnapshotRows(
  ctx: PortfolioContext,
  assetClass: AssetClass,
): Promise<SnapshotValuationRow[]> {
  return cachedPortfolioData(
    ctx,
    `portfolio.assetClassSnapshots.${assetClass}`,
    () =>
      ctx.db
        .select({
          instrumentId: holdingSnapshots.instrumentId,
          accountId: holdingSnapshots.accountId,
          snapshotDate: holdingSnapshots.snapshotDate,
          investedAmount: holdingSnapshots.investedAmount,
          currentValue: holdingSnapshots.currentValue,
          currency: holdingSnapshots.currency,
          sourcePayload: holdingSnapshots.sourcePayload,
          sourceSheet: sql<string>`coalesce(${holdingSnapshots.sourcePayload}->>'sourceSheet', '')`,
          accountName: accounts.name,
          provider: accounts.provider,
          instrumentName: instruments.name,
          assetClass: instruments.assetClass,
        })
        .from(holdingSnapshots)
        .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
        .innerJoin(
          instruments,
          eq(instruments.id, holdingSnapshots.instrumentId),
        )
        .where(
          and(
            eq(holdingSnapshots.householdId, ctx.membership.householdId),
            eq(instruments.assetClass, assetClass),
          ),
        )
        .orderBy(
          holdingSnapshots.snapshotDate,
          holdingSnapshots.createdAt,
          holdingSnapshots.id,
        ),
  );
}

export async function historyByHoldingPositions(
  ctx: PortfolioContext,
  holdings: CurrentHoldingRow[],
): Promise<Map<string, SnapshotValuationRow[]>> {
  const instrumentIds = [
    ...new Set(holdings.map((holding) => holding.instrumentId)),
  ];
  if (instrumentIds.length === 0) return new Map();

  const rows = await ctx.db
    .select({
      instrumentId: holdingSnapshots.instrumentId,
      accountId: holdingSnapshots.accountId,
      snapshotDate: holdingSnapshots.snapshotDate,
      investedAmount: holdingSnapshots.investedAmount,
      currentValue: holdingSnapshots.currentValue,
      currency: holdingSnapshots.currency,
      sourcePayload: holdingSnapshots.sourcePayload,
      sourceSheet: sql<string>`coalesce(${holdingSnapshots.sourcePayload}->>'sourceSheet', '')`,
      accountName: accounts.name,
      provider: accounts.provider,
      instrumentName: instruments.name,
      assetClass: instruments.assetClass,
    })
    .from(holdingSnapshots)
    .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
    .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
    .where(
      and(
        eq(holdingSnapshots.householdId, ctx.membership.householdId),
        inArray(holdingSnapshots.instrumentId, instrumentIds),
      ),
    )
    .orderBy(holdingSnapshots.snapshotDate);

  const grouped = new Map<string, SnapshotValuationRow[]>();
  for (const row of rows) {
    grouped.set(row.instrumentId, [
      ...(grouped.get(row.instrumentId) ?? []),
      row,
    ]);
  }
  return grouped;
}

export async function transactionsByHoldingPositions(
  ctx: PortfolioContext,
  holdings: CurrentHoldingRow[],
): Promise<Map<string, InstrumentTransactionRow[]>> {
  const instrumentIds = [
    ...new Set(holdings.map((holding) => holding.instrumentId)),
  ];
  if (instrumentIds.length === 0) return new Map();

  const rows = await ctx.db
    .select({
      accountId: transactions.accountId,
      instrumentId: transactions.instrumentId,
      tradeDate: transactions.tradeDate,
      amount: transactions.amount,
      type: transactions.type,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, ctx.membership.householdId),
        inArray(transactions.instrumentId, instrumentIds),
      ),
    )
    .orderBy(transactions.tradeDate);

  const grouped = new Map<string, InstrumentTransactionRow[]>();
  for (const row of rows) {
    if (!row.instrumentId) continue;
    grouped.set(row.instrumentId, [
      ...(grouped.get(row.instrumentId) ?? []),
      row,
    ]);
  }
  return grouped;
}
