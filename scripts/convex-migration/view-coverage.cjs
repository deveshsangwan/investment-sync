const assetClasses = [
  "indian_stock",
  "mutual_fund",
  "us_stock",
  "nps",
  "ulip",
  "crypto",
  "cash",
  "other",
];

function requireCompleteIds(expected, actual, description) {
  if (
    !Array.isArray(actual) ||
    actual.some((id) => typeof id !== "string") ||
    new Set(actual).size !== actual.length ||
    JSON.stringify([...expected].sort()) !== JSON.stringify([...actual].sort())
  )
    throw new Error(`Incomplete semantic coverage: ${description}`);
}

function validateSemanticCoverage(snapshot) {
  if (!Array.isArray(snapshot.views)) throw new Error("Missing semantic views");
  requireCompleteIds(
    snapshot.tables.households.map((row) => row.id),
    snapshot.views.map((view) => view.householdId),
    "households",
  );

  for (const view of snapshot.views) {
    if (
      !view.overview ||
      !view.positions ||
      !Array.isArray(view.holdingDetails) ||
      !Array.isArray(view.assetClassDetails)
    )
      throw new Error("Missing semantic view results");
    requireCompleteIds(
      assetClasses,
      view.assetClassDetails.map((entry) => entry.assetClass),
      "asset classes",
    );
    const holdingIds = snapshot.tables.holding_snapshots
      .filter((row) => row.household_id === view.householdId)
      .map((row) => row.id);
    requireCompleteIds(
      holdingIds,
      view.holdingDetails.map((entry) => entry.legacyId),
      "legacy holding links",
    );
    if (
      [...view.holdingDetails, ...view.assetClassDetails].some(
        (entry) => !Object.hasOwn(entry, "value"),
      )
    )
      throw new Error("Missing semantic detail result");

    if (view.positions.error === "CurrencyRateUnavailableError") continue;
    if (
      !Array.isArray(view.positions.current) ||
      !Array.isArray(view.positions.exited)
    )
      throw new Error("Missing Current or Exited semantic result");
    const known = new Set(holdingIds);
    if (
      [...view.positions.current, ...view.positions.exited].some(
        (holding) => !known.has(holding.id),
      )
    )
      throw new Error(
        "Position comparison refers to an unknown legacy holding",
      );
  }
}

module.exports = { validateSemanticCoverage };
