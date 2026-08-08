import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import {
  createDatabase,
  households,
  householdMembers,
  importBatches,
  importRows,
  users,
  type Database,
} from "@investment-sync/db";
import type { ImportSourceType } from "@investment-sync/importers";
import { sql } from "drizzle-orm";
import { createApiContext, type ApiContext } from "../context";
import type { MembershipContext } from "./membership";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Skipping locally is fine; skipping in CI is how this suite silently stopped
// running before. Fail loudly instead so a renamed or dropped env var breaks
// the build rather than turning the database tests back off unnoticed.
export function requireTestDatabaseUrlInCi() {
  if (process.env.CI && !testDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL must be set in CI so the import integration suites run",
    );
  }
}

export function testDatabase(): Database | undefined {
  return testDatabaseUrl ? createDatabase(testDatabaseUrl) : undefined;
}

/**
 * Instruments and users are global -- neither is scoped to a Household, so
 * deleting Households leaves them behind. A stale instrument whose name differs
 * only by whitespace then wins identity resolution in a later run and fails a
 * test that has nothing to do with it. Truncate everything instead of tracking
 * ids; this is a dedicated test database.
 *
 * ponytail: relies on the suites sharing one database serially
 * (--no-file-parallelism). Give each file its own schema if that stops holding.
 */
export async function resetDatabase(db: Database) {
  await db.execute(sql`
    truncate table
      users, households, household_members, accounts, instruments,
      holding_snapshots, transactions, portfolio_valuations,
      import_batches, import_rows, currency_rates, prices
    restart identity cascade
  `);
}

export interface ImportFixture {
  batchId: string;
  clerkUserId: string;
  email: string;
  membership: MembershipContext;
}

export async function createFixture(
  db: Database,
  rows: Record<string, unknown>[] = [holdingRow()],
  sourceType: ImportSourceType = "unknown",
): Promise<ImportFixture> {
  const membership = await createHousehold(db);
  const batchId = await createBatch(db, membership, rows, sourceType);

  return {
    batchId,
    clerkUserId: membership.userId,
    email: `${membership.userId}@example.com`,
    membership,
  };
}

export async function createHousehold(
  db: Database,
): Promise<MembershipContext> {
  const appUserId = randomUUID();
  const householdId = randomUUID();
  const clerkUserId = `test_${randomUUID()}`;

  await db.insert(users).values({
    id: appUserId,
    clerkUserId,
    email: `${clerkUserId}@example.com`,
  });
  await db.insert(households).values({
    id: householdId,
    name: "Test Household",
    ownerUserId: appUserId,
  });
  await db.insert(householdMembers).values({
    householdId,
    userId: appUserId,
    role: "owner",
  });

  return { userId: clerkUserId, appUserId, householdId, role: "owner" };
}

export async function createBatch(
  db: Database,
  membership: Pick<MembershipContext, "householdId" | "appUserId">,
  rows: Record<string, unknown>[],
  sourceType: ImportSourceType = "unknown",
  overrides: Partial<typeof importBatches.$inferInsert> = {},
) {
  const batchId = randomUUID();
  await db.insert(importBatches).values({
    id: batchId,
    householdId: membership.householdId,
    uploadedByUserId: membership.appUserId,
    sourceType,
    originalFileName: "holdings.csv",
    expiresAt: new Date(Date.now() + 86_400_000),
    status: "parsed",
    rowCount: rows.length,
    ...overrides,
  });
  if (rows.length > 0) {
    await db.insert(importRows).values(
      rows.map((normalizedPayload, index) => ({
        importBatchId: batchId,
        rowNumber: index + 1,
        normalizedPayload,
      })),
    );
  }
  return batchId;
}

export function contextFor(
  db: Database,
  fixture: { clerkUserId: string; email?: string | null },
  supabase: unknown = {},
): ApiContext {
  return createApiContext({
    auth: { userId: fixture.clerkUserId, email: fixture.email ?? null },
    db,
    supabase: supabase as ApiContext["supabase"],
  });
}

export function holdingRow(
  overrides: Partial<{
    accountName: string;
    provider: string;
    instrumentName: string;
    symbol: string;
    investedAmount: number;
    currentValue: number;
    metadata: Record<string, unknown>;
    sourceDate: string;
    omitSourceDate: boolean;
  }> = {},
) {
  return {
    kind: "holding",
    sourceType: "tickertape_stock_csv",
    sourceDate: overrides.omitSourceDate
      ? undefined
      : (overrides.sourceDate ?? "2026-06-16"),
    accountName: overrides.accountName ?? "Indian Stocks",
    provider: overrides.provider ?? "Tickertape",
    instrumentName: overrides.instrumentName ?? "ABC",
    symbol: overrides.symbol ?? "ABC",
    assetClass: "indian_stock",
    currency: "INR",
    quantity: 1,
    investedAmount: overrides.investedAmount ?? 100,
    currentValue: overrides.currentValue ?? 125,
    metadata: overrides.metadata ?? {},
  };
}

