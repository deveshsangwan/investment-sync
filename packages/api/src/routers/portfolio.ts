import { assetClassEnum } from "@investment-sync/db";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import {
  buildAssetClassDetail,
  buildHoldingDetail,
} from "../services/portfolio/detail";
import {
  buildPortfolioHoldings,
  buildPortfolioPositions,
} from "../services/portfolio/holdings";
import { buildPortfolioOverview } from "../services/portfolio/overview";
import { buildPortfolioSummary } from "../services/portfolio/summary";

export const portfolioRouter = router({
  holdings: protectedProcedure.query(async ({ ctx }) =>
    buildPortfolioHoldings(ctx),
  ),
  positions: protectedProcedure.query(async ({ ctx }) =>
    buildPortfolioPositions(ctx),
  ),
  summary: protectedProcedure.query(async ({ ctx }) =>
    buildPortfolioSummary(ctx),
  ),
  overview: protectedProcedure.query(async ({ ctx }) =>
    buildPortfolioOverview(ctx),
  ),
  holdingDetail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => buildHoldingDetail(ctx, input.id)),
  assetClassDetail: protectedProcedure
    .input(z.object({ assetClass: z.enum(assetClassEnum.enumValues) }))
    .query(async ({ ctx, input }) =>
      buildAssetClassDetail(ctx, input.assetClass),
    ),
});
