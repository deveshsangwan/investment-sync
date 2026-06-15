import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  households,
  householdMembers,
  importBatches,
  importRows,
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
  });

  async function createFixture() {
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
    await db.insert(importRows).values({
      importBatchId: batchId,
      rowNumber: 1,
      normalizedPayload: {
        kind: "holding",
        sourceType: "tickertape_stock_csv",
        sourceDate: "2026-06-16",
        accountName: "Indian Stocks",
        provider: "Tickertape",
        instrumentName: "ABC",
        symbol: "ABC",
        assetClass: "indian_stock",
        currency: "INR",
        quantity: 1,
        investedAmount: 100,
        currentValue: 125,
        metadata: {},
      },
    });

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
