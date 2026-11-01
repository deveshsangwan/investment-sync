import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accounts,
  importBatches,
  instruments,
  sourceSnapshots,
  type Database,
} from "@investment-sync/db";
import { eq } from "drizzle-orm";
import { parseImportFile } from "@investment-sync/importers";
import { vestedWorkbook } from "../../../../importers/src/vested-fixtures";
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
  type ImportFixture,
} from "../import-test-support";
import {
  latestCurrentHoldings,
  exitedCurrentHoldings,
} from "./latest-holdings";
import { holdingSnapshotTimelineRows } from "./data";

vi.mock("../currency-rates", () => ({
  getUsdInrRate: vi.fn().mockResolvedValue({
    rate: 1,
    status: "fresh",
    fetchedAt: "2026-11-01T00:00:00Z",
    provider: "frankfurter",
  }),
}));
requireTestDatabaseUrlInCi();

const describeDb = testDatabaseUrl ? describe : describe.skip;
function declaration(sourceDate: string, accountName = "US Stocks") {
  return {
    kind: "source_snapshot",
    sourceType: "vested_drivewealth_xlsx",
    sourceDate,
    accountName,
    provider: "Vested / DriveWealth",
    assetClass: "us_stock",
    currency: "USD",
    sourceGroup: "",
    completeness: "complete",
    metadata: {},
  };
}
function holding(
  sourceDate: string,
  accountName = "US Stocks",
  currentValue = 120,
) {
  return {
    ...holdingRow({
      sourceDate,
      symbol: "FAKE",
      instrumentName: "FAKE",
      currentValue,
    }),
    sourceType: "vested_drivewealth_xlsx",
    accountName,
    provider: "Vested / DriveWealth",
    assetClass: "us_stock",
    currency: "USD",
    quantity: currentValue / 12,
  };
}

