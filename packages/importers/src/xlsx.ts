import * as XLSX from "xlsx";
import type {
  AssetClass,
  Currency,
  ImportFile,
  NormalizedHoldingRow,
  NormalizedImportRow,
  ParseResult,
  PortfolioImporter,
} from "./types";
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
  parserVersion: "investment-portfolio-workbook-v2",
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
    const initialDate = firstPortfolioDate(rows.slice(headerRow + 1), headers);
    const summaryRows: NormalizedImportRow[] = rows
      .slice(headerRow + 1)
      .flatMap((row): NormalizedImportRow[] => {
        const record = objectFromRow(headers, row);
        const assetType = String(record["asset type"] ?? "").trim();
        if (!assetType) return [];
        if (assetType.toLowerCase() === "total") {
          const valuationDate = toIsoDate(record.date);
          if (!valuationDate) return [];
          return [
            {
              kind: "valuation" as const,
              sourceType: "investment_portfolio_xlsx" as const,
              valuationDate,
              investedAmount: parseRequiredNumber(record["investment amount"]),
              currentValue: parseRequiredNumber(record["current value"]),
              pnlAmount: parseNumber(record["gain/loss"]),
              currency: "INR" as const,
              metadata: { sourceSheet: "Investment Portfolio" },
            },
          ];
        }

        const assetClass = assetClassFromWorkbookLabel(assetType);

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
              isAggregate: true,
              sourceSheet: "Investment Portfolio",
              realizedGain: parseNumber(record["realized gain"]),
            },
          },
        ];
      });
    const detailedRows = [
      ...parseStockInvestments(file, initialDate),
      ...parseMutualFunds(file, initialDate),
      ...parseNps(file, initialDate),
      ...parseUlips(file, initialDate),
      ...parseCrypto(file, initialDate),
      ...parseUsStocks(file, initialDate),
    ];
    const parsedRows = [...summaryRows, ...detailedRows];

    return {
      sourceType: "investment_portfolio_xlsx",
      parserVersion: this.parserVersion,
      rows: parsedRows,
      warnings:
        parsedRows.length === 0
          ? ["No holdings or valuations were parsed from the workbook"]
          : [],
    };
  },
};

function parseStockInvestments(
  file: ImportFile,
  initialDate?: string,
): NormalizedHoldingRow[] {
  const rows = workbookRows(file, "Stock Investments");
  const headerRow = findHeaderRow(rows, ["Security", "Quantity"]);
  if (headerRow < 0) return [];

  let sourceDate = initialDate;
  return rows.slice(headerRow + 1).flatMap((row) => {
    const date = toIsoDate(row[0]);
    if (date) {
      sourceDate = date;
      return [];
    }

    const symbol = String(row[0] ?? "").trim();
    if (!symbol || ["stocks/etfs", "total"].includes(symbol.toLowerCase())) {
      return [];
    }
    const investedAmount = parseNumber(row[6]) ?? 0;
    const currentValue = parseNumber(row[7]) ?? 0;
    if (investedAmount === 0 && currentValue === 0) return [];

    return [
      {
        kind: "holding",
        sourceType: "investment_portfolio_xlsx",
        sourceDate,
        accountName: "Indian Stocks",
        provider: "Manual Workbook",
        instrumentName: symbol,
        symbol,
        assetClass: "indian_stock",
        currency: "INR",
        quantity: parseNumber(row[2]),
        investedAmount,
        currentValue,
        pnlAmount: parseNumber(row[8]),
        pnlPercent: parseNumber(row[9]),
        metadata: {
          sourceSheet: "Stock Investments",
          smallcases: parseNumber(row[1]),
          averageCost: parseNumber(row[3]),
          portfolioWeight: parseNumber(row[4]),
          ltp: parseNumber(row[5]),
          dailyChangeAmount: parseNumber(row[10]),
          dailyChangePercent: parseNumber(row[11]),
        },
      },
    ];
  });
}

function parseMutualFunds(
  file: ImportFile,
  initialDate?: string,
): NormalizedHoldingRow[] {
  const rows = workbookRows(file, "Mutual Funds");
  const headerRow = findHeaderRow(rows, ["Fund Name", "Current Value"]);
  if (headerRow < 0) return [];

  let sourceDate = initialDate;
  return rows.slice(headerRow + 1).flatMap((row) => {
    const date = toIsoDate(row[0]);
    if (date) {
      sourceDate = date;
      return [];
    }

    const fundName = String(row[0] ?? "").trim();
    if (!fundName || fundName.toLowerCase() === "total") return [];
    const investedAmount = parseNumber(row[8]) ?? 0;
    const currentValue = parseNumber(row[9]) ?? 0;
    if (investedAmount === 0 && currentValue === 0) return [];

    return [
      {
        kind: "holding",
        sourceType: "investment_portfolio_xlsx",
        sourceDate,
        accountName: "Mutual Funds",
        provider: "Manual Workbook",
        instrumentName: fundName,
        assetClass: "mutual_fund",
        currency: "INR",
        quantity: parseNumber(row[7]),
        investedAmount,
        currentValue,
        pnlAmount: parseNumber(row[11]),
        pnlPercent: parseNumber(row[12]),
        metadata: {
          sourceSheet: "Mutual Funds",
          amcName: row[1],
          category: row[2],
          subCategory: row[3],
          planType: row[4],
          optionType: row[5],
          nav: parseNumber(row[6]),
          weight: parseNumber(row[10]),
          xirr: parseNumber(row[13]),
          investedSince: row[14],
        },
      },
    ];
  });
}

