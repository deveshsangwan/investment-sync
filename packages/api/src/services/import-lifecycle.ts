import { createHash, randomUUID } from "node:crypto";
import { importBatches, importRows } from "@investment-sync/db";
import {
  normalizedImportRowSchema,
  parseImportFile,
} from "@investment-sync/importers";
import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { getImportBucketName, validateImportFile } from "../config";
import { logger } from "../logger";
import {
  duplicateImportError,
  importEffect,
  ImportConflictError,
  type ImportDependencies,
  type ImportError,
  ImportPersistenceError,
  ImportStorageError,
  ImportValidationError,
  toImportError,
} from "./import-errors";
import type { MembershipContext } from "./membership";

const IMPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;
const MAX_IMPORT_ROWS = 25_000;

export interface ImportFileInput {
  fileName: string;
  mimeType?: string;
  content: Buffer;
}

export function uploadAndProcessImport(
  ctx: ImportDependencies,
  membership: MembershipContext,
  input: ImportFileInput,
) {
  return Effect.gen(function* () {
    // Before the batch row exists, so a file we refuse outright leaves no trace.
    yield* validateImportInput(input);

    const now = new Date(yield* Clock.currentTimeMillis);
    const fileHash = createHash("sha256").update(input.content).digest("hex");
    const importBatchId = randomUUID();
    const storagePath = `${membership.userId}/${importBatchId}/${sanitizeFileName(input.fileName)}`;

    yield* createImportBatch(ctx, membership, {
      importBatchId,
      fileHash,
      fileName: input.fileName,
      expiresAt: new Date(now.getTime() + IMPORT_TTL_MS),
    });

    /**
     * From here on every failure is recorded on the batch row before it
     * propagates. `markImportFailed` cannot fail, so the original error is
     * always what reaches the caller.
     */
    const failBatch =
      (metadata: FailedImportMetadata = {}) =>
      <A, E extends ImportError>(effect: Effect.Effect<A, E>) =>
        Effect.tapError(effect, (error) =>
          markImportFailed(
            ctx,
            membership,
            importBatchId,
            error.message,
            now,
            metadata,
          ),
        );

    const parsed = yield* Effect.try({
      try: () => parseAndValidateImport(input),
      catch: toImportError,
    }).pipe(failBatch());

    // Only a duplicate that is actually found marks the batch failed; a query
    // that errors leaves the batch alone, as it always has.
    const duplicate = yield* findCommittedDuplicate(
      ctx,
      membership,
      fileHash,
      parsed.parserVersion,
    );
    if (duplicate) {
      yield* Effect.fail(duplicateImportError()).pipe(
        failBatch({
          sourceType: parsed.sourceType,
          parserVersion: parsed.parserVersion,
          rowCount: parsed.rows.length,
          warnings: parsed.warnings,
        }),
      );
    }

    yield* ensureImportBucket(ctx).pipe(failBatch());
    yield* uploadSourceFile(ctx, storagePath, input).pipe(failBatch());

    yield* writeParsedRows(ctx, membership, {
      importBatchId,
      storagePath,
      parsed,
      now,
    }).pipe(
      Effect.catchAll((error) =>
        // The stored file has to go, and how the failure is recorded depends on
        // whether it went: a file that could not be deleted keeps its path and
        // expires now, so the cleanup cron retries instead of orphaning it.
        removeStoredFile(ctx, storagePath).pipe(
          Effect.flatMap((removed) =>
            markImportFailed(
              ctx,
              membership,
              importBatchId,
              error.message,
              now,
              removed ? { storagePath: null } : { expiresAt: now },
            ),
          ),
          Effect.flatMap(() => Effect.fail(error)),
        ),
      ),
    );

    return {
      importBatchId,
      sourceType: parsed.sourceType,
      parserVersion: parsed.parserVersion,
      rowCount: parsed.rows.length,
      previewRows: parsed.rows.slice(0, 3),
      warnings: parsed.warnings,
    };
  });
}

function createImportBatch(
  ctx: ImportDependencies,
  membership: MembershipContext,
  batch: {
    importBatchId: string;
    fileHash: string;
    fileName: string;
    expiresAt: Date;
  },
) {
  return importEffect(() =>
    ctx.db
      .insert(importBatches)
      .values({
        id: batch.importBatchId,
        householdId: membership.householdId,
        uploadedByUserId: membership.appUserId,
        originalFileName: batch.fileName,
        fileHash: batch.fileHash,
        expiresAt: batch.expiresAt,
        status: "created",
      })
      .returning({ id: importBatches.id }),
  ).pipe(
    Effect.flatMap(([created]) =>
      created
        ? Effect.void
        : Effect.fail(
            new ImportPersistenceError({
              message: "Import Batch could not be created",
            }),
          ),
    ),
  );
}

