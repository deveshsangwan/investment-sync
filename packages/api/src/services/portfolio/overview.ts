import {
  cashFlowRows,
  holdingSnapshotTimelineRows,
  portfolioValuationRows,
} from "./data";
import {
  buildPortfolioHoldingsFromSnapshot,
  buildPortfolioPerformanceFromSnapshot,
  buildPortfolioSummaryFromSnapshot,
  buildPortfolioTimelineFromValuations,
} from "./from-snapshot";
import { cachedPortfolioData } from "./cache";
import { latestCurrentHoldings } from "./latest-holdings";
import { getUsdInrRateIfNeeded } from "./utils";
import type { PortfolioContext } from "./types";

export async function buildPortfolioOverview(ctx: PortfolioContext) {
  return cachedPortfolioData(ctx, "portfolio.overview", () =>
    buildPortfolioOverviewUncached(ctx),
  );
}

async function buildPortfolioOverviewUncached(ctx: PortfolioContext) {
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
  const timeline =
    valuations.length > 0
      ? buildPortfolioTimelineFromValuations(valuations)
      : await holdingSnapshotTimelineRows(ctx);

  return {
    holdings: buildPortfolioHoldingsFromSnapshot(
      latestHoldings,
      usdInrRate?.rate,
    ),
    summary: buildPortfolioSummaryFromSnapshot(
      latestHoldings,
      usdInrRate?.rate,
      usdInrRate ? [usdInrRate] : [],
    ),
    performance: buildPortfolioPerformanceFromSnapshot(
      latestHoldings,
      valuations,
      cashFlows,
      usdInrRate?.rate,
    ),
    timeline,
  };
}
