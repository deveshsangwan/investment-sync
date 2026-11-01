import {
  accounts,
  holdingSnapshots,
  instruments,
  portfolioValuations,
  sourceSnapshots,
  transactions,
} from "@investment-sync/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  holdingsAtSourceSnapshot,
  retainedAtDeclaredSnapshotSql,
} from "./latest-holdings";
import { cachedPortfolioData } from "./cache";
import {
  aggregateSnapshotTotalsByDate,
  convertToInr,
  getUsdInrRateIfNeeded,
  holdingPositionKey,
  holdingCashFlowKey,
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
      .where(
        and(
          eq(transactions.householdId, ctx.membership.householdId),
          sql`${transactions.metadata}->'realizedSale' is null`,
        ),
      ),
  );
}

export async function holdingSnapshotTimelineRows(
  ctx: PortfolioContext,
  includePnl = false,
) {
  return cachedPortfolioData(
    ctx,
    `portfolio.holdingSnapshotTimeline.${includePnl}`,
    () => holdingSnapshotTimelineRowsUncached(ctx, includePnl),
  );
}

async function holdingSnapshotTimelineRowsUncached(
  ctx: PortfolioContext,
  includePnl: boolean,
) {
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
    .where(
      and(
        eq(holdingSnapshots.householdId, ctx.membership.householdId),
        retainedAtDeclaredSnapshotSql(),
      ),
    )
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
  const declarations = await ctx.db
    .select({ snapshotDate: sourceSnapshots.snapshotDate })
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.householdId, ctx.membership.householdId));
  const firstDeclarationDate = declarations
    .map((declaration) => declaration.snapshotDate)
    .sort()[0];
  const selectedDates = new Set([
    ...totalsByDate.keys(),
    ...declarations.map((declaration) => declaration.snapshotDate),
  ]);
  const pnlByDate = new Map<string, number>();
  for (const snapshotDate of selectedDates) {
    if (!firstDeclarationDate || snapshotDate < firstDeclarationDate) continue;
    const current = await holdingsAtSourceSnapshot(ctx, snapshotDate);
    pnlByDate.set(
      snapshotDate,
      current.reduce(
        (total, row) =>
          total +
          convertToInr(
            row.pnlAmount === null
              ? Number(row.currentValue) - Number(row.investedAmount)
              : Number(row.pnlAmount),
            row.currency,
            usdInrRate?.rate,
          ),
        0,
      ),
    );
    totalsByDate.set(snapshotDate, {
      investedAmount: current.reduce(
        (total, row) =>
          total +
          convertToInr(
            Number(row.investedAmount),
            row.currency,
            usdInrRate?.rate,
          ),
        0,
      ),
      currentValue: current.reduce(
        (total, row) =>
          total +
          convertToInr(
            Number(row.currentValue),
            row.currency,
            usdInrRate?.rate,
          ),
        0,
      ),
    });
  }

  return [...totalsByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([snapshotDate, totals]) => ({
      snapshotDate,
      investedAmount: roundMoney(totals.investedAmount),
      currentValue: roundMoney(totals.currentValue),
      ...(includePnl && pnlByDate.has(snapshotDate)
        ? { pnlAmount: roundMoney(pnlByDate.get(snapshotDate) ?? 0) }
        : {}),
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
            retainedAtDeclaredSnapshotSql(),
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
  holdings: Array<Pick<CurrentHoldingRow, "instrumentId">>,
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
    const key = holdingPositionKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

export async function transactionsByHoldingPositions(
  ctx: PortfolioContext,
  holdings: Array<Pick<CurrentHoldingRow, "instrumentId">>,
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
        sql`${transactions.metadata}->'realizedSale' is null`,
      ),
    )
    .orderBy(transactions.tradeDate);

  const grouped = new Map<string, InstrumentTransactionRow[]>();
  for (const row of rows) {
    if (!row.instrumentId) continue;
    const key = holdingCashFlowKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

export async function sourceSnapshotDates(
  ctx: PortfolioContext,
  assetClass?: AssetClass,
) {
  return ctx.db
    .select({ snapshotDate: sourceSnapshots.snapshotDate })
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.householdId, ctx.membership.householdId),
        assetClass ? eq(sourceSnapshots.assetClass, assetClass) : undefined,
      ),
    );
}
