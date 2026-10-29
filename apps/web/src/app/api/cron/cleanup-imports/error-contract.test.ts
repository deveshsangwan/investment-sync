import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ImportStorageError,
  ImportPersistenceError,
  logger,
} from "@investment-sync/api";
import { GET } from "./route";

const dependencies = vi.hoisted(() => ({
  createApiContext: vi.fn(),
  runImportEffect: vi.fn(),
}));
vi.mock("@investment-sync/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@investment-sync/api")>()),
  createApiContext: dependencies.createApiContext,
  runImportEffect: dependencies.runImportEffect,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "fake-cleanup-key");
  vi.stubEnv("SOURCE_WRITES_PAUSED", "false");
  dependencies.createApiContext.mockReturnValue({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  [
    new ImportStorageError({ message: "fake private provider detail" }),
    502,
    "PROVIDER_UNAVAILABLE",
    "The service is temporarily unavailable. Please try again.",
  ],
  [
    new ImportPersistenceError({ message: "fake private database detail" }),
    500,
    "INTERNAL_FAILURE",
    "The operation could not be completed. Please try again.",
  ],
  [
    new Error("fake private provider detail"),
    500,
    "INTERNAL_FAILURE",
    "The operation could not be completed. Please try again.",
  ],
])(
  "sanitizes an authorized cleanup failure: %s",
  async (error, status, code, message) => {
    dependencies.runImportEffect.mockRejectedValueOnce(error);
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});

    const response = await GET(
      new Request("http://localhost/api/cron/cleanup-imports", {
        headers: { authorization: "Bearer fake-cleanup-key" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body).toEqual({
      error: message,
      code,
      requestId: expect.any(String),
    });
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
    expect(log).toHaveBeenCalledWith("Import cleanup failed", {
      requestId: body.requestId,
      code,
      error,
    });
  },
);
