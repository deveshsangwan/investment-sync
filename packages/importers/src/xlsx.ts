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
  INVESTMENT_PORTFOLIO_SUMMARY_SHEET,
  objectFromRow,
  parseNumber,
  parseRequiredNumber,
  pick,
  requireColumns,
  toStringValue,
  toIsoDate,
  type RequiredColumn,
} from "./utils";

interface WorkbookContext {
  workbook: XLSX.WorkBook;
  rowsBySheet: Map<string, unknown[][]>;
}

function createWorkbookContext(file: ImportFile): WorkbookContext {
  return {
    workbook: XLSX.read(file.content, { type: "buffer", cellDates: true }),
    rowsBySheet: new Map(),
  };
}

function workbookRows(
  context: WorkbookContext,
  sheetName: string,
): unknown[][] {
  const cached = context.rowsBySheet.get(sheetName);
  if (cached) return cached;

  const sheet = context.workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });
  context.rowsBySheet.set(sheetName, rows);
  return rows;
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
    const workbook = createWorkbookContext(file);
    const rows = workbookRows(workbook, "Unrealized P&L - Summary ");
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
      const symbol = toStringValue(record.security).trim();
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
  parserVersion: "investment-portfolio-workbook-v4",
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
      INVESTMENT_PORTFOLIO_SUMMARY_SHEET,
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
    const workbook = createWorkbookContext(file);
    const rows = workbookRows(workbook, INVESTMENT_PORTFOLIO_SUMMARY_SHEET);
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
    const valuationRows: NormalizedImportRow[] = rows
      .slice(headerRow + 1)
      .flatMap((row): NormalizedImportRow[] => {
        const record = objectFromRow(headers, row);
        const assetType = toStringValue(record["asset type"]).trim();
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
              metadata: { sourceSheet: INVESTMENT_PORTFOLIO_SUMMARY_SHEET },
            },
          ];
        }
        return [];
      });
    const detailedRows = dedupeHoldingRows([
      ...parseStockInvestments(workbook, initialDate),
      ...parseMutualFunds(workbook, initialDate),
      ...parseNps(workbook, initialDate),
      ...parseUlips(workbook, initialDate),
      ...parseCrypto(workbook, initialDate),
      ...parseUsStocks(workbook, initialDate),
    ]);
    const parsedRows = [...valuationRows, ...detailedRows.rows];
    const warnings = [
      ...detailedRows.warnings,
      ...(parsedRows.length === 0
        ? ["No holdings or valuations were parsed from the workbook"]
        : []),
    ];

    return {
      sourceType: "investment_portfolio_xlsx",
      parserVersion: this.parserVersion,
      rows: parsedRows,
      warnings,
    };
  },
};

const STOCK_INVESTMENTS_COLUMNS: RequiredColumn[] = [
  { field: "Security", aliases: ["security"] },
  { field: "Invested Value", aliases: ["invested value rs", "invested value"] },
  { field: "Current Value", aliases: ["current value rs", "current value"] },
];

