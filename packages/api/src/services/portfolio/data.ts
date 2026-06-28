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
  convertToInr,
  filterAggregateRowsBySnapshotGroup,
  getUsdInrRateIfNeeded,
  holdingCashFlowKey,
  holdingPositionKey,
  holdingSnapshotKey,
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
    .orderBy(holdingSnapshots.snapshotDate);
  const eligibleRows = filterAggregateRowsBySnapshotGroup(rows);
  const usdInrRate = await getUsdInrRateIfNeeded(
    eligibleRows.map((row) => row.currency),
    ctx.db,
  );
  const latestBySnapshot = new Map<string, (typeof eligibleRows)[number]>();

  for (const row of eligibleRows) {
    latestBySnapshot.set(holdingSnapshotKey(row), row);
  }

  const totalsByDate = new Map<
    string,
    { investedAmount: number; currentValue: number }
  >();
  for (const row of latestBySnapshot.values()) {
    const investedAmount = convertToInr(
      Number(row.investedAmount),
      row.currency,
      usdInrRate?.rate,
    );
    const currentValue = convertToInr(
      Number(row.currentValue),
      row.currency,
      usdInrRate?.rate,
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
        .orderBy(holdingSnapshots.snapshotDate),
  );
}

export async function historyByHoldingPositions(
  ctx: PortfolioContext,
  holdings: CurrentHoldingRow[],
): Promise<Map<string, SnapshotValuationRow[]>> {
  const instrumentIds = [
    ...new Set(holdings.map((holding) => holding.instrumentId)),
  ];
  const accountIds = [...new Set(holdings.map((holding) => holding.accountId))];
  const requestedKeys = new Set(holdings.map(holdingPositionKey));
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
        inArray(holdingSnapshots.accountId, accountIds),
        inArray(holdingSnapshots.instrumentId, instrumentIds),
      ),
    )
    .orderBy(holdingSnapshots.snapshotDate);

  const grouped = new Map<string, SnapshotValuationRow[]>();
  for (const row of rows) {
    const key = holdingPositionKey(row);
    if (!requestedKeys.has(key)) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
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
  const accountIds = [...new Set(holdings.map((holding) => holding.accountId))];
  const requestedKeys = new Set(holdings.map(holdingCashFlowKey));
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
        inArray(transactions.accountId, accountIds),
        inArray(transactions.instrumentId, instrumentIds),
      ),
    )
    .orderBy(transactions.tradeDate);

  const grouped = new Map<string, InstrumentTransactionRow[]>();
  for (const row of rows) {
    if (!row.instrumentId) continue;
    const key = holdingCashFlowKey(row);
    if (!requestedKeys.has(key)) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}
