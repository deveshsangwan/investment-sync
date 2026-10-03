import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const dependencies = vi.hoisted(() => ({
  createApiContext: vi.fn(),
  cleanupExpiredImportFiles: vi.fn(),
  runImportEffect: vi.fn(),
}));

vi.mock("@investment-sync/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@investment-sync/api")>()),
  createApiContext: dependencies.createApiContext,
  cleanupExpiredImportFiles: dependencies.cleanupExpiredImportFiles,
  runImportEffect: dependencies.runImportEffect,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "local-test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("source cleanup write freeze", () => {
  it("returns a stable conflict before creating clients or starting cleanup", async () => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

    const response = await GET(
      new Request("http://localhost/api/cron/cleanup-imports", {
        headers: { authorization: "Bearer local-test-secret" },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Source writes are paused",
    });
    expect(dependencies.createApiContext).not.toHaveBeenCalled();
    expect(dependencies.cleanupExpiredImportFiles).not.toHaveBeenCalled();
  });

  it("keeps unauthenticated cleanup unauthorized", async () => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

    const response = await GET(
      new Request("http://localhost/api/cron/cleanup-imports"),
    );

    expect(response.status).toBe(401);
    expect(dependencies.createApiContext).not.toHaveBeenCalled();
  });

  it("preserves ordinary cleanup when the switch is unset", async () => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", undefined);
    dependencies.createApiContext.mockReturnValue({});
    dependencies.runImportEffect.mockResolvedValue({ deleted: 2 });

    const response = await GET(
      new Request("http://localhost/api/cron/cleanup-imports", {
        headers: { authorization: "Bearer local-test-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 2 });
    expect(dependencies.cleanupExpiredImportFiles).toHaveBeenCalledTimes(1);
  });
});