function parseStockInvestments(
  workbook: WorkbookContext,
  initialDate?: string,
): NormalizedHoldingRow[] {
  const rows = workbookRows(workbook, "Stock Investments");
  if (rows.length === 0) return [];
  // ponytail: locate the header row with just the "Security" anchor so a
  // renamed money column still produces the clearer missing-column error
  // below instead of a generic "header row not found". If "Security" itself
  // is renamed, the sheet is treated as absent (silent skip) — broaden this
  // anchor list if that surfaces in real workbooks.
  const headerRow = findHeaderRow(rows, ["Security"]);
  if (headerRow < 0) return [];

  const headers = rows[headerRow] ?? [];
  requireColumns(headers, STOCK_INVESTMENTS_COLUMNS, "Stock Investments");

  let sourceDate = initialDate;
  return rows.slice(headerRow + 1).flatMap((row) => {
    const date = toIsoDate(row[0]);
    if (date) {
      sourceDate = date;
      return [];
    }

    const record = objectFromRow(headers, row);
    const symbol = toStringValue(pick(record, ["security"])).trim();
    if (!symbol || ["stocks/etfs", "total"].includes(symbol.toLowerCase())) {
      return [];
    }

    const investedAmount = parseNumber(
      pick(record, ["invested value rs", "invested value"]),
    );
    const currentValue = parseNumber(
      pick(record, ["current value rs", "current value"]),
    );
    if (investedAmount === undefined && currentValue === undefined) return [];
    if (investedAmount === undefined || currentValue === undefined) {
      throw new Error(
        `Stock Investments sheet row for "${symbol}" is missing a required value (Invested Value or Current Value)`,
      );
    }

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
        quantity: parseNumber(pick(record, ["quantity"])),
        investedAmount,
        currentValue,
        pnlAmount: parseNumber(pick(record, ["p & l rs", "p & l"])),
        pnlPercent: parseNumber(pick(record, ["net change %"])),
        metadata: {
          sourceSheet: "Stock Investments",
          smallcases: parseNumber(pick(record, ["no. of smallcases"])),
          averageCost: parseNumber(
            pick(record, ["average cost rs", "average cost"]),
          ),
          portfolioWeight: parseNumber(pick(record, ["portfolio weight %"])),
          ltp: parseNumber(pick(record, ["ltp rs", "ltp"])),
          dailyChangeAmount: parseNumber(
            pick(record, ["daily change rs", "daily change"]),
          ),
          dailyChangePercent: parseNumber(pick(record, ["daily change %"])),
        },
      },
    ];
  });
}

const MUTUAL_FUNDS_COLUMNS: RequiredColumn[] = [
  { field: "Fund Name", aliases: ["fund name"] },
  {
    field: "Invested Amount",
    aliases: [
      "invested amt rs",
      "invested amt",
      "invested amount",
      "invested value",
    ],
  },
  { field: "Current Value", aliases: ["current value rs", "current value"] },
];

function parseMutualFunds(
  workbook: WorkbookContext,
  initialDate?: string,
): NormalizedHoldingRow[] {
  const rows = workbookRows(workbook, "Mutual Funds");
  if (rows.length === 0) return [];
  // ponytail: same "Fund Name" anchor + explicit requireColumns split as
  // Stock Investments above — see the comment there for the tradeoff.
  const headerRow = findHeaderRow(rows, ["Fund Name"]);
  if (headerRow < 0) return [];

  const headers = rows[headerRow] ?? [];
  requireColumns(headers, MUTUAL_FUNDS_COLUMNS, "Mutual Funds");

  let sourceDate = initialDate;
  return rows.slice(headerRow + 1).flatMap((row) => {
    const date = toIsoDate(row[0]);
    if (date) {
      sourceDate = date;
      return [];
    }

    const record = objectFromRow(headers, row);
    const fundName = toStringValue(pick(record, ["fund name"])).trim();
    if (!fundName || fundName.toLowerCase() === "total") return [];

    const investedAmount = parseNumber(
      pick(record, [
        "invested amt rs",
        "invested amt",
        "invested amount",
        "invested value",
      ]),
    );
    const currentValue = parseNumber(
      pick(record, ["current value rs", "current value"]),
    );
    if (investedAmount === undefined && currentValue === undefined) return [];
    if (investedAmount === undefined || currentValue === undefined) {
      throw new Error(
        `Mutual Funds sheet row for "${fundName}" is missing a required value (Invested Amount or Current Value)`,
      );
    }

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
        quantity: parseNumber(pick(record, ["units"])),
        investedAmount,
        currentValue,
        pnlAmount: parseNumber(pick(record, ["p&l rs", "p&l"])),
        pnlPercent: parseNumber(pick(record, ["p&l %"])),
        metadata: {
          sourceSheet: "Mutual Funds",
          amcName: pick(record, ["amc name"]),
          category: pick(record, ["category"]),
          subCategory: pick(record, ["sub-category"]),
          planType: pick(record, ["plan type"]),
          optionType: pick(record, ["option type"]),
          nav: parseNumber(pick(record, ["nav rs", "nav"])),
          weight: parseNumber(pick(record, ["weight %"])),
          xirr: parseNumber(pick(record, ["xirr %", "xirr"])),
          investedSince: pick(record, ["invested since"]),
        },
      },
    ];
  });
}

