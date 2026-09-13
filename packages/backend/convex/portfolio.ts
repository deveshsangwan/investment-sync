import {
  valuePortfolioPublication,
  type PortfolioProjection,
} from "@investment-sync/portfolio-domain";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { readValuationQuote } from "./model/currencyRates";
import {
  activePortfolio,
  assetClassProjection,
  holdingDetailProjection,
  logPortfolioRead,
  overviewProjection,
  positionsProjection,
} from "./model/portfolioReads";
import {
  assetClassDetailViewValidator,
  assetClassValidator,
  holdingDetailViewValidator,
  overviewViewValidator,
  positionsViewValidator,
} from "./model/portfolioValidators";

export const overview = query({
  args: {},
  returns: overviewViewValidator,
  handler: async (ctx) => {
    const active = await activePortfolio(ctx);
    if (!active)
      return valuePortfolioPublication(emptyProjection(), undefined, {
        view: "overview",
      });
    const [readModel, quote] = await Promise.all([
      overviewProjection(ctx, active),
      readValuationQuote(ctx),
    ]);
    const value = valuePortfolioPublication(readModel.projection, quote, {
      view: "overview",
    });
    await logPortfolioRead(ctx, "overview", {
      ...readModel.counts,
      ranges: readModel.counts.ranges + 1,
    });

    return value;
  },
});

export const positions = query({
  args: {},
  returns: positionsViewValidator,
  handler: async (ctx) => {
    const active = await activePortfolio(ctx);
    if (!active)
      return valuePortfolioPublication(emptyProjection(), undefined, {
        view: "positions",
      });
    const [readModel, quote] = await Promise.all([
      positionsProjection(ctx, active),
      readValuationQuote(ctx),
    ]);
    const value = valuePortfolioPublication(readModel.projection, quote, {
      view: "positions",
    });
    await logPortfolioRead(ctx, "positions", {
      ...readModel.counts,
      ranges: readModel.counts.ranges + 1,
    });

    return value;
  },
});

export const holdingDetail = query({
  args: { positionKey: v.string() },
  returns: holdingDetailViewValidator,
  handler: async (ctx, args) => {
    const active = await activePortfolio(ctx);
    if (!active) return null;
    const readModel = await holdingDetailProjection(
      ctx,
      active,
      args.positionKey,
    );
    if (!readModel) return null;
    const quote = await readValuationQuote(ctx);
    const value = valuePortfolioPublication(readModel.projection, quote, {
      view: "holdingDetail",
      positionKey: readModel.positionKey,
    });
    await logPortfolioRead(ctx, "holdingDetail", {
      ...readModel.counts,
      ranges: readModel.counts.ranges + 1,
    });

    return value;
  },
});

export const assetClassDetail = query({
  args: { assetClass: assetClassValidator },
  returns: assetClassDetailViewValidator,
  handler: async (ctx, args) => {
    const active = await activePortfolio(ctx);
    if (!active)
      return valuePortfolioPublication(emptyProjection(), undefined, {
        view: "assetClassDetail",
        assetClass: args.assetClass,
      });
    const [readModel, quote] = await Promise.all([
      assetClassProjection(ctx, active, args.assetClass),
      readValuationQuote(ctx),
    ]);
    const value = valuePortfolioPublication(readModel.projection, quote, {
      view: "assetClassDetail",
      assetClass: args.assetClass,
    });
    await logPortfolioRead(ctx, "assetClassDetail", {
      ...readModel.counts,
      ranges: readModel.counts.ranges + 1,
    });

    return value;
  },
});

function emptyProjection(): PortfolioProjection {
  return {
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
}
