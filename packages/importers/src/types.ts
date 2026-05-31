export type ImportSourceType =
  | "investment_portfolio_xlsx"
  | "tickertape_stock_csv"
  | "tickertape_mutual_fund_csv"
  | "vested_drivewealth_xlsx"
  | "manual_snapshot"
  | "cas_pdf"
  | "unknown";

export type AssetClass =
  | "indian_stock"
  | "mutual_fund"
  | "us_stock"
  | "nps"
  | "ulip"
  | "crypto"
  | "cash"
  | "other";

export type Currency = "INR" | "USD" | "BTC" | "ETH" | "OTHER";

export interface ImportFile {
  fileName: string;
  mimeType?: string;
  content: Buffer;
}

export interface DetectionResult {
  sourceType: ImportSourceType;
  confidence: number;
  reason: string;
}

export interface NormalizedHoldingRow {
  kind: "holding";
  sourceType: ImportSourceType;
  sourceDate?: string;
  accountName: string;
  provider: string;
  instrumentName: string;
  symbol?: string;
  isin?: string;
  assetClass: AssetClass;
  currency: Currency;
  quantity?: number;
  investedAmount: number;
  currentValue: number;
  pnlAmount?: number;
  pnlPercent?: number;
  metadata: Record<string, unknown>;
}

export interface NormalizedTransactionRow {
  kind: "transaction";
  sourceType: ImportSourceType;
  accountName: string;
  provider: string;
  instrumentName: string;
  symbol?: string;
  assetClass: AssetClass;
  currency: Currency;
  tradeDate: string;
  type:
    | "buy"
    | "sell"
    | "dividend"
    | "fee"
    | "transfer"
    | "contribution"
    | "redemption";
  quantity?: number;
  price?: number;
  amount: number;
  metadata: Record<string, unknown>;
}

export type NormalizedImportRow =
  | NormalizedHoldingRow
  | NormalizedTransactionRow;

export interface ParseResult {
  sourceType: ImportSourceType;
  parserVersion: string;
  rows: NormalizedImportRow[];
  warnings: string[];
}

export interface PortfolioImporter {
  sourceType: ImportSourceType;
  parserVersion: string;
  detect(file: ImportFile): DetectionResult;
  parse(file: ImportFile): ParseResult;
}
