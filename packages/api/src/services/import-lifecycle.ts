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

export async function uploadAndProcessImportPromise(
  ctx: ImportDependencies,
  membership: MembershipContext,
  input: { fileName: string; mimeType?: string; content: Buffer },
  now: Date,
) {
  validateImportInput(input);
  const fileHash = createHash("sha256").update(input.content).digest("hex");
  const importBatchId = randomUUID();
  const storagePath = `${membership.userId}/${importBatchId}/${sanitizeFileName(input.fileName)}`;
  const expiresAt = new Date(now.getTime() + IMPORT_TTL_MS);
  const [batch] = await ctx.db
    .insert(importBatches)
    .values({
      id: importBatchId,
      householdId: membership.householdId,
      uploadedByUserId: membership.appUserId,
      originalFileName: input.fileName,
      fileHash,
      expiresAt,
      status: "created",
    })
    .returning({ id: importBatches.id });
  if (!batch) {
    throw new ImportPersistenceError({
      message: "Import Batch could not be created",
    });
  }

  let parsed: ReturnType<typeof parseAndValidateImport>;
  try {
    parsed = parseAndValidateImport(input);
  } catch (error) {
    const failure = toImportError(error);
    await markImportFailed(
      ctx,
      membership,
      importBatchId,
      failure.message,
      now,
    );
    throw failure;
  }

  const [duplicate] = await ctx.db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.householdId, membership.householdId),
        eq(importBatches.fileHash, fileHash),
        eq(importBatches.parserVersion, parsed.parserVersion),
        eq(importBatches.status, "committed"),
      ),
    )
    .limit(1);
  if (duplicate) {
    const error = duplicateImportError();
    await markImportFailed(ctx, membership, importBatchId, error.message, now, {
      sourceType: parsed.sourceType,
      parserVersion: parsed.parserVersion,
      rowCount: parsed.rows.length,
      warnings: parsed.warnings,
    });
    throw error;
  }

  try {
    await ensureImportBucket(ctx);
  } catch (error) {
    const failure = toImportError(error);
    await markImportFailed(
      ctx,
      membership,
      importBatchId,
      failure.message,
      now,
    );
    throw failure;
  }
  const bucket = getImportBucketName();
  const storageUpload = await ctx.supabase.storage
    .from(bucket)
    .upload(storagePath, input.content, {
      contentType: input.mimeType,
      upsert: false,
    });
  if (storageUpload.error) {
    const error = new ImportStorageError({
      message: "Source File could not be stored",
      cause: storageUpload.error,
    });
    await markImportFailed(ctx, membership, importBatchId, error.message, now);
    throw error;
  }

  try {
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
  } catch (error) {
    const failure = toImportError(error);
    const removed = await removeStoredFile(ctx, storagePath);
    await markImportFailed(
      ctx,
      membership,
      importBatchId,
      failure.message,
      now,
      removed ? { storagePath: null } : { expiresAt: now },
    );
    throw failure;
  }

  return {
    importBatchId,
    sourceType: parsed.sourceType,
    parserVersion: parsed.parserVersion,
    rowCount: parsed.rows.length,
    previewRows: parsed.rows.slice(0, 3),
    warnings: parsed.warnings,
  };
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

async function ensureImportBucket(ctx: ImportDependencies) {
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

function validateImportInput(input: {
  fileName: string;
  mimeType?: string;
  content: Buffer;
}) {
  try {
    validateImportFile({
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.content.length,
    });
  } catch (error) {
    throw new ImportValidationError({
      message: error instanceof Error ? error.message : "Invalid import file",
    });
  }
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

async function markImportFailed(
  ctx: ImportDependencies,
  membership: MembershipContext,
  importBatchId: string,
  message: string,
  now: Date,
  metadata: FailedImportMetadata = {},
) {
  try {
    await ctx.db
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
      );
  } catch (error) {
    logger.error("Failed to record Import Batch failure", {
      importBatchId,
      error,
    });
  }
}

async function removeStoredFile(ctx: ImportDependencies, storagePath: string) {
  const removed = await ctx.supabase.storage
    .from(getImportBucketName())
    .remove([storagePath]);
  if (!removed.error) return true;
  logger.error("Failed to delete Source File after import failure", {
    storagePath,
    error: removed.error,
  });
  return false;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
