import { latestCurrentHoldings } from "./latest-holdings";
import { convertToInr, getUsdInrRateIfNeeded } from "./utils";
import type { CurrentHoldingRow, PortfolioContext } from "./types";

export function buildPortfolioHoldingsFromSnapshot(
  latestHoldings: CurrentHoldingRow[],
  usdInrRate?: number,
) {
  return latestHoldings
    .map((holding) => {
      const investedAmount = Number(holding.investedAmount);
      const currentValue = Number(holding.currentValue);
      const pnlAmount =
        holding.pnlAmount === null ? null : Number(holding.pnlAmount);

      return {
        ...holding,
        currentValueInInr: convertToInr(
          currentValue,
          holding.currency,
          usdInrRate,
        ),
        investedAmountInInr: convertToInr(
          investedAmount,
          holding.currency,
          usdInrRate,
        ),
        pnlAmountInInr:
          pnlAmount === null
            ? null
            : convertToInr(pnlAmount, holding.currency, usdInrRate),
      };
    })
    .sort((a, b) => {
      const dateOrder =
        new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime();
      if (dateOrder !== 0) return dateOrder;
      return b.currentValueInInr - a.currentValueInInr;
    });
}

export async function buildPortfolioHoldings(ctx: PortfolioContext) {
  const latestHoldings = await latestCurrentHoldings(ctx);
  const usdInrRate = await getUsdInrRateIfNeeded(
    latestHoldings.map((holding) => holding.currency),
    ctx.db,
  );

  return buildPortfolioHoldingsFromSnapshot(latestHoldings, usdInrRate?.rate);
}
