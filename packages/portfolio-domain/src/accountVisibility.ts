import { accountKey } from "./identity";
import {
  eligibleSnapshots,
  nativeTotals,
  snapshotTimeline,
  timelineWithManualPolicies,
} from "./sourceSnapshots";
import type { PortfolioProjection, PositionProjection } from "./types";

export function visibleAccountProjection(
  projection: PortfolioProjection,
  archivedAccountKeys: ReadonlySet<string>,
): PortfolioProjection {
  const isVisible = (fact: { row: Parameters<typeof accountKey>[0] }) =>
    !archivedAccountKeys.has(accountKey(fact.row));
  const filterPosition = (position: PositionProjection) => ({
    ...position,
    history: position.history.filter(isVisible),
    transactions: position.transactions.filter(isVisible),
    instrumentHistory: position.instrumentHistory.filter(isVisible),
    instrumentTransactions: position.instrumentTransactions.filter(isVisible),
  });
  // Source selection is already complete. Hiding its winners must never revive
  // older overlapping sources or erase persisted transaction occurrence IDs.
  const positions = projection.positions
    .filter((position) => isVisible(position.holding))
    .map(filterPosition);
  const detailPositions = projection.detailPositions
    ?.filter((position) => isVisible(position.holding))
    .map(filterPosition);
  const current = positions.filter((position) => position.status === "current");
  const history = new Map(
    [...projection.positions, ...(projection.detailPositions ?? [])]
      .flatMap((position) => position.history)
      .map((fact) => [fact.factKey, fact]),
  );
  const declarations = projection.sourceSnapshots ?? [];
  const visibleDeclarations = declarations.filter(isVisible);
  const eligible = eligibleSnapshots([...history.values()]);
  const timeline = (holdings: typeof eligible, assetClass?: string) => {
    const sourceSnapshots = declarations.filter(
      (fact) => !assetClass || fact.row.assetClass === assetClass,
    );
    return timelineWithManualPolicies(
      holdings,
      snapshotTimeline(
        holdings.filter(isVisible),
        sourceSnapshots.filter(isVisible),
      ),
      false,
      archivedAccountKeys,
      sourceSnapshots,
    );
  };

  return {
    ...projection,
    positions,
    detailPositions,
    asOfDate:
      [
        ...current.map((position) => position.holding.snapshotDate),
        ...visibleDeclarations.map((fact) => fact.snapshotDate),
      ]
        .sort()
        .at(-1) ?? null,
    totals: nativeTotals(current.map((position) => position.holding.row)),
    assetClasses: projection.assetClasses.map((asset) => ({
      ...asset,
      totals: nativeTotals(
        current
          .filter(
            (position) => position.holding.row.assetClass === asset.assetClass,
          )
          .map((position) => position.holding.row),
      ),
      timeline: timeline(
        eligible.filter((fact) => fact.row.assetClass === asset.assetClass),
        asset.assetClass,
      ),
    })),
    timeline: timeline(eligible),
    // Reported portfolio totals have no account attribution and cannot be
    // apportioned safely. Use visible holding history while accounts are hidden.
    hasExplicitValuations: false,
    valuations: [],
    cashFlows: projection.cashFlows.filter(isVisible),
  };
}
