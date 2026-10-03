import { randomUUID } from "node:crypto";
import {
  currencyRates,
  accounts,
  householdMembers,
  households,
  importBatches,
  importRows,
  instruments,
  holdingSnapshots,
  portfolioValuations,
  transactions,
  users,
  type Database,
} from "@investment-sync/db";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../root";
import { SourceWritesPausedError } from "../source-writes";
import { publicProcedure, router } from "../trpc";
import { getUsdInrRate } from "./currency-rates";
import {
  cleanupExpiredImportFiles,
  commitImport,
  runImportEffect,
  uploadAndProcessImport,
} from "./import-service";
import {
  contextFor,
  createFixture,
  dbWith,
  fakeSupabase,
  holdingRow,
  requireTestDatabaseUrlInCi,
  resetDatabase,
  testDatabase,
  testDatabaseUrl,
  tickertapeCsv,
  transactionRow,
  valuationRow,
} from "./import-test-support";
import { ensureMembership } from "./membership";

requireTestDatabaseUrlInCi();

const describeDb = testDatabaseUrl ? describe : describe.skip;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describeDb("source write freeze", () => {
  const database = testDatabase();

  function getDatabase() {
    if (!database) throw new Error("TEST_DATABASE_URL is required");

    return database;
  }

  beforeEach(async () => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", "false");
    await resetDatabase(getDatabase());
  });

  it("keeps existing-user queries read-only, including profile and expired FX", async () => {
    const db = getDatabase();
    const fixture = await createFixture(db, [
      holdingRow(),
      {
        ...holdingRow({ instrumentName: "US Equity", symbol: "US" }),
        currency: "USD",
        assetClass: "us_stock",
      },
    ]);
    const storage = fakeSupabase();
    await runImportEffect(
      commitImport(
        contextFor(db, fixture, storage.client),
        fixture.membership,
        fixture.batchId,
      ),
    );
    await db.insert(currencyRates).values({
      base: "USD",
      quote: "INR",
      provider: "frankfurter",
      rate: "83.25",
      fetchedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const [originalUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, fixture.membership.appUserId));
    const insert = vi.fn(() => {
      throw new Error("Unexpected insert");
    });
    const update = vi.fn(() => {
      throw new Error("Unexpected update");
    });
    const transaction = vi.fn(() => {
      throw new Error("Unexpected transaction");
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("SOURCE_WRITES_PAUSED", "true");
    const readDatabase = dbWith(db, { insert, update, transaction });
    const ctx = contextFor(
      readDatabase,
      { ...fixture, email: "changed@example.com" },
      storage.client,
    );
    const caller = appRouter.createCaller(ctx);

    expect(await caller.auth.me()).toMatchObject({
      user: { email: fixture.email },
    });
    expect(await caller.accounts.list()).toHaveLength(1);
    expect(await caller.imports.list()).toHaveLength(1);
    const holdings = await caller.portfolio.holdings();
    expect(holdings).toHaveLength(2);
    await caller.portfolio.positions();
    await caller.portfolio.summary();
    await caller.portfolio.overview();
    const holding = holdings[0];
    if (!holding) throw new Error("Expected a holding fixture");

    await caller.portfolio.holdingDetail({ id: holding.id });
    await caller.portfolio.assetClassDetail({ assetClass: "us_stock" });
    expect(await getUsdInrRate(readDatabase)).toMatchObject({
      rate: 83.25,
      isStale: true,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(
      await db
        .select()
        .from(users)
        .where(eq(users.id, fixture.membership.appUserId)),
    ).toEqual([originalUser]);
  });

  it("rejects unknown identities without provisioning", async () => {
    const db = getDatabase();
    const storage = fakeSupabase();
    const insert = vi.fn(() => {
      throw new Error("Unexpected provisioning");
    });
    const transaction = vi.fn(() => {
      throw new Error("Unexpected provisioning transaction");
    });
    const ctx = contextFor(
      dbWith(db, { insert, transaction }),
      { clerkUserId: `unknown_${randomUUID()}`, email: "unknown@example.com" },
      storage.client,
    );
    vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

    await expect(ensureMembership(ctx)).rejects.toBeInstanceOf(
      SourceWritesPausedError,
    );
    await expect(appRouter.createCaller(ctx).auth.me()).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Source writes are paused",
    });

    expect(insert).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(households)).toHaveLength(0);
    expect(await db.select().from(householdMembers)).toHaveLength(0);
  });

  it("blocks every tRPC mutation before membership and resolver side effects", async () => {
    const db = getDatabase();
    const fixture = await createFixture(db);
    const storage = fakeSupabase();
    const select = vi.fn(() => {
      throw new Error("Membership must not load");
    });
    const ctx = contextFor(dbWith(db, { select }), fixture, storage.client);
    const publicWrite = vi.fn();
    const testRouter = router({ write: publicProcedure.mutation(publicWrite) });
    vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

    await expect(
      appRouter
        .createCaller(ctx)
        .imports.commit({ importBatchId: fixture.batchId }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Source writes are paused",
    });
    await expect(testRouter.createCaller(ctx).write()).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Source writes are paused",
    });

    expect(select).not.toHaveBeenCalled();
    expect(publicWrite).not.toHaveBeenCalled();
  });

  it("blocks direct upload, repeated upload, commit and cleanup before DB or Storage access", async () => {
    const db = getDatabase();
    const fixture = await createFixture(db, [holdingRow()], "unknown");
    await db
      .update(importBatches)
      .set({ storagePath: "expired.csv", expiresAt: new Date(0) })
      .where(eq(importBatches.id, fixture.batchId));
    const storage = fakeSupabase();
    const insert = vi.fn(() => {
      throw new Error("Unexpected insert");
    });
    const update = vi.fn(() => {
      throw new Error("Unexpected update");
    });
    const select = vi.fn(() => {
      throw new Error("Unexpected read before write gate");
    });
    const transaction = vi.fn(() => {
      throw new Error("Unexpected transaction");
    });
    const ctx = contextFor(
      dbWith(db, { insert, update, select, transaction }),
      fixture,
      storage.client,
    );
    const input = {
      fileName: "holdings.csv",
      mimeType: "text/csv",
      content: Buffer.from(tickertapeCsv(1)),
    };
    const pendingUpload = uploadAndProcessImport(
      ctx,
      fixture.membership,
      input,
    );
    vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

    for (const operation of [
      pendingUpload.pipe(Effect.asVoid),
      uploadAndProcessImport(ctx, fixture.membership, input).pipe(
        Effect.asVoid,
      ),
      commitImport(ctx, fixture.membership, fixture.batchId).pipe(
        Effect.asVoid,
      ),
      cleanupExpiredImportFiles(ctx).pipe(Effect.asVoid),
    ]) {
      await expect(runImportEffect(operation)).rejects.toMatchObject({
        _tag: "ImportConflictError",
        message: "Source writes are paused",
      });
    }

    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.getBucket).not.toHaveBeenCalled();
    expect(storage.createBucket).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(await db.select().from(importBatches)).toMatchObject([
      { status: "parsed", storagePath: "expired.csv" },
    ]);
    expect(await db.select().from(importRows)).toMatchObject([
      { isCommitted: false },
    ]);
  });

  it("rechecks cleanup after selecting files and before Storage deletion", async () => {
    const db = getDatabase();
    const fixture = await createFixture(db);
    await db
      .update(importBatches)
      .set({ storagePath: "expired.csv", expiresAt: new Date(0) })
      .where(eq(importBatches.id, fixture.batchId));
    const storage = fakeSupabase();
    const select = vi.fn(() => {
      vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

      return db.select({
        id: importBatches.id,
        storagePath: importBatches.storagePath,
      });
    });
    const ctx = contextFor(dbWith(db, { select }), fixture, storage.client);

    await expect(
      runImportEffect(cleanupExpiredImportFiles(ctx)),
    ).rejects.toMatchObject({
      _tag: "ImportConflictError",
      message: "Source writes are paused",
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(await db.select().from(importBatches)).toMatchObject([
      { storagePath: "expired.csv" },
    ]);
  });

  it("leaves source metadata frozen when a previously issued cleanup delete completes", async () => {
    const db = getDatabase();
    const fixture = await createFixture(db);
    await db
      .update(importBatches)
      .set({ storagePath: "expired.csv", expiresAt: new Date(0) })
      .where(eq(importBatches.id, fixture.batchId));
    const storage = fakeSupabase();
    storage.remove.mockImplementation(() => {
      vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

      return Promise.resolve({ error: null });
    });
    const update = vi.fn(() => {
      throw new Error("Unexpected cleanup metadata update");
    });
    const ctx = contextFor(dbWith(db, { update }), fixture, storage.client);

    await expect(
      runImportEffect(cleanupExpiredImportFiles(ctx)),
    ).rejects.toMatchObject({
      _tag: "ImportConflictError",
      message: "Source writes are paused",
    });

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(await db.select().from(importBatches)).toMatchObject([
      { storagePath: "expired.csv" },
    ]);
  });

  it("rechecks bucket provisioning after the Storage read and before creation", async () => {
    const db = getDatabase();
    const fixture = await createFixture(db, []);
    const storage = fakeSupabase();
    storage.getBucket.mockImplementation(() => {
      vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

      return Promise.resolve({ error: { message: "Bucket does not exist" } });
    });
    const update = vi.fn(() => {
      throw new Error("Unexpected failure recording");
    });
    const ctx = contextFor(dbWith(db, { update }), fixture, storage.client);

    await expect(
      runImportEffect(
        uploadAndProcessImport(ctx, fixture.membership, {
          fileName: "holdings.csv",
          mimeType: "text/csv",
          content: Buffer.from(tickertapeCsv(1)),
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "ImportConflictError",
      message: "Source writes are paused",
    });

    expect(storage.getBucket).toHaveBeenCalledTimes(1);
    expect(storage.createBucket).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(await db.select().from(importBatches)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "created", errors: [] }),
      ]),
    );
  });

  it("keeps failure recording and compensating Storage deletion frozen after an in-flight upload", async () => {
    const db = getDatabase();
    const fixture = await createFixture(db);
    const storage = fakeSupabase();
    storage.upload.mockImplementation(() => {
      vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

      return Promise.resolve({ error: null });
    });
    const update = vi.fn(() => {
      throw new Error("Unexpected failure recording");
    });
    const ctx = contextFor(dbWith(db, { update }), fixture, storage.client);

    await expect(
      runImportEffect(
        uploadAndProcessImport(ctx, fixture.membership, {
          fileName: "holdings.csv",
          mimeType: "text/csv",
          content: Buffer.from(tickertapeCsv(1)),
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "ImportConflictError",
      message: "Source writes are paused",
    });

    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(await db.select().from(importBatches)).toHaveLength(2);
  });

  it("preserves first-login provisioning and email synchronization when unset", async () => {
    const db = getDatabase();
    const storage = fakeSupabase();
    vi.stubEnv("SOURCE_WRITES_PAUSED", undefined);
    const clerkUserId = `new_${randomUUID()}`;
    const first = contextFor(
      db,
      { clerkUserId, email: "first@example.com" },
      storage.client,
    );
    const membership = await ensureMembership(first);
    const next = contextFor(
      db,
      { clerkUserId, email: "next@example.com" },
      storage.client,
    );

    expect(await ensureMembership(next)).toEqual(membership);
    expect(await appRouter.createCaller(next).accounts.list()).toHaveLength(6);
    expect(await db.select().from(users)).toMatchObject([
      { email: "next@example.com" },
    ]);
    expect(await db.select().from(households)).toHaveLength(1);
    expect(await db.select().from(householdMembers)).toHaveLength(1);
  });

  it.each([1, 2, 3, 4])(
    "rolls back first-login provisioning when pause starts during write %i",
    async (pauseAfterWrite) => {
      const db = getDatabase();
      const storage = fakeSupabase();
      const { database, writes } = pauseDuringTransactionWrite(
        db,
        pauseAfterWrite,
      );
      const ctx = contextFor(
        database,
        { clerkUserId: `new_${randomUUID()}`, email: "new@example.com" },
        storage.client,
      );

      await expect(ensureMembership(ctx)).rejects.toBeInstanceOf(
        SourceWritesPausedError,
      );

      expect(writes).toHaveBeenCalledTimes(pauseAfterWrite);
      expect(await db.select().from(users)).toHaveLength(0);
      expect(await db.select().from(households)).toHaveLength(0);
      expect(await db.select().from(householdMembers)).toHaveLength(0);
      expect(await db.select().from(accounts)).toHaveLength(0);
    },
  );

  it.each([1, 2, 3, 4, 5, 6, 7])(
    "stops later writes and rolls back Commit when pause starts during write %i",
    async (pauseAfterWrite) => {
      const db = getDatabase();
      const fixture = await createFixture(db, [
        holdingRow(),
        transactionRow(),
        valuationRow(),
      ]);
      const storage = fakeSupabase();
      const { database, writes } = pauseDuringTransactionWrite(
        db,
        pauseAfterWrite,
      );
      const ctx = contextFor(database, fixture, storage.client);

      await expect(
        runImportEffect(commitImport(ctx, fixture.membership, fixture.batchId)),
      ).rejects.toMatchObject({
        _tag: "ImportConflictError",
        message: "Source writes are paused",
      });

      expect(writes).toHaveBeenCalledTimes(pauseAfterWrite);
      expect(await db.select().from(accounts)).toHaveLength(0);
      expect(await db.select().from(instruments)).toHaveLength(0);
      expect(await db.select().from(holdingSnapshots)).toHaveLength(0);
      expect(await db.select().from(transactions)).toHaveLength(0);
      expect(await db.select().from(portfolioValuations)).toHaveLength(0);
      expect(await db.select().from(importRows)).toMatchObject([
        { isCommitted: false },
        { isCommitted: false },
        { isCommitted: false },
      ]);
      expect(await db.select().from(importBatches)).toMatchObject([
        { status: "parsed", committedAt: null },
      ]);
    },
  );

  it.each([1, 2])(
    "rolls back parsed import rows when pause starts during transaction write %i",
    async (pauseAfterWrite) => {
      const db = getDatabase();
      const fixture = await createFixture(db, []);
      const storage = fakeSupabase();
      const { database, writes } = pauseDuringTransactionWrite(
        db,
        pauseAfterWrite,
      );
      const ctx = contextFor(database, fixture, storage.client);

      await expect(
        runImportEffect(
          uploadAndProcessImport(ctx, fixture.membership, {
            fileName: "holdings.csv",
            mimeType: "text/csv",
            content: Buffer.from(tickertapeCsv(1)),
          }),
        ),
      ).rejects.toMatchObject({
        _tag: "ImportConflictError",
        message: "Source writes are paused",
      });

      expect(writes).toHaveBeenCalledTimes(pauseAfterWrite);
      expect(storage.remove).not.toHaveBeenCalled();
      expect(await db.select().from(importRows)).toHaveLength(0);
      expect(await db.select().from(importBatches)).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            status: "uploaded",
            processedAt: null,
            errors: [],
          }),
        ]),
      );
    },
  );

  it.each([undefined, new Date(0)])(
    "fails frozen FX reads without a usable quote, fetchedAt=%s",
    async (fetchedAt) => {
      const db = getDatabase();
      if (fetchedAt) {
        await db.insert(currencyRates).values({
          base: "USD",
          quote: "INR",
          provider: "frankfurter",
          rate: "83.25",
          fetchedAt,
        });
      }

      const fetch = vi.fn();
      const insert = vi.fn(() => {
        throw new Error("Unexpected FX persistence");
      });
      vi.stubGlobal("fetch", fetch);
      vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

      await expect(getUsdInrRate(dbWith(db, { insert }))).rejects.toMatchObject(
        {
          _tag: "CurrencyRateUnavailableError",
          message: "USD/INR exchange rate is unavailable",
        },
      );

      expect(fetch).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it("prevents FX persistence when freeze starts during an in-flight provider fetch", async () => {
    const db = getDatabase();
    const fetch = vi.fn(() => {
      vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

      return Promise.resolve(
        new Response(JSON.stringify({ rate: 84.25 }), { status: 200 }),
      );
    });
    const insert = vi.fn(() => {
      throw new Error("Unexpected FX persistence");
    });
    vi.stubGlobal("fetch", fetch);

    await expect(getUsdInrRate(dbWith(db, { insert }))).resolves.toMatchObject({
      rate: 84.25,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    expect(await db.select().from(currencyRates)).toHaveLength(0);
  });

  it("prevents another FX request when pause starts after a transient provider failure", async () => {
    const db = getDatabase();
    const fetch = vi.fn(() => {
      vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

      return Promise.reject(new Error("Provider unavailable"));
    });
    const insert = vi.fn(() => {
      throw new Error("Unexpected FX persistence");
    });
    vi.stubGlobal("fetch", fetch);

    await expect(getUsdInrRate(dbWith(db, { insert }))).rejects.toMatchObject({
      _tag: "CurrencyRateUnavailableError",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });
});

function pauseDuringTransactionWrite(db: Database, pauseAfterWrite: number) {
  const writes = vi.fn();
  const database = dbWith(db, {
    transaction: ((operation, options) =>
      db.transaction(async (tx) => {
        const insert = tx.insert.bind(tx);
        const update = tx.update.bind(tx);
        const pauseDuringWrite = () => {
          writes();

          if (writes.mock.calls.length === pauseAfterWrite) {
            // The current write has passed its guard. Pause while it runs so
            // later writes must stop and the transaction must roll back.
            queueMicrotask(() => vi.stubEnv("SOURCE_WRITES_PAUSED", "true"));
          }
        };
        vi.spyOn(tx, "insert").mockImplementation((table) => {
          pauseDuringWrite();

          return insert(table);
        });
        vi.spyOn(tx, "update").mockImplementation((table) => {
          pauseDuringWrite();

          return update(table);
        });

        return operation(tx);
      }, options)) satisfies Database["transaction"],
  });

  return { database, writes };
}
