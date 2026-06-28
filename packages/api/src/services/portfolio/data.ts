import {
  accounts,
  holdingSnapshots,
  instruments,
  portfolioValuations,
  transactions,
} from "@investment-sync/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { cachedPortfolioData } from "./cache";
import type {
  AssetClass,
  CashFlowRow,
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
    ctx.db
      .select({
        snapshotDate: holdingSnapshots.snapshotDate,
        currentValue: sql<string>`sum(${holdingSnapshots.currentValue})`.as(
          "current_value",
        ),
        investedAmount: sql<string>`sum(${holdingSnapshots.investedAmount})`.as(
          "invested_amount",
        ),
      })
      .from(holdingSnapshots)
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId))
      .groupBy(holdingSnapshots.snapshotDate)
      .orderBy(holdingSnapshots.snapshotDate),
  );
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
          snapshotDate: holdingSnapshots.snapshotDate,
          investedAmount: holdingSnapshots.investedAmount,
          currentValue: holdingSnapshots.currentValue,
          currency: holdingSnapshots.currency,
          sourcePayload: holdingSnapshots.sourcePayload,
          accountName: accounts.name,
          provider: accounts.provider,
          instrumentName: instruments.name,
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
        .orderBy(holdingSnapshots.snapshotDate),
  );
}

export async function historyByInstrumentIds(
  ctx: PortfolioContext,
  instrumentIds: string[],
): Promise<Map<string, SnapshotValuationRow[]>> {
  if (instrumentIds.length === 0) return new Map();

  const rows = await ctx.db
    .select({
      instrumentId: holdingSnapshots.instrumentId,
      snapshotDate: holdingSnapshots.snapshotDate,
      investedAmount: holdingSnapshots.investedAmount,
      currentValue: holdingSnapshots.currentValue,
      currency: holdingSnapshots.currency,
      sourcePayload: holdingSnapshots.sourcePayload,
      accountName: accounts.name,
      provider: accounts.provider,
      instrumentName: instruments.name,
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

export async function transactionsByInstrumentIds(
  ctx: PortfolioContext,
  instrumentIds: string[],
): Promise<Map<string, InstrumentTransactionRow[]>> {
  if (instrumentIds.length === 0) return new Map();

  const rows = await ctx.db
    .select({
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
