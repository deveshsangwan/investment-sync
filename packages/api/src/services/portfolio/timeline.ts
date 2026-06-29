import { holdingSnapshotTimelineRows, portfolioValuationRows } from "./data";
import { buildPortfolioTimelineFromValuations } from "./from-snapshot";
import { getUsdInrRateIfNeeded } from "./utils";
import type { PortfolioContext } from "./types";

export { buildPortfolioTimelineFromValuations } from "./from-snapshot";

export async function buildPortfolioTimeline(ctx: PortfolioContext) {
  const valuations = await portfolioValuationRows(ctx);

  if (valuations.length > 0) {
    const usdInrRate = await getUsdInrRateIfNeeded(
      valuations.map((valuation) => valuation.currency),
      ctx.db,
    );
    return buildPortfolioTimelineFromValuations(valuations, usdInrRate?.rate);
  }

  return holdingSnapshotTimelineRows(ctx);
}
