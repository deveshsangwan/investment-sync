import { buildPortfolioHoldingsFromSnapshot } from "./from-snapshot";
import {
  exitedCurrentHoldings,
  latestCurrentHoldings,
} from "./latest-holdings";
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

export async function buildPortfolioPositions(ctx: PortfolioContext) {
  const [current, exited] = await Promise.all([
    latestCurrentHoldings(ctx),
    exitedCurrentHoldings(ctx),
  ]);
  const usdInrRate = await getUsdInrRateIfNeeded(
    [...current, ...exited].map((holding) => holding.currency),
    ctx.db,
  );

  return {
    current: buildPortfolioHoldingsFromSnapshot(current, usdInrRate?.rate),
    exited: buildPortfolioHoldingsFromSnapshot(exited, usdInrRate?.rate),
  };
}
