import type { ValuationQuote } from "@investment-sync/portfolio-domain";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";

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

export function classifyQuoteAge(fetchedAt: string, evaluationTime: number) {
  const age = evaluationTime - Date.parse(fetchedAt);
  if (age >= currencyRatePolicy.usableMilliseconds) return "unavailable";
  if (age >= currencyRatePolicy.freshMilliseconds) return "stale";

  return "fresh";
}

export async function scheduleQuoteExpiry(
  ctx: MutationCtx,
  fetchedAt: string,
  quoteRevision: number,
) {
  const fetchedInstant = Date.parse(fetchedAt);
  await ctx.scheduler.runAt(
    fetchedInstant + currencyRatePolicy.freshMilliseconds,
    internal.currencyRates.markStale,
    { quoteRevision },
  );
  await ctx.scheduler.runAt(
    fetchedInstant + currencyRatePolicy.usableMilliseconds,
    internal.currencyRates.markUnavailable,
    { quoteRevision },
  );
}

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
