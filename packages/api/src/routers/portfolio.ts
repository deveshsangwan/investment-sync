import { summarizePortfolio } from "@investment-sync/analytics";
import { accounts, holdingSnapshots, instruments } from "@investment-sync/db";
import { eq, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";
import { getUsdInrRate } from "../services/currency-rates";

type Currency = "INR" | "USD" | "BTC" | "ETH" | "OTHER";

export const portfolioRouter = router({
  holdings: protectedProcedure.query(async ({ ctx }) => {
    const holdings = await ctx.db
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
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId));

    const usdInrRate = await getUsdInrRateIfNeeded(
      holdings.map((holding) => holding.currency),
    );

    return holdings
      .map((holding) => {
        const investedAmount = Number(holding.investedAmount);
        const currentValue = Number(holding.currentValue);
        const pnlAmount =
          holding.pnlAmount === null ? null : Number(holding.pnlAmount);

        return {
          ...holding,
          currentValueInInr: convertToInr(
            currentValue,
            holding.currency,
            usdInrRate?.rate,
          ),
          investedAmountInInr: convertToInr(
            investedAmount,
            holding.currency,
            usdInrRate?.rate,
          ),
          pnlAmountInInr:
            pnlAmount === null
              ? null
              : convertToInr(pnlAmount, holding.currency, usdInrRate?.rate),
        };
      })
      .sort((a, b) => {
        const dateOrder =
          new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime();
        if (dateOrder !== 0) return dateOrder;
        return b.currentValueInInr - a.currentValueInInr;
      });
  }),
  summary: protectedProcedure.query(async ({ ctx }) => {
    const holdings = await ctx.db
      .select({
        assetClass: instruments.assetClass,
        investedAmount: holdingSnapshots.investedAmount,
        currentValue: holdingSnapshots.currentValue,
        currency: holdingSnapshots.currency,
      })
      .from(holdingSnapshots)
      .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId));

    const usdInrRate = await getUsdInrRateIfNeeded(
      holdings.map((holding) => holding.currency),
    );
    const summary = summarizePortfolio(
      holdings.map((holding) => ({
        assetClass: holding.assetClass,
        investedAmount: convertToInr(
          Number(holding.investedAmount),
          holding.currency,
          usdInrRate?.rate,
        ),
        currentValue: convertToInr(
          Number(holding.currentValue),
          holding.currency,
          usdInrRate?.rate,
        ),
      })),
    );

    return {
      ...summary,
      currency: "INR" as const,
      exchangeRates: usdInrRate ? [usdInrRate] : [],
    };
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

async function getUsdInrRateIfNeeded(currencies: Currency[]) {
  return currencies.includes("USD") ? getUsdInrRate() : undefined;
}

function convertToInr(
  amount: number,
  currency: Currency,
  usdInrRate?: number,
): number {
  if (!Number.isFinite(amount)) return 0;
  if (currency === "INR") return amount;
  if (currency === "USD" && usdInrRate) return amount * usdInrRate;
  return amount;
}
