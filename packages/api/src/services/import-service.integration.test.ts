import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import type { ImportSourceType } from "@investment-sync/importers";
import { eq } from "drizzle-orm";
import { createApiContext, type ApiContext } from "../context";
import { appRouter } from "../root";
import {
  cleanupExpiredImportFiles,
  commitImport,
  listImports,
  runImportEffect,
  uploadAndProcessImport,
} from "./import-service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Skipping locally is fine; skipping in CI is how this suite silently stopped
// running before. Fail loudly instead so a renamed or dropped env var breaks
// the build rather than turning the database tests back off unnoticed.
if (process.env.CI && !testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL must be set in CI so the import integration suite runs",
  );
}

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

    const result = await runImportEffect(
      commitImport(ctx, fixture.membership, fixture.batchId),
    );

    expect(result.committed).toBe(1);
    await expect(
      runImportEffect(commitImport(ctx, fixture.membership, fixture.batchId)),
    ).resolves.toEqual({ committed: 1 });

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
    expect(JSON.stringify({ holdings, overview })).not.toContain(
      "sourcePayload",
    );
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

    const result = await runImportEffect(
      commitImport(ctx, fixture.membership, fixture.batchId),
    );
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

    const result = await runImportEffect(
      commitImport(ctx, fixture.membership, fixture.batchId),
    );
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

    await runImportEffect(
      commitImport(ctx, fixture.membership, fixture.batchId),
    );

    const caller = appRouter.createCaller(ctx);
    const holdings = await caller.portfolio.holdings();

    expect(holdings).toHaveLength(1);
    expect(holdings[0]?.currentValue).toBe("125.0000");
  });

  it("keeps the richer snapshot regardless of same-date import order", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");

    for (const order of [
      [
        npsHoldingRow("nps_csv", 200),
        npsHoldingRow("investment_portfolio_xlsx", 100),
      ],
      [
        npsHoldingRow("investment_portfolio_xlsx", 100),
        npsHoldingRow("nps_csv", 200),
      ],
    ]) {
      const [first, second] = order;
      if (!first || !second) throw new Error("Invalid priority test fixture");
      const fixture = await createFixture([first], first.sourceType);
      const ctx = createApiContext({
        auth: { userId: fixture.clerkUserId, email: fixture.email },
        db,
        supabase: {} as ApiContext["supabase"],
      });
      await runImportEffect(
        commitImport(ctx, fixture.membership, fixture.batchId),
      );
      const secondBatchId = await createBatch(
        fixture.membership,
        [second],
        second.sourceType,
      );
      await runImportEffect(
        commitImport(ctx, fixture.membership, secondBatchId),
      );

      const snapshots = await db
        .select({
          id: holdingSnapshots.id,
          currentValue: holdingSnapshots.currentValue,
          sourceType: holdingSnapshots.sourceType,
          sourcePayload: holdingSnapshots.sourcePayload,
        })
        .from(holdingSnapshots)
        .where(
          eq(holdingSnapshots.householdId, fixture.membership.householdId),
        );
      expect(snapshots).toHaveLength(1);
      const [snapshot] = snapshots;
      if (!snapshot) throw new Error("Expected one NPS snapshot");
      expect(snapshot.currentValue).toBe("200.0000");
      expect(snapshot.sourceType).toBe("nps_csv");
      expect(snapshot.sourcePayload).toMatchObject({
        npsDetails: { schemaVersion: 1, tier: "I" },
      });
      const detail = await appRouter
        .createCaller(ctx)
        .portfolio.holdingDetail({ id: snapshot.id });
      expect(detail?.npsDetails).toMatchObject({
        schemaVersion: 1,
        tier: "I",
      });
      expect(JSON.stringify(detail)).not.toContain("sourcePayload");
      const householdAccounts = await db
        .select({ provider: accounts.provider, name: accounts.name })
        .from(accounts)
        .where(eq(accounts.householdId, fixture.membership.householdId));
      expect(householdAccounts).toEqual([{ provider: "NPS", name: "NPS" }]);
    }
  });

  it("serializes concurrent imports before creating shared identities", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture(
      [npsHoldingRow("investment_portfolio_xlsx", 100)],
      "investment_portfolio_xlsx",
    );
    const portalBatchId = await createBatch(
      fixture.membership,
      [npsHoldingRow("nps_csv", 200)],
      "nps_csv",
    );
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: {} as ApiContext["supabase"],
    });

    await Promise.all([
      runImportEffect(commitImport(ctx, fixture.membership, fixture.batchId)),
      runImportEffect(commitImport(ctx, fixture.membership, portalBatchId)),
    ]);

    const [householdAccounts, snapshots] = await Promise.all([
      db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.householdId, fixture.membership.householdId)),
      db
        .select({
          currentValue: holdingSnapshots.currentValue,
          sourceType: holdingSnapshots.sourceType,
        })
        .from(holdingSnapshots)
        .where(
          eq(holdingSnapshots.householdId, fixture.membership.householdId),
        ),
    ]);
    expect(householdAccounts).toHaveLength(1);
    expect(snapshots).toEqual([
      { currentValue: "200.0000", sourceType: "nps_csv" },
    ]);
  });

  it("rejects an Import Batch that is not parsed", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture([]);
    await db
      .update(importBatches)
      .set({ status: "created" })
      .where(eq(importBatches.id, fixture.batchId));
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: {} as ApiContext["supabase"],
    });

    await expect(
      runImportEffect(commitImport(ctx, fixture.membership, fixture.batchId)),
    ).rejects.toThrow("Import Batch is not ready to commit");
  });

  it("rejects a duplicate committed Import Batch", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture();
    const duplicateBatchId = randomUUID();
    await db
      .update(importBatches)
      .set({ fileHash: "same-file", parserVersion: "parser-v1", rowCount: 1 })
      .where(eq(importBatches.id, fixture.batchId));
    await db.insert(importBatches).values({
      id: duplicateBatchId,
      householdId: fixture.membership.householdId,
      uploadedByUserId: fixture.membership.appUserId,
      originalFileName: "duplicate.csv",
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "parsed",
      fileHash: "same-file",
      parserVersion: "parser-v1",
      rowCount: 1,
    });
    await db.insert(importRows).values({
      importBatchId: duplicateBatchId,
      rowNumber: 1,
      normalizedPayload: holdingRow(),
    });
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: {} as ApiContext["supabase"],
    });

    await runImportEffect(
      commitImport(ctx, fixture.membership, fixture.batchId),
    );
    await expect(
      runImportEffect(commitImport(ctx, fixture.membership, duplicateBatchId)),
    ).rejects.toThrow("Duplicate Import");
  });

  it("enforces committed duplicate protection in Postgres", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture();
    const duplicateBatchId = randomUUID();
    await db
      .update(importBatches)
      .set({ fileHash: "database-duplicate", parserVersion: "parser-v1" })
      .where(eq(importBatches.id, fixture.batchId));
    await db.insert(importBatches).values({
      id: duplicateBatchId,
      householdId: fixture.membership.householdId,
      uploadedByUserId: fixture.membership.appUserId,
      originalFileName: "duplicate.csv",
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "parsed",
      fileHash: "database-duplicate",
      parserVersion: "parser-v1",
      rowCount: 1,
    });

    await db
      .update(importBatches)
      .set({ status: "committed" })
      .where(eq(importBatches.id, fixture.batchId));
    await expect(
      db
        .update(importBatches)
        .set({ status: "committed" })
        .where(eq(importBatches.id, duplicateBatchId)),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("uses the UTC upload date when a holding has no source date", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture([holdingRow({ omitSourceDate: true })]);
    await db
      .update(importBatches)
      .set({ uploadedAt: new Date("2026-05-02T23:30:00.000Z") })
      .where(eq(importBatches.id, fixture.batchId));
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: {} as ApiContext["supabase"],
    });

    await runImportEffect(
      commitImport(ctx, fixture.membership, fixture.batchId),
    );
    const [snapshot] = await db
      .select({ snapshotDate: holdingSnapshots.snapshotDate })
      .from(holdingSnapshots)
      .where(eq(holdingSnapshots.importBatchId, fixture.batchId));

    expect(snapshot?.snapshotDate).toBe("2026-05-02");
  });

  it("rejects an Import Batch with no usable rows", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture();
    const supabase = fakeSupabase();
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: supabase.client as unknown as ApiContext["supabase"],
    });
    const content = Buffer.from(
      [
        "https://tickertape.in/portfolio?tab=holdings",
        "Security,Quantity,Current Value,Average Cost",
      ].join("\n"),
    );

    await expect(
      runImportEffect(
        uploadAndProcessImport(ctx, fixture.membership, {
          fileName: "empty.csv",
          mimeType: "text/csv",
          content,
        }),
      ),
    ).rejects.toThrow("Import Batch contains no usable rows");

    const batches = await runImportEffect(listImports(ctx, fixture.membership));
    const failed = batches.find((batch) => batch.status === "failed");
    expect(failed).toMatchObject({
      status: "failed",
      sourceFileAvailable: false,
      errors: ["Import Batch contains no usable rows"],
    });
    expect(failed).not.toHaveProperty("storagePath");
    expect(failed).not.toHaveProperty("fileHash");
  });

  it("returns only three preview rows after storing a valid import", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture();
    const supabase = fakeSupabase();
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: supabase.client as unknown as ApiContext["supabase"],
    });
    const content = Buffer.from(tickertapeCsv(4));

    const result = await runImportEffect(
      uploadAndProcessImport(ctx, fixture.membership, {
        fileName: "holdings.csv",
        mimeType: "text/csv",
        content,
      }),
    );

    expect(result.rowCount).toBe(4);
    expect(result.previewRows).toHaveLength(3);
    expect(result).not.toHaveProperty("rows");
    expect(supabase.upload).toHaveBeenCalledOnce();
    const [batch] = await db
      .select({
        status: importBatches.status,
        rowCount: importBatches.rowCount,
      })
      .from(importBatches)
      .where(eq(importBatches.id, result.importBatchId));
    expect(batch).toEqual({ status: "parsed", rowCount: 4 });
  });

  it("rejects imports above the normalized row limit before storage", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture();
    const supabase = fakeSupabase();
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: supabase.client as unknown as ApiContext["supabase"],
    });
    const content = Buffer.from(tickertapeCsv(25_001));
    expect(content.length).toBeLessThan(4 * 1024 * 1024);

    await expect(
      runImportEffect(
        uploadAndProcessImport(ctx, fixture.membership, {
          fileName: "too-many-rows.csv",
          mimeType: "text/csv",
          content,
        }),
      ),
    ).rejects.toThrow("Import Batch cannot exceed 25000 rows");
    expect(supabase.upload).not.toHaveBeenCalled();
  });

  it("clears an expired Source File without changing Import status", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture();
    await db
      .update(importBatches)
      .set({
        status: "committed",
        storagePath: "test/source.csv",
        expiresAt: new Date(0),
      })
      .where(eq(importBatches.id, fixture.batchId));
    const supabase = fakeSupabase();
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: supabase.client as unknown as ApiContext["supabase"],
    });

    await expect(
      runImportEffect(cleanupExpiredImportFiles(ctx)),
    ).resolves.toEqual({ deleted: 1 });
    const batches = await runImportEffect(listImports(ctx, fixture.membership));

    expect(batches[0]).toMatchObject({
      id: fixture.batchId,
      status: "committed",
      sourceFileAvailable: false,
    });
    expect(supabase.remove).toHaveBeenCalledWith(["test/source.csv"]);
  });

  async function createFixture(
    rows: Record<string, unknown>[] = [holdingRow()],
    sourceType: ImportSourceType = "unknown",
  ) {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const appUserId = randomUUID();
    const householdId = randomUUID();
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
    const membership = {
      userId: clerkUserId,
      appUserId,
      householdId,
      role: "owner",
    } as const;
    const batchId = await createBatch(membership, rows, sourceType);

    return {
      batchId,
      clerkUserId,
      email,
      membership,
    };
  }

  async function createBatch(
    membership: { householdId: string; appUserId: string },
    rows: Record<string, unknown>[],
    sourceType: ImportSourceType = "unknown",
  ) {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
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
});

function npsHoldingRow(
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

function holdingRow(
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

function fakeSupabase() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  return {
    upload,
    remove,
    client: {
      storage: {
        getBucket: vi.fn().mockResolvedValue({ error: null }),
        createBucket: vi.fn().mockResolvedValue({ error: null }),
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

function tickertapeCsv(rowCount: number) {
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
