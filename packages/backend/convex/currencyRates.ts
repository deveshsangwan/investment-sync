import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { overviewProjection } from "./model/portfolioReads";
import type { MutationCtx } from "./_generated/server";
import {
  classifyQuoteAge,
  scheduleQuoteExpiry,
  usdInrRate,
} from "./model/currencyRates";
import {
  hasMigrationWriteFreeze,
  requireApplicationWritesEnabled,
} from "./model/migrationFreeze";

const settlementValidator = v.union(
  v.literal("saved"),
  v.literal("retained"),
  v.literal("superseded"),
);

export const beginRefresh = internalMutation({
  args: {},
  returns: v.object({ requestRevision: v.number() }),
  handler: async (ctx) => {
    requireApplicationWritesEnabled();
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
    if (hasMigrationWriteFreeze()) return "superseded";
    validateRefreshRevision(args.requestRevision);
    validateQuote(args.rate, args.fetchedAt);
    const current = await currentRate(ctx);
    if (!current || current.refreshRevision !== args.requestRevision)
      return "superseded";

    await ctx.db.patch("currencyRates", current._id, {
      status: classifyQuoteAge(args.fetchedAt, Date.now()),
      rate: args.rate,
      fetchedAt: args.fetchedAt,
      quoteRevision: args.requestRevision,
    });
    await scheduleQuoteExpiry(ctx, args.fetchedAt, args.requestRevision);

    return "saved";
  },
});

export const retainQuoteAfterFailure = internalMutation({
  args: { requestRevision: v.number() },
  returns: settlementValidator,
  handler: async (ctx, args) => {
    validateRefreshRevision(args.requestRevision);
    const current = await currentRate(ctx);

    if (!current || current.refreshRevision !== args.requestRevision)
      return "superseded";
    if (current.fetchedAt && current.status !== "unavailable") {
      const status = classifyQuoteAge(current.fetchedAt, Date.now());
      if (status !== current.status)
        await ctx.db.patch("currencyRates", current._id, { status });
    }

    return "retained";
  },
});

export const markStale = internalMutation({
  args: { quoteRevision: v.number() },
  returns: v.union(
    v.literal("stale"),
    v.literal("unavailable"),
    v.literal("superseded"),
  ),
  handler: async (ctx, args) => {
    validateRefreshRevision(args.quoteRevision);
    const current = await currentRate(ctx);
    if (
      !current ||
      current.quoteRevision !== args.quoteRevision ||
      current.status !== "fresh" ||
      !current.fetchedAt
    ) {
      return "superseded";
    }

    const status = classifyQuoteAge(current.fetchedAt, Date.now());
    if (status === "fresh") return "superseded";

    // Expiry changes only usability. It must still update subscriptions when
    // migration freezes quote replacement and a deadline passes during review.
    await ctx.db.patch("currencyRates", current._id, { status });
    return status;
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
      current.status === "unavailable" ||
      !current.fetchedAt ||
      classifyQuoteAge(current.fetchedAt, Date.now()) !== "unavailable"
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

export const historicalRequests = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), beforeDate: v.string() },
  returns: v.object({
    dates: v.array(v.string()),
    continuationCursor: v.union(v.string(), v.null()),
    hasMoreDates: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("households")
      .paginate({ cursor: args.cursor, numItems: 1 });
    const dates: string[] = [];

    for (const household of page.page) {
      if (!household.activePortfolioVersionId) continue;

      const version = await ctx.db.get(household.activePortfolioVersionId);

      if (!version || version.householdId !== household._id) continue;

      const model = await overviewProjection(ctx, { household, version });
      const candidates = [
        ...new Set(
          model.projection.timeline
            .filter(
              (point) =>
                point.snapshotDate < args.beforeDate &&
                point.totals.some(
                  (total) =>
                    total.currency === "USD" &&
                    (Number(total.currentValue) !== 0 ||
                      Number(total.investedAmount) !== 0),
                ),
            )
            .map((point) => point.snapshotDate),
        ),
      ];

      for (const date of candidates) {
        const existing = await ctx.db
          .query("historicalCurrencyRates")
          .withIndex("by_date", (q) => q.eq("date", date))
          .unique();

        if (!existing) dates.push(date);

        if (dates.length > 20) break;
      }
    }

    return {
      dates: dates.slice(0, 20),
      continuationCursor: page.isDone ? null : page.continueCursor,
      hasMoreDates: dates.length > 20,
    };
  },
});

export const saveHistoricalQuotes = internalMutation({
  args: {
    quotes: v.array(
      v.object({ date: v.string(), rateDate: v.string(), rate: v.string() }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    if (hasMigrationWriteFreeze()) return 0;

    if (args.quotes.length > 20) throw new Error("Too many historical rates");

    let saved = 0;
    for (const quote of args.quotes) {
      const requested = Date.parse(quote.date);
      const observed = Date.parse(quote.rateDate);
      const rate = Number(quote.rate);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(quote.date) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(quote.rateDate) ||
        !Number.isFinite(requested) ||
        !Number.isFinite(observed) ||
        new Date(requested).toISOString().slice(0, 10) !== quote.date ||
        new Date(observed).toISOString().slice(0, 10) !== quote.rateDate ||
        quote.date >= new Date().toISOString().slice(0, 10) ||
        observed > requested ||
        requested - observed > 7 * 86400000 ||
        !Number.isFinite(rate) ||
        rate <= 0
      )
        throw new Error("Invalid historical USD/INR rate");

      const existing = await ctx.db
        .query("historicalCurrencyRates")
        .withIndex("by_date", (q) => q.eq("date", quote.date))
        .unique();

      if (existing) continue;

      await ctx.db.insert("historicalCurrencyRates", {
        ...quote,
        provider: "frankfurter-ecb",
        fetchedAt: new Date().toISOString(),
      });
      saved += 1;
    }

    return saved;
  },
});
