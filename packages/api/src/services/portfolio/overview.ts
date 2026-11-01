import {
  cashFlowRows,
  holdingSnapshotTimelineRows,
  portfolioValuationRows,
  sourceSnapshotDates,
} from "./data";
import {
  buildPortfolioHoldingsFromSnapshot,
  buildPortfolioPerformanceFromSnapshot,
  buildPortfolioSummaryFromSnapshot,
  buildPortfolioTimelineFromValuations,
} from "./from-snapshot";
import { cachedPortfolioData } from "./cache";
import {
  latestCurrentHoldings,
  latestSourceSnapshotDate,
} from "./latest-holdings";
import { getUsdInrRateIfNeeded } from "./utils";
import type { PortfolioContext } from "./types";

export async function buildPortfolioOverview(ctx: PortfolioContext) {
  return cachedPortfolioData(ctx, "portfolio.overview", () =>
    buildPortfolioOverviewUncached(ctx),
  );
}

async function buildPortfolioOverviewUncached(ctx: PortfolioContext) {
  const [latestHoldings, valuations, cashFlows] = await Promise.all([
    latestCurrentHoldings(ctx),
    portfolioValuationRows(ctx),
    cashFlowRows(ctx),
  ]);

  const usdInrRate = await getUsdInrRateIfNeeded(
    [
      ...latestHoldings.map((holding) => holding.currency),
      ...cashFlows.map((flow) => flow.currency),
      ...valuations.map((valuation) => valuation.currency),
    ],
    ctx.db,
  );
  const summary = buildPortfolioSummaryFromSnapshot(
    latestHoldings,
    usdInrRate?.rate,
    usdInrRate ? [usdInrRate] : [],
    await latestSourceSnapshotDate(ctx),
  );
  let historicalTimeline =
    valuations.length > 0
      ? buildPortfolioTimelineFromValuations(valuations, usdInrRate?.rate)
      : await holdingSnapshotTimelineRows(ctx);
  if (valuations.length && summary.asOfDate) {
    const declarations = await sourceSnapshotDates(ctx);
    const firstDeclarationDate = declarations
      .map((declaration) => declaration.snapshotDate)
      .sort()[0];
    if (firstDeclarationDate) {
      const sourcePoints = (
        await holdingSnapshotTimelineRows(ctx, true)
      ).filter((point) => point.snapshotDate >= firstDeclarationDate);
      historicalTimeline = [
        ...new Map(
          [...sourcePoints, ...historicalTimeline].map((point) => [
            point.snapshotDate,
            point,
          ]),
        ).values(),
      ].sort((left, right) =>
        left.snapshotDate.localeCompare(right.snapshotDate),
      );
    }
  }
  const lastTimelinePoint = historicalTimeline.at(-1);
  let timeline = historicalTimeline;
  if (
    summary.asOfDate &&
    (!lastTimelinePoint || summary.asOfDate >= lastTimelinePoint.snapshotDate)
  ) {
    // ponytail: current carries older account snapshots forward; use synchronized
    // valuations if point-in-time precision becomes necessary.
    const currentPoint = {
      snapshotDate: summary.asOfDate,
      investedAmount: summary.investedAmount,
      currentValue: summary.currentValue,
      pnlAmount: summary.pnlAmount,
      currency: "INR" as const,
    };

    timeline =
      lastTimelinePoint?.snapshotDate === summary.asOfDate
        ? [...historicalTimeline.slice(0, -1), currentPoint]
        : [...historicalTimeline, currentPoint];
  }

  return {
    holdings: buildPortfolioHoldingsFromSnapshot(
      latestHoldings,
      usdInrRate?.rate,
    ),
    summary,
    performance: buildPortfolioPerformanceFromSnapshot(
      latestHoldings,
      valuations,
      cashFlows,
      usdInrRate?.rate,
      summary.asOfDate,
    ),
    timeline,
  };
}