function parseNps(
  file: ImportFile,
  initialDate?: string,
): NormalizedHoldingRow[] {
  const rows = workbookRows(file, "NPS");
  let sourceDate = initialDate;
  const parsed: NormalizedHoldingRow[] = [];

  for (const row of rows) {
    const date = toIsoDate(row[0]);
    if (date) {
      sourceDate = date;
      continue;
    }
    const currentValue = parseNumber(row[0]);
    const investedAmount = parseNumber(row[2]);
    if (
      !sourceDate ||
      currentValue === undefined ||
      investedAmount === undefined
    ) {
      continue;
    }
    const pnlAmount = parseNumber(row[4]);
    parsed.push({
      kind: "holding",
      sourceType: "investment_portfolio_xlsx",
      sourceDate,
      accountName: "NPS",
      provider: "Manual Workbook",
      instrumentName: "NPS",
      assetClass: "nps",
      currency: "INR",
      investedAmount,
      currentValue,
      pnlAmount,
      pnlPercent:
        investedAmount === 0 || pnlAmount === undefined
          ? undefined
          : (pnlAmount / investedAmount) * 100,
      metadata: {
        sourceSheet: "NPS",
        contributions: parseNumber(row[1]),
        withdrawals: parseNumber(row[3]),
        charges: parseNumber(row[5]),
        xirr: parseNumber(row[7]),
      },
    });
  }

  return parsed;
}

function parseUlips(
  file: ImportFile,
  initialDate?: string,
): NormalizedHoldingRow[] {
  return parseSimpleSectionHoldings({
    rows: workbookRows(file, "ULIPS"),
    initialDate,
    accountName: "ULIPs",
    assetClass: "ulip",
    currency: "INR",
    sourceSheet: "ULIPS",
    nameColumn: 0,
    investedColumn: 1,
    currentColumn: 3,
    pnlColumn: 2,
  });
}

function parseCrypto(
  file: ImportFile,
  initialDate?: string,
): NormalizedHoldingRow[] {
  return parseSimpleSectionHoldings({
    rows: workbookRows(file, "Crypto"),
    initialDate,
    accountName: "Crypto",
    assetClass: "crypto",
    currency: "OTHER",
    sourceSheet: "Crypto",
    nameColumn: 0,
    quantityColumn: 1,
    investedColumn: 2,
    currentColumn: 4,
    pnlColumn: 3,
  });
}

function parseUsStocks(
  file: ImportFile,
  initialDate?: string,
): NormalizedHoldingRow[] {
  return parseSimpleSectionHoldings({
    rows: workbookRows(file, "US stocks"),
    initialDate,
    accountName: "US Stocks",
    assetClass: "us_stock",
    currency: "USD",
    sourceSheet: "US stocks",
    nameColumn: 0,
    quantityColumn: 1,
    investedColumn: 3,
    currentColumn: 2,
    pnlColumn: 4,
    pnlPercentColumn: 5,
    symbolFromName: true,
  });
}

function parseSimpleSectionHoldings({
  rows,
  initialDate,
  accountName,
  assetClass,
  currency,
  sourceSheet,
  nameColumn,
  quantityColumn,
  investedColumn,
  currentColumn,
  pnlColumn,
  pnlPercentColumn,
  symbolFromName,
}: {
  rows: unknown[][];
  initialDate?: string;
  accountName: string;
  assetClass: AssetClass;
  currency: Currency;
  sourceSheet: string;
  nameColumn: number;
  quantityColumn?: number;
  investedColumn: number;
  currentColumn: number;
  pnlColumn?: number;
  pnlPercentColumn?: number;
  symbolFromName?: boolean;
}): NormalizedHoldingRow[] {
  let sourceDate = initialDate;
  return rows.slice(1).flatMap((row) => {
    const date = toIsoDate(row[0]);
    if (date) {
      sourceDate = date;
      return [];
    }

    const instrumentName = String(row[nameColumn] ?? "").trim();
    if (!instrumentName || instrumentName.toLowerCase() === "total") return [];
    const investedAmount = parseNumber(row[investedColumn]) ?? 0;
    const currentValue = parseNumber(row[currentColumn]) ?? 0;
    if (investedAmount === 0 && currentValue === 0) return [];

    return [
      {
        kind: "holding",
        sourceType: "investment_portfolio_xlsx",
        sourceDate,
        accountName,
        provider: "Manual Workbook",
        instrumentName,
        symbol: symbolFromName ? instrumentName : undefined,
        assetClass,
        currency,
        quantity:
          quantityColumn === undefined
            ? undefined
            : parseNumber(row[quantityColumn]),
        investedAmount,
        currentValue,
        pnlAmount:
          pnlColumn === undefined ? undefined : parseNumber(row[pnlColumn]),
        pnlPercent:
          pnlPercentColumn === undefined
            ? undefined
            : parseNumber(row[pnlPercentColumn]),
        metadata: { sourceSheet },
      },
    ];
  });
}

function firstPortfolioDate(
  rows: unknown[][],
  headers: unknown[],
): string | undefined {
  for (const row of rows) {
    const record = objectFromRow(headers, row);
    const date = toIsoDate(record.date);
    if (date) return date;
  }
  return undefined;
}

function assetClassFromWorkbookLabel(value: string): AssetClass {
  const normalized = value.trim().toLowerCase();
  if (normalized === "stocks") return "indian_stock";
  if (normalized === "mutual funds") return "mutual_fund";
  if (normalized === "nps") return "nps";
  if (normalized === "ulips") return "ulip";
  if (normalized === "crypto") return "crypto";
  return "other";
}
