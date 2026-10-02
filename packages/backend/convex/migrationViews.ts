import {
  valuePortfolioPublication,
  type PortfolioProjection,
} from "@investment-sync/portfolio-domain";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { migrationTarget, requireMigration } from "./model/migration";
import {
  assetClassProjection,
  holdingDetailProjection,
  overviewProjection,
  positionsProjection,
} from "./model/portfolioReads";
import { assetClassValidator } from "./model/portfolioValidators";

const quoteValidator = v.union(
  v.object({ status: v.literal("unavailable") }),
  v.object({
    status: v.union(v.literal("fresh"), v.literal("stale")),
    rate: v.string(),
    fetchedAt: v.string(),
    provider: v.literal("frankfurter"),
  }),
);

export const portfolioView = internalQuery({
  args: {
    runKey: v.string(),
    legacyHouseholdId: v.string(),
    view: v.union(
      v.literal("overview"),
      v.literal("positions"),
      v.literal("holdingDetail"),
      v.literal("assetClassDetail"),
    ),
    positionKey: v.optional(v.string()),
    assetClass: v.optional(assetClassValidator),
    quote: quoteValidator,
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const household = await migrationTarget(
      ctx,
      args.runKey,
      "households",
      args.legacyHouseholdId,
      "households",
    );
    const version = household.activePortfolioVersionId
      ? await ctx.db.get(
          "portfolioVersions",
          household.activePortfolioVersionId,
        )
      : null;
    if (version && version.householdId !== household._id)
      throw new Error(
        "Active migration portfolio belongs to another household",
      );
    const active = version ? { household, version } : null;
    const empty: PortfolioProjection = {
      projectorVersion: "portfolio-v1",
      asOfDate: null,
      positions: [],
      totals: [],
      assetClasses: [],
      timeline: [],
      hasExplicitValuations: false,
      valuations: [],
      cashFlows: [],
    };
    try {
      switch (args.view) {
        case "overview": {
          const projection = active
            ? (await overviewProjection(ctx, active)).projection
            : empty;
          return JSON.stringify(
            valuePortfolioPublication(projection, args.quote, {
              view: "overview",
            }),
          );
        }
        case "positions": {
          const projection = active
            ? (await positionsProjection(ctx, active)).projection
            : empty;
          return JSON.stringify(
            valuePortfolioPublication(projection, args.quote, {
              view: "positions",
            }),
          );
        }
        case "holdingDetail": {
          if (!args.positionKey)
            throw new Error(
              "Holding detail requires positionKey or legacy UUID",
            );
          const model = active
            ? await holdingDetailProjection(ctx, active, args.positionKey)
            : null;
          return JSON.stringify(
            model
              ? valuePortfolioPublication(model.projection, args.quote, {
                  view: "holdingDetail",
                  positionKey: model.positionKey,
                })
              : null,
          );
        }
        case "assetClassDetail": {
          if (!args.assetClass)
            throw new Error("Asset class detail requires assetClass");
          const projection = active
            ? (await assetClassProjection(ctx, active, args.assetClass))
                .projection
            : empty;
          return JSON.stringify(
            valuePortfolioPublication(projection, args.quote, {
              view: "assetClassDetail",
              assetClass: args.assetClass,
            }),
          );
        }
      }
    } catch (error) {
      if (
        args.quote.status === "unavailable" &&
        error instanceof Error &&
        error.message === "USD/INR exchange rate is unavailable"
      )
        return JSON.stringify({ error: "CurrencyRateUnavailableError" });
      throw error;
    }
  },
});