function findCommittedDuplicate(
  ctx: ImportDependencies,
  membership: MembershipContext,
  fileHash: string,
  parserVersion: string,
) {
  return importEffect(() =>
    ctx.db
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.householdId, membership.householdId),
          eq(importBatches.fileHash, fileHash),
          eq(importBatches.parserVersion, parserVersion),
          eq(importBatches.status, "committed"),
        ),
      )
      .limit(1),
  ).pipe(Effect.map(([duplicate]) => duplicate));
}

function uploadSourceFile(
  ctx: ImportDependencies,
  storagePath: string,
  input: ImportFileInput,
) {
  return importEffect(() =>
    ctx.supabase.storage
      .from(getImportBucketName())
      .upload(storagePath, input.content, {
        contentType: input.mimeType,
        upsert: false,
      }),
  ).pipe(
    Effect.flatMap((uploaded) =>
      uploaded.error
        ? Effect.fail(
            new ImportStorageError({
              message: "Source File could not be stored",
              cause: uploaded.error,
            }),
          )
        : Effect.void,
    ),
  );
}

function writeParsedRows(
  ctx: ImportDependencies,
  membership: MembershipContext,
  args: {
    importBatchId: string;
    storagePath: string;
    parsed: ReturnType<typeof parseAndValidateImport>;
    now: Date;
  },
) {
  return importEffect(() =>
    writeParsedRowsInTransaction(ctx, membership, args),
  );
}

/**
 * Stays Promise-shaped: Drizzle's transaction rolls back when the callback
 * throws, and that is what guards the parsed transition. Running Effects inside
 * the callback would need a nested runtime; it becomes Effect-native once a
 * Database service exposes transactions as scoped Effects.
 */
async function writeParsedRowsInTransaction(
  ctx: ImportDependencies,
  membership: MembershipContext,
  {
    importBatchId,
    storagePath,
    parsed,
    now,
  }: {
    importBatchId: string;
    storagePath: string;
    parsed: ReturnType<typeof parseAndValidateImport>;
    now: Date;
  },
) {
  await ctx.db
    .update(importBatches)
    .set({
      sourceType: parsed.sourceType,
      status: "uploaded",
      parserVersion: parsed.parserVersion,
      rowCount: parsed.rows.length,
      warnings: parsed.warnings,
      storagePath,
    })
    .where(
      and(
        eq(importBatches.id, importBatchId),
        eq(importBatches.householdId, membership.householdId),
      ),
    );

  await ctx.db.transaction(async (tx) => {
    await tx.insert(importRows).values(
      parsed.rows.map((row, index) => ({
        importBatchId,
        rowNumber: index + 1,
        normalizedPayload: row,
      })),
    );
    const updated = await tx
      .update(importBatches)
      .set({ status: "parsed", processedAt: now })
      .where(
        and(
          eq(importBatches.id, importBatchId),
          eq(importBatches.householdId, membership.householdId),
          eq(importBatches.status, "uploaded"),
        ),
      )
      .returning({ id: importBatches.id });
    if (!updated[0]) {
      throw new ImportConflictError({
        message: "Import Batch changed while it was being parsed",
      });
    }
  });
}

export function cleanupExpiredImportFiles(
  ctx: ImportDependencies,
): Effect.Effect<{ deleted: number }, ImportError> {
  return Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) => expiredStoredFiles(ctx, new Date(now))),
    Effect.flatMap((toDelete) => {
      if (toDelete.length === 0) return Effect.succeed({ deleted: 0 });

      return removeExpiredFiles(
        ctx,
        toDelete.map((batch) => batch.storagePath),
      ).pipe(
        // Only clear the paths once storage confirms the delete, so a failed
        // sweep leaves rows pointing at files that still exist.
        Effect.andThen(
          importEffect(() =>
            ctx.db
              .update(importBatches)
              .set({ storagePath: null })
              .where(
                inArray(
                  importBatches.id,
                  toDelete.map((batch) => batch.id),
                ),
              ),
          ),
        ),
        Effect.as({ deleted: toDelete.length }),
      );
    }),
  );
}

function expiredStoredFiles(ctx: ImportDependencies, now: Date) {
  return importEffect(() =>
    ctx.db
      .select({ id: importBatches.id, storagePath: importBatches.storagePath })
      .from(importBatches)
      .where(
        and(
          isNotNull(importBatches.storagePath),
          lte(importBatches.expiresAt, now),
        ),
      )
      .limit(CLEANUP_BATCH_SIZE),
  ).pipe(
    Effect.map((expired) =>
      expired.filter(
        (batch): batch is { id: string; storagePath: string } =>
          typeof batch.storagePath === "string" && batch.storagePath.length > 0,
      ),
    ),
  );
}

function removeExpiredFiles(ctx: ImportDependencies, storagePaths: string[]) {
  return importEffect(() =>
    ctx.supabase.storage.from(getImportBucketName()).remove(storagePaths),
  ).pipe(
    Effect.flatMap((removed) =>
      removed.error
        ? Effect.fail(
            new ImportStorageError({
              message: "Expired Source Files could not be deleted",
              cause: removed.error,
            }),
          )
        : Effect.void,
    ),
  );
}

