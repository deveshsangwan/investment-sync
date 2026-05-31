import * as XLSX from "xlsx";
import type { ImportFile, ParseResult, PortfolioImporter } from "./types";
import {
  findHeaderRow,
  objectFromRow,
  parseNumber,
  parseRequiredNumber,
  toIsoDate,
} from "./utils";

function workbookRows(file: ImportFile, sheetName: string): unknown[][] {
  const workbook = XLSX.read(file.content, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];
}

export const vestedDrivewealthImporter: PortfolioImporter = {
  sourceType: "vested_drivewealth_xlsx",
  parserVersion: "vested-drivewealth-v1",
  detect(file: ImportFile) {
    if (!file.fileName.toLowerCase().endsWith(".xlsx")) {
      return {
        sourceType: "vested_drivewealth_xlsx",
        confidence: 0,
        reason: "Not an XLSX file",
      };
    }
    const workbook = XLSX.read(file.content, {
      type: "buffer",
      bookSheets: true,
    });
    const hasVestedSheets =
      workbook.SheetNames.includes("Unrealized P&L - Summary ") ||
      workbook.SheetNames.includes("Realized P&L - Summary ");
    return {
      sourceType: "vested_drivewealth_xlsx",
      confidence: hasVestedSheets ? 0.95 : 0,
      reason: hasVestedSheets
        ? "Vested/DriveWealth P&L sheets detected"
        : "Vested sheets not found",
    };
  },
  parse(file: ImportFile): ParseResult {
    const rows = workbookRows(file, "Unrealized P&L - Summary ");
    const headerRow = findHeaderRow(rows, [
      "Security",
      "Quantity",
      "Market Value",
    ]);
    if (headerRow < 0)
      throw new Error(
        "Could not find Vested unrealized P&L summary header row",
      );

    const headers = rows[headerRow] ?? [];
    const holdings = rows.slice(headerRow + 1).flatMap((row) => {
      const record = objectFromRow(headers, row);
      const symbol = String(record.security ?? "").trim();
      if (!symbol || symbol.toLowerCase() === "total") return [];

      return [
        {
          kind: "holding" as const,
          sourceType: "vested_drivewealth_xlsx" as const,
          accountName: "US Stocks",
          provider: "Vested / DriveWealth",
          instrumentName: symbol,
          symbol,
          assetClass: "us_stock" as const,
          currency: "USD" as const,
          quantity: parseNumber(record.quantity),
          investedAmount: parseRequiredNumber(record["cost basis (usd)"]),
          currentValue: parseRequiredNumber(record["market value (usd)"]),
          pnlAmount: parseNumber(record["profit/loss (usd)"]),
          pnlPercent: parseNumber(record["profit/loss (%)"]),
          metadata: {
            profitLossInr: parseNumber(record["profit/loss (inr)"]),
          },
        },
      ];
    });

    return {
      sourceType: "vested_drivewealth_xlsx",
      parserVersion: this.parserVersion,
      rows: holdings,
      warnings:
        holdings.length === 0
          ? ["No Vested holdings were parsed from the workbook"]
          : [],
    };
  },
};

export const investmentPortfolioWorkbookImporter: PortfolioImporter = {
  sourceType: "investment_portfolio_xlsx",
  parserVersion: "investment-portfolio-workbook-v1",
  detect(file: ImportFile) {
    if (!file.fileName.toLowerCase().endsWith(".xlsx")) {
      return {
        sourceType: "investment_portfolio_xlsx",
        confidence: 0,
        reason: "Not an XLSX file",
      };
    }
    const workbook = XLSX.read(file.content, {
      type: "buffer",
      bookSheets: true,
    });
    const expectedSheets = [
      "Investment Portfolio",
      "Stock Investments",
      "Mutual Funds",
      "NPS",
      "ULIPS",
      "Crypto",
    ];
    const matches = expectedSheets.filter((sheet) =>
      workbook.SheetNames.includes(sheet),
    ).length;
    return {
      sourceType: "investment_portfolio_xlsx",
      confidence: matches >= 3 ? 0.85 : 0,
      reason:
        matches >= 3
          ? "Current personal investment workbook sheets detected"
          : "Workbook layout not recognized",
    };
  },
  parse(file: ImportFile): ParseResult {
    const rows = workbookRows(file, "Investment Portfolio");
    const headerRow = findHeaderRow(rows, [
      "Date",
      "Asset Type",
      "Investment Amount",
      "Current Value",
    ]);
    if (headerRow < 0)
      throw new Error("Could not find Investment Portfolio summary header row");

    const headers = rows[headerRow] ?? [];
    const holdings = rows.slice(headerRow + 1).flatMap((row) => {
      const record = objectFromRow(headers, row);
      const assetType = String(record["asset type"] ?? "").trim();
      if (!assetType || assetType.toLowerCase() === "total") return [];

      const assetClass: import("./types").AssetClass =
        assetType.toLowerCase() === "stocks"
          ? "indian_stock"
          : assetType.toLowerCase() === "mutual funds"
            ? "mutual_fund"
            : assetType.toLowerCase() === "nps"
              ? "nps"
              : assetType.toLowerCase() === "ulips"
                ? "ulip"
                : assetType.toLowerCase() === "crypto"
                  ? "crypto"
                  : "other";

      return [
        {
          kind: "holding" as const,
          sourceType: "investment_portfolio_xlsx" as const,
          sourceDate: toIsoDate(record.date),
          accountName: assetType,
          provider: "Manual Workbook",
          instrumentName: `${assetType} Summary`,
          assetClass,
          currency: "INR" as const,
          investedAmount: parseRequiredNumber(record["investment amount"]),
          currentValue: parseRequiredNumber(record["current value"]),
          pnlAmount: parseNumber(record["gain/loss"]),
          pnlPercent: parseNumber(record["percentage change"]),
          metadata: {
            realizedGain: parseNumber(record["realized gain"]),
          },
        },
      ];
    });

    return {
      sourceType: "investment_portfolio_xlsx",
      parserVersion: this.parserVersion,
      rows: holdings,
      warnings:
        holdings.length === 0
          ? ["No summary holdings were parsed from the workbook"]
          : [],
    };
  },
};
