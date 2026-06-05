import { getUsdInrRate } from "../currency-rates";

export type Currency = "INR" | "USD" | "BTC" | "ETH" | "OTHER";

export function parseDate(
  value: string | Date | null | undefined,
): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function getUsdInrRateIfNeeded(currencies: Currency[]) {
  return currencies.includes("USD") ? getUsdInrRate() : undefined;
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
    holding.sourcePayload?.isAggregate === true ||
    holding.instrumentName.endsWith(" Summary")
  );
}

export function sourceXirrFromPayload(payload?: Record<string, unknown>) {
  const value = payload?.xirr;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
