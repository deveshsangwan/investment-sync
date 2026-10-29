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
    selectionAccountKey(row),
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

function selectionAccountKey(row: PositionRow): string {
  const sheet = row.metadata.sourceSheet ?? "";
  const isWorkbook =
    row.provider === "Manual Workbook" &&
    row.sourceType === "investment_portfolio_xlsx";

  // Only these importer-defined representations describe the same account.
  // Other brokers, account names and sheets must retain independent positions.
  if (
    row.accountName === "US Stocks" &&
    row.assetClass === "us_stock" &&
    row.currency === "USD" &&
    ((isWorkbook && sheet === "US stocks") ||
      (row.provider === "Vested / DriveWealth" &&
        row.sourceType === "vested_drivewealth_xlsx" &&
        sheet === ""))
  ) {
    return JSON.stringify(["workbook-vested-us-stocks"]);
  }

  if (
    row.currency === "INR" &&
    ((row.accountName === "Indian Stocks" &&
      row.assetClass === "indian_stock" &&
      ((isWorkbook && sheet === "Stock Investments") ||
        (row.provider === "Tickertape" &&
          row.sourceType === "tickertape_stock_csv" &&
          sheet === ""))) ||
      (row.accountName === "Mutual Funds" &&
        row.assetClass === "mutual_fund" &&
        ((isWorkbook && sheet === "Mutual Funds") ||
          (row.provider === "Tickertape" &&
            row.sourceType === "tickertape_mutual_fund_csv" &&
            sheet === ""))))
  ) {
    return JSON.stringify(["workbook-tickertape", row.assetClass]);
  }

  return accountKey(row);
}
