import {
  summarizePerformance,
  summarizePortfolio,
  xirrByAssetClass,
} from "@investment-sync/analytics";
import {
  accounts,
  holdingSnapshots,
  instruments,
  portfolioValuations,
  transactions,
} from "@investment-sync/db";
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
        sourcePayload: holdingSnapshots.sourcePayload,
      })
      .from(holdingSnapshots)
      .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
      .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId));

    const latestHoldings = latestNonAggregateHoldings(holdings);
    const usdInrRate = await getUsdInrRateIfNeeded(
      latestHoldings.map((holding) => holding.currency),
    );

    return latestHoldings
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
          new Date(b.snapshotDate).getTime() -
          new Date(a.snapshotDate).getTime();
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
        snapshotDate: holdingSnapshots.snapshotDate,
        instrumentName: instruments.name,
        sourcePayload: holdingSnapshots.sourcePayload,
      })
      .from(holdingSnapshots)
      .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId));

    const latestHoldings = latestNonAggregateHoldings(holdings);
    const usdInrRate = await getUsdInrRateIfNeeded(
      latestHoldings.map((holding) => holding.currency),
    );
    const summary = summarizePortfolio(
      latestHoldings.map((holding) => ({
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
      asOfDate: latestHoldings[0]?.snapshotDate ?? null,
    };
  }),
  timeline: protectedProcedure.query(async ({ ctx }) => {
    const valuations = await ctx.db
      .select({
        valuationDate: portfolioValuations.valuationDate,
        currentValue: portfolioValuations.currentValue,
        investedAmount: portfolioValuations.investedAmount,
        pnlAmount: portfolioValuations.pnlAmount,
        currency: portfolioValuations.currency,
      })
      .from(portfolioValuations)
      .where(eq(portfolioValuations.householdId, ctx.membership.householdId))
      .orderBy(portfolioValuations.valuationDate);

    if (valuations.length > 0) {
      return valuations.map((valuation) => ({
        snapshotDate: valuation.valuationDate,
        currentValue: valuation.currentValue,
        investedAmount: valuation.investedAmount,
        pnlAmount: valuation.pnlAmount,
        currency: valuation.currency,
      }));
    }

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
  performance: protectedProcedure.query(async ({ ctx }) => {
    const holdings = await ctx.db
      .select({
        snapshotDate: holdingSnapshots.snapshotDate,
        assetClass: instruments.assetClass,
        investedAmount: holdingSnapshots.investedAmount,
        currentValue: holdingSnapshots.currentValue,
        currency: holdingSnapshots.currency,
        instrumentName: instruments.name,
        sourcePayload: holdingSnapshots.sourcePayload,
      })
      .from(holdingSnapshots)
      .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId));

    const latestHoldings = latestNonAggregateHoldings(holdings);
    const valuations = await ctx.db
      .select({
        valuationDate: portfolioValuations.valuationDate,
        investedAmount: portfolioValuations.investedAmount,
        currentValue: portfolioValuations.currentValue,
        currency: portfolioValuations.currency,
      })
      .from(portfolioValuations)
      .where(eq(portfolioValuations.householdId, ctx.membership.householdId))
      .orderBy(portfolioValuations.valuationDate);
    const cashFlows = await ctx.db
      .select({
        tradeDate: transactions.tradeDate,
        amount: transactions.amount,
        type: transactions.type,
        currency: transactions.currency,
      })
      .from(transactions)
      .where(eq(transactions.householdId, ctx.membership.householdId));

    const usdInrRate = await getUsdInrRateIfNeeded([
      ...latestHoldings.map((holding) => holding.currency),
      ...cashFlows.map((flow) => flow.currency),
      ...valuations.map((valuation) => valuation.currency),
    ]);
    const asOfDate = parseDate(latestHoldings[0]?.snapshotDate) ?? new Date();
    const performanceHoldings = latestHoldings.map((holding) => ({
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
      sourceXirr: sourceXirrFromPayload(holding.sourcePayload),
    }));
    const performance = summarizePerformance({
      holdings: performanceHoldings,
      cashFlows: cashFlows.map((flow) => ({
        date: parseDate(flow.tradeDate) ?? new Date(flow.tradeDate),
        amount: convertToInr(
          Number(flow.amount),
          flow.currency,
          usdInrRate?.rate,
        ),
        type: flow.type,
      })),
      valuations: valuations.map((valuation) => ({
        date:
          parseDate(valuation.valuationDate) ??
          new Date(valuation.valuationDate),
        investedAmount: convertToInr(
          Number(valuation.investedAmount),
          valuation.currency,
          usdInrRate?.rate,
        ),
        currentValue: convertToInr(
          Number(valuation.currentValue),
          valuation.currency,
          usdInrRate?.rate,
        ),
      })),
      asOfDate,
    });

    return {
      ...performance,
      byAssetClass: xirrByAssetClass({ holdings: performanceHoldings }),
      asOfDate: latestHoldings[0]?.snapshotDate ?? null,
    };
  }),
});

function latestNonAggregateHoldings<
  T extends {
    snapshotDate: string;
    accountName?: string;
    provider?: string;
    assetClass: string;
    instrumentName: string;
    currency?: string;
    sourcePayload?: Record<string, unknown>;
  },
>(holdings: T[]): T[] {
  if (holdings.length === 0) return [];
  const assetClassesWithDetails = new Set(
    holdings
      .filter((holding) => !isAggregateHolding(holding))
      .map((holding) => holding.assetClass),
  );
  const eligible = holdings.filter(
    (holding) =>
      !isAggregateHolding(holding) ||
      !assetClassesWithDetails.has(holding.assetClass),
  );
  const byInstrument = new Map<string, T>();
  for (const holding of eligible) {
    const key = [
      holding.accountName,
      holding.provider,
      holding.instrumentName,
      holding.currency,
    ].join("|");
    const current = byInstrument.get(key);
    if (!current || holding.snapshotDate > current.snapshotDate) {
      byInstrument.set(key, holding);
    }
  }
  return [...byInstrument.values()].sort((a, b) => {
    const dateOrder =
      new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime();
    if (dateOrder !== 0) return dateOrder;
    return a.instrumentName.localeCompare(b.instrumentName);
  });
}

function isAggregateHolding(holding: {
  instrumentName: string;
  sourcePayload?: Record<string, unknown>;
}) {
  return (
    holding.sourcePayload?.isAggregate === true ||
    holding.instrumentName.endsWith(" Summary")
  );
}

function sourceXirrFromPayload(payload?: Record<string, unknown>) {
  const value = payload?.xirr;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

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
