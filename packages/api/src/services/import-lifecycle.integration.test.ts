import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { importBatches, importRows, type Database } from "@investment-sync/db";
import { and, eq } from "drizzle-orm";
import {
  cleanupExpiredImportFiles,
  listImports,
  runImportEffect,
  uploadAndProcessImport,
} from "./import-service";
import {
  contextFor,
  createBatch,
  createFixture,
  createHousehold,
  dbWith,
  fakeSupabase,
  requireTestDatabaseUrlInCi,
  resetDatabase,
  testDatabase,
  testDatabaseUrl,
  tickertapeCsv,
} from "./import-test-support";

requireTestDatabaseUrlInCi();

const describeDb = testDatabaseUrl ? describe : describe.skip;
const TICKERTAPE_PARSER_VERSION = "tickertape-stock-v1";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describeDb("import lifecycle integration", () => {
  const db = testDatabase() as Database;

  beforeEach(async () => {
    await resetDatabase(db);
  });

  describe("upload happy path", () => {
    it("stores the Source File under user/batch/name and records the batch", async () => {
      const fixture = await createFixture(db);
      const supabase = fakeSupabase();
      const ctx = contextFor(db, fixture, supabase.client);
      const before = Date.now();

      const result = await runImportEffect(
        uploadAndProcessImport(ctx, fixture.membership, {
          fileName: "my holdings (final)!.csv",
          mimeType: "text/csv",
          content: Buffer.from(tickertapeCsv(2)),
        }),
      );

      expect(result).toMatchObject({
        sourceType: "tickertape_stock_csv",
        parserVersion: TICKERTAPE_PARSER_VERSION,
        rowCount: 2,
      });
      expect(supabase.upload).toHaveBeenCalledOnce();
      const storagePath = supabase.upload.mock.calls[0]?.[0] as string;
      // Unsafe characters are replaced, and the Clerk user id -- not the app
      // user id -- prefixes the path.
      expect(storagePath).toBe(
        `${fixture.membership.userId}/${result.importBatchId}/my_holdings__final__.csv`,
      );

      const [batch] = await db
        .select({
          status: importBatches.status,
          storagePath: importBatches.storagePath,
          parserVersion: importBatches.parserVersion,
          rowCount: importBatches.rowCount,
          expiresAt: importBatches.expiresAt,
          processedAt: importBatches.processedAt,
        })
        .from(importBatches)
        .where(eq(importBatches.id, result.importBatchId));
      expect(batch).toMatchObject({
        status: "parsed",
        storagePath,
        parserVersion: TICKERTAPE_PARSER_VERSION,
        rowCount: 2,
      });
      expect(batch?.processedAt).not.toBeNull();
      expect(batch?.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + THIRTY_DAYS_MS - 5_000,
      );
      expect(batch?.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + THIRTY_DAYS_MS + 5_000,
      );

      const rows = await db
        .select({ rowNumber: importRows.rowNumber })
        .from(importRows)
        .where(eq(importRows.importBatchId, result.importBatchId));
      expect(rows.map((row) => row.rowNumber).sort()).toEqual([1, 2]);
    });

    it("records the file hash so a later duplicate can be detected", async () => {
      const fixture = await createFixture(db);
      const supabase = fakeSupabase();
      const ctx = contextFor(db, fixture, supabase.client);
      const content = Buffer.from(tickertapeCsv(1));

      const result = await runImportEffect(
        uploadAndProcessImport(ctx, fixture.membership, {
          fileName: "holdings.csv",
          mimeType: "text/csv",
          content,
        }),
      );

      const [batch] = await db
        .select({ fileHash: importBatches.fileHash })
        .from(importBatches)
        .where(eq(importBatches.id, result.importBatchId));
      expect(batch?.fileHash).toBe(
        createHash("sha256").update(content).digest("hex"),
      );
    });
  });

  describe("upload rejections", () => {
    it("rejects an invalid file before any Import Batch row exists", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase();
      const ctx = contextFor(db, fixture, supabase.client);
      const batchesBefore = await countBatches(db);

      await expect(
        runImportEffect(
          uploadAndProcessImport(ctx, fixture.membership, {
            fileName: "holdings.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("nope"),
          }),
        ),
      ).rejects.toThrow("Import files must be CSV or XLSX files");

      // Validation runs before the insert, so a rejected file leaves no trace.
      expect(await countBatches(db)).toBe(batchesBefore);
      expect(supabase.upload).not.toHaveBeenCalled();
    });

    it("marks the batch failed when the file cannot be parsed", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase();
      const ctx = contextFor(db, fixture, supabase.client);

      await expect(
        runImportEffect(
          uploadAndProcessImport(ctx, fixture.membership, {
            fileName: "holdings.csv",
            mimeType: "text/csv",
            content: Buffer.from("not,a,known,format\n1,2,3,4"),
          }),
        ),
      ).rejects.toThrow("No importer could detect this file format yet");

      const failed = await onlyFailedBatch(db, fixture.membership.householdId);
      expect(failed).toMatchObject({
        status: "failed",
        storagePath: null,
        errors: ["No importer could detect this file format yet"],
      });
      expect(failed?.processedAt).not.toBeNull();
      expect(supabase.upload).not.toHaveBeenCalled();
    });

    it("keeps parse metadata when a Duplicate Import is rejected", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase();
      const ctx = contextFor(db, fixture, supabase.client);
      const content = Buffer.from(tickertapeCsv(2));
      const fileHash = createHash("sha256").update(content).digest("hex");
      await createBatch(db, fixture.membership, [], "tickertape_stock_csv", {
        status: "committed",
        fileHash,
        parserVersion: TICKERTAPE_PARSER_VERSION,
        originalFileName: "already-committed.csv",
      });

      await expect(
        runImportEffect(
          uploadAndProcessImport(ctx, fixture.membership, {
            fileName: "holdings.csv",
            mimeType: "text/csv",
            content,
          }),
        ),
      ).rejects.toThrow("Duplicate Import");

      // The rejected batch still records what the parser found, so the uploads
      // screen can explain which file was refused.
      const failed = await onlyFailedBatch(db, fixture.membership.householdId);
      expect(failed).toMatchObject({
        status: "failed",
        sourceType: "tickertape_stock_csv",
        parserVersion: TICKERTAPE_PARSER_VERSION,
        rowCount: 2,
        storagePath: null,
        errors: ["Duplicate Import"],
      });
      expect(supabase.upload).not.toHaveBeenCalled();
    });

    it("marks the batch failed when import storage is unavailable", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase({
        getBucketError: { message: "missing" },
        createBucketError: { message: "permission denied" },
      });
      const ctx = contextFor(db, fixture, supabase.client);

      await expect(
        runImportEffect(
          uploadAndProcessImport(ctx, fixture.membership, {
            fileName: "holdings.csv",
            mimeType: "text/csv",
            content: Buffer.from(tickertapeCsv(1)),
          }),
        ),
      ).rejects.toThrow("Import storage is unavailable");

      const failed = await onlyFailedBatch(db, fixture.membership.householdId);
      expect(failed?.errors).toEqual(["Import storage is unavailable"]);
      expect(supabase.upload).not.toHaveBeenCalled();
    });

    it("tolerates a bucket that already exists", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase({
        getBucketError: { message: "not found" },
        createBucketError: { message: "Bucket already exists" },
      });
      const ctx = contextFor(db, fixture, supabase.client);

      await expect(
        runImportEffect(
          uploadAndProcessImport(ctx, fixture.membership, {
            fileName: "holdings.csv",
            mimeType: "text/csv",
            content: Buffer.from(tickertapeCsv(1)),
          }),
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    });

    it("marks the batch failed when the Source File cannot be stored", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase({ uploadError: { message: "no space" } });
      const ctx = contextFor(db, fixture, supabase.client);

      await expect(
        runImportEffect(
          uploadAndProcessImport(ctx, fixture.membership, {
            fileName: "holdings.csv",
            mimeType: "text/csv",
            content: Buffer.from(tickertapeCsv(1)),
          }),
        ),
      ).rejects.toThrow("Source File could not be stored");

      const failed = await onlyFailedBatch(db, fixture.membership.householdId);
      expect(failed).toMatchObject({
        status: "failed",
        storagePath: null,
        errors: ["Source File could not be stored"],
      });
      expect(await countRowsFor(db, failed?.id)).toBe(0);
    });
  });

  describe("recovery after the Source File is already stored", () => {
    it("deletes the stored file and clears the path when persistence fails", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase();
      const failing = dbWith(db, {
        transaction: () => Promise.reject(new Error("rows insert failed")),
      });
      const ctx = contextFor(db, fixture, supabase.client);

      await expect(
        runImportEffect(
          uploadAndProcessImport(
            { db: failing, supabase: ctx.supabase },
            fixture.membership,
            {
              fileName: "holdings.csv",
              mimeType: "text/csv",
              content: Buffer.from(tickertapeCsv(1)),
            },
          ),
        ),
      ).rejects.toThrow("Import operation failed");

      expect(supabase.remove).toHaveBeenCalledOnce();
      const failed = await onlyFailedBatch(db, fixture.membership.householdId);
      expect(failed).toMatchObject({
        status: "failed",
        storagePath: null,
        errors: ["Import operation failed"],
      });
      expect(await countRowsFor(db, failed?.id)).toBe(0);
    });

    it("expires the batch immediately when the stored file cannot be deleted", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase({ removeError: { message: "locked" } });
      const failing = dbWith(db, {
        transaction: () => Promise.reject(new Error("rows insert failed")),
      });
      const ctx = contextFor(db, fixture, supabase.client);
      const before = Date.now();

      await expect(
        runImportEffect(
          uploadAndProcessImport(
            { db: failing, supabase: ctx.supabase },
            fixture.membership,
            {
              fileName: "holdings.csv",
              mimeType: "text/csv",
              content: Buffer.from(tickertapeCsv(1)),
            },
          ),
        ),
      ).rejects.toThrow("Import operation failed");

      // The path is deliberately kept and expiry pulled back to now, so the
      // cleanup cron retries the delete instead of orphaning the file.
      const failed = await onlyFailedBatch(db, fixture.membership.householdId);
      expect(failed?.status).toBe("failed");
      expect(failed?.storagePath).not.toBeNull();
      expect(failed?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(failed?.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before - 5_000,
      );
    });

    it("records the storage path even when it was never persisted", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase({ removeError: { message: "locked" } });
      // Fail the update that writes storagePath, so the column is still null
      // when compensation runs. markImportFailed's own update must still work.
      let updates = 0;
      const failing = dbWith(db, {
        update: (...args: unknown[]) => {
          updates += 1;
          if (updates === 1) throw new Error("could not record the upload");
          return (db.update as unknown as (...a: unknown[]) => unknown)(
            ...args,
          );
        },
      });
      const ctx = contextFor(db, fixture, supabase.client);

      await expect(
        runImportEffect(
          uploadAndProcessImport(
            { db: failing, supabase: ctx.supabase },
            fixture.membership,
            {
              fileName: "holdings.csv",
              mimeType: "text/csv",
              content: Buffer.from(tickertapeCsv(1)),
            },
          ),
        ),
      ).rejects.toThrow("Import operation failed");

      // Without the path the cleanup cron cannot find the row -- it filters on
      // a non-null storagePath -- and the uploaded file leaks forever.
      const failed = await onlyFailedBatch(db, fixture.membership.householdId);
      expect(failed?.storagePath).toBe(
        `${fixture.membership.userId}/${failed?.id}/holdings.csv`,
      );
      expect(failed?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("rejects when the batch status changes while it is being parsed", async () => {
      const fixture = await createFixture(db, []);
      const supabase = fakeSupabase();
      const racing = dbWith(db, {
        transaction: async (...args: unknown[]) => {
          // Simulate a competing writer between the "uploaded" update and the
          // parsed transition guarded by `status = 'uploaded'`.
          await db
            .update(importBatches)
            .set({ status: "created" })
            .where(
              eq(importBatches.householdId, fixture.membership.householdId),
            );
          return (
            db.transaction as unknown as (...a: unknown[]) => Promise<unknown>
          )(...args);
        },
      });
      const ctx = contextFor(db, fixture, supabase.client);

      await expect(
        runImportEffect(
          uploadAndProcessImport(
            { db: racing, supabase: ctx.supabase },
            fixture.membership,
            {
              fileName: "holdings.csv",
              mimeType: "text/csv",
              content: Buffer.from(tickertapeCsv(1)),
            },
          ),
        ),
      ).rejects.toThrow("Import Batch changed while it was being parsed");

      const failed = await onlyFailedBatch(db, fixture.membership.householdId);
      expect(failed?.errors).toEqual([
        "Import Batch changed while it was being parsed",
      ]);
      expect(await countRowsFor(db, failed?.id)).toBe(0);
    });
  });

  describe("cleanupExpiredImportFiles", () => {
    it("leaves unexpired and already-cleared batches alone", async () => {
      const membership = await createHousehold(db);
      const unexpired = await createBatch(db, membership, [], "unknown", {
        storagePath: "keep/me.csv",
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      const cleared = await createBatch(db, membership, [], "unknown", {
        storagePath: null,
        expiresAt: new Date(0),
      });
      const supabase = fakeSupabase();
      const ctx = contextFor(
        db,
        { clerkUserId: membership.userId },
        supabase.client,
      );

      await expect(
        runImportEffect(cleanupExpiredImportFiles(ctx)),
      ).resolves.toEqual({ deleted: 0 });
      expect(supabase.remove).not.toHaveBeenCalled();
      expect(await storagePathOf(db, unexpired)).toBe("keep/me.csv");
      expect(await storagePathOf(db, cleared)).toBeNull();
    });

    it("keeps the storage path when the delete call fails", async () => {
      const membership = await createHousehold(db);
      const batchId = await createBatch(db, membership, [], "unknown", {
        storagePath: "expired/source.csv",
        expiresAt: new Date(0),
      });
      const supabase = fakeSupabase({ removeError: { message: "denied" } });
      const ctx = contextFor(
        db,
        { clerkUserId: membership.userId },
        supabase.client,
      );

      await expect(
        runImportEffect(cleanupExpiredImportFiles(ctx)),
      ).rejects.toThrow("Expired Source Files could not be deleted");

      // No partial state: the row still points at a file that still exists.
      expect(await storagePathOf(db, batchId)).toBe("expired/source.csv");
    });

    it("deletes at most one batch of files per run", async () => {
      const membership = await createHousehold(db);
      for (let index = 0; index < 101; index += 1) {
        await createBatch(db, membership, [], "unknown", {
          storagePath: `expired/${index}.csv`,
          expiresAt: new Date(0),
        });
      }
      const supabase = fakeSupabase();
      const ctx = contextFor(
        db,
        { clerkUserId: membership.userId },
        supabase.client,
      );

      await expect(
        runImportEffect(cleanupExpiredImportFiles(ctx)),
      ).resolves.toEqual({ deleted: 100 });
      await expect(
        runImportEffect(cleanupExpiredImportFiles(ctx)),
      ).resolves.toEqual({ deleted: 1 });
      await expect(
        runImportEffect(cleanupExpiredImportFiles(ctx)),
      ).resolves.toEqual({ deleted: 0 });
    });

    it("sweeps every Household because it runs without a session", async () => {
      const first = await createHousehold(db);
      const second = await createHousehold(db);
      for (const membership of [first, second]) {
        await createBatch(db, membership, [], "unknown", {
          storagePath: `expired/${membership.householdId}.csv`,
          expiresAt: new Date(0),
        });
      }
      const supabase = fakeSupabase();
      const ctx = contextFor(
        db,
        { clerkUserId: first.userId },
        supabase.client,
      );

      await expect(
        runImportEffect(cleanupExpiredImportFiles(ctx)),
      ).resolves.toEqual({ deleted: 2 });
    });
  });

  describe("listImports", () => {
    it("returns only the caller's Household, newest first, without paths", async () => {
      const fixture = await createFixture(db, []);
      const other = await createHousehold(db);
      await createBatch(db, other, [], "unknown", {
        originalFileName: "someone-elses.csv",
      });
      const older = await createBatch(db, fixture.membership, [], "unknown", {
        originalFileName: "older.csv",
        uploadedAt: new Date("2026-01-01T00:00:00.000Z"),
        storagePath: "a/b.csv",
      });
      const newer = await createBatch(db, fixture.membership, [], "unknown", {
        originalFileName: "newer.csv",
        uploadedAt: new Date("2026-02-01T00:00:00.000Z"),
        storagePath: null,
      });
      const ctx = contextFor(db, fixture, fakeSupabase().client);

      const batches = await runImportEffect(
        listImports(ctx, fixture.membership),
      );

      // The fixture batch defaults to uploadedAt = now, so it leads.
      expect(batches.map((batch) => batch.id)).toEqual([
        fixture.batchId,
        newer,
        older,
      ]);
      expect(batches.map((batch) => batch.sourceFileAvailable)).toEqual([
        false,
        false,
        true,
      ]);
      expect(JSON.stringify(batches)).not.toContain("storagePath");
      expect(JSON.stringify(batches)).not.toContain("someone-elses.csv");
    });

    it("returns at most fifty batches", async () => {
      const fixture = await createFixture(db, []);
      for (let index = 0; index < 55; index += 1) {
        await createBatch(db, fixture.membership, []);
      }
      const ctx = contextFor(db, fixture, fakeSupabase().client);

      const batches = await runImportEffect(
        listImports(ctx, fixture.membership),
      );
      expect(batches).toHaveLength(50);
    });
  });
});

async function countBatches(db: Database) {
  const rows = await db.select({ id: importBatches.id }).from(importBatches);
  return rows.length;
}

async function countRowsFor(db: Database, batchId: string | undefined) {
  if (!batchId) return 0;
  const rows = await db
    .select({ id: importRows.id })
    .from(importRows)
    .where(eq(importRows.importBatchId, batchId));
  return rows.length;
}

async function storagePathOf(db: Database, batchId: string) {
  const [batch] = await db
    .select({ storagePath: importBatches.storagePath })
    .from(importBatches)
    .where(eq(importBatches.id, batchId));
  return batch?.storagePath ?? null;
}

async function onlyFailedBatch(db: Database, householdId: string) {
  const batches = await db
    .select({
      id: importBatches.id,
      status: importBatches.status,
      sourceType: importBatches.sourceType,
      parserVersion: importBatches.parserVersion,
      rowCount: importBatches.rowCount,
      storagePath: importBatches.storagePath,
      errors: importBatches.errors,
      expiresAt: importBatches.expiresAt,
      processedAt: importBatches.processedAt,
    })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.householdId, householdId),
        eq(importBatches.status, "failed"),
      ),
    );
  expect(batches).toHaveLength(1);
  return batches[0];
}
