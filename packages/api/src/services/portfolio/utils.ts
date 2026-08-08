import type { Database } from "@investment-sync/db";
import { npsDetailsSchema, type NpsDetails } from "@investment-sync/importers";
import { getUsdInrRate } from "../currency-rates";
import { isAggregateHolding } from "./aggregates";
import type { Currency, CurrentHoldingRow } from "./types";

export type SnapshotAmountRow = {
  accountId: string;
  accountName?: string;
  provider?: string;
  instrumentId: string;
  assetClass?: string;
  currency: Currency;
  sourceSheet?: string | null;
  snapshotDate: string;
  investedAmount: string | number;
  currentValue: string | number;
  instrumentName: string;
  sourcePayload?: Record<string, unknown>;
};

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

/**
 * Amounts are denominated in the row's own currency. Only INR, and USD when a
 * rate is available, can be stated in INR; anything else contributes 0 rather
 * than being counted as rupees.
 *
 * ponytail: excluded rather than converted -- there is no BTC/ETH rate source
 * in currency_rates today. Convert here once one exists.
 */
export function convertToInr(
  amount: number,
  currency: Currency,
  usdInrRate?: number,
): number {
  if (!Number.isFinite(amount)) return 0;
  if (currency === "INR") return amount;
  if (currency === "USD") return usdInrRate ? amount * usdInrRate : 0;
  return 0;
}

export function toPublicHoldingWithInr<T extends CurrentHoldingRow>(
  holding: T,
  usdInrRate?: number,
) {
  const { sourcePayload: _sourcePayload, ...publicHolding } = holding;
  const pnlAmount =
    holding.pnlAmount === null ? null : Number(holding.pnlAmount);

  return {
    ...publicHolding,
    currentValueInInr: convertToInr(
      Number(holding.currentValue),
      holding.currency,
      usdInrRate,
    ),
    investedAmountInInr: convertToInr(
      Number(holding.investedAmount),
      holding.currency,
      usdInrRate,
    ),
    pnlAmountInInr:
      pnlAmount === null
        ? null
        : convertToInr(pnlAmount, holding.currency, usdInrRate),
  };
}

export function toPublicHoldingWithInrAndXirr(
  holding: CurrentHoldingRow,
  usdInrRate?: number,
) {
  return {
    ...toPublicHoldingWithInr(holding, usdInrRate),
    sourceXirr: sourceXirrFromPayload(holding.sourcePayload),
  };
}

export function aggregateSnapshotTotalsByDate<T extends SnapshotAmountRow>(
  rows: T[],
  usdInrRate?: number,
): Map<string, { investedAmount: number; currentValue: number }> {
  // ponytail: TS-side aggregate filter for timeline rows; migrations handle DB cleanup.
  const eligible = filterAggregateRowsBySnapshotGroup(rows);
  const latestBySnapshot = new Map<string, T>();

  // Duplicate position keys within eligible rows: last row wins (Map.set overwrite).
  for (const row of eligible) {
    latestBySnapshot.set(holdingSnapshotKey(row), row);
  }

  const totalsByDate = new Map<
    string,
    { investedAmount: number; currentValue: number }
  >();

  for (const row of latestBySnapshot.values()) {
    const investedAmount = convertToInr(
      Number(row.investedAmount),
      row.currency,
      usdInrRate,
    );
    const currentValue = convertToInr(
      Number(row.currentValue),
      row.currency,
      usdInrRate,
    );
    const existing = totalsByDate.get(row.snapshotDate) ?? {
      investedAmount: 0,
      currentValue: 0,
    };
    totalsByDate.set(row.snapshotDate, {
      investedAmount: existing.investedAmount + investedAmount,
      currentValue: existing.currentValue + currentValue,
    });
  }

  return totalsByDate;
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

export function sourceXirrFromPayload(payload?: Record<string, unknown>) {
  const value = payload?.xirr;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function npsDetailsFromPayload(
  payload?: Record<string, unknown>,
): NpsDetails | null {
  const parsed = npsDetailsSchema.safeParse(payload?.npsDetails);
  return parsed.success ? parsed.data : null;
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
