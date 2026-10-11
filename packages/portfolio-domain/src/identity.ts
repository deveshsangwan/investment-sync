import type { HoldingRow, TransactionRow } from "./types";

type PositionRow = HoldingRow | TransactionRow;

export function accountKey(
  row: Pick<PositionRow, "provider" | "accountName">,
): string {
  return JSON.stringify([
    row.provider.trim().toLowerCase(),
    row.accountName.trim().toLowerCase(),
  ]);
}

export function instrumentKey(
  row: Pick<
    PositionRow,
    "assetClass" | "currency" | "symbol" | "instrumentName" | "policyId"
  >,
): string {
  if (row.policyId) {
    return JSON.stringify([
      row.assetClass,
      row.currency,
      "policy",
      row.policyId,
    ]);
  }

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
  if (row.policyId) {
    return instrumentKey(row);
  }

  // Legacy reads group by the symbol-or-name text, even though stored
  // instruments distinguish a symbol from an identical name.
  return JSON.stringify([
    row.assetClass,
    row.currency,
    (row.symbol?.trim() || row.instrumentName.trim()).toUpperCase(),
  ]);
}

export function positionKey(row: PositionRow): string {
  if (row.policyId) {
    return policyPositionKey(row.policyId);
  }

  return JSON.stringify([
    accountKey(row),
    instrumentKey(row),
    row.source.group,
  ]);
}

export function policyPositionKey(policyId: string): string {
  return JSON.stringify(["policy", policyId]);
}
