import { INVESTMENT_PORTFOLIO_SUMMARY_SHEET } from "@investment-sync/importers";
import { sql, type SQLWrapper } from "drizzle-orm";

export const AGGREGATE_HOLDING_NAME_SUFFIX = " Summary";
export const AGGREGATE_HOLDING_NAME_SUFFIX_LOWER =
  AGGREGATE_HOLDING_NAME_SUFFIX.toLowerCase();
export const AGGREGATE_HOLDING_SOURCE_VALUE = "true";

export function isAggregatePayloadValue(value: unknown) {
  return (
    value === true ||
    (typeof value === "string" &&
      value.trim().toLowerCase() === AGGREGATE_HOLDING_SOURCE_VALUE)
  );
}

export function isAggregateHolding(holding: {
  instrumentName: string;
  sourcePayload?: Record<string, unknown>;
  sourceSheet?: string | null;
}) {
  const sourceSheet =
    holding.sourceSheet ??
    (typeof holding.sourcePayload?.sourceSheet === "string"
      ? holding.sourcePayload.sourceSheet
      : undefined);

  return (
    isAggregatePayloadValue(holding.sourcePayload?.isAggregate) ||
    sourceSheet === INVESTMENT_PORTFOLIO_SUMMARY_SHEET ||
    holding.instrumentName
      .trimEnd()
      .toLowerCase()
      .endsWith(AGGREGATE_HOLDING_NAME_SUFFIX.toLowerCase())
  );
}

export function aggregateDetectionSql(
  aliasForPayload: SQLWrapper,
  aliasForInstrumentName: SQLWrapper,
  aliasForSourceSheet: SQLWrapper,
) {
  return sql`
    lower(trim(coalesce(${aliasForPayload}->>'isAggregate', ''))) = ${AGGREGATE_HOLDING_SOURCE_VALUE}
    or ${aliasForSourceSheet} = ${INVESTMENT_PORTFOLIO_SUMMARY_SHEET}
    or (
      right(
        lower(rtrim(${aliasForInstrumentName})),
        ${AGGREGATE_HOLDING_NAME_SUFFIX_LOWER.length}
      ) = ${AGGREGATE_HOLDING_NAME_SUFFIX_LOWER}
    )
  `;
}

/** Shared snapshot-group match for quoted CTE columns (latest-holdings). */
export function aggregateSnapshotGroupMatchSql(
  details: SQLWrapper,
  base: SQLWrapper,
) {
  return sql`
    ${details}."assetClass" = ${base}."assetClass"
    and ${details}."accountId" = ${base}."accountId"
    and lower(trim(${details}."accountName")) = lower(trim(${base}."accountName"))
    and lower(trim(${details}."provider")) = lower(trim(${base}."provider"))
    and ${details}."currency" = ${base}."currency"
    and ${details}."sourceSheet" = ${base}."sourceSheet"
    and ${details}."snapshotDate" = ${base}."snapshotDate"
  `;
}
