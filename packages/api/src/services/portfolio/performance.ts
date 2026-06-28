import { type PerformanceValuationInput } from "@investment-sync/analytics";
import { cashFlowRows, portfolioValuationRows } from "./data";
import { buildPortfolioPerformanceFromSnapshot } from "./from-snapshot";
import { latestCurrentHoldings } from "./latest-holdings";
import { convertToInr, getUsdInrRateIfNeeded, parseDate } from "./utils";
import type { Currency, PortfolioContext } from "./types";

export { buildPortfolioPerformanceFromSnapshot } from "./from-snapshot";

export function toPerformanceValuation(
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

export async function buildPortfolioPerformance(ctx: PortfolioContext) {
  const [latestHoldings, valuations, cashFlows] = await Promise.all([
    latestCurrentHoldings(ctx),
    portfolioValuationRows(ctx),
    cashFlowRows(ctx),
  ]);

  const usdInrRate = await getUsdInrRateIfNeeded(
    [
      ...latestHoldings.map((holding) => holding.currency),
      ...cashFlows.map((flow) => flow.currency),
      ...valuations.map((valuation) => valuation.currency),
    ],
    ctx.db,
  );

  return buildPortfolioPerformanceFromSnapshot(
    latestHoldings,
    valuations,
    cashFlows,
    usdInrRate?.rate,
  );
}
