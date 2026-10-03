import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const dependencies = vi.hoisted(() => ({
  auth: vi.fn(),
  createApiContext: vi.fn(),
  ensureMembership: vi.fn(),
  uploadAndProcessImport: vi.fn(),
  runImportEffect: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: dependencies.auth }));
vi.mock("@investment-sync/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@investment-sync/api")>()),
  createApiContext: dependencies.createApiContext,
  ensureMembership: dependencies.ensureMembership,
  uploadAndProcessImport: dependencies.uploadAndProcessImport,
  runImportEffect: dependencies.runImportEffect,
}));

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.auth.mockResolvedValue({ userId: "owner", sessionClaims: {} });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("source upload write freeze", () => {
  it("returns a stable conflict before parsing the file or loading membership", async () => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", "true");
    const request = new Request("http://localhost/api/imports/upload", {
      method: "POST",
    });
    const formData = vi.spyOn(request, "formData");

    const response = await POST(request);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Source writes are paused",
    });
    expect(formData).not.toHaveBeenCalled();
    expect(dependencies.createApiContext).not.toHaveBeenCalled();
    expect(dependencies.ensureMembership).not.toHaveBeenCalled();
    expect(dependencies.uploadAndProcessImport).not.toHaveBeenCalled();
  });

  it("keeps unauthenticated uploads unauthorized", async () => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", "true");
    dependencies.auth.mockResolvedValue({ userId: null });

    const response = await POST(
      new Request("http://localhost/api/imports/upload", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(dependencies.createApiContext).not.toHaveBeenCalled();
  });

  it("rechecks the pause after parsing the request and before membership effects", async () => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", "false");
    const body = new FormData();
    body.set(
      "file",
      new File(["holdings"], "holdings.csv", { type: "text/csv" }),
    );
    const request = new Request("http://localhost/api/imports/upload", {
      method: "POST",
    });
    vi.spyOn(request, "formData").mockImplementation(() => {
      vi.stubEnv("SOURCE_WRITES_PAUSED", "true");

      return Promise.resolve(body);
    });

    const response = await POST(request);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Source writes are paused",
    });
    expect(dependencies.createApiContext).not.toHaveBeenCalled();
    expect(dependencies.ensureMembership).not.toHaveBeenCalled();
    expect(dependencies.uploadAndProcessImport).not.toHaveBeenCalled();
  });

  it("preserves the ordinary upload response when the switch is unset", async () => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", undefined);
    dependencies.createApiContext.mockReturnValue({});
    dependencies.ensureMembership.mockResolvedValue({ role: "owner" });
    const result = { importBatchId: "batch", rowCount: 1 };
    dependencies.runImportEffect.mockResolvedValue(result);
    const body = new FormData();
    body.set(
      "file",
      new File(["holdings"], "holdings.csv", { type: "text/csv" }),
    );

    const response = await POST(
      new Request("http://localhost/api/imports/upload", {
        method: "POST",
        body,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(dependencies.ensureMembership).toHaveBeenCalledTimes(1);
    expect(dependencies.uploadAndProcessImport).toHaveBeenCalledTimes(1);
  });
});
