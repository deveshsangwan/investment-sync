import { buildPortfolioHoldingsFromSnapshot } from "./from-snapshot";
import { latestCurrentHoldings } from "./latest-holdings";
import { getUsdInrRateIfNeeded } from "./utils";
import type { PortfolioContext } from "./types";

export { buildPortfolioHoldingsFromSnapshot } from "./from-snapshot";

export async function buildPortfolioHoldings(ctx: PortfolioContext) {
  const latestHoldings = await latestCurrentHoldings(ctx);
  const usdInrRate = await getUsdInrRateIfNeeded(
    latestHoldings.map((holding) => holding.currency),
    ctx.db,
  );

  return buildPortfolioHoldingsFromSnapshot(latestHoldings, usdInrRate?.rate);
}
