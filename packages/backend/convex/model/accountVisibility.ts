import {
  visibleAccountProjection,
  type PortfolioProjection,
} from "@investment-sync/portfolio-domain";
import type { QueryCtx } from "../_generated/server";
import type { ActivePortfolio } from "./portfolioReads";
import { completeProjection } from "./portfolioReads";
import { capacityError, portfolioLimits } from "./portfolioLimits";

export async function accountPreferences(
  ctx: QueryCtx,
  active: ActivePortfolio,
) {
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_householdId_and_key", (q) =>
      q.eq("householdId", active.household._id),
    )
    .take(portfolioLimits.accounts + 1);
  if (accounts.length > portfolioLimits.accounts)
    capacityError("Household account capacity exceeded");

  return accounts;
}

export async function archivedProjection(
  ctx: QueryCtx,
  active: ActivePortfolio,
  accounts: Awaited<ReturnType<typeof accountPreferences>>,
) {
  if (!accounts.some((account) => account.isArchived)) return null;

  const readModel = await completeProjection(ctx, active);
  return {
    ...readModel,
    projection: visibleAccountProjection(
      readModel.projection,
      new Set(
        accounts
          .filter((account) => account.isArchived)
          .map((account) => account.key),
      ),
    ),
  };
}

export function applyAccountNames(
  projection: PortfolioProjection,
  accounts: Awaited<ReturnType<typeof accountPreferences>>,
) {
  const names = new Map(
    accounts.map((account) => [
      account.key,
      account.displayName ?? account.name,
    ]),
  );
  const renameHolding = (
    holding: PortfolioProjection["positions"][number]["holding"],
  ) => ({
    ...holding,
    row: {
      ...holding.row,
      accountName: names.get(holding.accountKey) ?? holding.row.accountName,
    },
  });
  const renamePosition = (
    position: PortfolioProjection["positions"][number],
  ) => ({
    ...position,
    holding: renameHolding(position.holding),
    history: position.history.map(renameHolding),
    instrumentHistory: position.instrumentHistory.map(renameHolding),
  });

  return {
    ...projection,
    positions: projection.positions.map(renamePosition),
    detailPositions: projection.detailPositions?.map(renamePosition),
  };
}
