import { convexTest } from "convex-test";
import { vi } from "vitest";
import { internal } from "../convex/_generated/api";
import {
  canonicalJson,
  legacyTables,
  type LegacyTable,
} from "../convex/model/migrationValidators";
import schema from "../convex/schema";
import { modules } from "../convex/test.setup";

export const evaluationTime = "2025-06-01T00:00:00.000Z";
export const creationTime = "2025-05-01T00:00:00.000Z";
export const runKey = "synthetic-migration";
export const inputDigest = "a".repeat(64);
export const ownerIdentity = {
  subject: "fake_migration_owner",
  issuer: "https://fake.example",
  tokenIdentifier: "fake|migration_owner",
};
export const quote = { status: "unavailable" } as const;
export type LegacyTables = Record<LegacyTable, Array<Record<string, unknown>>>;

export function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function first<T>(values: T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("Missing synthetic fixture value");
  return value;
}

export function fixtures() {
  const tables: LegacyTables = {
    users: [],
    households: [],
    household_members: [],
    accounts: [],
    instruments: [],
    import_batches: [],
    import_rows: [],
    holding_snapshots: [],
    transactions: [],
    portfolio_valuations: [],
    currency_rates: [],
    prices: [],
  };
  tables.users = [1, 2].map((index) => ({
    id: uuid(index),
    clerk_user_id: index === 1 ? ownerIdentity.subject : "fake_other_owner",
    email: `fake${index}@example.invalid`,
    created_at: creationTime,
    updated_at: creationTime,
  }));
  tables.households = [1, 2].map((index) => ({
    id: uuid(10 + index),
    owner_user_id: uuid(index),
    name: `Saved portfolio ${index}`,
    created_at: creationTime,
    updated_at: creationTime,
  }));
  tables.household_members = [1, 2].map((index) => ({
    id: uuid(20 + index),
    user_id: uuid(index),
    household_id: uuid(10 + index),
    role: "owner",
    created_at: creationTime,
  }));
  tables.accounts = [1, 2].map((index) => ({
    id: uuid(30 + index),
    household_id: uuid(10 + index),
    name: "Fake stocks",
    provider: "Fake broker",
    account_type: "brokerage",
    currency: "INR",
    is_archived: index === 2,
    metadata: { original: "retained" },
    created_at: creationTime,
    updated_at: creationTime,
  }));
  tables.instruments = [
    {
      id: uuid(40),
      name: "Fake Alpha",
      symbol: "ALPHA",
      isin: "FAKE00000001",
      exchange: "FAKE",
      asset_class: "indian_stock",
      currency: "INR",
      provider_metadata: { original: "retained" },
      created_at: creationTime,
      updated_at: creationTime,
    },
  ];
  tables.import_batches = [1, 2, 3, 4].map((index) => ({
    id: uuid(50 + index),
    household_id: uuid(11),
    uploaded_by_user_id: uuid(1),
    source_type: "tickertape_stock_csv",
    status: index === 1 ? "committed" : index === 4 ? "created" : "expired",
    parser_version: index === 4 ? null : "historical-parser-v1",
    original_file_name: `fake-${index}.csv`,
    storage_path: `fake/${index}.csv`,
    file_hash: String(index).repeat(64),
    row_count: index === 1 || index === 2 ? 1 : 0,
    warnings: [],
    errors: [],
    uploaded_at: creationTime,
    expires_at: index === 4 ? "2025-07-01T00:00:00.000Z" : creationTime,
    processed_at: index === 4 ? null : creationTime,
    committed_at: index === 1 ? creationTime : null,
  }));
  const normalized = {
    kind: "holding",
    sourceType: "tickertape_stock_csv",
    sourceDate: "2025-05-01",
    accountName: "Fake stocks",
    provider: "Fake broker",
    instrumentName: "Fake Alpha",
    symbol: "ALPHA",
    assetClass: "indian_stock",
    currency: "INR",
    quantity: 99,
    investedAmount: 100,
    currentValue: 777,
    metadata: {},
  };
  tables.import_rows = [1, 2].map((index) => ({
    id: uuid(60 + index),
    import_batch_id: uuid(50 + index),
    row_number: 1,
    normalized_payload: normalized,
    row_errors: [],
    is_committed: index === 1,
    created_at: creationTime,
  }));
  tables.holding_snapshots = [1, 2].map((index) => ({
    id: uuid(70 + index),
    household_id: uuid(10 + index),
    account_id: uuid(30 + index),
    instrument_id: uuid(40),
    import_batch_id: index === 1 ? uuid(51) : null,
    source_type: "tickertape_stock_csv",
    snapshot_date: "2025-05-01",
    quantity: "123456789.1234567890",
    invested_amount: index === 1 ? "100.0000" : "20.0000",
    current_value: index === 1 ? "150.0000" : "25.0000",
    pnl_amount: null,
    pnl_percent: null,
    currency: "INR",
    source_payload: {},
    created_at: creationTime,
  }));
  tables.transactions = [
    {
      id: uuid(80),
      household_id: uuid(11),
      account_id: uuid(31),
      instrument_id: uuid(40),
      import_batch_id: null,
      type: "buy",
      trade_date: "2024-05-01",
      quantity: null,
      price: null,
      amount: "100.0000",
      currency: "INR",
      notes: null,
      metadata: {},
      created_at: creationTime,
    },
  ];
  tables.portfolio_valuations = [
    {
      id: uuid(90),
      household_id: uuid(11),
      valuation_date: "2025-05-01",
      invested_amount: "100.0000",
      current_value: "150.0000",
      pnl_amount: "50.0000",
      currency: "INR",
      metadata: {},
      created_at: creationTime,
    },
  ];

  return tables;
}

export function beginArguments(
  tables: LegacyTables,
  sourceKind: "synthetic" | "production" = "synthetic",
) {
  return {
    runKey,
    inputDigest,
    sourceKind,
    evaluationTime,
    expectedCountsJson: canonicalJson(
      Object.fromEntries(
        legacyTables.map((table) => [table, tables[table].length]),
      ),
    ),
    sourceFilesJson: JSON.stringify(
      tables.import_batches.map((row) => ({
        legacyBatchId: row.id,
        expiresAt: row.expires_at,
        legacyStoragePath: row.storage_path,
        status: "unavailable",
      })),
    ),
  };
}

export async function migrate(tables = fixtures()) {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("MIGRATION_MODE", "synthetic");
  const t = convexTest(schema, modules);
  await t.mutation(internal.migration.begin, beginArguments(tables));
  for (const table of legacyTables)
    for (const row of tables[table])
      await t.mutation(internal.migration.loadRecord, {
        runKey,
        legacyTable: table,
        rowJson: JSON.stringify(row),
      });
  for (const batch of tables.import_batches)
    await t.action(internal.migration.finalizeBatch, {
      runKey,
      legacyBatchId: String(batch.id),
    });
  await t.mutation(internal.migration.completeRun, { runKey });
  for (const household of tables.households)
    await t.action(internal.migrationPublication.publish, {
      runKey,
      legacyHouseholdId: String(household.id),
    });

  return t;
}
