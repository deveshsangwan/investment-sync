import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  duplicateImportError,
  importEffect,
  importErrorHttpStatus,
  ImportConflictError,
  ImportNotFoundError,
  ImportPersistenceError,
  ImportStorageError,
  ImportValidationError,
  isImportError,
  runImportEffect,
  toImportError,
} from "./import-errors";

const COMMITTED_INDEX = "import_batches_committed_file_parser_idx";

describe("importErrorHttpStatus", () => {
  it.each([
    [new ImportValidationError({ message: "bad" }), 400],
    [new ImportNotFoundError({ message: "gone" }), 404],
    [new ImportConflictError({ message: "clash" }), 409],
    [new ImportStorageError({ message: "storage" }), 502],
    [new ImportPersistenceError({ message: "db" }), 500],
  ])("maps %s", (error, status) => {
    expect(importErrorHttpStatus(error)).toBe(status);
  });
});

describe("isImportError", () => {
  it("accepts every tagged import error", () => {
    const errors = [
      new ImportValidationError({ message: "bad" }),
      new ImportNotFoundError({ message: "gone" }),
      new ImportConflictError({ message: "clash" }),
      new ImportStorageError({ message: "storage" }),
      new ImportPersistenceError({ message: "db" }),
    ];
    expect(errors.every(isImportError)).toBe(true);
  });

  it("rejects plain errors and tag-shaped impostors", () => {
    expect(isImportError(new Error("nope"))).toBe(false);
    expect(isImportError(null)).toBe(false);
    expect(isImportError(undefined)).toBe(false);
    expect(isImportError("ImportValidationError")).toBe(false);
    // A bare object carrying the right _tag must not pass: the transport layer
    // reads _tag to pick a status code, so anything that gets through here can
    // steer the HTTP response.
    expect(isImportError({ _tag: "ImportValidationError", message: "x" })).toBe(
      false,
    );
  });
});

describe("toImportError", () => {
  it("passes an existing import error through untouched", () => {
    const original = new ImportNotFoundError({ message: "gone" });
    expect(toImportError(original)).toBe(original);
  });

  it("maps the committed-duplicate unique violation to a conflict", () => {
    const error = toImportError({ code: "23505", constraint: COMMITTED_INDEX });
    expect(error).toBeInstanceOf(ImportConflictError);
    expect(error.message).toBe("Duplicate Import");
  });

  it("finds the duplicate violation nested inside cause chains", () => {
    // postgres-js wraps driver errors, so the violation is rarely on the
    // surface object.
    const nested = {
      message: "insert failed",
      cause: { cause: { code: "23505", constraint: COMMITTED_INDEX } },
    };
    expect(toImportError(nested)).toBeInstanceOf(ImportConflictError);
  });

  it("does not treat other unique violations as duplicate imports", () => {
    const error = toImportError({
      code: "23505",
      constraint: "households_owner_user_id_unique",
    });
    expect(error).toBeInstanceOf(ImportPersistenceError);
    expect(error.message).toBe("Import operation failed");
  });

  it("wraps unknown failures as persistence errors and keeps the cause", () => {
    const cause = new Error("connection reset");
    const error = toImportError(cause);
    expect(error).toBeInstanceOf(ImportPersistenceError);
    expect((error as ImportPersistenceError).cause).toBe(cause);
  });
});

describe("duplicateImportError", () => {
  it("always carries the message the transport layer surfaces", () => {
    expect(duplicateImportError().message).toBe("Duplicate Import");
  });
});

describe("importEffect", () => {
  it("succeeds with the resolved value", async () => {
    await expect(
      Effect.runPromise(importEffect(() => Promise.resolve(42))),
    ).resolves.toBe(42);
  });

  it("preserves the tag of an import error thrown inside", async () => {
    const failure = await Effect.runPromise(
      Effect.either(
        importEffect(() =>
          Promise.reject(new ImportValidationError({ message: "bad file" })),
        ),
      ),
    );
    expect(failure._tag).toBe("Left");
    if (failure._tag !== "Left") return;
    expect(failure.left).toBeInstanceOf(ImportValidationError);
    expect(failure.left.message).toBe("bad file");
  });

  it("converts an unknown throw into a persistence error", async () => {
    const failure = await Effect.runPromise(
      Effect.either(importEffect(() => Promise.reject(new Error("boom")))),
    );
    expect(failure._tag).toBe("Left");
    if (failure._tag !== "Left") return;
    expect(failure.left).toBeInstanceOf(ImportPersistenceError);
  });
});

describe("runImportEffect", () => {
  it("resolves the success value", async () => {
    await expect(runImportEffect(Effect.succeed("ok"))).resolves.toBe("ok");
  });

  it("rejects with the tagged error itself, not a FiberFailure", async () => {
    // Regression guard: a bare Effect.runPromise rejects with an opaque
    // FiberFailure, which makes every `isImportError` check at the adapters
    // fall through to a 500.
    const original = new ImportConflictError({ message: "Duplicate Import" });
    const rejection = await runImportEffect(Effect.fail(original)).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBe(original);
    expect(isImportError(rejection)).toBe(true);
    expect(importErrorHttpStatus(rejection as ImportConflictError)).toBe(409);
  });
});
