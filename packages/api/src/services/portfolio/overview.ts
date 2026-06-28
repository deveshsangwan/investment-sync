import {
  cashFlowRows,
  holdingSnapshotTimelineRows,
  portfolioValuationRows,
} from "./data";
import { buildPortfolioHoldingsFromSnapshot } from "./holdings";
import { latestCurrentHoldings } from "./latest-holdings";
import { buildPortfolioPerformanceFromSnapshot } from "./performance";
import { buildPortfolioSummaryFromSnapshot } from "./summary";
import { buildPortfolioTimelineFromValuations } from "./timeline";
import { getUsdInrRateIfNeeded } from "./utils";
import type { PortfolioContext } from "./types";

export async function buildPortfolioOverview(ctx: PortfolioContext) {
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
