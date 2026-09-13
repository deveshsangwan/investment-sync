import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { currencyRatePolicy, usdInrRate } from "./model/currencyRates";

const settlementValidator = v.union(
  v.literal("saved"),
  v.literal("retained"),
  v.literal("superseded"),
);

export const beginRefresh = internalMutation({
  args: {},
  returns: v.object({ requestRevision: v.number() }),
  handler: async (ctx) => {
    const current = await currentRate(ctx);
    const requestRevision = (current?.refreshRevision ?? 0) + 1;

    if (current) {
      await ctx.db.patch("currencyRates", current._id, {
        refreshRevision: requestRevision,
      });
    } else {
      await ctx.db.insert("currencyRates", {
        ...usdInrRate,
        status: "unavailable",
        refreshRevision: requestRevision,
      });
    }

    return { requestRevision };
  },
});

export const saveQuote = internalMutation({
  args: {
    requestRevision: v.number(),
    rate: v.string(),
    fetchedAt: v.string(),
  },
  returns: settlementValidator,
  handler: async (ctx, args) => {
    validateRefreshRevision(args.requestRevision);
    validateQuote(args.rate, args.fetchedAt);
    const current = await currentRate(ctx);
    if (!current || current.refreshRevision !== args.requestRevision)
      return "superseded";

    await ctx.db.patch("currencyRates", current._id, {
      status: "fresh",
      rate: args.rate,
      fetchedAt: args.fetchedAt,
      quoteRevision: args.requestRevision,
    });
    const fetchedAt = Date.parse(args.fetchedAt);
    await ctx.scheduler.runAt(
      fetchedAt + currencyRatePolicy.freshMilliseconds,
      internal.currencyRates.markStale,
      { quoteRevision: args.requestRevision },
    );
    await ctx.scheduler.runAt(
      fetchedAt + currencyRatePolicy.usableMilliseconds,
      internal.currencyRates.markUnavailable,
      { quoteRevision: args.requestRevision },
    );

    return "saved";
  },
});

export const retainQuoteAfterFailure = internalMutation({
  args: { requestRevision: v.number() },
  returns: settlementValidator,
  handler: async (ctx, args) => {
    validateRefreshRevision(args.requestRevision);
    const current = await currentRate(ctx);

    return current?.refreshRevision === args.requestRevision
      ? "retained"
      : "superseded";
  },
});

export const markStale = internalMutation({
  args: { quoteRevision: v.number() },
  returns: v.union(v.literal("stale"), v.literal("superseded")),
  handler: async (ctx, args) => {
    validateRefreshRevision(args.quoteRevision);
    const current = await currentRate(ctx);
    if (
      !current ||
      current.quoteRevision !== args.quoteRevision ||
      current.status !== "fresh"
    ) {
      return "superseded";
    }

    await ctx.db.patch("currencyRates", current._id, { status: "stale" });
    return "stale";
  },
});

export const markUnavailable = internalMutation({
  args: { quoteRevision: v.number() },
  returns: v.union(v.literal("unavailable"), v.literal("superseded")),
  handler: async (ctx, args) => {
    validateRefreshRevision(args.quoteRevision);
    const current = await currentRate(ctx);
    if (
      !current ||
      current.quoteRevision !== args.quoteRevision ||
      current.status === "unavailable"
    ) {
      return "superseded";
    }

    await ctx.db.patch("currencyRates", current._id, {
      status: "unavailable",
    });
    return "unavailable";
  },
});

async function currentRate(ctx: Pick<MutationCtx, "db">) {
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

  return rates[0];
}

function validateRefreshRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error("Invalid currency-rate revision");
}

function validateQuote(rate: string, fetchedAt: string) {
  const numericRate = Number(rate);
  const instant = Date.parse(fetchedAt);
  if (
    !Number.isFinite(numericRate) ||
    numericRate <= 0 ||
    !Number.isFinite(instant) ||
    new Date(instant).toISOString() !== fetchedAt
  ) {
    throw new Error("Invalid USD/INR quote");
  }
}