export function transactionRow(
  overrides: Partial<{
    tradeDate: string;
    type: string;
    amount: number;
    quantity: number;
    price: number;
    instrumentName: string;
    symbol: string;
  }> = {},
) {
  return {
    kind: "transaction",
    sourceType: "tickertape_stock_csv",
    accountName: "Indian Stocks",
    provider: "Tickertape",
    instrumentName: overrides.instrumentName ?? "ABC",
    symbol: overrides.symbol ?? "ABC",
    assetClass: "indian_stock",
    currency: "INR",
    tradeDate: overrides.tradeDate ?? "2026-06-16",
    type: overrides.type ?? "buy",
    quantity: overrides.quantity ?? 1,
    price: overrides.price ?? 100,
    amount: overrides.amount ?? 100,
    metadata: {},
  };
}

export function valuationRow(
  overrides: Partial<{
    valuationDate: string;
    investedAmount: number;
    currentValue: number;
    pnlAmount: number;
  }> = {},
) {
  return {
    kind: "valuation",
    sourceType: "investment_portfolio_xlsx",
    valuationDate: overrides.valuationDate ?? "2026-06-16",
    investedAmount: overrides.investedAmount ?? 100,
    currentValue: overrides.currentValue ?? 125,
    ...(overrides.pnlAmount === undefined
      ? {}
      : { pnlAmount: overrides.pnlAmount }),
    currency: "INR",
    metadata: {},
  };
}

export function npsHoldingRow(
  sourceType: "investment_portfolio_xlsx" | "nps_csv",
  currentValue: number,
) {
  return {
    kind: "holding",
    sourceType,
    sourceDate: "2026-06-16",
    accountName: "NPS",
    provider: "NPS",
    instrumentName: "NPS",
    assetClass: "nps",
    currency: "INR",
    investedAmount: 100,
    currentValue,
    metadata: {
      sourceSheet: "NPS",
      ...(sourceType === "nps_csv"
        ? {
            npsDetails: {
              schemaVersion: 1,
              tier: "I",
              totalContribution: 100,
              totalWithdrawal: 0,
              schemes: [
                {
                  code: "E",
                  sourceName: "Scheme E",
                  currentValue,
                  units: 1,
                  nav: currentValue,
                },
              ],
              contributionEvents: [],
              activities: [],
            },
          }
        : {}),
    },
  } as const;
}

export function fakeSupabase(
  options: {
    uploadError?: unknown;
    removeError?: unknown;
    getBucketError?: unknown;
    createBucketError?: unknown;
  } = {},
) {
  const upload = vi
    .fn()
    .mockResolvedValue({ error: options.uploadError ?? null });
  const remove = vi
    .fn()
    .mockResolvedValue({ error: options.removeError ?? null });
  const getBucket = vi
    .fn()
    .mockResolvedValue({ error: options.getBucketError ?? null });
  const createBucket = vi
    .fn()
    .mockResolvedValue({ error: options.createBucketError ?? null });
  return {
    upload,
    remove,
    getBucket,
    createBucket,
    client: {
      storage: {
        getBucket,
        createBucket,
        from: vi.fn().mockReturnValue({
          createSignedUploadUrl: vi.fn().mockResolvedValue({
            error: null,
            data: { token: "token", signedUrl: "https://example.com" },
          }),
          upload,
          remove,
        }),
      },
    },
  };
}

export function tickertapeCsv(rowCount: number) {
  const rows = Array.from(
    { length: rowCount },
    (_, index) => `STOCK${index},0,1,100,10,120,100,120,20,20,1,1`,
  );
  return `,,,Holdings - 16-May-26 IST
Visit: https://tickertape.in/portfolio?tab=holdings

Security,No. of Smallcases,Quantity,Average Cost ₹,Portfolio Weight %,LTP ₹,Invested Value ₹,Current Value ₹,P & L ₹,Net Change %,Daily Change ₹,Daily Change %

Stocks/ETFs

${rows.join("\n")}`;
}

/**
 * Drizzle's db is method-heavy; a spread loses it. Proxy so only the named
 * method is replaced and every other call still reaches the real database --
 * markImportFailed has to keep working while the path under test fails.
 */
export function dbWith(
  db: Database,
  overrides: Record<string, unknown>,
): Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (typeof property === "string" && property in overrides) {
        return overrides[property];
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
