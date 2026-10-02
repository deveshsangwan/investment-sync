import { createClient } from "../../packages/api/node_modules/@supabase/supabase-js/dist/index.mjs";
import type { Database } from "../../packages/db/src/client";
import { assetClassEnum } from "../../packages/db/src/schema";
import { buildPortfolioOverview } from "../../packages/api/src/services/portfolio/overview";
import { buildPortfolioPositions } from "../../packages/api/src/services/portfolio/holdings";
import {
  buildAssetClassDetail,
  buildHoldingDetail,
} from "../../packages/api/src/services/portfolio/detail";
import type { PortfolioContext } from "../../packages/api/src/services/portfolio/types";

/** Run the retained SQL services, on the caller's read-only snapshot connection. */
export async function collectLegacyViews(
  db: Database,
  householdIds: string[],
  evaluationTime: string,
) {
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  Date.now = () => Date.parse(evaluationTime);
  // A comparison must use the saved quote and must never refresh production FX.
  globalThis.fetch = () =>
    Promise.reject(new Error("Network disabled during snapshot comparison"));

  try {
    const views = [];
    for (const householdId of householdIds) {
      const ctx: PortfolioContext = {
        db,
        auth: { userId: null },
        supabase: createClient<Record<string, unknown>>(
          "http://127.0.0.1:1",
          "snapshot-comparison",
        ),
        cache: new Map(),
        membership: { householdId },
      };
      const positions = await capture(() => buildPortfolioPositions(ctx));
      const details = [];
      if ("current" in positions) {
        const ids = new Set(
          [...positions.current, ...positions.exited].map(
            (holding) => holding.id,
          ),
        );
        for (const id of ids)
          details.push({
            legacyId: id,
            value: await capture(() => buildHoldingDetail(ctx, id)),
          });
      }

      const assetClasses = [];
      for (const assetClass of assetClassEnum.enumValues) {
        assetClasses.push({
          assetClass,
          value: await capture(() => buildAssetClassDetail(ctx, assetClass)),
        });
      }

      views.push({
        householdId,
        overview: await capture(() => buildPortfolioOverview(ctx)),
        positions,
        holdingDetails: details,
        assetClassDetails: assetClasses,
      });
    }

    return views;
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
}

async function capture<T>(
  operation: () => Promise<T>,
): Promise<T | { error: "CurrencyRateUnavailableError" }> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error && error.name === "CurrencyRateUnavailableError")
      return { error: "CurrencyRateUnavailableError" };
    if (
      typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      error._tag === "CurrencyRateUnavailableError"
    )
      return { error: "CurrencyRateUnavailableError" };

    throw error;
  }
}
