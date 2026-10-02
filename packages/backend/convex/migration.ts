import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  chunkRows,
  digest,
  importLimits,
  parseRows,
  storageChecksumToHex,
  utf8Bytes,
} from "./model/importLimits";
import { manifestEntry } from "./model/importValidators";
import {
  migrationRecord,
  migrationTarget,
  requireCompleteInput,
  requireMigration,
  requireMigrationMode,
} from "./model/migration";
import { loadLegacyRecord } from "./model/migrationLoad";
import {
  batchSchema,
  canonicalJson,
  exportTables,
  exportTableValidator,
  legacyTables,
  legacyTableValidator,
  parseJson,
  sourceFileManifestSchema,
  tableCountsSchema,
} from "./model/migrationValidators";

export const begin = internalMutation({
  args: {
    runKey: v.string(),
    inputDigest: v.string(),
    sourceKind: v.union(v.literal("synthetic"), v.literal("production")),
    evaluationTime: v.string(),
    expectedCountsJson: v.string(),
    sourceFilesJson: v.string(),
  },
  returns: v.id("migrationRuns"),
  handler: async (ctx, args) => {
    requireMigrationMode(args.sourceKind);
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(args.runKey) ||
      !/^[a-f0-9]{64}$/.test(args.inputDigest) ||
      !Number.isFinite(Date.parse(args.evaluationTime)) ||
      new Date(args.evaluationTime).toISOString() !== args.evaluationTime
    )
      throw new Error("Invalid migration identity, digest, or evaluation time");
    const counts = tableCountsSchema.parse(parseJson(args.expectedCountsJson));
    const expectedCountsJson = canonicalJson(counts);
    const files = sourceFileManifestSchema.parse(
      parseJson(args.sourceFilesJson),
    );
    const sourceFilesJson = canonicalJson(files);
    if (
      files.length !== counts.import_batches ||
      new Set(files.map((file) => file.legacyBatchId)).size !== files.length ||
      files.some(
        (file) =>
          file.status === "available" &&
          (!file.contentHash ||
            file.sizeBytes === undefined ||
            Date.parse(file.expiresAt) <= Date.parse(args.evaluationTime)),
      )
    )
      throw new Error(
        "Migration source file manifest is incomplete or inconsistent",
      );
    const existing = await ctx.db
      .query("migrationRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (existing) {
      if (
        existing.inputDigest !== args.inputDigest ||
        existing.sourceKind !== args.sourceKind ||
        existing.evaluationTime !== args.evaluationTime ||
        existing.expectedCountsJson !== expectedCountsJson ||
        existing.sourceFilesJson !== sourceFilesJson
      )
        throw new Error("Conflicting migration input for existing run");
      return existing._id;
    }

    for (const table of exportTables) {
      const record = await ctx.db
        .query(table)
        .withIndex("by_creation_time")
        .first();
      if (record)
        throw new Error("Migration requires an empty target database");
    }
    const storedFile = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time")
      .first();
    if (storedFile) throw new Error("Migration requires empty target storage");

    return ctx.db.insert("migrationRuns", {
      ...args,
      expectedCountsJson,
      sourceFilesJson,
      loadedCountsJson: canonicalJson(
        Object.fromEntries(legacyTables.map((table) => [table, 0])),
      ),
      nextFactOrdinal: 0,
      maximumFactSequence: 0,
      inputSealed: false,
      finalizedBatchCount: 0,
      unsupportedCount: 0,
    });
  },
});

