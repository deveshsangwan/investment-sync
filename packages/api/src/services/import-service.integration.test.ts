import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  accounts,
  holdingSnapshots,
  importBatches,
  importRows,
  instruments,
  portfolioValuations,
  transactions,
  type Database,
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
import {
  createBatch as createBatchIn,
  createFixture as createFixtureIn,
  createHousehold,
  fakeSupabase,
  holdingRow,
  npsHoldingRow,
  requireTestDatabaseUrlInCi,
  resetDatabase,
  testDatabase,
  testDatabaseUrl,
  tickertapeCsv,
  transactionRow,
  valuationRow,
} from "./import-test-support";

requireTestDatabaseUrlInCi();

const describeDb = testDatabaseUrl ? describe : describe.skip;

describeDb("import service integration", () => {
  const db = testDatabase() as Database;

  beforeEach(async () => {
    await resetDatabase(db);
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

  it("carries a workbook-only holding through later partial imports", async () => {
    if (!db) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await createFixture(
      [
        {
          kind: "holding",
          sourceType: "investment_portfolio_xlsx",
          sourceDate: "2026-05-15",
          accountName: "EPF",
          provider: "Manual Workbook",
          instrumentName: "EPF Summary",
          assetClass: "other",
          currency: "INR",
          investedAmount: 172_800,
          currentValue: 182_816,
          metadata: {
            isAggregate: true,
            sourceSheet: "Investment Portfolio",
          },
        },
      ],
      "investment_portfolio_xlsx",
    );
    const ctx = createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email },
      db,
      supabase: {} as ApiContext["supabase"],
    });
    await runImportEffect(
      commitImport(ctx, fixture.membership, fixture.batchId),
    );
    const stockBatchId = await createBatch(
      fixture.membership,
      [holdingRow({ sourceDate: "2026-08-08" })],
      "tickertape_stock_csv",
    );
    await runImportEffect(commitImport(ctx, fixture.membership, stockBatchId));

    const overview = await appRouter.createCaller(ctx).portfolio.overview();

    expect(
      overview.holdings.map((holding) => holding.instrumentName).sort(),
    ).toEqual(["ABC", "EPF Summary"]);
    expect(overview.summary).toMatchObject({
      investedAmount: 172_900,
      currentValue: 182_941,
      asOfDate: "2026-08-08",
    });
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

  describe("commit rejections", () => {
    it("hides another Household's Import Batch behind not-found", async () => {
      const fixture = await createFixture();
      const intruder = await createHousehold(db);
      const ctx = createApiContext({
        auth: { userId: intruder.userId, email: null },
        db,
        supabase: {} as ApiContext["supabase"],
      });

      // Not "forbidden": a cross-Household id must not be confirmed to exist.
      await expect(
        runImportEffect(commitImport(ctx, intruder, fixture.batchId)),
      ).rejects.toThrow("Import Batch was not found");

      const [batch] = await db
        .select({ status: importBatches.status })
        .from(importBatches)
        .where(eq(importBatches.id, fixture.batchId));
      expect(batch?.status).toBe("parsed");
    });

    it("rejects an unknown Import Batch id", async () => {
      const fixture = await createFixture();
      const ctx = contextOf(fixture);

      await expect(
        runImportEffect(commitImport(ctx, fixture.membership, randomUUID())),
      ).rejects.toThrow("Import Batch was not found");
    });

    it("rejects a batch whose stored rows do not match its row count", async () => {
      const fixture = await createFixture([holdingRow()]);
      await db
        .update(importBatches)
        .set({ rowCount: 2 })
        .where(eq(importBatches.id, fixture.batchId));
      const ctx = contextOf(fixture);

      await expect(
        runImportEffect(commitImport(ctx, fixture.membership, fixture.batchId)),
      ).rejects.toThrow("Import Batch rows are incomplete");
    });

    it("rejects a parsed batch that has no rows at all", async () => {
      const fixture = await createFixture([]);
      const ctx = contextOf(fixture);

      await expect(
        runImportEffect(commitImport(ctx, fixture.membership, fixture.batchId)),
      ).rejects.toThrow("Import Batch rows are incomplete");
    });

    it("rejects a row whose stored payload no longer validates", async () => {
      const fixture = await createFixture([
        holdingRow(),
        { kind: "holding", instrumentName: "" },
      ]);
      const ctx = contextOf(fixture);

      await expect(
        runImportEffect(commitImport(ctx, fixture.membership, fixture.batchId)),
      ).rejects.toThrow("Import Batch row 2 is invalid");
    });

    it("writes nothing when a commit fails part way through", async () => {
      const fixture = await createFixture([
        holdingRow(),
        { kind: "holding", instrumentName: "" },
      ]);
      const ctx = contextOf(fixture);

      await expect(
        runImportEffect(commitImport(ctx, fixture.membership, fixture.batchId)),
      ).rejects.toThrow("Import Batch row 2 is invalid");

      // The whole commit is one transaction: no accounts, instruments or
      // snapshots may survive a partial failure.
      expect(await countIn(accounts, fixture.membership.householdId)).toBe(0);
      expect(
        await countIn(holdingSnapshots, fixture.membership.householdId),
      ).toBe(0);
      const remainingInstruments = await db
        .select({ id: instruments.id })
        .from(instruments);
      expect(remainingInstruments).toHaveLength(0);
      const [batch] = await db
        .select({
          status: importBatches.status,
          committedAt: importBatches.committedAt,
        })
        .from(importBatches)
        .where(eq(importBatches.id, fixture.batchId));
      expect(batch).toMatchObject({ status: "parsed", committedAt: null });
      const [row] = await db
        .select({ isCommitted: importRows.isCommitted })
        .from(importRows)
        .where(eq(importRows.importBatchId, fixture.batchId));
      expect(row?.isCommitted).toBe(false);
    });
  });

  describe("commit bookkeeping", () => {
    it("flags every row committed and stamps committedAt", async () => {
      const fixture = await createFixture([
        holdingRow({ symbol: "AAA", instrumentName: "AAA" }),
        holdingRow({ symbol: "BBB", instrumentName: "BBB" }),
      ]);
      const ctx = contextOf(fixture);
      const before = Date.now();

      await runImportEffect(
        commitImport(ctx, fixture.membership, fixture.batchId),
      );

      const rows = await db
        .select({ isCommitted: importRows.isCommitted })
        .from(importRows)
        .where(eq(importRows.importBatchId, fixture.batchId));
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.isCommitted)).toBe(true);

      const [batch] = await db
        .select({ committedAt: importBatches.committedAt })
        .from(importBatches)
        .where(eq(importBatches.id, fixture.batchId));
      expect(batch?.committedAt?.getTime()).toBeGreaterThanOrEqual(
        before - 5_000,
      );
    });

    it("commits transaction rows and dedupes a re-import of the same trade", async () => {
      const fixture = await createFixture([
        transactionRow({ amount: 100, tradeDate: "2026-06-16" }),
        transactionRow({
          amount: 250,
          tradeDate: "2026-06-17",
          type: "sell",
        }),
      ]);
      const ctx = contextOf(fixture);

      const result = await runImportEffect(
        commitImport(ctx, fixture.membership, fixture.batchId),
      );
      expect(result.committed).toBe(2);

      const committed = await db
        .select({
          type: transactions.type,
          amount: transactions.amount,
          tradeDate: transactions.tradeDate,
          quantity: transactions.quantity,
        })
        .from(transactions)
        .where(eq(transactions.householdId, fixture.membership.householdId))
        .orderBy(transactions.tradeDate);
      expect(committed).toEqual([
        {
          type: "buy",
          amount: "100.0000",
          tradeDate: "2026-06-16",
          quantity: "1.0000000000",
        },
        {
          type: "sell",
          amount: "250.0000",
          tradeDate: "2026-06-17",
          quantity: "1.0000000000",
        },
      ]);

      // Same identity tuple in a second batch updates rather than duplicates.
      const repeatBatchId = await createBatch(fixture.membership, [
        transactionRow({ amount: 100, tradeDate: "2026-06-16", quantity: 7 }),
      ]);
      await runImportEffect(
        commitImport(ctx, fixture.membership, repeatBatchId),
      );
      const afterRepeat = await db
        .select({ quantity: transactions.quantity })
        .from(transactions)
        .where(eq(transactions.householdId, fixture.membership.householdId))
        .orderBy(transactions.tradeDate);
      expect(afterRepeat).toHaveLength(2);
      expect(afterRepeat[0]?.quantity).toBe("7.0000000000");
    });

    it("commits valuation rows and derives a missing pnl amount", async () => {
      const fixture = await createFixture(
        [
          valuationRow({
            valuationDate: "2026-06-16",
            investedAmount: 100,
            currentValue: 125,
          }),
          valuationRow({
            valuationDate: "2026-06-17",
            investedAmount: 100,
            currentValue: 90,
            pnlAmount: -25,
          }),
        ],
        "investment_portfolio_xlsx",
      );
      const ctx = contextOf(fixture);

      const result = await runImportEffect(
        commitImport(ctx, fixture.membership, fixture.batchId),
      );
      expect(result.committed).toBe(2);

      const valuations = await db
        .select({
          valuationDate: portfolioValuations.valuationDate,
          pnlAmount: portfolioValuations.pnlAmount,
        })
        .from(portfolioValuations)
        .where(
          eq(portfolioValuations.householdId, fixture.membership.householdId),
        )
        .orderBy(portfolioValuations.valuationDate);
      expect(valuations).toEqual([
        // Derived as currentValue - investedAmount when the row omits it.
        { valuationDate: "2026-06-16", pnlAmount: "25.0000" },
        // An explicit value is kept even when it disagrees with the subtraction.
        { valuationDate: "2026-06-17", pnlAmount: "-25.0000" },
      ]);
    });

    it("commits a mixed batch of holdings, transactions and valuations", async () => {
      const fixture = await createFixture([
        holdingRow(),
        transactionRow(),
        valuationRow(),
      ]);
      const ctx = contextOf(fixture);

      const result = await runImportEffect(
        commitImport(ctx, fixture.membership, fixture.batchId),
      );

      expect(result.committed).toBe(3);
      expect(
        await countIn(holdingSnapshots, fixture.membership.householdId),
      ).toBe(1);
      expect(await countIn(transactions, fixture.membership.householdId)).toBe(
        1,
      );
      expect(
        await countIn(portfolioValuations, fixture.membership.householdId),
      ).toBe(1);
    });

    it("serves fresh portfolio reads after a later commit", async () => {
      const fixture = await createFixture([holdingRow({ currentValue: 125 })]);
      const ctx = contextOf(fixture);
      await runImportEffect(
        commitImport(ctx, fixture.membership, fixture.batchId),
      );
      expect(
        (await appRouter.createCaller(ctx).portfolio.summary()).currentValue,
      ).toBe(125);

      const secondBatchId = await createBatch(fixture.membership, [
        holdingRow({ currentValue: 500, sourceDate: "2026-06-17" }),
      ]);
      await runImportEffect(
        commitImport(ctx, fixture.membership, secondBatchId),
      );

      // The module-global householdPortfolioCache lives for 30s across
      // contexts, and the commit must invalidate it or the dashboard shows
      // stale totals right after an import. A fresh context is required to
      // reach it: ctx.cache is request-scoped and deliberately never cleared,
      // so reusing ctx would test the wrong cache and read 125 forever.
      const freshCtx = contextOf(fixture);
      expect(
        (await appRouter.createCaller(freshCtx).portfolio.summary())
          .currentValue,
      ).toBe(500);
    });
  });

  function contextOf(fixture: { clerkUserId: string; email?: string | null }) {
    return createApiContext({
      auth: { userId: fixture.clerkUserId, email: fixture.email ?? null },
      db,
      supabase: {} as ApiContext["supabase"],
    });
  }

  async function countIn(
    table:
      | typeof accounts
      | typeof holdingSnapshots
      | typeof transactions
      | typeof portfolioValuations,
    householdId: string,
  ) {
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.householdId, householdId));
    return rows.length;
  }

  function createFixture(
    rows: Record<string, unknown>[] = [holdingRow()],
    sourceType: ImportSourceType = "unknown",
  ) {
    return createFixtureIn(db, rows, sourceType);
  }

  function createBatch(
    membership: { householdId: string; appUserId: string },
    rows: Record<string, unknown>[],
    sourceType: ImportSourceType = "unknown",
  ) {
    return createBatchIn(db, membership, rows, sourceType);
  }
});
