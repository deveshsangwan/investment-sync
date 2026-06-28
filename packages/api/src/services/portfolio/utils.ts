import type { Database } from "@investment-sync/db";
import { getUsdInrRate } from "../currency-rates";
import type { Currency } from "./types";

export const AGGREGATE_HOLDING_NAME_SUFFIX = " Summary";
export const AGGREGATE_HOLDING_NAME_SQL_PATTERN = `%${AGGREGATE_HOLDING_NAME_SUFFIX.toLowerCase()}`;
export const AGGREGATE_HOLDING_SOURCE_VALUE = "true";

export function parseDate(
  value: string | Date | null | undefined,
): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function getUsdInrRateIfNeeded(
  currencies: Currency[],
  db?: Database,
) {
  return currencies.includes("USD") ? getUsdInrRate(db) : undefined;
}

export function convertToInr(
  amount: number,
  currency: Currency,
  usdInrRate?: number,
): number {
  if (!Number.isFinite(amount)) return 0;
  if (currency === "INR") return amount;
  if (currency === "USD" && usdInrRate) return amount * usdInrRate;
  return amount;
}

export function sum(values: number[]): number {
  return values.reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0,
  );
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isAggregateHolding(holding: {
  instrumentName: string;
  sourcePayload?: Record<string, unknown>;
}) {
  return (
    isAggregatePayloadValue(holding.sourcePayload?.isAggregate) ||
    holding.instrumentName
      .trimEnd()
      .toLowerCase()
      .endsWith(AGGREGATE_HOLDING_NAME_SUFFIX.toLowerCase())
  );
}

export function isAggregatePayloadValue(value: unknown) {
  return (
    value === true ||
    (typeof value === "string" &&
      value.trim().toLowerCase() === AGGREGATE_HOLDING_SOURCE_VALUE)
  );
}

export function sourceXirrFromPayload(payload?: Record<string, unknown>) {
  const value = payload?.xirr;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export type HoldingPositionIdentity = {
  accountId: string;
  accountName?: string;
  provider?: string;
  instrumentId: string;
  currency: Currency;
  sourceSheet?: string | null;
};

export function holdingPositionKey(value: HoldingPositionIdentity) {
  return [
    value.accountId,
    normalizeKeyPart(value.provider),
    normalizeKeyPart(value.accountName),
    value.instrumentId,
    value.currency,
    value.sourceSheet ?? "",
  ].join("|");
}

export function holdingSnapshotKey(
  value: HoldingPositionIdentity & { snapshotDate: string },
) {
  return `${holdingPositionKey(value)}|${value.snapshotDate}`;
}

export function holdingCashFlowKey(value: {
  accountId: string;
  instrumentId: string | null;
}) {
  return `${value.accountId}|${value.instrumentId ?? ""}`;
}

export function filterAggregateRowsBySnapshotGroup<
  T extends {
    accountId: string;
    accountName?: string;
    provider?: string;
    assetClass?: string;
    currency: Currency;
    sourceSheet?: string | null;
    snapshotDate: string;
    instrumentName: string;
    sourcePayload?: Record<string, unknown>;
  },
>(rows: T[]): T[] {
  const detailedGroups = new Set(
    rows
      .filter((row) => !isAggregateHolding(row))
      .map(aggregateSnapshotGroupKey),
  );

  return rows.filter(
    (row) =>
      !isAggregateHolding(row) ||
      !detailedGroups.has(aggregateSnapshotGroupKey(row)),
  );
}

function normalizeKeyPart(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function aggregateSnapshotGroupKey(value: {
  accountId: string;
  accountName?: string;
  provider?: string;
  assetClass?: string;
  currency: Currency;
  sourceSheet?: string | null;
  snapshotDate: string;
}) {
  return [
    value.accountId,
    normalizeKeyPart(value.provider),
    normalizeKeyPart(value.accountName),
    value.assetClass ?? "",
    value.currency,
    value.sourceSheet ?? "",
    value.snapshotDate,
  ].join("|");
}
