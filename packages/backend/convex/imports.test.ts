import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import {
  chunkRows,
  digest,
  importLimits,
  parseRows,
  utf8Bytes,
} from "./model/importLimits";
import { expireSourceFile } from "./model/importRetention";
import schema from "./schema";
import { modules } from "./test.setup";

const identity = {
  subject: "import_owner",
  issuer: "https://example.clerk.accounts.dev",
  tokenIdentifier: "test|import_owner",
};
const row = {
  kind: "holding",
  sourceType: "manual_snapshot",
  accountName: "Test account",
  provider: "Test provider",
  instrumentName: "Test stock",
  assetClass: "indian_stock",
  currency: "INR",
  investedAmount: "10",
  currentValue: "12",
  source: {
    group: "Test",
    completeness: "complete",
    granularity: "instrument",
    priority: 0,
  },
  numericProvenance: {},
  metadata: {},
};
const rowsJson = JSON.stringify([row]);

async function setup() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(identity);
  await owner.mutation(api.users.ensureCurrent);
  const reservation = await owner.mutation(api.imports.createUpload, {
    fileName: "holdings.csv",
    sizeBytes: 4,
  });
  return { t, owner, ...reservation };
}

async function stage() {
  const state = await setup();
  const storageId = await state.t.run((ctx) =>
    ctx.storage.store(new Blob(["test"], { type: "text/csv" })),
  );
  await state.owner.mutation(api.imports.attachUpload, {
    batchId: state.batchId,
    storageId,
  });
  const input = await state.t.query(internal.importWorkers.parseInput, {
    batchId: state.batchId,
    attempt: 1,
  });
  return { ...state, storageId, attempt: 1, contentHash: input.contentHash };
}

async function store(state: Awaited<ReturnType<typeof stage>>) {
  await state.t.mutation(internal.importWorkers.storeChunk, {
    batchId: state.batchId,
    attempt: state.attempt,
    index: 0,
    count: 1,
    digest: digest(rowsJson),
    rowsJson,
  });
}

async function finish(state: Awaited<ReturnType<typeof stage>>) {
  await state.t.mutation(internal.importWorkers.finishParse, {
    batchId: state.batchId,
    attempt: state.attempt,
    contentHash: state.contentHash,
    parserVersion: "test1",
    sourceType: "manual_snapshot",
    rowCount: 1,
    normalizedBytes: utf8Bytes(rowsJson),
    manifest: [
      {
        index: 0,
        count: 1,
        bytes: utf8Bytes(rowsJson),
        digest: digest(rowsJson),
      },
    ],
    warnings: [],
  });
}

async function finishRows(
  state: Awaited<ReturnType<typeof stage>>,
  rows: ReturnType<typeof parseRows>,
) {
  const manifest = [];
  for (const [index, rowsJson] of chunkRows(rows).entries()) {
    const count = parseRows(rowsJson).length;
    const receipt = {
      index,
      count,
      bytes: utf8Bytes(rowsJson),
      digest: digest(rowsJson),
    };
    await state.t.mutation(internal.importWorkers.storeChunk, {
      batchId: state.batchId,
      attempt: state.attempt,
      index,
      count,
      digest: receipt.digest,
      rowsJson,
    });
    manifest.push(receipt);
  }

  await state.t.mutation(internal.importWorkers.finishParse, {
    batchId: state.batchId,
    attempt: state.attempt,
    contentHash: state.contentHash,
    parserVersion: "test1",
    sourceType: "manual_snapshot",
    rowCount: rows.length,
    normalizedBytes: utf8Bytes(JSON.stringify(rows)),
    manifest,
    warnings: [],
  });
}

