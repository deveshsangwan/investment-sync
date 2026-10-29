import { afterEach, expect, it, vi } from "vitest";
import { logger } from "../logger";
import {
  ImportConflictError,
  ImportStorageError,
} from "../services/import-errors";
import { toImportTrpcError } from "./imports";

afterEach(() => vi.restoreAllMocks());

it.each([
  [
    new ImportConflictError({ message: "fake provider detail" }),
    "CONFLICT",
    "The data has changed. Reload and try again.",
  ],
  [
    new ImportStorageError({ message: "fake provider detail" }),
    "INTERNAL_SERVER_ERROR",
    "The service is temporarily unavailable. Please try again.",
  ],
  [
    new Error("fake provider detail"),
    "INTERNAL_SERVER_ERROR",
    "The operation could not be completed. Please try again.",
  ],
])(
  "sanitizes %s and logs batch identity with the original error",
  (cause, code, message) => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});

    const error = toImportTrpcError(cause, { importBatchId: "fake-batch" });

    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.cause).toBe(cause);
    const anyString: unknown = expect.any(String);

    expect(log).toHaveBeenCalledWith("Import request failed", {
      importBatchId: "fake-batch",
      requestId: anyString,
      code: anyString,
      error: cause,
    });
  },
);
