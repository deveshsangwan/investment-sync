import {
  resolveAssetClassXirr,
  resolveHoldingXirr,
  summarizePerformance,
  summarizePortfolio,
  xirrByAssetClass,
  type PerformanceValuationInput,
} from "@investment-sync/analytics";
import {
  accounts,
  assetClassEnum,
  holdingSnapshots,
  instruments,
  portfolioValuations,
  transactions,
} from "@investment-sync/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { ApiContext } from "../context";
import { protectedProcedure, router } from "../trpc";
import { getUsdInrRate } from "../services/currency-rates";
import { getHouseholdPortfolioCache } from "../services/portfolio-cache";

type Currency = "INR" | "USD" | "BTC" | "ETH" | "OTHER";
type PortfolioContext = ApiContext & { membership: { householdId: string } };

export const portfolioRouter = router({
  holdings: protectedProcedure.query(async ({ ctx }) => {
    const latestHoldings = await latestCurrentHoldings(ctx);
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
    const latestHoldings = await latestCurrentHoldings(ctx);
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
    const valuations = await portfolioValuationRows(ctx);

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
    const [latestHoldings, valuations, cashFlows] = await Promise.all([
      latestCurrentHoldings(ctx),
      portfolioValuationRows(ctx),
      cashFlowRows(ctx),
    ]);

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
  holdingDetail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [selected] = await ctx.db
        .select({
          id: holdingSnapshots.id,
          accountId: holdingSnapshots.accountId,
          instrumentId: holdingSnapshots.instrumentId,
          snapshotDate: holdingSnapshots.snapshotDate,
          quantity: holdingSnapshots.quantity,
          investedAmount: holdingSnapshots.investedAmount,
          currentValue: holdingSnapshots.currentValue,
          pnlAmount: holdingSnapshots.pnlAmount,
          pnlPercent: holdingSnapshots.pnlPercent,
          currency: holdingSnapshots.currency,
          sourcePayload: holdingSnapshots.sourcePayload,
          accountName: accounts.name,
          provider: accounts.provider,
          instrumentName: instruments.name,
          symbol: instruments.symbol,
          assetClass: instruments.assetClass,
          isin: instruments.isin,
          exchange: instruments.exchange,
        })
        .from(holdingSnapshots)
        .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
        .innerJoin(
          instruments,
          eq(instruments.id, holdingSnapshots.instrumentId),
        )
        .where(
          and(
            eq(holdingSnapshots.id, input.id),
            eq(holdingSnapshots.householdId, ctx.membership.householdId),
          ),
        )
        .limit(1);

      if (!selected) return null;

      const history = await ctx.db
        .select({
          id: holdingSnapshots.id,
          snapshotDate: holdingSnapshots.snapshotDate,
          quantity: holdingSnapshots.quantity,
          investedAmount: holdingSnapshots.investedAmount,
          currentValue: holdingSnapshots.currentValue,
          pnlAmount: holdingSnapshots.pnlAmount,
          pnlPercent: holdingSnapshots.pnlPercent,
          currency: holdingSnapshots.currency,
          sourcePayload: holdingSnapshots.sourcePayload,
          accountName: accounts.name,
          provider: accounts.provider,
        })
        .from(holdingSnapshots)
        .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
        .where(
          and(
            eq(holdingSnapshots.householdId, ctx.membership.householdId),
            eq(holdingSnapshots.instrumentId, selected.instrumentId),
          ),
        )
        .orderBy(holdingSnapshots.snapshotDate);

      const allHoldings = await currentHoldings(ctx);
      const latestHoldings = await latestCurrentHoldings(ctx);
      const latest = latestHoldingForSelection(selected, history) ?? selected;
      const usdInrRate = await getUsdInrRateIfNeeded([
        selected.currency,
        ...latestHoldings.map((holding) => holding.currency),
      ]);
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
      const isCurrent = isCurrentHoldingSnapshot(selected, latest, allHoldings);
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
          date:
            parseDate(transaction.tradeDate) ?? new Date(transaction.tradeDate),
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
        transactions: transactionsForHolding,
      };
    }),
  assetClassDetail: protectedProcedure
    .input(z.object({ assetClass: z.string() }))
    .query(async ({ ctx, input }) => {
      const [holdings, assetClassSnapshots] = await Promise.all([
        currentHoldings(ctx),
        assetClassSnapshotRows(ctx, input.assetClass as AssetClass),
      ]);
      const latestHoldings = latestNonAggregateHoldings(holdings);
      const exitedHoldings = exitedNonAggregateHoldings(holdings);
      const usdInrRate = await getUsdInrRateIfNeeded([
        ...latestHoldings.map((holding) => holding.currency),
        ...exitedHoldings.map((holding) => holding.currency),
        ...assetClassSnapshots.map((row) => row.currency),
      ]);
      const converted = latestHoldings.map((holding) => {
        const currentValueInInr = convertToInr(
          Number(holding.currentValue),
          holding.currency,
          usdInrRate?.rate,
        );
        const investedAmountInInr = convertToInr(
          Number(holding.investedAmount),
          holding.currency,
          usdInrRate?.rate,
        );
        const pnlAmountInInr = convertToInr(
          Number(holding.pnlAmount ?? 0),
          holding.currency,
          usdInrRate?.rate,
        );
        return {
          ...holding,
          currentValueInInr,
          investedAmountInInr,
          pnlAmountInInr,
          sourceXirr: sourceXirrFromPayload(holding.sourcePayload),
        };
      });
      const convertedExited = exitedHoldings.map((holding) => ({
        ...holding,
        currentValueInInr: convertToInr(
          Number(holding.currentValue),
          holding.currency,
          usdInrRate?.rate,
        ),
        investedAmountInInr: convertToInr(
          Number(holding.investedAmount),
          holding.currency,
          usdInrRate?.rate,
        ),
        pnlAmountInInr: convertToInr(
          Number(holding.pnlAmount ?? 0),
          holding.currency,
          usdInrRate?.rate,
        ),
        sourceXirr: sourceXirrFromPayload(holding.sourcePayload),
      }));
      const assetHoldings = converted
        .filter((holding) => holding.assetClass === input.assetClass)
        .sort((a, b) => b.currentValueInInr - a.currentValueInInr);
      const assetExitedHoldings = convertedExited
        .filter((holding) => holding.assetClass === input.assetClass)
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
      const instrumentIds = [
        ...new Set(assetHoldings.map((holding) => holding.instrumentId)),
      ];
      const [
        transactionsByInstrument,
        historyByInstrument,
        assetClassValuations,
      ] = await Promise.all([
        transactionsByInstrumentIds(ctx, instrumentIds),
        historyByInstrumentIds(ctx, instrumentIds),
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
        assetClass: input.assetClass,
        holdings: assetHoldings.map((holding) => {
          const instrumentHistory = historyByInstrument.get(
            holding.instrumentId,
          ) ?? [holding];
          const instrumentTransactions =
            transactionsByInstrument.get(holding.instrumentId) ?? [];
          const resolved = resolveHoldingXirr({
            cashFlows: instrumentTransactions.map(
              (transaction: InstrumentTransactionRow) => ({
                date:
                  parseDate(transaction.tradeDate) ??
                  new Date(transaction.tradeDate),
                amount: convertToInr(
                  Number(transaction.amount),
                  transaction.currency,
                  usdInrRate?.rate,
                ),
                type: transaction.type,
              }),
            ),
            terminalValue: holding.currentValueInInr,
            asOfDate: parseDate(holding.snapshotDate) ?? new Date(),
            sourceXirr: holding.sourceXirr,
            valuations: instrumentHistory.map((point) =>
              toPerformanceValuation(point, usdInrRate?.rate),
            ),
          });

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
        exitedHoldings: assetExitedHoldings,
      };
    }),
});

type CurrentHoldingRow = {
  id: string;
  instrumentId: string;
  snapshotDate: string;
  quantity: string | null;
  investedAmount: string;
  currentValue: string;
  pnlAmount: string | null;
  pnlPercent: string | null;
  currency: Currency;
  sourcePayload: Record<string, unknown>;
  accountName: string;
  provider: string;
  instrumentName: string;
  symbol: string | null;
  assetClass: string;
};

type SnapshotValuationRow = {
  instrumentId: string;
  snapshotDate: string;
  investedAmount: string;
  currentValue: string;
  currency: Currency;
  sourcePayload?: Record<string, unknown>;
  accountName: string;
  provider: string;
  instrumentName: string;
};

type InstrumentTransactionRow = {
  instrumentId: string | null;
  tradeDate: string;
  amount: string;
  type:
    | "buy"
    | "sell"
    | "dividend"
    | "fee"
    | "transfer"
    | "contribution"
    | "redemption";
  currency: Currency;
};

type AssetClass = (typeof assetClassEnum.enumValues)[number];

function cached<T>(
  ctx: ApiContext,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = ctx.cache.get(key);
  if (existing) return existing as Promise<T>;

  const promise = load();
  ctx.cache.set(key, promise);
  return promise;
}

function cachedPortfolioData<T>(
  ctx: PortfolioContext,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  return cached(ctx, key, () =>
    getHouseholdPortfolioCache(ctx.membership.householdId, key, load),
  );
}

async function currentHoldings(
  ctx: PortfolioContext,
): Promise<CurrentHoldingRow[]> {
  return cachedPortfolioData(ctx, "portfolio.currentHoldings", () =>
    ctx.db
      .select({
        id: holdingSnapshots.id,
        instrumentId: holdingSnapshots.instrumentId,
        snapshotDate: holdingSnapshots.snapshotDate,
        quantity: holdingSnapshots.quantity,
        investedAmount: holdingSnapshots.investedAmount,
        currentValue: holdingSnapshots.currentValue,
        pnlAmount: holdingSnapshots.pnlAmount,
        pnlPercent: holdingSnapshots.pnlPercent,
        currency: holdingSnapshots.currency,
        sourcePayload: holdingSnapshots.sourcePayload,
        accountName: accounts.name,
        provider: accounts.provider,
        instrumentName: instruments.name,
        symbol: instruments.symbol,
        assetClass: instruments.assetClass,
      })
      .from(holdingSnapshots)
      .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
      .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
      .where(eq(holdingSnapshots.householdId, ctx.membership.householdId)),
  );
}

async function latestCurrentHoldings(
  ctx: PortfolioContext,
): Promise<CurrentHoldingRow[]> {
  return cachedPortfolioData(ctx, "portfolio.latestCurrentHoldings", async () =>
    latestNonAggregateHoldings(await currentHoldings(ctx)),
  );
}

async function portfolioValuationRows(ctx: PortfolioContext) {
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

async function cashFlowRows(ctx: PortfolioContext) {
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

function latestHoldingForSelection<
  T extends {
    snapshotDate: string;
  },
>(selected: T, history: T[]): T | undefined {
  return history
    .filter((row) => row.snapshotDate >= selected.snapshotDate)
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0];
}

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
  const eligible = nonAggregateEligibleHoldings(holdings);
  const latestDateBySnapshotGroup = latestSnapshotDatesByGroup(eligible);
  const byInstrument = latestSnapshotsByInstrument(
    eligible.filter((holding) => {
      const latestGroupDate = latestDateBySnapshotGroup.get(
        snapshotGroupKey(holding),
      );
      return !latestGroupDate || holding.snapshotDate === latestGroupDate;
    }),
  );
  return [...byInstrument.values()].sort((a, b) => {
    const dateOrder =
      new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime();
    if (dateOrder !== 0) return dateOrder;
    return a.instrumentName.localeCompare(b.instrumentName);
  });
}

function exitedNonAggregateHoldings<
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
  const eligible = nonAggregateEligibleHoldings(holdings);
  const latestDateBySnapshotGroup = latestSnapshotDatesByGroup(eligible);
  const byInstrument = latestSnapshotsByInstrument(eligible);

  return [...byInstrument.values()]
    .filter((holding) => {
      const latestGroupDate = latestDateBySnapshotGroup.get(
        snapshotGroupKey(holding),
      );
      return Boolean(
        latestGroupDate && holding.snapshotDate !== latestGroupDate,
      );
    })
    .sort((a, b) => {
      const dateOrder =
        new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime();
      if (dateOrder !== 0) return dateOrder;
      return a.instrumentName.localeCompare(b.instrumentName);
    });
}

function nonAggregateEligibleHoldings<
  T extends {
    assetClass: string;
    instrumentName: string;
    sourcePayload?: Record<string, unknown>;
  },
>(holdings: T[]) {
  const assetClassesWithDetails = new Set(
    holdings
      .filter((holding) => !isAggregateHolding(holding))
      .map((holding) => holding.assetClass),
  );
  return holdings.filter(
    (holding) =>
      !isAggregateHolding(holding) ||
      !assetClassesWithDetails.has(holding.assetClass),
  );
}

function latestSnapshotsByInstrument<
  T extends {
    snapshotDate: string;
    assetClass: string;
    instrumentName: string;
    symbol?: string | null;
    currency?: string;
  },
>(holdings: T[]): Map<string, T> {
  const byInstrument = new Map<string, T>();
  for (const holding of holdings) {
    const key = [
      holding.assetClass,
      holding.symbol?.trim().toUpperCase() ??
        holding.instrumentName.trim().toUpperCase(),
      holding.currency,
    ].join("|");
    const current = byInstrument.get(key);
    if (!current || holding.snapshotDate > current.snapshotDate) {
      byInstrument.set(key, holding);
    }
  }
  return byInstrument;
}

function latestSnapshotDatesByGroup<
  T extends {
    snapshotDate: string;
    accountName?: string;
    provider?: string;
    assetClass: string;
    currency?: string;
    sourcePayload?: Record<string, unknown>;
  },
>(holdings: T[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const holding of holdings) {
    const key = snapshotGroupKey(holding);
    const current = latest.get(key);
    if (!current || holding.snapshotDate > current) {
      latest.set(key, holding.snapshotDate);
    }
  }
  return latest;
}

function isCurrentHoldingSnapshot<
  TSelected extends {
    snapshotDate: string;
    accountName: string;
    provider: string;
    assetClass: string;
    currency: Currency;
    sourcePayload?: Record<string, unknown>;
  },
  THolding extends {
    snapshotDate: string;
    accountName?: string;
    provider?: string;
    assetClass: string;
    currency?: string;
    sourcePayload?: Record<string, unknown>;
  },
>(selected: TSelected, latest: { snapshotDate: string }, holdings: THolding[]) {
  const latestDate = latestSnapshotDatesByGroup(holdings).get(
    snapshotGroupKey(selected),
  );
  return latestDate === latest.snapshotDate;
}

function snapshotGroupKey(holding: {
  accountName?: string;
  provider?: string;
  assetClass: string;
  currency?: string;
  sourcePayload?: Record<string, unknown>;
}) {
  return [
    holding.accountName ?? "",
    holding.provider ?? "",
    holding.assetClass,
    holding.currency ?? "",
    String(holding.sourcePayload?.sourceSheet ?? ""),
  ].join("|");
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

async function assetClassSnapshotRows(
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

function valuationsFromSnapshotRows(
  rows: SnapshotValuationRow[],
  usdInrRate?: number,
): PerformanceValuationInput[] {
  const eligible = rows.filter((row) => !isAggregateHolding(row));
  const latestByInstrumentDate = new Map<string, SnapshotValuationRow>();

  for (const row of eligible) {
    const key = `${row.instrumentId}|${row.snapshotDate}`;
    latestByInstrumentDate.set(key, row);
  }

  const totalsByDate = new Map<
    string,
    { investedAmount: number; currentValue: number }
  >();

  for (const row of latestByInstrumentDate.values()) {
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

async function historyByInstrumentIds(
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
    grouped.set(row.instrumentId, [...(grouped.get(row.instrumentId) ?? []), row]);
  }
  return grouped;
}

async function transactionsByInstrumentIds(
  ctx: PortfolioContext,
  instrumentIds: string[],
) {
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
    grouped.set(row.instrumentId, [...(grouped.get(row.instrumentId) ?? []), row]);
  }
  return grouped;
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

function sum(values: number[]): number {
  return values.reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0,
  );
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}
