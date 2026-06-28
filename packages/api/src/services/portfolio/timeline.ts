import { holdingSnapshotTimelineRows, portfolioValuationRows } from "./data";
import type { PortfolioContext, PortfolioValuationRow } from "./types";

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

export async function buildPortfolioTimeline(ctx: PortfolioContext) {
  const valuations = await portfolioValuationRows(ctx);

  if (valuations.length > 0) {
    return buildPortfolioTimelineFromValuations(valuations);
  }

  return holdingSnapshotTimelineRows(ctx);
}