export const loadRecord = internalMutation({
  args: {
    runKey: v.string(),
    legacyTable: legacyTableValidator,
    rowJson: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const run = await requireMigration(ctx, args.runKey);
    if (utf8Bytes(args.rowJson) > 524288)
      throw new Error("Legacy row exceeds supported size");
    const value = parseJson(args.rowJson);
    const { id } = z.object({ id: z.string().uuid() }).parse(value);
    const existing = await ctx.db
      .query("migrationRecords")
      .withIndex("by_runKey_and_legacyTable_and_legacyId", (q) =>
        q
          .eq("runKey", args.runKey)
          .eq("legacyTable", args.legacyTable)
          .eq("legacyId", id),
      )
      .unique();
    if (existing) {
      if (existing.digest !== digest(canonicalJson(value)))
        throw new Error("Conflicting legacy record replay");
    } else {
      if (run.inputSealed)
        throw new Error("Migration input has already been sealed");
      await loadLegacyRecord(ctx, run, args.legacyTable, value);
    }
    const mappings = await ctx.db
      .query("migrationMappings")
      .withIndex("by_runKey_and_legacyTable_and_legacyId", (q) =>
        q
          .eq("runKey", args.runKey)
          .eq("legacyTable", args.legacyTable)
          .eq("legacyId", id),
      )
      .take(257);
    if (mappings.length > 256)
      throw new Error("Legacy mapping capacity exceeded");

    return canonicalJson({
      legacyTable: args.legacyTable,
      legacyId: id,
      mappings,
    });
  },
});

