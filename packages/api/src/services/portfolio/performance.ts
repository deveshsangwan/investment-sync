import {
  summarizePerformance,
  xirrByAssetClass,
  type PerformanceValuationInput,
} from "@investment-sync/analytics";
import { cashFlowRows, portfolioValuationRows } from "./data";
import { latestCurrentHoldings } from "./latest-holdings";
import {
  convertToInr,
  getUsdInrRateIfNeeded,
  parseDate,
  sourceXirrFromPayload,
} from "./utils";
import type {
  CashFlowRow,
  CurrentHoldingRow,
  Currency,
  PortfolioContext,
  PortfolioValuationRow,
} from "./types";

export function buildPortfolioPerformanceFromSnapshot(
  latestHoldings: CurrentHoldingRow[],
  valuations: PortfolioValuationRow[],
  cashFlows: CashFlowRow[],
  usdInrRate?: number,
) {
  const asOfDate = parseDate(latestHoldings[0]?.snapshotDate) ?? new Date();
  const performanceHoldings = latestHoldings.map((holding) => ({
    assetClass: holding.assetClass,
    investedAmount: convertToInr(
      Number(holding.investedAmount),
      holding.currency,
      usdInrRate,
    ),
    currentValue: convertToInr(
      Number(holding.currentValue),
      holding.currency,
      usdInrRate,
    ),
    sourceXirr: sourceXirrFromPayload(holding.sourcePayload),
  }));
  const performance = summarizePerformance({
    holdings: performanceHoldings,
    cashFlows: cashFlows.map((flow) => ({
      date: parseDate(flow.tradeDate) ?? new Date(flow.tradeDate),
      amount: convertToInr(Number(flow.amount), flow.currency, usdInrRate),
      type: flow.type,
    })),
    valuations: valuations.map((valuation) => ({
      date:
        parseDate(valuation.valuationDate) ?? new Date(valuation.valuationDate),
      investedAmount: convertToInr(
        Number(valuation.investedAmount),
        valuation.currency,
        usdInrRate,
      ),
      currentValue: convertToInr(
        Number(valuation.currentValue),
        valuation.currency,
        usdInrRate,
      ),
    })),
    asOfDate,
  });

  return {
    ...performance,
    byAssetClass: xirrByAssetClass({ holdings: performanceHoldings }),
    asOfDate: latestHoldings[0]?.snapshotDate ?? null,
  };
}

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