export function listImports(
  ctx: ImportDependencies,
  membership: MembershipContext,
) {
  return importEffect(() => listImportsQuery(ctx, membership));
}

async function listImportsQuery(
  ctx: ImportDependencies,
  membership: MembershipContext,
) {
  const batches = await ctx.db
    .select({
      id: importBatches.id,
      sourceType: importBatches.sourceType,
      status: importBatches.status,
      parserVersion: importBatches.parserVersion,
      originalFileName: importBatches.originalFileName,
      rowCount: importBatches.rowCount,
      warnings: importBatches.warnings,
      errors: importBatches.errors,
      uploadedAt: importBatches.uploadedAt,
      expiresAt: importBatches.expiresAt,
      processedAt: importBatches.processedAt,
      committedAt: importBatches.committedAt,
      storagePath: importBatches.storagePath,
    })
    .from(importBatches)
    .where(eq(importBatches.householdId, membership.householdId))
    .orderBy(desc(importBatches.uploadedAt))
    .limit(50);

  return batches.map(({ storagePath, ...batch }) => ({
    ...batch,
    sourceFileAvailable: storagePath !== null,
  }));
}

function ensureImportBucket(ctx: ImportDependencies) {
  return importEffect(() => ensureImportBucketExists(ctx));
}

async function ensureImportBucketExists(ctx: ImportDependencies) {
  const bucket = getImportBucketName();
  const existing = await ctx.supabase.storage.getBucket(bucket);
  if (!existing.error) return;

  const created = await ctx.supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: "4MB",
  });
  if (
    created.error &&
    !created.error.message.toLowerCase().includes("already exists")
  ) {
    throw new ImportStorageError({
      message: "Import storage is unavailable",
      cause: created.error,
    });
  }
}

function validateImportInput(input: ImportFileInput) {
  return Effect.try({
    try: () =>
      validateImportFile({
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.content.length,
      }),
    catch: (error) =>
      new ImportValidationError({
        message: error instanceof Error ? error.message : "Invalid import file",
      }),
  });
}

function parseAndValidateImport(input: {
  fileName: string;
  mimeType?: string;
  content: Buffer;
}) {
  let parsed: ReturnType<typeof parseImportFile>;
  try {
    parsed = parseImportFile(input);
  } catch (error) {
    throw new ImportValidationError({
      message:
        error instanceof Error ? error.message : "Import file is invalid",
    });
  }

  const rows = parsed.rows.map((row, index) => {
    const result = normalizedImportRowSchema.safeParse(row);
    if (!result.success) {
      throw new ImportValidationError({
        message: `Import Batch row ${index + 1} is invalid`,
      });
    }
    return result.data;
  });
  if (rows.length === 0) {
    throw new ImportValidationError({
      message: "Import Batch contains no usable rows",
    });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportValidationError({
      message: `Import Batch cannot exceed ${MAX_IMPORT_ROWS} rows`,
    });
  }
  return { ...parsed, rows };
}

type FailedImportMetadata = Partial<
  Pick<
    typeof importBatches.$inferInsert,
    | "sourceType"
    | "parserVersion"
    | "rowCount"
    | "warnings"
    | "storagePath"
    | "expiresAt"
  >
>;

/**
 * Best effort by design: recording the failure must never replace the failure
 * being recorded, so this effect cannot fail.
 */
function markImportFailed(
  ctx: ImportDependencies,
  membership: MembershipContext,
  importBatchId: string,
  message: string,
  now: Date,
  metadata: FailedImportMetadata = {},
): Effect.Effect<void> {
  return Effect.tryPromise(() =>
    ctx.db
      .update(importBatches)
      .set({
        status: "failed",
        errors: [message],
        processedAt: now,
        ...metadata,
      })
      .where(
        and(
          eq(importBatches.id, importBatchId),
          eq(importBatches.householdId, membership.householdId),
        ),
      ),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.error("Failed to record Import Batch failure", {
          importBatchId,
          error,
        });
      }),
    ),
    Effect.asVoid,
  );
}

/** Reports whether the file is gone; never fails, so compensation can branch. */
function removeStoredFile(
  ctx: ImportDependencies,
  storagePath: string,
): Effect.Effect<boolean> {
  return Effect.tryPromise(() =>
    ctx.supabase.storage.from(getImportBucketName()).remove([storagePath]),
  ).pipe(
    Effect.map((removed) => removed.error ?? null),
    Effect.catchAll((error: unknown) => Effect.succeed(error)),
    Effect.map((error) => {
      if (!error) return true;
      logger.error("Failed to delete Source File after import failure", {
        storagePath,
        error,
      });
      return false;
    }),
  );
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
