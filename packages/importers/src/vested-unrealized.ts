import * as XLSX from "xlsx";
import { parseSourceDecimal } from "./numeric";
import { withSourceDecimals } from "./source-decimals";
import type { NormalizedHoldingRow } from "./types";
import {
  objectFromRow,
  parseNumber,
  requireColumns,
  requireHeaderRow,
  toStringValue,
} from "./utils";

const sectionName = "Vested unrealized P&L summary";
const requiredColumns = {
  Security: ["Security"],
  Quantity: ["Quantity"],
  "Cost Basis (USD)": ["Cost Basis (USD)"],
  "Market Value (USD)": ["Market Value (USD)"],
};

export function parseVestedUnrealizedSheet(
  sheet: XLSX.WorkSheet | undefined,
): NormalizedHoldingRow[] {
  // Reading from row 1 keeps validation locations aligned with the worksheet.
  const rows = sheet
    ? XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: "",
        range: 0,
      })
    : [];
  const headerRow = requireHeaderRow(
    rows,
    ["Security", "Quantity"],
    sectionName,
  );
  const headers = rows[headerRow] ?? [];
  requireColumns(headers, requiredColumns, sectionName);

  return rows.slice(headerRow + 1).flatMap((row, index) => {
    const record = objectFromRow(headers, row);
    const symbol = toStringValue(record.security).trim();

    if (!symbol || symbol.toLowerCase() === "total") {
      return [];
    }

    const rowNumber = headerRow + index + 2;
    const investedAmount = parseRequiredUsdAmount(
      record["cost basis (usd)"],
      "Cost Basis (USD)",
      rowNumber,
    );
    const currentValue = parseRequiredUsdAmount(
      record["market value (usd)"],
      "Market Value (USD)",
      rowNumber,
    );

    return [
      withSourceDecimals<NormalizedHoldingRow>(
        {
          kind: "holding",
          sourceType: "vested_drivewealth_xlsx",
          accountName: "US Stocks",
          provider: "Vested / DriveWealth",
          instrumentName: symbol,
          symbol,
          assetClass: "us_stock",
          currency: "USD",
          quantity: parseNumber(record.quantity),
          investedAmount,
          currentValue,
          pnlAmount: parseNumber(record["profit/loss (usd)"]),
          pnlPercent: parseNumber(record["profit/loss (%)"]),
          metadata: {
            profitLossInr: parseNumber(record["profit/loss (inr)"]),
          },
        },
        {
          quantity: record.quantity,
          investedAmount: record["cost basis (usd)"],
          currentValue: record["market value (usd)"],
          pnlAmount: record["profit/loss (usd)"],
        },
      ),
    ];
  });
}

function parseRequiredUsdAmount(
  value: unknown,
  field: string,
  rowNumber: number,
) {
  const message = `${sectionName} row ${rowNumber}: ${field} must contain a valid number`;

  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(message);
  }

  const text = String(value).replace(/\s/g, "");
  const numericText =
    text.startsWith("(") && text.endsWith(")") ? text.slice(1, -1) : text;
  // Check the whole USD cell before the shared parser removes formatting.
  const hasValidFormat =
    /^(?:[+-]?\$?|\$[+-]?)(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(
      numericText,
    );

  if (!hasValidFormat) {
    throw new Error(message);
  }

  let decimal;
  try {
    decimal = parseSourceDecimal(String(value));
  } catch {
    // Decimal range errors must use the same safe field/row context.
    throw new Error(message);
  }

  if (decimal === undefined) {
    throw new Error(message);
  }

  return Number(decimal);
}
