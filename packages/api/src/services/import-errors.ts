import { publicError } from "@investment-sync/portfolio-domain";
import type { ApiContext } from "../context";
import { Data, Effect } from "effect";
import {
  assertSourceWritesAllowed,
  SourceWritesPausedError,
} from "../source-writes";

const COMMITTED_IMPORT_UNIQUE_INDEX =
  "import_batches_committed_file_parser_idx";

export type ImportDependencies = Pick<ApiContext, "db" | "supabase">;

export class ImportValidationError extends Data.TaggedError(
  "ImportValidationError",
)<{ message: string; cause?: unknown }> {}

export class ImportNotFoundError extends Data.TaggedError(
  "ImportNotFoundError",
)<{ message: string }> {}

export class ImportConflictError extends Data.TaggedError(
  "ImportConflictError",
)<{ message: string; cause?: unknown }> {}

export class ImportStorageError extends Data.TaggedError("ImportStorageError")<{
  message: string;
  cause?: unknown;
}> {}

export class ImportPersistenceError extends Data.TaggedError(
  "ImportPersistenceError",
)<{ message: string; cause?: unknown }> {}

export type ImportError =
  | ImportValidationError
  | ImportNotFoundError
  | ImportConflictError
  | ImportStorageError
  | ImportPersistenceError;

export async function runImportEffect<A>(
  effect: Effect.Effect<A, ImportError>,
): Promise<A> {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Left") throw result.left;
  return result.right;
}

export function importErrorHttpStatus(error: ImportError) {
  return publicImportError(error).status;
}

export function publicImportError(error: unknown) {
  if (
    error instanceof SourceWritesPausedError ||
    (error instanceof ImportConflictError &&
      error.message === "Source writes are paused")
  ) {
    return publicError("SOURCE_WRITES_PAUSED");
  }

  if (!isImportError(error)) return publicError("INTERNAL_FAILURE");

  switch (error._tag) {
    case "ImportValidationError":
      return publicError("VALIDATION");
    case "ImportNotFoundError":
      return publicError("NOT_FOUND");
    case "ImportConflictError":
      return publicError(
        error.message === "Duplicate Import" ? "DUPLICATE_IMPORT" : "CONFLICT",
      );
    case "ImportStorageError":
      return publicError("PROVIDER_UNAVAILABLE");
    case "ImportPersistenceError":
      return publicError("INTERNAL_FAILURE");
  }
}

export function isImportError(error: unknown): error is ImportError {
  return (
    error instanceof ImportValidationError ||
    error instanceof ImportNotFoundError ||
    error instanceof ImportConflictError ||
    error instanceof ImportStorageError ||
    error instanceof ImportPersistenceError
  );
}

export function duplicateImportError(cause?: unknown) {
  return new ImportConflictError({ message: "Duplicate Import", cause });
}

export function importEffect<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({ try: operation, catch: toImportError });
}

export function importWriteEffect<A>(operation: () => Promise<A>) {
  return importEffect(() => {
    assertSourceWritesAllowed();

    return operation();
  });
}

export function toImportError(error: unknown): ImportError {
  if (isImportError(error)) return error;

  if (error instanceof SourceWritesPausedError) {
    return new ImportConflictError({ message: error.message, cause: error });
  }

  if (isCommittedImportUniqueViolation(error)) {
    return duplicateImportError(error);
  }
  return new ImportPersistenceError({
    message: "Import operation failed",
    cause: error,
  });
}

function isCommittedImportUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };
  return (
    (candidate.code === "23505" &&
      candidate.constraint === COMMITTED_IMPORT_UNIQUE_INDEX) ||
    isCommittedImportUniqueViolation(candidate.cause)
  );
}
