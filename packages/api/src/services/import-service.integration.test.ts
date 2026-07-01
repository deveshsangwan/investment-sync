import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  accounts,
  holdingSnapshots,
  households,
  householdMembers,
  importBatches,
  importRows,
  instruments,
  users,
} from "@investment-sync/db";
import { eq } from "drizzle-orm";
import { createApiContext, type ApiContext } from "../context";
import { appRouter } from "../root";
import { commitImport } from "./import-service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDb = testDatabaseUrl ? describe : describe.skip;

describeDb("import service integration", () => {
  const db = testDatabaseUrl ? createDatabase(testDatabaseUrl) : undefined;
  const householdIds: string[] = [];

  afterEach(async () => {
    if (!db) return;
    for (const householdId of householdIds.splice(0)) {
      await db.delete(households).where(eq(households.id, householdId));
    }
  });

  it("commits rows transactionally and exposes matching overview data", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture();
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: {} as ApiContext["supabase"],
    });

    const result = await commitImport(ctx, fixture.membership, fixture.batchId);

    expect(result.committed).toBe(1);

    const [batch] = await db
      .select({ status: importBatches.status })
      .from(importBatches)
      .where(eq(importBatches.id, fixture.batchId))
      .limit(1);
    expect(batch?.status).toBe("committed");

    const caller = appRouter.createCaller(ctx);
    const [holdings, summary, overview] = await Promise.all([
      caller.portfolio.holdings(),
      caller.portfolio.summary(),
      caller.portfolio.overview(),
    ]);

    expect(holdings).toHaveLength(1);
    expect(summary.currentValue).toBe(125);
    expect(overview.holdings).toEqual(holdings);
    expect(overview.summary).toEqual(summary);
    expect(overview.performance.absoluteReturnPercent).toBe(25);
    expect(overview.timeline).toHaveLength(1);
  });

  it("keeps dashboard and asset-class holdings aligned for aggregate edges", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture([
      holdingRow({
        instrumentName: "Foo",
        symbol: "FOO",
        currentValue: 100,
      }),
      holdingRow({
        instrumentName: "Foo Summary",
        symbol: "FOO_SUMMARY",
        currentValue: 999,
      }),
      holdingRow({
        instrumentName: "Something Summary Extra",
        symbol: "SUM_EXTRA",
        currentValue: 200,
      }),
      holdingRow({
        instrumentName: "Boolean Aggregate",
        symbol: "BOOL_AGG",
        currentValue: 300,
        metadata: { isAggregate: true },
      }),
      holdingRow({
        instrumentName: "String Aggregate",
        symbol: "STRING_AGG",
        currentValue: 400,
        metadata: { isAggregate: "true" },
      }),
    ]);
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: {} as ApiContext["supabase"],
    });

    const result = await commitImport(ctx, fixture.membership, fixture.batchId);
    expect(result.committed).toBe(5);

    const caller = appRouter.createCaller(ctx);
    const [holdings, assetClassDetail] = await Promise.all([
      caller.portfolio.holdings(),
      caller.portfolio.assetClassDetail({ assetClass: "indian_stock" }),
    ]);

    expect(holdings.map((holding) => holding.instrumentName)).toEqual([
      "Something Summary Extra",
      "Foo",
    ]);
    expect(
      assetClassDetail.holdings.map((holding) => holding.instrumentName),
    ).toEqual(holdings.map((holding) => holding.instrumentName));
    expect(
      holdings.some((holding) => holding.instrumentName === "Foo Summary"),
    ).toBe(false);
    expect(
      holdings.some(
        (holding) => holding.instrumentName === "Boolean Aggregate",
      ),
    ).toBe(false);
    expect(
      holdings.some((holding) => holding.instrumentName === "String Aggregate"),
    ).toBe(false);
  });

  it("collapses duplicate instrument identities at read time", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture([
      holdingRow({
        accountName: "Broker A",
        currentValue: 125,
        investedAmount: 100,
      }),
      holdingRow({
        accountName: "Broker B",
        currentValue: 210,
        investedAmount: 200,
      }),
    ]);
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: {} as ApiContext["supabase"],
    });

    const result = await commitImport(ctx, fixture.membership, fixture.batchId);
    expect(result.committed).toBe(2);

    const caller = appRouter.createCaller(ctx);
    const [holdings, assetClassDetail] = await Promise.all([
      caller.portfolio.holdings(),
      caller.portfolio.assetClassDetail({ assetClass: "indian_stock" }),
    ]);

    expect(holdings).toHaveLength(1);
    expect(assetClassDetail.holdings).toHaveLength(1);
    expect(assetClassDetail.summary.currentValue).toBe(
      Number(holdings[0]?.currentValue ?? 0),
    );
  });

  it("reuses legacy instrument identities with whitespace drift", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const symbol = `LEGACY${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const fixture = await createFixture([
      holdingRow({ instrumentName: symbol, symbol }),
    ]);
    const [account] = await db
      .insert(accounts)
      .values({
        householdId: fixture.membership.householdId,
        name: "Indian Stocks",
        provider: "Tickertape",
        accountType: "indian_stock",
        currency: "INR",
      })
      .returning();
    const [instrument] = await db
      .insert(instruments)
      .values({
        name: `${symbol} `,
        symbol: ` ${symbol.toLowerCase()} `,
        assetClass: "indian_stock",
        currency: "INR",
      })
      .returning();
    if (!account || !instrument) throw new Error("Failed to seed fixture");

    await db.insert(holdingSnapshots).values({
      householdId: fixture.membership.householdId,
      accountId: account.id,
      instrumentId: instrument.id,
      snapshotDate: "2026-06-16",
      quantity: "1",
      investedAmount: "100",
      currentValue: "100",
      currency: "INR",
      sourcePayload: {},
    });
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: {} as ApiContext["supabase"],
    });

    await commitImport(ctx, fixture.membership, fixture.batchId);

    const caller = appRouter.createCaller(ctx);
    const holdings = await caller.portfolio.holdings();

    expect(holdings).toHaveLength(1);
    expect(holdings[0]?.currentValue).toBe("125.0000");
  });

  async function createFixture(
    rows: Record<string, unknown>[] = [holdingRow()],
  ) {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const appUserId = randomUUID();
    const householdId = randomUUID();
    const batchId = randomUUID();
    const clerkUserId = `test_${randomUUID()}`;
    const email = `${clerkUserId}@example.com`;
    householdIds.push(householdId);

    await db.insert(users).values({
      id: appUserId,
      clerkUserId,
      email,
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
    await db.insert(importBatches).values({
      id: batchId,
      householdId,
      uploadedByUserId: appUserId,
      originalFileName: "holdings.csv",
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "parsed",
    });
    await db.insert(importRows).values(
      rows.map((normalizedPayload, index) => ({
        importBatchId: batchId,
        rowNumber: index + 1,
        normalizedPayload,
      })),
    );

    return {
      batchId,
      clerkUserId,
      email,
      membership: {
        userId: clerkUserId,
        appUserId,
        householdId,
        role: "owner",
      },
    };
  }
});

function holdingRow(
  overrides: Partial<{
    accountName: string;
    provider: string;
    instrumentName: string;
    symbol: string;
    investedAmount: number;
    currentValue: number;
    metadata: Record<string, unknown>;
  }> = {},
) {
  return {
    kind: "holding",
    sourceType: "tickertape_stock_csv",
    sourceDate: "2026-06-16",
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

function transactionRow(
  overrides: Partial<{
    accountName: string;
    provider: string;
    instrumentName: string;
    symbol: string;
    tradeDate: string;
    amount: number;
  }> = {},
) {
  return {
    kind: "transaction",
    sourceType: "tickertape_stock_csv",
    accountName: overrides.accountName ?? "Indian Stocks",
    provider: overrides.provider ?? "Tickertape",
    instrumentName: overrides.instrumentName ?? "ABC",
    symbol: overrides.symbol ?? "ABC",
    assetClass: "indian_stock",
    currency: "INR",
    tradeDate: overrides.tradeDate ?? "2026-06-16",
    type: "buy",
    amount: overrides.amount ?? -100,
    metadata: {},
  };
}