const NPS_COLUMNS: RequiredColumn[] = [
  { field: "Value", aliases: ["value", "current value"] },
  {
    field: "Contribution",
    aliases: ["contribution", "invested amount", "investment amount"],
  },
];

function parseNps(
  workbook: WorkbookContext,
  initialDate?: string,
): NormalizedHoldingRow[] {
  const rows = workbookRows(workbook, "NPS");
  if (rows.length === 0) return [];

  const headers = rows[0] ?? [];
  requireColumns(headers, NPS_COLUMNS, "NPS");

  let sourceDate = initialDate;
  const parsed: NormalizedHoldingRow[] = [];

  for (const row of rows.slice(1)) {
    const date = toIsoDate(row[0]);
    if (date) {
      sourceDate = date;
      continue;
    }

    const record = objectFromRow(headers, row);
    const currentValue = parseNumber(pick(record, ["value", "current value"]));
    const investedAmount = parseNumber(
      pick(record, ["contribution", "invested amount", "investment amount"]),
    );
    if (currentValue === undefined && investedAmount === undefined) continue;
    if (!sourceDate) continue;
    if (currentValue === undefined || investedAmount === undefined) {
      throw new Error(
        `NPS sheet row is missing a required value (Value or Contribution) for date ${sourceDate}`,
      );
    }

    const pnlAmount = parseNumber(pick(record, ["gain/loss", "p&l", "pnl"]));
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
        contributions: parseNumber(pick(record, ["count", "contributions"])),
        withdrawals: parseNumber(pick(record, ["withdrawals", "withdrawal"])),
        charges: parseNumber(pick(record, ["charges"])),
        xirr: parseNumber(pick(record, ["xirr", "xirr %"])),
      },
    });
  }

  return parsed;
}

function parseUlips(
  workbook: WorkbookContext,
  initialDate?: string,
): NormalizedHoldingRow[] {
  return parseSimpleSectionHoldings({
    rows: workbookRows(workbook, "ULIPS"),
    initialDate,
    accountName: "ULIPs",
    assetClass: "ulip",
    currency: "INR",
    sourceSheet: "ULIPS",
    nameAliases: ["name"],
    investedAliases: ["invested"],
    currentAliases: ["current value"],
    pnlAliases: ["returns"],
  });
}

function parseCrypto(
  workbook: WorkbookContext,
  initialDate?: string,
): NormalizedHoldingRow[] {
  return parseSimpleSectionHoldings({
    rows: workbookRows(workbook, "Crypto"),
    initialDate,
    accountName: "Crypto",
    assetClass: "crypto",
    currency: "OTHER",
    sourceSheet: "Crypto",
    nameAliases: ["name"],
    quantityAliases: ["units"],
    investedAliases: ["invested"],
    currentAliases: ["total asset value"],
    pnlAliases: ["returns"],
  });
}

