import type { ValuationQuote } from "@investment-sync/portfolio-domain";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const usdInrRate = {
  base: "USD",
  quote: "INR",
  provider: "frankfurter",
} as const;

export const currencyRatePolicy = {
  freshMilliseconds: 6 * 60 * 60 * 1000,
  usableMilliseconds: 7 * 24 * 60 * 60 * 1000,
  requestTimeoutMilliseconds: 4000,
  retryDelayMilliseconds: 100,
} as const;

export async function readValuationQuote(ctx: QueryCtx) {
  const rates = await ctx.db
    .query("currencyRates")
    .withIndex("by_base_and_quote_and_provider", (query) =>
      query
        .eq("base", usdInrRate.base)
        .eq("quote", usdInrRate.quote)
        .eq("provider", usdInrRate.provider),
    )
    .take(2);
  if (rates.length > 1) throw new Error("USD/INR rate state is ambiguous");

  return toValuationQuote(rates[0]);
}

export function toValuationQuote(
  rate: Doc<"currencyRates"> | undefined,
): ValuationQuote {
  if (!rate || rate.status === "unavailable" || !rate.rate || !rate.fetchedAt) {
    return { status: "unavailable" };
  }

  return {
    status: rate.status,
    rate: rate.rate,
    fetchedAt: rate.fetchedAt,
    provider: rate.provider,
  };
}
