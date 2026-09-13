import type { NormalizedImportRow } from "./types";
import type { ImportSourceMetadata } from "./exact-types";

export function legacySourceMetadata(
  row: NormalizedImportRow,
): ImportSourceMetadata {
  const group =
    typeof row.metadata.sourceSheet === "string"
      ? row.metadata.sourceSheet
      : "";
  const isAggregate =
    row.metadata.isAggregate === true ||
    (typeof row.metadata.isAggregate === "string" &&
      row.metadata.isAggregate.trim().toLowerCase() === "true") ||
    group === "Investment Portfolio" ||
    (row.kind !== "valuation" &&
      row.instrumentName.trimEnd().toLowerCase().endsWith(" summary"));

  return {
    group,
    completeness: row.kind === "holding" ? "complete" : "partial",
    granularity:
      row.kind === "valuation"
        ? "portfolio"
        : isAggregate
          ? "asset_class"
          : "instrument",
    priority: row.sourceType === "nps_csv" ? 100 : 0,
  };
}