function rowsWithNormalizedBytes(bytes: number) {
  const rows = Array.from({ length: 16 }, () => ({
    ...row,
    metadata: { padding: "" },
  }));
  const padding = bytes - utf8Bytes(JSON.stringify(rows));
  for (const [index, candidate] of rows.entries())
    candidate.metadata.padding = "x".repeat(
      Math.floor(padding / rows.length) + Number(index < padding % rows.length),
    );
  return parseRows(JSON.stringify(rows));
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("import lifecycle", () => {
  it("exposes availability without exposing storage IDs or download URLs", async () => {
    const state = await stage();
    const view = await state.owner.query(api.imports.get, {
      batchId: state.batchId,
    });
    const list = await state.owner.query(api.imports.list, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(view.fileAvailable).toBe(true);
    expect(view).not.toHaveProperty("fileUrl");
    expect(view).not.toHaveProperty("storageId");
    expect(JSON.stringify([view, list])).not.toContain(state.storageId);
  });

  it("accepts 1100 normalized rows and rejects 1101 at finalization", async () => {
    const accepted = await stage();
    const rows = parseRows(
      JSON.stringify(Array.from({ length: 1101 }, () => row)),
    );
    await finishRows(accepted, rows.slice(0, 1100));
    await expect(
      accepted.owner.query(api.imports.get, { batchId: accepted.batchId }),
    ).resolves.toMatchObject({ status: "parsed", rowCount: 1100 });
    const rejected = await stage();
    await expect(finishRows(rejected, rows)).rejects.toThrow(
      "Import capacity exceeded",
    );
    await expect(
      rejected.owner.query(api.imports.get, { batchId: rejected.batchId }),
    ).resolves.toMatchObject({ status: "parsing", rowCount: 0 });
  });

  it("accepts 524288 normalized bytes and rejects one byte above", async () => {
    const accepted = await stage();
    const maximum = rowsWithNormalizedBytes(importLimits.normalizedBytes);
    expect(utf8Bytes(JSON.stringify(maximum))).toBe(524288);
    await finishRows(accepted, maximum);
    const rejected = await stage();
    const oversized = rowsWithNormalizedBytes(importLimits.normalizedBytes + 1);
    expect(utf8Bytes(JSON.stringify(oversized))).toBe(524289);
    await expect(finishRows(rejected, oversized)).rejects.toThrow(
      "Import capacity exceeded",
    );
  });

  it("explicitly rejects the 1348-row stress fixture through normal staging", async () => {
    const state = await stage();
    const rows = parseRows(
      JSON.stringify(
        Array.from({ length: 1348 }, (_, index) => ({
          ...row,
          sourceType: "investment_portfolio_xlsx",
          accountName: `Account ${index % 16}`,
          instrumentName: `Instrument ${index % 182}`,
        })),
      ),
    );
    await expect(finishRows(state, rows)).rejects.toThrow(
      "Import capacity exceeded",
    );
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({ status: "parsing", rowCount: 0 });
  });

  it("rejects checksum mismatch before marking a batch parsed", async () => {
    const state = await stage();
    await store(state);
    await expect(
      finish({ ...state, contentHash: "wrong checksum" }),
    ).rejects.toThrow("Source file checksum mismatch");
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({ status: "parsing" });
  });

  it("checks downloaded bytes against the attached storage checksum", async () => {
    const state = await stage();
    await state.t.run(async (ctx) => {
      const file = await ctx.db.query("sourceFiles").unique();
      if (!file) throw new Error("Missing test file");
      await ctx.db.patch("sourceFiles", file._id, {
        contentHash: "wrong checksum",
      });
    });
    await state.t.action(internal.actions.parseImport.parseImport, {
      batchId: state.batchId,
      attempt: 1,
    });
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({
      status: "failed",
      errorMessage: "Source file checksum mismatch",
    });
  });

  it("retries deletion failure and succeeds when storage recovers", async () => {
    const state = await stage();
    await store(state);
    await finish(state);
    await state.t.run(async (ctx) => {
      const file = await ctx.db.query("sourceFiles").unique();
      if (!file) throw new Error("Missing test file");
      await expireSourceFile(
        {
          ...ctx,
          storage: {
            ...ctx.storage,
            delete: () => Promise.reject(new Error("Storage outage")),
          },
        },
        file,
      );
      expect(await ctx.db.get("sourceFiles", file._id)).toMatchObject({
        status: "delete_failed",
      });
      expect(await ctx.storage.get(state.storageId)).not.toBeNull();
    });
    vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1);
    await state.t.mutation(internal.importCleanup.expireFiles, {});
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({ status: "parsed", fileAvailable: false });
    await state.t.run(async (ctx) => {
      expect(await ctx.db.query("sourceFiles").unique()).toMatchObject({
        status: "deleted",
      });
      expect(await ctx.storage.get(state.storageId)).toBeNull();
    });
  });

  it("treats an already-deleted storage object as successful expiration", async () => {
    const state = await stage();
    await state.t.run(async (ctx) => {
      await ctx.storage.delete(state.storageId);
      const file = await ctx.db.query("sourceFiles").unique();
      if (!file) throw new Error("Missing test file");
      await ctx.db.patch("sourceFiles", file._id, {
        expiresAt: Date.now() - 1,
      });
    });
    await state.t.mutation(internal.importCleanup.expireFiles, {});
    await state.t.run(async (ctx) => {
      expect(await ctx.db.query("sourceFiles").unique()).toMatchObject({
        status: "deleted",
      });
    });
  });

  it("expires parse leases through the scheduled mutation and fences the worker", async () => {
    const state = await stage();
    vi.setSystemTime(Date.now() + importLimits.parseLeaseMs + 1);
    await state.t.mutation(internal.importCleanup.expireParseLeases, {});
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({
      status: "failed",
      errorMessage: "Parsing timed out; retry this import",
    });
    await expect(store(state)).rejects.toThrow(
      "Parse attempt is no longer active",
    );
  });

  it("cleans expired failed staging in bounded batches and preserves parsed provenance", async () => {
    const failed = await stage();
    for (let index = 0; index < 51; index++) {
      await failed.t.mutation(internal.importWorkers.storeChunk, {
        batchId: failed.batchId,
        attempt: 1,
        index,
        count: 1,
        rowsJson,
        digest: digest(rowsJson),
      });
    }
    await failed.t.mutation(internal.importWorkers.failParse, {
      batchId: failed.batchId,
      attempt: 1,
      errorMessage: "Failed import",
    });
    vi.setSystemTime(Date.now() + importLimits.retentionMs + 1);
    await failed.t.mutation(internal.importCleanup.expireFailedStaging, {});
    await failed.t.run(async (ctx) => {
      expect(await ctx.db.query("importRowChunks").collect()).toHaveLength(1);
    });
    await failed.t.mutation(internal.importCleanup.expireFailedStaging, {});
    await failed.t.run(async (ctx) => {
      expect(await ctx.db.query("importRowChunks").collect()).toHaveLength(0);
    });

    const parsed = await stage();
    await store(parsed);
    await finish(parsed);
    await parsed.t.run((ctx) =>
      ctx.db.patch("importBatches", parsed.batchId, {
        stagingExpiresAt: Date.now() - 1,
      }),
    );
    await parsed.t.mutation(internal.importCleanup.expireFailedStaging, {});
    await parsed.t.run(async (ctx) => {
      expect(await ctx.db.query("importRowChunks").collect()).toHaveLength(1);
    });
    await expect(
      parsed.owner.query(api.imports.get, { batchId: parsed.batchId }),
    ).resolves.toMatchObject({ status: "parsed" });
  });
  it("rejects viewer attach and retry while allowing scoped history reads", async () => {
    const state = await setup();
    const storageId = await state.t.run((ctx) =>
      ctx.storage.store(new Blob(["test"])),
    );
    await state.owner.run(async (ctx) => {
      const membership = await ctx.db.query("householdMembers").unique();
      if (!membership) throw new Error("Missing test membership");
      await ctx.db.patch("householdMembers", membership._id, {
        role: "viewer",
      });
    });
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({ status: "awaiting_upload" });
    await expect(
      state.owner.mutation(api.imports.attachUpload, {
        batchId: state.batchId,
        storageId,
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      state.owner.mutation(api.imports.retryParse, { batchId: state.batchId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  it("records parser failure without writing normalized or portfolio data", async () => {
    const state = await stage();
    await state.t.action(internal.actions.parseImport.parseImport, {
      batchId: state.batchId,
      attempt: 1,
    });
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({
      status: "failed",
      rowCount: 0,
    });
    await state.t.run(async (ctx) => {
      expect(await ctx.db.query("importRowChunks").collect()).toHaveLength(0);
      expect(await ctx.db.query("importDedupeKeys").collect()).toHaveLength(0);
    });
  });

  it("sweeps old unclaimed blobs while preserving attached and recent blobs", async () => {
    const state = await stage();
    const orphan = await state.t.run((ctx) =>
      ctx.storage.store(new Blob(["orphan"])),
    );
    vi.setSystemTime(Date.now() + importLimits.uploadGraceMs + 1);
    const recent = await state.t.run((ctx) =>
      ctx.storage.store(new Blob(["recent"])),
    );
    await state.t.mutation(internal.importCleanup.sweepOrphans, {
      cursor: null,
    });
    await state.t.run(async (ctx) => {
      expect(await ctx.storage.get(orphan)).toBeNull();
      expect(await ctx.storage.get(recent)).not.toBeNull();
      expect(await ctx.storage.get(state.storageId)).not.toBeNull();
    });
  });

  it("expires abandoned reservations and refuses later attachment", async () => {
    const state = await setup();
    vi.setSystemTime(Date.now() + importLimits.uploadGraceMs + 1);
    const storageId = await state.t.run((ctx) =>
      ctx.storage.store(new Blob(["test"])),
    );
    await state.t.mutation(internal.importCleanup.expireFiles, {});
    await expect(
      state.owner.mutation(api.imports.attachUpload, {
        batchId: state.batchId,
        storageId,
      }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({ status: "failed", fileAvailable: false });
  });
  it("requires authentication and owner authority for upload writes", async () => {
    const { t, owner } = await setup();
    const args = { fileName: "test.csv", sizeBytes: 4 };
    await expect(
      t.mutation(api.imports.createUpload, args),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await owner.run(async (ctx) => {
      const membership = await ctx.db.query("householdMembers").unique();
      if (!membership) throw new Error("Missing test membership");
      await ctx.db.patch("householdMembers", membership._id, {
        role: "viewer",
      });
    });
    await expect(
      owner.mutation(api.imports.createUpload, args),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  it("hides foreign batches and rejects claims of attached storage", async () => {
    const { t, owner, batchId, storageId } = await stage();
    const other = t.withIdentity({
      ...identity,
      subject: "other",
      tokenIdentifier: "test|other",
    });
    await other.mutation(api.users.ensureCurrent);
    await expect(
      other.query(api.imports.get, { batchId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      other.mutation(api.imports.attachUpload, { batchId, storageId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      other.mutation(api.imports.retryParse, { batchId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    const reservation = await other.mutation(api.imports.createUpload, {
      fileName: "other.csv",
      sizeBytes: 4,
      mimeType: "text/csv",
    });
    await expect(
      other.mutation(api.imports.attachUpload, {
        batchId: reservation.batchId,
        storageId,
      }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      owner.mutation(api.imports.attachUpload, { batchId, storageId }),
    ).resolves.toBe(batchId);
    const list = await other.query(api.imports.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(list.page.map((batch) => batch.id)).toEqual([reservation.batchId]);
  });

  it("enforces upload ceilings and metadata against the reservation", async () => {
    const { t, owner, batchId } = await setup();
    await expect(
      owner.mutation(api.imports.createUpload, {
        fileName: "test.csv",
        sizeBytes: importLimits.fileBytes,
      }),
    ).resolves.toHaveProperty("uploadUrl");
    await expect(
      owner.mutation(api.imports.createUpload, {
        fileName: "test.csv",
        sizeBytes: importLimits.fileBytes + 1,
      }),
    ).rejects.toMatchObject({ data: { code: "CAPACITY" } });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["wrong size"], { type: "text/csv" })),
    );
    await expect(
      owner.mutation(api.imports.attachUpload, { batchId, storageId }),
    ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
  });

  it("makes identical chunk replay idempotent and rejects conflicting content", async () => {
    const state = await stage();
    await store(state);
    await store(state);
    const changed = JSON.stringify([{ ...row, currentValue: "13" }]);
    await expect(
      state.t.mutation(internal.importWorkers.storeChunk, {
        batchId: state.batchId,
        attempt: 1,
        index: 0,
        count: 1,
        digest: digest(changed),
        rowsJson: changed,
      }),
    ).rejects.toThrow("Conflicting chunk replay");
    await state.t.run(async (ctx) => {
      expect(await ctx.db.query("importRowChunks").collect()).toHaveLength(1);
    });
    await finish(state);
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({
      status: "parsed",
      rowCount: 1,
    });
  });

  it("rejects missing or corrupted manifests without publishing a parsed batch", async () => {
    const state = await stage();
    await expect(finish(state)).rejects.toThrow(
      "Chunk manifest length mismatch",
    );
    await store(state);
    await state.t.run(async (ctx) => {
      const chunk = await ctx.db.query("importRowChunks").unique();
      if (!chunk) throw new Error("Missing test chunk");
      await ctx.db.patch("importRowChunks", chunk._id, { digest: "corrupted" });
    });
    await expect(finish(state)).rejects.toThrow("Chunk manifest mismatch");
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({ status: "parsing", rowCount: 0 });
  });

  it("fences old workers after retry and retains only current attempt chunks", async () => {
    const state = await stage();
    await store(state);
    await state.t.mutation(internal.importWorkers.failParse, {
      batchId: state.batchId,
      attempt: 1,
      errorMessage: "Parser failed",
    });
    await state.owner.mutation(api.imports.retryParse, {
      batchId: state.batchId,
    });
    await expect(store(state)).rejects.toThrow(
      "Parse attempt is no longer active",
    );
    await expect(finish(state)).rejects.toThrow(
      "Parse attempt is no longer active",
    );
    await state.t.mutation(internal.importWorkers.failParse, {
      batchId: state.batchId,
      attempt: 1,
      errorMessage: "Late failure",
    });
    await state.t.mutation(internal.importCleanup.obsoleteChunks, {
      batchId: state.batchId,
      beforeAttempt: 2,
    });
    await state.t.run(async (ctx) => {
      expect(await ctx.db.query("importRowChunks").collect()).toHaveLength(0);
    });
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({ status: "parsing", errorMessage: null });
  });

  it("recovers a timed-out parse and prevents retry of a live attempt", async () => {
    const state = await stage();
    await expect(
      state.owner.mutation(api.imports.retryParse, { batchId: state.batchId }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    await state.t.run((ctx) =>
      ctx.db.patch("importBatches", state.batchId, {
        leaseExpiresAt: Date.now() - 1,
      }),
    );
    await state.owner.mutation(api.imports.retryParse, {
      batchId: state.batchId,
    });
    await expect(store(state)).rejects.toThrow(
      "Parse attempt is no longer active",
    );
  });

  it("expires files while keeping parsed rows and batch history", async () => {
    const state = await stage();
    await store(state);
    await finish(state);
    await state.t.run(async (ctx) => {
      const file = await ctx.db.query("sourceFiles").unique();
      if (!file) throw new Error("Missing test file");
      await ctx.db.patch("sourceFiles", file._id, {
        expiresAt: Date.now() - 1,
      });
    });
    await state.t.mutation(internal.importCleanup.expireFiles, {});
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({
      status: "parsed",
      rowCount: 1,
      fileAvailable: false,
    });
    await state.t.run(async (ctx) => {
      expect(await ctx.db.query("importRowChunks").collect()).toHaveLength(1);
    });
  });

  it("rejects a committed duplicate at parse finalization", async () => {
    const state = await stage();
    await store(state);
    await state.t.run(async (ctx) => {
      const batch = await ctx.db.get("importBatches", state.batchId);
      if (!batch) throw new Error("Missing test batch");
      await ctx.db.insert("importDedupeKeys", {
        householdId: batch.householdId,
        key: `${state.contentHash}:test1`,
        batchId: state.batchId,
      });
    });
    await expect(finish(state)).rejects.toThrow("already been committed");
    await expect(
      state.owner.query(api.imports.get, { batchId: state.batchId }),
    ).resolves.toMatchObject({ status: "parsing" });
  });
});
