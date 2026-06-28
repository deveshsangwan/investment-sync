import { holdingSnapshotTimelineRows, portfolioValuationRows } from "./data";
import { buildPortfolioTimelineFromValuations } from "./from-snapshot";
import type { PortfolioContext } from "./types";

export { buildPortfolioTimelineFromValuations } from "./from-snapshot";

export async function buildPortfolioTimeline(ctx: PortfolioContext) {
  const valuations = await portfolioValuationRows(ctx);

  if (valuations.length > 0) {
    return buildPortfolioTimelineFromValuations(valuations);
  }

  return holdingSnapshotTimelineRows(ctx);
}