export const batchRowsPage = internalQuery({
  args: {
    runKey: v.string(),
    legacyBatchId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    pageJson: v.string(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    if (args.paginationOpts.numItems > 20)
      throw new Error("Migration row page exceeds 20 records");
    const result = await ctx.db
      .query("migrationRecords")
      .withIndex(
        "by_runKey_and_legacyTable_and_batchLegacyId_and_rowNumber",
        (q) =>
          q
            .eq("runKey", args.runKey)
            .eq("legacyTable", "import_rows")
            .eq("batchLegacyId", args.legacyBatchId),
      )
      .paginate(args.paginationOpts);
    return {
      pageJson: JSON.stringify(result.page),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const writeBatchChunk = internalMutation({
  args: {
    runKey: v.string(),
    legacyBatchId: v.string(),
    index: v.number(),
    rowsJson: v.string(),
  },
  returns: manifestEntry,
  handler: async (ctx, args) => {
    const run = await requireMigration(ctx, args.runKey);
    const batch = await migrationTarget(
      ctx,
      args.runKey,
      "import_batches",
      args.legacyBatchId,
      "importBatches",
    );
    const rows = parseRows(args.rowsJson);
    if (
      !Number.isSafeInteger(args.index) ||
      args.index < 0 ||
      args.index >= importLimits.chunks ||
      rows.length < 1 ||
      rows.length > importLimits.chunkRows ||
      utf8Bytes(args.rowsJson) > importLimits.chunkBytes
    )
      throw new Error("Migration chunk capacity exceeded");
    const entry = {
      index: args.index,
      count: rows.length,
      bytes: utf8Bytes(args.rowsJson),
      digest: digest(args.rowsJson),
    };
    const existing = await ctx.db
      .query("importRowChunks")
      .withIndex("by_batchId_and_attempt_and_index", (q) =>
        q
          .eq("batchId", batch._id)
          .eq("attempt", batch.attempt)
          .eq("index", args.index),
      )
      .unique();
    if (existing) {
      if (
        existing.digest !== entry.digest ||
        existing.rowsJson !== args.rowsJson
      )
        throw new Error("Conflicting migration normalized chunk");
      return entry;
    }
    if (run.inputSealed || batch.migrationRowsFinalized)
      throw new Error("Migration batch rows are already sealed");
    await ctx.db.insert("importRowChunks", {
      batchId: batch._id,
      attempt: batch.attempt,
      ...entry,
      rowsJson: args.rowsJson,
    });

    return entry;
  },
});

export const sealBatchRows = internalMutation({
  args: {
    runKey: v.string(),
    legacyBatchId: v.string(),
    manifest: v.array(manifestEntry),
    rowCount: v.number(),
    normalizedBytes: v.number(),
    previewRowsJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireMigration(ctx, args.runKey);
    const batch = await migrationTarget(
      ctx,
      args.runKey,
      "import_batches",
      args.legacyBatchId,
      "importBatches",
    );
    const source = batchSchema.parse(
      parseJson(
        (
          await migrationRecord(
            ctx,
            args.runKey,
            "import_batches",
            args.legacyBatchId,
          )
        ).sourceJson,
      ),
    );
    if (batch.migrationRowsFinalized) {
      if (
        canonicalJson(batch.manifest) !== canonicalJson(args.manifest) ||
        batch.rowCount !== args.rowCount ||
        batch.normalizedBytes !== args.normalizedBytes ||
        batch.previewRowsJson !== args.previewRowsJson
      )
        throw new Error("Conflicting finalized migration batch");
      return null;
    }
    if (
      run.inputSealed ||
      !Number.isSafeInteger(args.rowCount) ||
      args.rowCount < 0 ||
      args.rowCount > importLimits.rows ||
      args.normalizedBytes > importLimits.normalizedBytes ||
      args.manifest.length > importLimits.chunks ||
      args.manifest.reduce((count, entry) => count + entry.count, 0) !==
        args.rowCount
    )
      throw new Error(
        "Migration normalized manifest capacity or count mismatch",
      );
    const chunks = await ctx.db
      .query("importRowChunks")
      .withIndex("by_batchId_and_attempt_and_index", (q) =>
        q.eq("batchId", batch._id).eq("attempt", batch.attempt),
      )
      .take(importLimits.chunks + 1);
    if (chunks.length !== args.manifest.length)
      throw new Error("Migration normalized chunk manifest incomplete");
    const verifiedRows = [];
    for (const [index, chunk] of chunks.entries()) {
      const expected = args.manifest[index];
      if (
        !expected ||
        expected.index !== index ||
        chunk.index !== index ||
        chunk.digest !== expected.digest ||
        digest(chunk.rowsJson) !== expected.digest ||
        chunk.bytes !== expected.bytes ||
        utf8Bytes(chunk.rowsJson) !== expected.bytes ||
        chunk.count !== expected.count
      )
        throw new Error("Migration normalized manifest mismatch");
      verifiedRows.push(...parseRows(chunk.rowsJson));
    }
    if (
      utf8Bytes(JSON.stringify(verifiedRows)) !== args.normalizedBytes ||
      verifiedRows.length !== args.rowCount
    )
      throw new Error("Migration normalized byte totals mismatch");
    const previewRowsJson = JSON.stringify(verifiedRows.slice(0, 10));
    if (previewRowsJson !== args.previewRowsJson)
      throw new Error("Migration normalized preview mismatch");
    const status =
      source.status === "expired"
        ? args.rowCount > 0
          ? "parsed"
          : "failed"
        : batch.status;
    await ctx.db.patch("importBatches", batch._id, {
      manifest: args.manifest,
      rowCount: args.rowCount,
      normalizedBytes: args.normalizedBytes,
      previewRowsJson,
      migrationRowsFinalized: true,
      status,
      failureReason:
        source.status === "expired" && args.rowCount === 0
          ? "source_expired_no_rows"
          : undefined,
      errorMessage:
        source.status === "expired" && args.rowCount === 0
          ? "Source file expired without normalized rows"
          : batch.errorMessage,
    });
    await ctx.db.patch("migrationRuns", run._id, {
      finalizedBatchCount: run.finalizedBatchCount + 1,
    });

    return null;
  },
});

export const finalizeBatch = internalAction({
  args: { runKey: v.string(), legacyBatchId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows: ReturnType<typeof parseRows> = [];
    let cursor: string | null = null;
    let bytes = 2;
    do {
      const page: {
        pageJson: string;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.migration.batchRowsPage, {
        ...args,
        paginationOpts: { cursor, numItems: 20, maximumBytesRead: 524288 },
      });
      const records = z
        .array(
          z.object({ normalizedRowJson: z.string(), rowNumber: z.number() }),
        )
        .parse(parseJson(page.pageJson));
      for (const record of records) {
        const parsed = parseRows(`[${record.normalizedRowJson}]`);
        bytes += utf8Bytes(JSON.stringify(parsed[0])) + Number(rows.length > 0);
        rows.push(...parsed);
        if (
          rows.length > importLimits.rows ||
          bytes > importLimits.normalizedBytes
        )
          throw new Error("Legacy batch exceeds supported normalized capacity");
      }
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor !== null);
    const manifest = [];
    for (const [index, rowsJson] of chunkRows(rows).entries()) {
      const entry: {
        index: number;
        count: number;
        bytes: number;
        digest: string;
      } = await ctx.runMutation(internal.migration.writeBatchChunk, {
        ...args,
        index,
        rowsJson,
      });
      manifest.push(entry);
    }
    await ctx.runMutation(internal.migration.sealBatchRows, {
      ...args,
      manifest,
      rowCount: rows.length,
      normalizedBytes: utf8Bytes(JSON.stringify(rows)),
      previewRowsJson: JSON.stringify(rows.slice(0, 10)),
    });

    return null;
  },
});

export const fileUploadUrl = internalMutation({
  args: { runKey: v.string(), legacyBatchId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const file = await migrationTarget(
      ctx,
      args.runKey,
      "import_batches",
      args.legacyBatchId,
      "sourceFiles",
    );
    if (file.status === "stored") return null;
    if (file.status !== "reserved")
      throw new Error("Legacy source file is unavailable");

    return ctx.storage.generateUploadUrl();
  },
});

export const claimFile = internalMutation({
  args: {
    runKey: v.string(),
    legacyBatchId: v.string(),
    storageId: v.id("_storage"),
    contentHash: v.string(),
    sizeBytes: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireMigration(ctx, args.runKey);
    const batch = await migrationTarget(
      ctx,
      args.runKey,
      "import_batches",
      args.legacyBatchId,
      "importBatches",
    );
    const file = await migrationTarget(
      ctx,
      args.runKey,
      "import_batches",
      args.legacyBatchId,
      "sourceFiles",
    );
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    const expected = sourceFileManifestSchema
      .parse(parseJson(run.sourceFilesJson))
      .find((entry) => entry.legacyBatchId === args.legacyBatchId);
    if (
      !expected ||
      !/^[a-f0-9]{64}$/.test(args.contentHash) ||
      !metadata ||
      metadata.size !== args.sizeBytes ||
      expected.sizeBytes !== args.sizeBytes ||
      expected.contentHash !== args.contentHash ||
      storageChecksumToHex(metadata.sha256) !== args.contentHash ||
      (batch.contentHash && batch.contentHash !== args.contentHash)
    )
      throw new Error(
        "Copied legacy source file checksum or byte size mismatch",
      );
    if (file.status === "stored") {
      if (
        file.storageId !== args.storageId ||
        file.contentHash !== args.contentHash ||
        file.sizeBytes !== args.sizeBytes
      )
        throw new Error("Conflicting migrated source file replay");
      return null;
    }
    if (run.inputSealed || file.status !== "reserved")
      throw new Error("Cannot attach unavailable legacy source file");
    const claimed = await ctx.db
      .query("sourceFiles")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (claimed) throw new Error("Source storage object is already claimed");
    await ctx.db.patch("sourceFiles", file._id, {
      storageId: args.storageId,
      status: "stored",
      contentHash: args.contentHash,
      sizeBytes: args.sizeBytes,
    });
    await ctx.db.patch("importBatches", batch._id, {
      sizeBytes: args.sizeBytes,
    });

    return null;
  },
});

export const discardUnclaimedFile = internalMutation({
  args: { runKey: v.string(), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const claimed = await ctx.db
      .query("sourceFiles")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (!claimed) await ctx.storage.delete(args.storageId);
    return null;
  },
});

export const attachFile = internalAction({
  args: {
    runKey: v.string(),
    legacyBatchId: v.string(),
    storageId: v.id("_storage"),
    contentHash: v.string(),
    sizeBytes: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.migration.claimFile, args);
    } catch (error) {
      await ctx.runMutation(internal.migration.discardUnclaimedFile, {
        runKey: args.runKey,
        storageId: args.storageId,
      });
      throw error;
    }
    return null;
  },
});

export const fileState = internalQuery({
  args: v.union(
    v.object({ runKey: v.string(), legacyBatchId: v.string() }),
    v.object({ runKey: v.string(), targetBatchId: v.id("importBatches") }),
  ),
  returns: v.object({
    status: v.string(),
    storageId: v.union(v.id("_storage"), v.null()),
    url: v.union(v.string(), v.null()),
    sizeBytes: v.union(v.number(), v.null()),
    contentHash: v.union(v.string(), v.null()),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const run = await requireMigration(ctx, args.runKey);
    let file;
    if ("legacyBatchId" in args) {
      file = await migrationTarget(
        ctx,
        args.runKey,
        "import_batches",
        args.legacyBatchId,
        "sourceFiles",
      );
    } else {
      requireCompleteInput(run);
      const batch = await ctx.db.get("importBatches", args.targetBatchId);
      if (!batch || !(await ctx.db.get("households", batch.householdId)))
        throw new Error("Rollback source batch is missing its household");
      file = await ctx.db
        .query("sourceFiles")
        .withIndex("by_batchId", (q) => q.eq("batchId", batch._id))
        .unique();
      if (
        !file ||
        file.householdId !== batch.householdId ||
        file.uploaderId !== batch.uploaderId
      )
        throw new Error(
          "Rollback source file ownership does not match its batch",
        );
    }
    const metadata = file.storageId
      ? await ctx.db.system.get("_storage", file.storageId)
      : null;
    return {
      status: file.status,
      storageId: file.storageId ?? null,
      url: file.storageId ? await ctx.storage.getUrl(file.storageId) : null,
      sizeBytes: metadata?.size ?? file.sizeBytes ?? null,
      contentHash: metadata
        ? storageChecksumToHex(metadata.sha256)
        : (file.contentHash ?? null),
      expiresAt: file.expiresAt,
    };
  },
});

export const markFileMissing = internalMutation({
  args: { runKey: v.string(), legacyBatchId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireMigration(ctx, args.runKey);
    const file = await migrationTarget(
      ctx,
      args.runKey,
      "import_batches",
      args.legacyBatchId,
      "sourceFiles",
    );
    if (file.status === "deleted") return null;
    if (run.inputSealed || file.status !== "reserved")
      throw new Error("Cannot change migrated available source file");
    await ctx.db.patch("sourceFiles", file._id, { status: "deleted" });
    return null;
  },
});

export const completeRun = internalMutation({
  args: { runKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await requireMigration(ctx, args.runKey);
    requireCompleteInput(run);
    const pending = await ctx.db
      .query("sourceFiles")
      .withIndex("by_status_and_expiresAt", (q) => q.eq("status", "reserved"))
      .first();
    if (pending)
      throw new Error("Migration source file availability is unresolved");
    const expected = tableCountsSchema.parse(parseJson(run.expectedCountsJson));
    if (run.finalizedBatchCount !== expected.import_batches)
      throw new Error("Migration normalized batch staging is incomplete");
    if (run.unsupportedCount)
      throw new Error(
        "Migration contains unsupported legacy transactions without instruments",
      );
    await ctx.db.patch("migrationRuns", run._id, { inputSealed: true });
    return null;
  },
});

export const exportPage = internalQuery({
  args: {
    runKey: v.string(),
    table: exportTableValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    pageJson: v.string(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    if (args.paginationOpts.numItems > 200)
      throw new Error("Migration export page exceeds 200 records");
    const result = await ctx.db
      .query(args.table)
      .withIndex("by_creation_time")
      .paginate(args.paginationOpts);
    return {
      pageJson: JSON.stringify(result.page),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
