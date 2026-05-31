import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const assetClassEnum = pgEnum("asset_class", [
  "indian_stock",
  "mutual_fund",
  "us_stock",
  "nps",
  "ulip",
  "crypto",
  "cash",
  "other",
]);

export const currencyEnum = pgEnum("currency", [
  "INR",
  "USD",
  "BTC",
  "ETH",
  "OTHER",
]);

export const importStatusEnum = pgEnum("import_status", [
  "created",
  "uploaded",
  "parsed",
  "committed",
  "failed",
  "expired",
]);

export const importSourceEnum = pgEnum("import_source", [
  "investment_portfolio_xlsx",
  "tickertape_stock_csv",
  "tickertape_mutual_fund_csv",
  "vested_drivewealth_xlsx",
  "manual_snapshot",
  "cas_pdf",
  "unknown",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "buy",
  "sell",
  "dividend",
  "fee",
  "transfer",
  "contribution",
  "redemption",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clerkUserIdIdx: uniqueIndex("users_clerk_user_id_idx").on(
      table.clerkUserId,
    ),
  }),
);

export const households = pgTable("households", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const householdMembers = pgTable(
  "household_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    memberIdx: uniqueIndex("household_members_household_user_idx").on(
      table.householdId,
      table.userId,
    ),
  }),
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    accountType: text("account_type").notNull(),
    currency: currencyEnum("currency").notNull().default("INR"),
    isArchived: boolean("is_archived").notNull().default(false),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    householdIdx: index("accounts_household_idx").on(table.householdId),
  }),
);

export const instruments = pgTable(
  "instruments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: text("symbol"),
    isin: text("isin"),
    name: text("name").notNull(),
    assetClass: assetClassEnum("asset_class").notNull(),
    currency: currencyEnum("currency").notNull().default("INR"),
    exchange: text("exchange"),
    providerMetadata: jsonb("provider_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    symbolIdx: index("instruments_symbol_idx").on(table.symbol),
    isinIdx: index("instruments_isin_idx").on(table.isin),
  }),
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: importSourceEnum("source_type").notNull().default("unknown"),
    status: importStatusEnum("status").notNull().default("created"),
    parserVersion: text("parser_version"),
    originalFileName: text("original_file_name").notNull(),
    storagePath: text("storage_path"),
    fileHash: text("file_hash"),
    rowCount: integer("row_count").notNull().default(0),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (table) => ({
    householdIdx: index("import_batches_household_idx").on(table.householdId),
    expiryIdx: index("import_batches_expiry_idx").on(table.expiresAt),
    fileHashIdx: index("import_batches_file_hash_idx").on(table.fileHash),
  }),
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importBatchId: uuid("import_batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    normalizedPayload: jsonb("normalized_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    rowErrors: jsonb("row_errors").$type<string[]>().notNull().default([]),
    isCommitted: boolean("is_committed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    batchIdx: index("import_rows_batch_idx").on(table.importBatchId),
  }),
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    instrumentId: uuid("instrument_id").references(() => instruments.id, {
      onDelete: "set null",
    }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, {
      onDelete: "set null",
    }),
    type: transactionTypeEnum("type").notNull(),
    tradeDate: date("trade_date").notNull(),
    quantity: numeric("quantity", { precision: 28, scale: 10 }),
    price: numeric("price", { precision: 28, scale: 10 }),
    amount: numeric("amount", { precision: 28, scale: 4 }).notNull(),
    currency: currencyEnum("currency").notNull().default("INR"),
    notes: text("notes"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    householdIdx: index("transactions_household_idx").on(table.householdId),
    accountIdx: index("transactions_account_idx").on(table.accountId),
    tradeDateIdx: index("transactions_trade_date_idx").on(table.tradeDate),
  }),
);

export const holdingSnapshots = pgTable(
  "holding_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, {
      onDelete: "set null",
    }),
    snapshotDate: date("snapshot_date").notNull(),
    quantity: numeric("quantity", { precision: 28, scale: 10 }),
    investedAmount: numeric("invested_amount", {
      precision: 28,
      scale: 4,
    }).notNull(),
    currentValue: numeric("current_value", {
      precision: 28,
      scale: 4,
    }).notNull(),
    pnlAmount: numeric("pnl_amount", { precision: 28, scale: 4 }),
    pnlPercent: numeric("pnl_percent", { precision: 12, scale: 6 }),
    currency: currencyEnum("currency").notNull().default("INR"),
    sourcePayload: jsonb("source_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    householdIdx: index("holding_snapshots_household_idx").on(
      table.householdId,
    ),
    dateIdx: index("holding_snapshots_date_idx").on(table.snapshotDate),
  }),
);

export const prices = pgTable(
  "prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    priceDate: date("price_date").notNull(),
    price: numeric("price", { precision: 28, scale: 10 }).notNull(),
    currency: currencyEnum("currency").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniquePriceIdx: uniqueIndex("prices_instrument_date_source_idx").on(
      table.instrumentId,
      table.priceDate,
      table.source,
    ),
  }),
);

export const portfolioValuations = pgTable(
  "portfolio_valuations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    valuationDate: date("valuation_date").notNull(),
    investedAmount: numeric("invested_amount", {
      precision: 28,
      scale: 4,
    }).notNull(),
    currentValue: numeric("current_value", {
      precision: 28,
      scale: 4,
    }).notNull(),
    pnlAmount: numeric("pnl_amount", { precision: 28, scale: 4 }).notNull(),
    currency: currencyEnum("currency").notNull().default("INR"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqueValuationIdx: uniqueIndex(
      "portfolio_valuations_household_date_idx",
    ).on(table.householdId, table.valuationDate),
  }),
);
