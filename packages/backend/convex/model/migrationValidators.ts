import { v } from "convex/values";
import { z } from "zod";
import {
  assetClassSchema,
  currencySchema,
  importSourceTypeSchema,
} from "@investment-sync/importers/types";

export const legacyTables = [
  "users",
  "households",
  "household_members",
  "accounts",
  "instruments",
  "import_batches",
  "import_rows",
  "holding_snapshots",
  "transactions",
  "portfolio_valuations",
  "currency_rates",
  "prices",
] as const;
export const legacyTableValidator = v.union(
  ...legacyTables.map((table) => v.literal(table)),
);
export type LegacyTable = (typeof legacyTables)[number];

export const exportTables = [
  "users",
  "households",
  "householdMembers",
  "accounts",
  "instruments",
  "importBatches",
  "sourceFiles",
  "importRowChunks",
  "importDedupeKeys",
  "holdingSnapshots",
  "transactions",
  "portfolioValuations",
  "portfolioVersions",
  "portfolioPositions",
  "portfolioHistoryFacts",
  "portfolioHistoryScopes",
  "portfolioSummaries",
  "assetClassSummaries",
  "portfolioTimeline",
  "legacyHoldingAliases",
  "currencyRates",
  "migrationRuns",
  "migrationRecords",
  "migrationMappings",
] as const;
export const exportTableValidator = v.union(
  ...exportTables.map((table) => v.literal(table)),
);

const timestamp = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "Invalid civil date",
  );
const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const identity = { id: z.string().uuid() };
const created = { created_at: timestamp };
const metadata = z.record(z.unknown());

export const userSchema = z
  .object({
    ...identity,
    ...created,
    updated_at: timestamp,
    clerk_user_id: z.string().min(1),
    email: z.string().nullable(),
  })
  .strict();
export const householdSchema = z
  .object({
    ...identity,
    ...created,
    updated_at: timestamp,
    owner_user_id: z.string().uuid(),
    name: z.string().min(1),
  })
  .strict();
export const memberSchema = z
  .object({
    ...identity,
    ...created,
    household_id: z.string().uuid(),
    user_id: z.string().uuid(),
    role: z.enum(["owner", "viewer"]),
  })
  .strict();
export const accountSchema = z
  .object({
    ...identity,
    ...created,
    updated_at: timestamp,
    household_id: z.string().uuid(),
    name: z.string().min(1),
    provider: z.string().min(1),
    account_type: z.string(),
    currency: currencySchema,
    is_archived: z.boolean(),
    metadata,
  })
  .strict();
export const instrumentSchema = z
  .object({
    ...identity,
    ...created,
    updated_at: timestamp,
    name: z.string().min(1),
    symbol: z.string().nullable(),
    isin: z.string().nullable(),
    exchange: z.string().nullable(),
    asset_class: assetClassSchema,
    currency: currencySchema,
    provider_metadata: metadata,
  })
  .strict();
export const batchSchema = z
  .object({
    ...identity,
    household_id: z.string().uuid(),
    uploaded_by_user_id: z.string().uuid(),
    source_type: importSourceTypeSchema,
    status: z.enum([
      "created",
      "uploaded",
      "parsed",
      "committed",
      "failed",
      "expired",
    ]),
    parser_version: z.string().nullable(),
    original_file_name: z.string().min(1),
    storage_path: z.string().nullable(),
    file_hash: z.string().nullable(),
    row_count: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
    errors: z.array(z.string()),
    uploaded_at: timestamp,
    expires_at: timestamp,
    processed_at: timestamp.nullable(),
    committed_at: timestamp.nullable(),
  })
  .strict();
export const importRowSchema = z
  .object({
    ...identity,
    ...created,
    import_batch_id: z.string().uuid(),
    row_number: z.number().int().positive(),
    normalized_payload: metadata,
    row_errors: z.array(z.string()),
    is_committed: z.boolean(),
  })
  .strict();
export const holdingSchema = z
  .object({
    ...identity,
    ...created,
    household_id: z.string().uuid(),
    account_id: z.string().uuid(),
    instrument_id: z.string().uuid(),
    import_batch_id: z.string().uuid().nullable(),
    source_type: importSourceTypeSchema,
    snapshot_date: civilDate,
    quantity: decimal.nullable(),
    invested_amount: decimal,
    current_value: decimal,
    pnl_amount: decimal.nullable(),
    pnl_percent: decimal.nullable(),
    currency: currencySchema,
    source_payload: metadata,
  })
  .strict();
export const transactionSchema = z
  .object({
    ...identity,
    ...created,
    household_id: z.string().uuid(),
    account_id: z.string().uuid(),
    instrument_id: z.string().uuid().nullable(),
    import_batch_id: z.string().uuid().nullable(),
    type: z.enum([
      "buy",
      "sell",
      "dividend",
      "fee",
      "transfer",
      "contribution",
      "redemption",
    ]),
    trade_date: civilDate,
    quantity: decimal.nullable(),
    price: decimal.nullable(),
    amount: decimal,
    currency: currencySchema,
    notes: z.string().nullable(),
    metadata,
  })
  .strict();
export const valuationSchema = z
  .object({
    ...identity,
    ...created,
    household_id: z.string().uuid(),
    valuation_date: civilDate,
    invested_amount: decimal,
    current_value: decimal,
    pnl_amount: decimal,
    currency: currencySchema,
    metadata,
  })
  .strict();
export const rateSchema = z
  .object({
    ...identity,
    ...created,
    updated_at: timestamp,
    base: currencySchema,
    quote: currencySchema,
    rate: decimal,
    provider: z.string(),
    fetched_at: timestamp,
  })
  .strict();
export const priceSchema = z
  .object({
    ...identity,
    ...created,
    instrument_id: z.string().uuid(),
    price_date: civilDate,
    price: decimal,
    currency: currencySchema,
    source: z.string(),
  })
  .strict();
export const tableCountsSchema = z
  .object(
    Object.fromEntries(
      legacyTables.map((table) => [table, z.number().int().nonnegative()]),
    ),
  )
  .strict();
export const sourceFileManifestSchema = z.array(
  z
    .object({
      legacyBatchId: z.string().uuid(),
      expiresAt: timestamp,
      legacyStoragePath: z.string().nullable(),
      status: z.enum(["available", "unavailable"]),
      reason: z.string().optional(),
      contentHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      sizeBytes: z.number().int().nonnegative().optional(),
    })
    .strict(),
);

export function parseJson(json: string): unknown {
  return JSON.parse(json);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;

  return JSON.stringify(value) ?? "null";
}
