import type { ImportFile, ParseResult, PortfolioImporter } from "./types";
import {
  findHeaderRow,
  objectFromRow,
  parseCsv,
  parseNumber,
  parseRequiredNumber,
  sourceDateFromText,
} from "./utils";

export const tickertapeStockImporter: PortfolioImporter = {
  sourceType: "tickertape_stock_csv",
  parserVersion: "tickertape-stock-v1",
  detect(file: ImportFile) {
    const text = file.content.toString(
      "utf8",
      0,
      Math.min(file.content.length, 2000),
    );
    const isStock =
      text.includes("https://tickertape.in/portfolio?tab=holdings") ||
      (text.includes("Security") && text.includes("Average Cost"));
    return {
      sourceType: "tickertape_stock_csv",
      confidence: isStock ? 0.95 : 0,
      reason: isStock
        ? "Tickertape stock holdings CSV headers detected"
        : "No stock holdings marker found",
    };
  },
  parse(file: ImportFile): ParseResult {
    const rows = parseCsv(file.content);
    const headerRow = findHeaderRow(rows, [
      "Security",
      "Quantity",
      "Current Value",
    ]);
    if (headerRow < 0)
      throw new Error("Could not find Tickertape stock holdings header row");

    const sourceDate = rows
      .slice(0, headerRow)
      .map((row) => row.join(" "))
      .map(sourceDateFromText)
      .find(Boolean);
    const headers = rows[headerRow] ?? [];

    const holdings = rows.slice(headerRow + 1).flatMap((row) => {
      const record = objectFromRow(headers, row);
      const symbol = String(record.security ?? "").trim();
      if (!symbol || symbol.toLowerCase() === "stocks/etfs") return [];

      const currentValue =
        parseNumber(record["current value rs"] ?? record["current value"]) ?? 0;
      const investedAmount =
        parseNumber(record["invested value rs"] ?? record["invested value"]) ??
        0;
      if (currentValue === 0 && investedAmount === 0) return [];

      return [
        {
          kind: "holding" as const,
          sourceType: "tickertape_stock_csv" as const,
          sourceDate,
          accountName: "Indian Stocks",
          provider: "Tickertape",
          instrumentName: symbol,
          symbol,
          assetClass: "indian_stock" as const,
          currency: "INR" as const,
          quantity: parseNumber(record.quantity),
          investedAmount,
          currentValue,
          pnlAmount: parseNumber(record["p & l rs"] ?? record["p & l"]),
          pnlPercent: parseNumber(record["net change %"]),
          metadata: {
            averageCost: parseNumber(
              record["average cost rs"] ?? record["average cost"],
            ),
            ltp: parseNumber(record["ltp rs"] ?? record.ltp),
            portfolioWeight: parseNumber(record["portfolio weight %"]),
            dailyChangeAmount: parseNumber(
              record["daily change rs"] ?? record["daily change"],
            ),
            dailyChangePercent: parseNumber(record["daily change %"]),
          },
        },
      ];
    });

    return {
      sourceType: "tickertape_stock_csv",
      parserVersion: this.parserVersion,
      rows: holdings,
      warnings:
        holdings.length === 0
          ? ["No stock holdings were parsed from the CSV"]
          : [],
    };
  },
};

export const tickertapeMutualFundImporter: PortfolioImporter = {
  sourceType: "tickertape_mutual_fund_csv",
  parserVersion: "tickertape-mf-v1",
  detect(file: ImportFile) {
    const text = file.content.toString(
      "utf8",
      0,
      Math.min(file.content.length, 2000),
    );
    const isMutualFund =
      text.includes("https://tickertape.in/portfolio?tab=mfholdings") ||
      (text.includes("Fund Name") &&
        text.includes("AMC Name") &&
        text.includes("XIRR"));
    return {
      sourceType: "tickertape_mutual_fund_csv",
      confidence: isMutualFund ? 0.95 : 0,
      reason: isMutualFund
        ? "Tickertape mutual fund holdings CSV headers detected"
        : "No MF holdings marker found",
    };
  },
  parse(file: ImportFile): ParseResult {
    const rows = parseCsv(file.content);
    const headerRow = findHeaderRow(rows, [
      "Fund Name",
      "AMC Name",
      "Current Value",
    ]);
    if (headerRow < 0)
      throw new Error("Could not find Tickertape mutual fund header row");

    const sourceDate = rows
      .slice(0, headerRow)
      .map((row) => row.join(" "))
      .map(sourceDateFromText)
      .find(Boolean);
    const headers = rows[headerRow] ?? [];

    const holdings = rows.slice(headerRow + 1).flatMap((row) => {
      const record = objectFromRow(headers, row);
      const fundName = String(record["fund name"] ?? "").trim();
      if (!fundName) return [];

      return [
        {
          kind: "holding" as const,
          sourceType: "tickertape_mutual_fund_csv" as const,
          sourceDate,
          accountName: "Mutual Funds",
          provider: "Tickertape",
          instrumentName: fundName,
          assetClass: "mutual_fund" as const,
          currency: "INR" as const,
          quantity: parseNumber(record.units),
          investedAmount: parseRequiredNumber(
            record["invested amt rs"] ?? record["invested amt"],
          ),
          currentValue: parseRequiredNumber(
            record["current value rs"] ?? record["current value"],
          ),
          pnlAmount: parseNumber(record["p&l rs"] ?? record["p&l"]),
          pnlPercent: parseNumber(record["p&l %"]),
          metadata: {
            amcName: record["amc name"],
            category: record.category,
            subCategory: record["sub-category"],
            planType: record["plan type"],
            optionType: record["option type"],
            nav: parseNumber(record["nav rs"] ?? record.nav),
            weight: parseNumber(record["weight %"]),
            xirr: parseNumber(record["xirr %"]),
            investedSince: record["invested since"],
          },
        },
      ];
    });

    return {
      sourceType: "tickertape_mutual_fund_csv",
      parserVersion: this.parserVersion,
      rows: holdings,
      warnings:
        holdings.length === 0
          ? ["No mutual fund holdings were parsed from the CSV"]
          : [],
    };
  },
};
