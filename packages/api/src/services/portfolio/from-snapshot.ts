import {
  summarizePerformance,
  summarizePortfolio,
  xirrByAssetClass,
} from "@investment-sync/analytics";
import type { CurrencyRateQuote } from "../currency-rates";
import {
  convertToInr,
  enrichHoldingWithInr,
  parseDate,
  sourceXirrFromPayload,
} from "./utils";
import type {
  CashFlowRow,
  CurrentHoldingRow,
  PortfolioValuationRow,
} from "./types";

export function buildPortfolioHoldingsFromSnapshot(
  latestHoldings: CurrentHoldingRow[],
  usdInrRate?: number,
) {
  return latestHoldings
    .map((holding) => enrichHoldingWithInr(holding, usdInrRate))
    .sort((a, b) => {
      const dateOrder =
        new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime();
      if (dateOrder !== 0) return dateOrder;
      return b.currentValueInInr - a.currentValueInInr;
    });
}

export function buildPortfolioSummaryFromSnapshot(
  latestHoldings: CurrentHoldingRow[],
  usdInrRate?: number,
  exchangeRates: CurrencyRateQuote[] = [],
) {
  const summary = summarizePortfolio(
    latestHoldings.map((holding) => ({
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
    })),
  );

  return {
    ...summary,
    currency: "INR" as const,
    exchangeRates,
    asOfDate: latestHoldings[0]?.snapshotDate ?? null,
  };
}

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

export function buildPortfolioTimelineFromValuations(
  valuations: PortfolioValuationRow[],
) {
  return valuations.map((valuation) => ({
    snapshotDate: valuation.valuationDate,
    currentValue: valuation.currentValue,
    investedAmount: valuation.investedAmount,
    pnlAmount: valuation.pnlAmount,
    currency: valuation.currency,
  }));
}
