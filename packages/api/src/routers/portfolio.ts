import { summarizePortfolio } from "@investment-sync/analytics";
import { accounts, holdingSnapshots, instruments } from "@investment-sync/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";

export const portfolioRouter = router({
  holdings: protectedProcedure.query(async ({ ctx }) => {
    const latestDates = ctx.db
      .select({
        instrumentId: holdingSnapshots.instrumentId,
        accountId: holdingSnapshots.accountId,
        snapshotDate: sql<string>`max(${holdingSnapshots.snapshotDate})`.as(
          "snapshot_date",
        ),
      })
      .from(holdingSnapshots)
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId))
      .groupBy(holdingSnapshots.instrumentId, holdingSnapshots.accountId)
      .as("latest_dates");

    return ctx.db
      .select({
        id: holdingSnapshots.id,
        snapshotDate: holdingSnapshots.snapshotDate,
        quantity: holdingSnapshots.quantity,
        investedAmount: holdingSnapshots.investedAmount,
        currentValue: holdingSnapshots.currentValue,
        pnlAmount: holdingSnapshots.pnlAmount,
        pnlPercent: holdingSnapshots.pnlPercent,
        currency: holdingSnapshots.currency,
        accountName: accounts.name,
        provider: accounts.provider,
        instrumentName: instruments.name,
        symbol: instruments.symbol,
        assetClass: instruments.assetClass,
      })
      .from(holdingSnapshots)
      .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
      .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
      .innerJoin(
        latestDates,
        and(
          eq(latestDates.instrumentId, holdingSnapshots.instrumentId),
          eq(latestDates.accountId, holdingSnapshots.accountId),
          eq(latestDates.snapshotDate, holdingSnapshots.snapshotDate),
        ),
      )
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId))
      .orderBy(desc(holdingSnapshots.currentValue));
  }),
  summary: protectedProcedure.query(async ({ ctx }) => {
    const latestDates = ctx.db
      .select({
        instrumentId: holdingSnapshots.instrumentId,
        accountId: holdingSnapshots.accountId,
        snapshotDate: sql<string>`max(${holdingSnapshots.snapshotDate})`.as(
          "snapshot_date",
        ),
      })
      .from(holdingSnapshots)
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId))
      .groupBy(holdingSnapshots.instrumentId, holdingSnapshots.accountId)
      .as("summary_latest_dates");

    const holdings = await ctx.db
      .select({
        assetClass: instruments.assetClass,
        investedAmount: holdingSnapshots.investedAmount,
        currentValue: holdingSnapshots.currentValue,
      })
      .from(holdingSnapshots)
      .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
      .innerJoin(
        latestDates,
        and(
          eq(latestDates.instrumentId, holdingSnapshots.instrumentId),
          eq(latestDates.accountId, holdingSnapshots.accountId),
          eq(latestDates.snapshotDate, holdingSnapshots.snapshotDate),
        ),
      )
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId));

    return summarizePortfolio(
      holdings.map((holding) => ({
        assetClass: holding.assetClass,
        investedAmount: Number(holding.investedAmount),
        currentValue: Number(holding.currentValue),
      })),
    );
  }),
  timeline: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
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
      .orderBy(holdingSnapshots.snapshotDate);
  }),
});
