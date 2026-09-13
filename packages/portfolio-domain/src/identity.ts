import type { HoldingRow, TransactionRow } from "./types";

type PositionRow = HoldingRow | TransactionRow;

export function accountKey(row: PositionRow): string {
  return JSON.stringify([
    row.provider.trim().toLowerCase(),
    row.accountName.trim().toLowerCase(),
  ]);
}

export function instrumentKey(row: PositionRow): string {
  const symbol = row.symbol?.trim().toUpperCase();
  return JSON.stringify([
    row.assetClass,
    row.currency,
    symbol ? "symbol" : "name",
    symbol || row.instrumentName.trim().toLowerCase(),
  ]);
}

export function sourceGroupKey(row: HoldingRow): string {
  return JSON.stringify([
    accountKey(row),
    row.assetClass,
    row.currency,
    row.source.group,
  ]);
}

export function canonicalPositionKey(row: PositionRow): string {
  // Legacy reads group by the symbol-or-name text, even though stored
  // instruments distinguish a symbol from an identical name.
  return JSON.stringify([
    row.assetClass,
    row.currency,
    (row.symbol?.trim() || row.instrumentName.trim()).toUpperCase(),
  ]);
}

export function positionKey(row: PositionRow): string {
  return JSON.stringify([
    accountKey(row),
    instrumentKey(row),
    row.source.group,
  ]);
}
