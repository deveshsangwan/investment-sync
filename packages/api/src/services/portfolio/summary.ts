import { buildPortfolioSummaryFromSnapshot } from "./from-snapshot";
import { latestCurrentHoldings } from "./latest-holdings";
import { getUsdInrRateIfNeeded } from "./utils";
import type { PortfolioContext } from "./types";

export { buildPortfolioSummaryFromSnapshot } from "./from-snapshot";

export async function buildPortfolioSummary(ctx: PortfolioContext) {
  const latestHoldings = await latestCurrentHoldings(ctx);
  const usdInrRate = await getUsdInrRateIfNeeded(
    latestHoldings.map((holding) => holding.currency),
    ctx.db,
  );

  return buildPortfolioSummaryFromSnapshot(
    latestHoldings,
    usdInrRate?.rate,
    usdInrRate ? [usdInrRate] : [],
  );
}
