import * as XLSX from "xlsx";
import { FinancialDecimal, parseSourceDecimal } from "./numeric";
import { getSourceDecimals, withSourceDecimals } from "./source-decimals";
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
  if (sheet) {
    for (const [address, value] of Object.entries(sheet)) {
      const cell: unknown = value;
      if (
        !address.startsWith("!") &&
        typeof cell === "object" &&
        cell !== null &&
        "t" in cell &&
        cell.t === "e"
      ) {
        throw new Error(
          `${sectionName} cell ${address}: spreadsheet error cannot establish complete evidence`,
        );
      }
    }
  }

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
  if (
    rows
      .slice(0, headerRow)
      .some((row) =>
        row.some((cell) =>
          /^\s*(?:partial|incomplete|truncated)\b/i.test(toStringValue(cell)),
        ),
      )
  ) {
    throw new Error(
      `${sectionName}: incomplete reports cannot declare a complete snapshot`,
    );
  }

  const headers = rows[headerRow] ?? [];
  requireColumns(headers, requiredColumns, sectionName);

  const totals: Array<{ record: Record<string, unknown>; rowNumber: number }> =
    [];
  const holdings = rows.slice(headerRow + 1).flatMap((row, index) => {
    const record = objectFromRow(headers, row);
    const symbol = toStringValue(record.security).trim();

    const rowNumber = headerRow + index + 2;
    if (row.every((cell) => !toStringValue(cell).trim())) return [];

    if (!symbol) {
      throw new Error(
        `${sectionName} row ${rowNumber}: Security is required for a populated row`,
      );
    }
    if (symbol.toLowerCase() === "total") {
      totals.push({ record, rowNumber });
      return [];
    }

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

  if (totals.length > 1)
    throw new Error(`${sectionName}: duplicate Total rows`);
  for (const { record, rowNumber } of totals) {
    if (
      holdings.length > 0 &&
      ["cost basis (usd)", "market value (usd)", "quantity"].every(
        (field) => !toStringValue(record[field]).trim(),
      )
    )
      continue;
    for (const [field, property] of [
      ["Cost Basis (USD)", "investedAmount"],
      ["Market Value (USD)", "currentValue"],
    ] as const) {
      parseRequiredUsdAmount(record[field.toLowerCase()], field, rowNumber);
      const total = parseSourceDecimal(String(record[field.toLowerCase()]));
      const sum = holdings.reduce(
        (value, holding) =>
          value.plus(
            parseSourceDecimal(
              toStringValue(
                getSourceDecimals(holding)?.[property] ?? holding[property],
              ),
            ) ?? "0",
          ),
        new FinancialDecimal(0),
      );
      if (
        total === undefined ||
        (holdings.length === 0
          ? total !== "0"
          : sum.minus(total).abs().gt("0.01"))
      ) {
        throw new Error(
          `${sectionName} row ${rowNumber}: ${field} Total does not reconcile with security rows`,
        );
      }
    }
    if (holdings.length === 0) {
      for (const field of [
        "quantity",
        "profit/loss (usd)",
        "profit/loss (%)",
        "profit/loss (inr)",
      ]) {
        const cell = toStringValue(record[field]).trim();
        if (cell && parseSourceDecimal(cell) !== "0")
          throw new Error(
            `${sectionName} row ${rowNumber}: empty snapshot must have zero totals`,
          );
      }
    }
  }

  return holdings;
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
