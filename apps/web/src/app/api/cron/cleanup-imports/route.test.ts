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
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "local-test-secret");
  vi.stubEnv("SOURCE_WRITES_PAUSED", undefined);
  dependencies.createApiContext.mockReturnValue({});
  dependencies.runImportEffect.mockResolvedValue({ deleted: 2 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("source cleanup authorization", () => {
  it.each([
    { secret: undefined, authorization: undefined },
    { secret: undefined, authorization: "Bearer local-test-secret" },
    { secret: "", authorization: undefined },
    { secret: "", authorization: "Bearer local-test-secret" },
  ])(
    "fails closed for secret=$secret and authorization=$authorization",
    async ({ secret, authorization }) => {
      vi.stubEnv("CRON_SECRET", secret);

      const response = await GET(
        new Request("http://localhost/api/cron/cleanup-imports", {
          headers: authorization === undefined ? {} : { authorization },
        }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Cleanup is not configured",
      });
      expect(dependencies.createApiContext).not.toHaveBeenCalled();
      expect(dependencies.cleanupExpiredImportFiles).not.toHaveBeenCalled();
      expect(dependencies.runImportEffect).not.toHaveBeenCalled();
    },
  );

  describe.each(["false", "true"])(
    "with SOURCE_WRITES_PAUSED=%s",
    (sourceWritesPaused) => {
      it.each([
        undefined,
        "",
        "local-test-secret",
        "Basic local-test-secret",
        "Bearer",
        "bearer local-test-secret",
        "BEARER local-test-secret",
        "Bearer  local-test-secret",
        "Bearer\tlocal-test-secret",
        "Bearer wrong-secret",
        "Bearer local-test-secreT",
        "Bearer local-test-secret-extra",
      ])("rejects authorization=%s before cleanup", async (authorization) => {
        vi.stubEnv("SOURCE_WRITES_PAUSED", sourceWritesPaused);

        const response = await GET(
          new Request("http://localhost/api/cron/cleanup-imports", {
            headers: authorization === undefined ? {} : { authorization },
          }),
        );

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "Unauthorized" });
        expect(dependencies.createApiContext).not.toHaveBeenCalled();
        expect(dependencies.cleanupExpiredImportFiles).not.toHaveBeenCalled();
        expect(dependencies.runImportEffect).not.toHaveBeenCalled();
      });
    },
  );
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
    expect(dependencies.runImportEffect).not.toHaveBeenCalled();
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
    expect(dependencies.createApiContext).toHaveBeenCalledTimes(1);
    expect(dependencies.createApiContext).toHaveBeenCalledWith({
      auth: { userId: null },
    });
    expect(dependencies.cleanupExpiredImportFiles).toHaveBeenCalledTimes(1);
    expect(dependencies.runImportEffect).toHaveBeenCalledTimes(1);
  });
});