function parseUsStocks(
  workbook: WorkbookContext,
  initialDate?: string,
): NormalizedHoldingRow[] {
  return parseSimpleSectionHoldings({
    rows: workbookRows(workbook, "US stocks"),
    initialDate,
    accountName: "US Stocks",
    assetClass: "us_stock",
    currency: "USD",
    sourceSheet: "US stocks",
    nameAliases: ["name"],
    quantityAliases: ["quantity"],
    investedAliases: ["invested"],
    currentAliases: ["current value"],
    pnlAliases: ["returns"],
    pnlPercentAliases: ["%"],
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
  nameAliases,
  quantityAliases,
  investedAliases,
  currentAliases,
  pnlAliases,
  pnlPercentAliases,
  symbolFromName,
}: {
  rows: unknown[][];
  initialDate?: string;
  accountName: string;
  assetClass: AssetClass;
  currency: Currency;
  sourceSheet: string;
  nameAliases: string[];
  quantityAliases?: string[];
  investedAliases: string[];
  currentAliases: string[];
  pnlAliases?: string[];
  pnlPercentAliases?: string[];
  symbolFromName?: boolean;
}): NormalizedHoldingRow[] {
  if (rows.length === 0) return [];
  // These sheets have no leading title rows, so the header is always row 0.
  const headers = rows[0] ?? [];
  requireColumns(
    headers,
    [
      { field: "Name", aliases: nameAliases },
      { field: "Invested", aliases: investedAliases },
      { field: "Current Value", aliases: currentAliases },
    ],
    sourceSheet,
  );

  let sourceDate = initialDate;
  return rows.slice(1).flatMap((row) => {
    const date = toIsoDate(row[0]);
    if (date) {
      sourceDate = date;
      return [];
    }

    const record = objectFromRow(headers, row);
    const instrumentName = toStringValue(pick(record, nameAliases)).trim();
    if (!instrumentName || instrumentName.toLowerCase() === "total") return [];

    const investedAmount = parseNumber(pick(record, investedAliases));
    const currentValue = parseNumber(pick(record, currentAliases));
    if (investedAmount === undefined && currentValue === undefined) return [];
    if (investedAmount === undefined || currentValue === undefined) {
      throw new Error(
        `${sourceSheet} sheet row for "${instrumentName}" is missing a required value (Invested or Current Value)`,
      );
    }

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
        quantity: quantityAliases
          ? parseNumber(pick(record, quantityAliases))
          : undefined,
        investedAmount,
        currentValue,
        pnlAmount: pnlAliases
          ? parseNumber(pick(record, pnlAliases))
          : undefined,
        pnlPercent: pnlPercentAliases
          ? parseNumber(pick(record, pnlPercentAliases))
          : undefined,
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

function dedupeHoldingRows(rows: NormalizedHoldingRow[]): {
  rows: NormalizedHoldingRow[];
  warnings: string[];
} {
  const byKey = new Map<string, NormalizedHoldingRow>();
  const warnings: string[] = [];

  for (const row of rows) {
    const existing = byKey.get(holdingDedupeKey(row));
    if (!existing) {
      byKey.set(holdingDedupeKey(row), row);
      continue;
    }

    if (sameHoldingAmounts(existing, row)) {
      byKey.set(holdingDedupeKey(row), richerHolding(existing, row));
      continue;
    }

    warnings.push(
      `Conflicting duplicate holding ignored for ${row.instrumentName} in ${toStringValue(
        row.metadata.sourceSheet ?? "unknown sheet",
      )} on ${row.sourceDate ?? "unknown date"}`,
    );
  }

  return { rows: [...byKey.values()], warnings };
}

function holdingDedupeKey(row: NormalizedHoldingRow): string {
  const keyParts = [
    row.sourceType,
    row.metadata.sourceSheet,
    row.accountName,
    row.provider,
    row.assetClass,
    row.currency,
    row.sourceDate,
    row.symbol?.trim().toUpperCase() || row.instrumentName.trim().toUpperCase(),
  ];
  return keyParts.map(toStringValue).join("|");
}

function sameHoldingAmounts(
  left: NormalizedHoldingRow,
  right: NormalizedHoldingRow,
): boolean {
  return (
    sameNumber(left.quantity, right.quantity) &&
    sameNumber(left.investedAmount, right.investedAmount) &&
    sameNumber(left.currentValue, right.currentValue) &&
    sameNumber(left.pnlAmount, right.pnlAmount) &&
    sameNumber(left.pnlPercent, right.pnlPercent)
  );
}

function sameNumber(left?: number, right?: number): boolean {
  if (left === undefined && right === undefined) return true;
  if (left === undefined || right === undefined) return false;
  return Math.abs(left - right) < 0.000001;
}

function richerHolding(
  left: NormalizedHoldingRow,
  right: NormalizedHoldingRow,
): NormalizedHoldingRow {
  return holdingCompletenessScore(right) > holdingCompletenessScore(left)
    ? right
    : left;
}

function holdingCompletenessScore(row: NormalizedHoldingRow): number {
  return [
    row.symbol,
    row.isin,
    row.quantity,
    row.pnlAmount,
    row.pnlPercent,
    ...Object.values(row.metadata),
  ].filter((value) => value !== undefined && value !== null && value !== "")
    .length;
}
