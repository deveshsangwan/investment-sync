import { z } from "zod";
import { isValidCalendarDateParts } from "./utils";

export type ImportSourceType =
  | "investment_portfolio_xlsx"
  | "nps_csv"
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

export interface NormalizedValuationRow {
  kind: "valuation";
  sourceType: ImportSourceType;
  valuationDate: string;
  investedAmount: number;
  currentValue: number;
  pnlAmount?: number;
  currency: Currency;
  metadata: Record<string, unknown>;
}

export type NormalizedImportRow =
  | NormalizedHoldingRow
  | NormalizedTransactionRow
  | NormalizedValuationRow;

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

export const importSourceTypeSchema = z.enum([
  "investment_portfolio_xlsx",
  "nps_csv",
  "tickertape_stock_csv",
  "tickertape_mutual_fund_csv",
  "vested_drivewealth_xlsx",
  "manual_snapshot",
  "cas_pdf",
  "unknown",
]);

export const assetClassSchema = z.enum([
  "indian_stock",
  "mutual_fund",
  "us_stock",
  "nps",
  "ulip",
  "crypto",
  "cash",
  "other",
]);

export const currencySchema = z.enum(["INR", "USD", "BTC", "ETH", "OTHER"]);

const metadataSchema = z.record(z.unknown());
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [yearText = "", monthText = "", dayText = ""] = value.split("-");
    return isValidCalendarDateParts(
      Number(yearText),
      Number(monthText),
      Number(dayText),
    );
  }, "Invalid calendar date");

export const normalizedHoldingRowSchema = z.object({
  kind: z.literal("holding"),
  sourceType: importSourceTypeSchema,
  sourceDate: isoDateSchema.optional(),
  accountName: z.string().min(1),
  provider: z.string().min(1),
  instrumentName: z.string().min(1),
  symbol: z.string().min(1).optional(),
  isin: z.string().min(1).optional(),
  assetClass: assetClassSchema,
  currency: currencySchema,
  quantity: z.number().finite().optional(),
  investedAmount: z.number().finite(),
  currentValue: z.number().finite(),
  pnlAmount: z.number().finite().optional(),
  pnlPercent: z.number().finite().optional(),
  metadata: metadataSchema,
}) satisfies z.ZodType<NormalizedHoldingRow>;

export const normalizedTransactionRowSchema = z.object({
  kind: z.literal("transaction"),
  sourceType: importSourceTypeSchema,
  accountName: z.string().min(1),
  provider: z.string().min(1),
  instrumentName: z.string().min(1),
  symbol: z.string().min(1).optional(),
  assetClass: assetClassSchema,
  currency: currencySchema,
  tradeDate: isoDateSchema,
  type: z.enum([
    "buy",
    "sell",
    "dividend",
    "fee",
    "transfer",
    "contribution",
    "redemption",
  ]),
  quantity: z.number().finite().optional(),
  price: z.number().finite().optional(),
  amount: z.number().finite(),
  metadata: metadataSchema,
}) satisfies z.ZodType<NormalizedTransactionRow>;

export const normalizedValuationRowSchema = z.object({
  kind: z.literal("valuation"),
  sourceType: importSourceTypeSchema,
  valuationDate: isoDateSchema,
  investedAmount: z.number().finite(),
  currentValue: z.number().finite(),
  pnlAmount: z.number().finite().optional(),
  currency: currencySchema,
  metadata: metadataSchema,
}) satisfies z.ZodType<NormalizedValuationRow>;

export const normalizedImportRowSchema = z.discriminatedUnion("kind", [
  normalizedHoldingRowSchema,
  normalizedTransactionRowSchema,
  normalizedValuationRowSchema,
]) satisfies z.ZodType<NormalizedImportRow>;
