import { summarizePortfolio } from "@investment-sync/analytics";
import type { CurrencyRateQuote } from "../currency-rates";
import { latestCurrentHoldings } from "./latest-holdings";
import { convertToInr, getUsdInrRateIfNeeded } from "./utils";
import type { CurrentHoldingRow, PortfolioContext } from "./types";

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
