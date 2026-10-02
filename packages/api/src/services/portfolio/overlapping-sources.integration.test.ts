import { beforeEach, describe, expect, it } from "vitest";
import { currencyRates, holdingSnapshots } from "@investment-sync/db";
import { eq } from "drizzle-orm";
import { appRouter } from "../../root";
import { commitImport, runImportEffect } from "../import-service";
import {
  contextFor,
  createBatch,
  createFixture,
  holdingRow,
  requireTestDatabaseUrlInCi,
  resetDatabase,
  testDatabase,
  testDatabaseUrl,
} from "../import-test-support";

requireTestDatabaseUrlInCi();

const describeDb = testDatabaseUrl ? describe : describe.skip;

describeDb("overlapping workbook and Vested holdings", () => {
  const db = testDatabase();

  function database() {
    if (!db) throw new Error("TEST_DATABASE_URL is required");

    return db;
  }

  beforeEach(async () => {
    await resetDatabase(database());
    await database().insert(currencyRates).values({
      base: "USD",
      quote: "INR",
      rate: "85",
      provider: "frankfurter",
      fetchedAt: new Date(),
    });
  });

  function usHolding(symbol: string, date: string, isWorkbook = false) {
    return {
      ...holdingRow({ symbol, instrumentName: symbol, sourceDate: date }),
      sourceType: isWorkbook
        ? "investment_portfolio_xlsx"
        : "vested_drivewealth_xlsx",
      accountName: "US Stocks",
      provider: isWorkbook ? "Manual Workbook" : "Vested / DriveWealth",
      assetClass: "us_stock",
      currency: "USD",
      metadata: isWorkbook ? { sourceSheet: "US stocks" } : {},
    };
  }

  async function seedExit(extraWorkbookRows: Record<string, unknown>[] = []) {
    const db = database();
    const fixture = await createFixture(db, [
      usHolding("BBAI", "2025-12-05", true),
      ...extraWorkbookRows,
    ]);
    const ctx = contextFor(db, fixture);
    await runImportEffect(
      commitImport(ctx, fixture.membership, fixture.batchId),
    );

    for (const rows of [
      [usHolding("BBAI", "2026-09-05"), usHolding("NVDA", "2026-09-05")],
      [usHolding("NVDA", "2026-09-22")],
    ]) {
      const batchId = await createBatch(db, fixture.membership, rows);
      await runImportEffect(commitImport(ctx, fixture.membership, batchId));
    }

    return fixture;
  }

  it("exits an omitted holding without reviving its workbook snapshot, and supports re-entry", async () => {
    const db = database();
    const fixture = await seedExit();
    const caller = appRouter.createCaller(contextFor(db, fixture));
    const positions = await caller.portfolio.positions();
    expect(positions.current.map((row) => row.symbol)).toEqual(["NVDA"]);
    expect(positions.exited).toMatchObject([
      {
        symbol: "BBAI",
        provider: "Vested / DriveWealth",
        snapshotDate: "2026-09-05",
      },
    ]);
    expect(positions.exited).toHaveLength(1);

    const overview = await caller.portfolio.overview();
    const detail = await caller.portfolio.assetClassDetail({
      assetClass: "us_stock",
    });
    expect(overview.holdings.map((row) => row.symbol)).toEqual(["NVDA"]);
    expect(detail.holdings.map((row) => row.symbol)).toEqual(["NVDA"]);
    expect(detail.exitedHoldings.map((row) => row.symbol)).toEqual(["BBAI"]);
    expect(
      await db
        .select()
        .from(holdingSnapshots)
        .where(
          eq(holdingSnapshots.householdId, fixture.membership.householdId),
        ),
    ).toHaveLength(4);

    const batchId = await createBatch(db, fixture.membership, [
      usHolding("BBAI", "2026-09-23"),
      usHolding("NVDA", "2026-09-23"),
    ]);
    await runImportEffect(
      commitImport(contextFor(db, fixture), fixture.membership, batchId),
    );
    const restored = await appRouter
      .createCaller(contextFor(db, fixture))
      .portfolio.positions();
    expect(restored.current.map((row) => row.symbol).sort()).toEqual([
      "BBAI",
      "NVDA",
    ]);
    expect(restored.exited).toEqual([]);
  });

  it("uses the newer complete source even for a workbook-only symbol", async () => {
    const fixture = await seedExit([usHolding("OLD", "2025-12-05", true)]);
    const positions = await appRouter
      .createCaller(contextFor(database(), fixture))
      .portfolio.positions();
    expect(positions.current.map((row) => row.symbol)).toEqual(["NVDA"]);
    expect(positions.exited.map((row) => row.symbol).sort()).toEqual([
      "BBAI",
      "OLD",
    ]);
  });

  it.each([
    { accountName: "Other US Account" },
    { provider: "Other Broker" },
    { metadata: { sourceSheet: "Other US stocks" } },
  ])("preserves an independent source %j", async (overrides) => {
    const fixture = await seedExit([
      { ...usHolding("OTHER", "2025-12-05", true), ...overrides },
    ]);
    const positions = await appRouter
      .createCaller(contextFor(database(), fixture))
      .portfolio.positions();
    expect(positions.current.map((row) => row.symbol).sort()).toEqual([
      "NVDA",
      "OTHER",
    ]);
  });

  it.each([false, true])(
    "prefers Vested on the same date, workbook first: %s",
    async (workbookFirst) => {
      const db = database();
      const workbook = [
        usHolding("BBAI", "2026-09-22", true),
        usHolding("NVDA", "2026-09-22", true),
      ];
      const vested = [
        { ...usHolding("NVDA", "2026-09-22"), currentValue: 250 },
      ];
      const first = workbookFirst ? workbook : vested;
      const second = workbookFirst ? vested : workbook;
      const fixture = await createFixture(db, first);
      const ctx = contextFor(db, fixture);
      await runImportEffect(
        commitImport(ctx, fixture.membership, fixture.batchId),
      );
      const batchId = await createBatch(db, fixture.membership, second);
      await runImportEffect(commitImport(ctx, fixture.membership, batchId));

      const positions = await appRouter
        .createCaller(contextFor(db, fixture))
        .portfolio.positions();
      expect(positions.current).toMatchObject([
        {
          symbol: "NVDA",
          provider: "Vested / DriveWealth",
          currentValue: "250.0000",
        },
      ]);
      expect(positions.current).toHaveLength(1);
      expect(positions.exited.map((row) => row.symbol)).toEqual(["BBAI"]);
    },
  );

  it("allows a newer workbook snapshot to restore the position", async () => {
    const db = database();
    const fixture = await seedExit();
    const batchId = await createBatch(db, fixture.membership, [
      usHolding("BBAI", "2026-09-23", true),
    ]);
    await runImportEffect(
      commitImport(contextFor(db, fixture), fixture.membership, batchId),
    );

    const positions = await appRouter
      .createCaller(contextFor(db, fixture))
      .portfolio.positions();
    expect(positions.current.map((row) => row.symbol)).toEqual(["BBAI"]);
    expect(positions.exited.map((row) => row.symbol)).toEqual(["NVDA"]);
  });

  it("preserves the same ticker held in an independent account", async () => {
    const fixture = await seedExit([
      {
        ...usHolding("BBAI", "2025-12-05", true),
        accountName: "Separate US Account",
      },
    ]);
    const positions = await appRouter
      .createCaller(contextFor(database(), fixture))
      .portfolio.positions();
    expect(
      positions.current.find((row) => row.symbol === "BBAI")?.accountName,
    ).toBe("Separate US Account");
  });

  it("does not use another household's newer Vested snapshot", async () => {
    const db = database();
    await seedExit();
    const fixture = await createFixture(db, [
      usHolding("BBAI", "2025-12-05", true),
    ]);
    await runImportEffect(
      commitImport(
        contextFor(db, fixture),
        fixture.membership,
        fixture.batchId,
      ),
    );

    const positions = await appRouter
      .createCaller(contextFor(db, fixture))
      .portfolio.positions();
    expect(positions.current.map((row) => row.symbol)).toEqual(["BBAI"]);
    expect(positions.exited).toEqual([]);
  });

  it("keeps workbook holdings when no Vested source exists", async () => {
    const db = database();
    const fixture = await createFixture(db, [
      usHolding("BBAI", "2025-12-05", true),
    ]);
    await runImportEffect(
      commitImport(
        contextFor(db, fixture),
        fixture.membership,
        fixture.batchId,
      ),
    );
    const positions = await appRouter
      .createCaller(contextFor(db, fixture))
      .portfolio.positions();
    expect(positions.current.map((row) => row.symbol)).toEqual(["BBAI"]);
    expect(positions.exited).toEqual([]);
  });
});
