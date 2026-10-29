import { createHash } from "node:crypto";
import * as schema from "@investment-sync/db";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitImport,
  runImportEffect,
  uploadAndProcessImport,
} from "./import-service";
import {
  contextFor,
  createBatch,
  createHousehold,
  fakeSupabase,
  holdingRow,
  requireTestDatabaseUrlInCi,
  resetDatabase,
  testDatabaseUrl,
  tickertapeCsv,
} from "./import-test-support";

requireTestDatabaseUrlInCi();

const describeDb = testDatabaseUrl ? describe : describe.skip;
const parserVersion = "tickertape-stock-v1";
const content = Buffer.from(tickertapeCsv(1));
const fileHash = createHash("sha256").update(content).digest("hex");
const { importBatches, importRows, holdingSnapshots } = schema;

describeDb("duplicate source content integration", () => {
  const clients: ReturnType<typeof postgres>[] = [];

  function connect() {
    if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

    // Each operation gets its own pool. createDatabase uses max: 1 and may cache
    // the pool, which would queue competing commits on the same connection.
    const client = postgres(testDatabaseUrl, { max: 1, prepare: false });
    clients.push(client);

    return { client, db: drizzle(client, { schema }) };
  }

  beforeEach(async () => {
    await resetDatabase(connect().db);
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.end()));
  });

  it("races independent identical uploads and commits after more than ten historical attempts", async () => {
    const first = connect();
    const second = connect();
    const sessions = await Promise.all([
      first.client`select pg_backend_pid() as pid`,
      second.client`select pg_backend_pid() as pid`,
    ]);
    expect(new Set(sessions.map((rows) => rows[0]?.pid)).size).toBe(2);

    const membership = await createHousehold(first.db);
    for (let index = 0; index < 12; index++) {
      await createBatch(first.db, membership, [], "tickertape_stock_csv", {
        status: "failed",
        fileHash,
        parserVersion,
      });
    }
    const storage = fakeSupabase();
    const fixture = { clerkUserId: membership.userId };
    const contexts = [
      contextFor(first.db, fixture, storage.client),
      contextFor(second.db, fixture, storage.client),
    ];
    const uploads = await Promise.all(
      contexts.map((ctx, index) =>
        runImportEffect(
          uploadAndProcessImport(ctx, membership, {
            fileName: `fake-holdings-${index}.csv`,
            mimeType: "text/csv",
            content,
          }),
        ),
      ),
    );
    const ids = uploads.map((upload) => upload.importBatchId);
    expect(new Set(ids).size).toBe(2);
    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(
      await first.db
        .select({
          fileHash: importBatches.fileHash,
          parserVersion: importBatches.parserVersion,
        })
        .from(importBatches)
        .where(inArray(importBatches.id, ids)),
    ).toEqual([
      { fileHash, parserVersion },
      { fileHash, parserVersion },
    ]);

    const commits = await Promise.allSettled(
      uploads.map((upload, index) => {
        const ctx = contexts[index];
        if (!ctx) throw new Error("Missing independent connection");

        return runImportEffect(
          commitImport(ctx, membership, upload.importBatchId),
        );
      }),
    );
    expect(commits.filter((result) => result.status === "fulfilled")).toEqual([
      { status: "fulfilled", value: { committed: 1 } },
    ]);
    expect(
      commits.filter((result) => result.status === "rejected"),
    ).toMatchObject([
      { reason: { _tag: "ImportConflictError", message: "Duplicate Import" } },
    ]);

    const winnerId =
      ids[commits.findIndex((result) => result.status === "fulfilled")];
    const loserId =
      ids[commits.findIndex((result) => result.status === "rejected")];
    const ctx = contexts[0];
    if (!winnerId || !loserId || !ctx)
      throw new Error("Missing commit results");

    await expect(
      runImportEffect(commitImport(ctx, membership, winnerId)),
    ).resolves.toEqual({ committed: 1 });
    await expect(
      runImportEffect(commitImport(ctx, membership, loserId)),
    ).rejects.toMatchObject({
      _tag: "ImportConflictError",
      message: "Duplicate Import",
    });
    expect(
      await first.db
        .select({ batchId: holdingSnapshots.importBatchId })
        .from(holdingSnapshots),
    ).toEqual([{ batchId: winnerId }]);
    expect(
      await first.db
        .select({
          batchId: importRows.importBatchId,
          isCommitted: importRows.isCommitted,
        })
        .from(importRows)
        .where(eq(importRows.importBatchId, loserId)),
    ).toEqual([{ batchId: loserId, isCommitted: false }]);
    expect(
      await first.db
        .select({ id: importBatches.id })
        .from(importBatches)
        .where(
          and(
            eq(importBatches.householdId, membership.householdId),
            eq(importBatches.status, "committed"),
          ),
        ),
    ).toEqual([{ id: winnerId }]);

    await expect(
      runImportEffect(
        uploadAndProcessImport(ctx, membership, {
          fileName: "fake-later.csv",
          content,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "ImportConflictError",
      message: "Duplicate Import",
    });
  });

  it("allows parser-version reprocessing and the same content in another household", async () => {
    const { db } = connect();
    const membership = await createHousehold(db);
    const otherHousehold = await createHousehold(db);
    const storage = fakeSupabase();
    const ctx = contextFor(
      db,
      { clerkUserId: membership.userId },
      storage.client,
    );
    const oldBatchId = await createBatch(
      db,
      membership,
      [holdingRow()],
      "tickertape_stock_csv",
      { fileHash, parserVersion: "fake-previous-parser" },
    );
    await runImportEffect(commitImport(ctx, membership, oldBatchId));

    const reprocessed = await runImportEffect(
      uploadAndProcessImport(ctx, membership, {
        fileName: "fake-current-parser.csv",
        content,
      }),
    );
    await runImportEffect(
      commitImport(ctx, membership, reprocessed.importBatchId),
    );
    const otherCtx = contextFor(
      db,
      { clerkUserId: otherHousehold.userId },
      storage.client,
    );
    const other = await runImportEffect(
      uploadAndProcessImport(otherCtx, otherHousehold, {
        fileName: "fake-other-household.csv",
        content,
      }),
    );
    await expect(
      runImportEffect(commitImport(ctx, membership, other.importBatchId)),
    ).rejects.toMatchObject({ _tag: "ImportNotFoundError" });
    await runImportEffect(
      commitImport(otherCtx, otherHousehold, other.importBatchId),
    );

    const committed = await db
      .select({
        id: importBatches.id,
        parserVersion: importBatches.parserVersion,
        householdId: importBatches.householdId,
      })
      .from(importBatches)
      .where(eq(importBatches.status, "committed"));
    expect(committed).toHaveLength(3);
    expect(committed).toEqual(
      expect.arrayContaining([
        {
          id: oldBatchId,
          parserVersion: "fake-previous-parser",
          householdId: membership.householdId,
        },
        {
          id: reprocessed.importBatchId,
          parserVersion,
          householdId: membership.householdId,
        },
        {
          id: other.importBatchId,
          parserVersion,
          householdId: otherHousehold.householdId,
        },
      ]),
    );
  });

  it("rolls back a failed commit without reserving the content identity", async () => {
    const { db } = connect();
    const membership = await createHousehold(db);
    const ctx = contextFor(db, { clerkUserId: membership.userId });
    const failedId = await createBatch(
      db,
      membership,
      [],
      "tickertape_stock_csv",
      { fileHash, parserVersion, rowCount: 1 },
    );
    const retryId = await createBatch(
      db,
      membership,
      [holdingRow()],
      "tickertape_stock_csv",
      { fileHash, parserVersion },
    );
    await expect(
      runImportEffect(commitImport(ctx, membership, failedId)),
    ).rejects.toMatchObject({
      _tag: "ImportPersistenceError",
      message: "Import Batch rows are incomplete",
    });
    await runImportEffect(commitImport(ctx, membership, retryId));
    await expect(
      runImportEffect(commitImport(ctx, membership, failedId)),
    ).rejects.toMatchObject({
      _tag: "ImportConflictError",
      message: "Duplicate Import",
    });

    expect(
      await db
        .select({ batchId: holdingSnapshots.importBatchId })
        .from(holdingSnapshots),
    ).toEqual([{ batchId: retryId }]);
  });
});