describeDb("SQL explicit source snapshots", () => {
  let db: Database;
  beforeAll(() => {
    const database = testDatabase();
    if (!database) throw new Error("TEST_DATABASE_URL required");

    db = database;
  });
  beforeEach(() => resetDatabase(db));
  async function commit(
    fixture: ImportFixture,
    rows?: Record<string, unknown>[],
    parserVersion = "vested-v5",
  ) {
    const batchId = rows
      ? await createBatch(
          db,
          fixture.membership,
          rows,
          "vested_drivewealth_xlsx",
          { parserVersion },
        )
      : fixture.batchId;
    await runImportEffect(
      commitImport(contextFor(db, fixture), fixture.membership, batchId),
    );

    return batchId;
  }
  function context(fixture: ImportFixture) {
    return { ...contextFor(db, fixture), membership: fixture.membership };
  }

  it.each([false, true])(
    "liquidates the sole position with sales=%s and keeps retained lot details",
    async (withSales) => {
      const fixture = await createFixture(db, [holding("2025-01-01")]);
      await commit(fixture);
      const parsed = parseImportFile(
        vestedWorkbook({
          holdings: [],
          ...(withSales
            ? {
                sales: [["FAKE", "2025-02-01", "2024-01-01", 10, 150, 100, 50]],
              }
            : {}),
        }),
      );
      const rows = parsed.rows.map((row) =>
        row.kind === "source_snapshot"
          ? { ...row, sourceDate: "2025-02-01" }
          : { ...row },
      );
      await commit(fixture, rows);
      expect(await latestCurrentHoldings(context(fixture))).toEqual([]);
      expect(await exitedCurrentHoldings(context(fixture))).toMatchObject([
        { symbol: "FAKE" },
      ]);
      const caller = appRouter.createCaller(contextFor(db, fixture));
      expect((await caller.portfolio.overview()).summary).toMatchObject({
        currentValue: 0,
        asOfDate: "2025-02-01",
      });
      const [exited] = await exitedCurrentHoldings(context(fixture));
      if (!exited) throw new Error("Missing exited position");

      expect(
        (await caller.portfolio.holdingDetail({ id: exited.id }))?.sales,
      ).toHaveLength(withSales ? 1 : 0);
      expect(
        (await holdingSnapshotTimelineRows(context(fixture))).at(-1),
      ).toMatchObject({ snapshotDate: "2025-02-01", currentValue: 0 });
    },
  );

  it("keeps partial holdings and never treats a sale-only report as completeness", async () => {
    const fixture = await createFixture(db, [holding("2025-01-01")]);
    await commit(fixture);
    const parsed = parseImportFile(
      vestedWorkbook({
        holdings: [],
        sales: [["FAKE", "2025-02-01", "2024-01-01", 2, 30, 20, 10]],
      }),
    );
    await commit(
      fixture,
      parsed.rows
        .filter((row) => row.kind === "transaction")
        .map((row) => ({ ...row })),
    );
    expect(await latestCurrentHoldings(context(fixture))).toMatchObject([
      { currentValue: "120.0000" },
    ]);
    await commit(fixture, [
      holding("2025-02-01", "US Stocks", 96),
      declaration("2025-02-01"),
    ]);
    expect(await latestCurrentHoldings(context(fixture))).toMatchObject([
      { quantity: "8.0000000000", currentValue: "96.0000" },
    ]);
  });

  it("handles same-day replacements, repeats, parser reprocessing, out-of-order reports and reentry", async () => {
    const fixture = await createFixture(db, [holding("2025-02-01")]);
    await commit(fixture);
    const emptyBatch = await commit(fixture, [declaration("2025-02-01")]);
    await commit(fixture, [declaration("2025-02-01")], "vested-v6");
    await runImportEffect(
      commitImport(contextFor(db, fixture), fixture.membership, emptyBatch),
    );
    expect(await latestCurrentHoldings(context(fixture))).toEqual([]);
    expect(await holdingSnapshotTimelineRows(context(fixture))).toEqual([
      {
        snapshotDate: "2025-02-01",
        investedAmount: 0,
        currentValue: 0,
        currency: "INR",
      },
    ]);
    await commit(fixture, [holding("2025-01-01"), declaration("2025-01-01")]);
    expect(await latestCurrentHoldings(context(fixture))).toEqual([]);
    await commit(fixture, [
      holding("2025-03-01", "US Stocks", 24),
      declaration("2025-03-01"),
    ]);
    expect(await latestCurrentHoldings(context(fixture))).toMatchObject([
      { quantity: "2.0000000000" },
    ]);
    expect(await exitedCurrentHoldings(context(fixture))).toEqual([]);
    const retained = await db.select().from(sourceSnapshots);
    expect(retained).toHaveLength(4);
    expect(
      retained.every((row) => row.normalizedPayload.kind === "source_snapshot"),
    ).toBe(true);
  });

  it("retains other accounts and households and creates no instrument for declaration-only input", async () => {
    const fixture = await createFixture(db, [
      holding("2025-01-01"),
      holding("2025-01-01", "Second account"),
    ]);
    const other = await createFixture(db, [holding("2025-01-01")]);
    await Promise.all([commit(fixture), commit(other)]);
    await commit(fixture, [declaration("2025-02-01")]);
    expect(await latestCurrentHoldings(context(fixture))).toMatchObject([
      { accountName: "Second account" },
    ]);
    expect(await latestCurrentHoldings(context(other))).toHaveLength(1);
    const before = await db.select().from(instruments);
    const empty = await createFixture(db, [
      declaration("2025-02-01", "Empty account"),
    ]);
    await commit(empty);
    expect(await db.select().from(instruments)).toHaveLength(before.length);
    expect(
      await db
        .select()
        .from(accounts)
        .where(eq(accounts.householdId, empty.membership.householdId)),
    ).toHaveLength(1);
  });

  it("serializes independent commits using the database clock rather than an application test clock", async () => {
    const fixture = await createFixture(db, [holding("2025-01-01")]);
    await commit(fixture);
    const batchA = await createBatch(db, fixture.membership, [
      declaration("2025-02-01"),
    ]);
    const batchB = await createBatch(db, fixture.membership, [
      declaration("2025-02-01"),
    ]);
    await Promise.all(
      [batchA, batchB].map((batchId) =>
        runImportEffect(
          commitImport(contextFor(db, fixture), fixture.membership, batchId),
        ),
      ),
    );
    const batches = await db.select().from(importBatches);
    const sequences = batches.map((batch) => batch.sourceSequence);
    expect(new Set(sequences).size).toBe(3);
    expect(sequences.every((sequence) => Number.isSafeInteger(sequence))).toBe(
      true,
    );
    expect(await latestCurrentHoldings(context(fixture))).toEqual([]);
  });
});
