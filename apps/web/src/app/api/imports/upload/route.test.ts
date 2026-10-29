import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import {
  ImportValidationError,
  ImportNotFoundError,
  ImportConflictError,
  ImportStorageError,
  ImportPersistenceError,
  logger,
} from "@investment-sync/api";

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
  vi.restoreAllMocks();
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
    expect(await response.json()).toMatchObject({
      error: "Source writes are paused",
      code: "SOURCE_WRITES_PAUSED",
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
    expect(await response.json()).toMatchObject({
      error: "Source writes are paused",
      code: "SOURCE_WRITES_PAUSED",
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

function uploadRequest() {
  const body = new FormData();
  body.set("file", new File(["fake"], "holdings.csv", { type: "text/csv" }));

  return new Request("http://localhost/api/imports/upload", {
    method: "POST",
    body,
  });
}

const privateMessage = "fake-provider://private-token";

describe("upload error contract", () => {
  beforeEach(() => {
    vi.stubEnv("SOURCE_WRITES_PAUSED", "false");
    dependencies.createApiContext.mockReturnValue({});
    dependencies.ensureMembership.mockResolvedValue({ role: "owner" });
  });

  it.each([
    [
      new ImportValidationError({ message: privateMessage }),
      400,
      "VALIDATION",
      "Check the file or entry values and try again.",
    ],
    [
      new ImportNotFoundError({ message: privateMessage }),
      404,
      "NOT_FOUND",
      "The requested item is unavailable.",
    ],
    [
      new ImportConflictError({ message: privateMessage }),
      409,
      "CONFLICT",
      "The data has changed. Reload and try again.",
    ],
    [
      new ImportStorageError({
        message: privateMessage,
        cause: new Error(privateMessage),
      }),
      502,
      "PROVIDER_UNAVAILABLE",
      "The service is temporarily unavailable. Please try again.",
    ],
    [
      new ImportPersistenceError({ message: privateMessage }),
      500,
      "INTERNAL_FAILURE",
      "The operation could not be completed. Please try again.",
    ],
    [
      new Error(privateMessage),
      500,
      "INTERNAL_FAILURE",
      "The operation could not be completed. Please try again.",
    ],
  ])(
    "sanitizes %s with status %s and diagnostic detail",
    async (error, status, code, message) => {
      dependencies.runImportEffect.mockRejectedValueOnce(error);
      const log = vi.spyOn(logger, "error").mockImplementation(() => {});

      const response = await POST(uploadRequest());
      const body = await response.json();

      expect(response.status).toBe(status);
      expect(body).toEqual({
        error: message,
        code,
        requestId: expect.any(String),
      });
      expect(response.headers.get("x-request-id")).toBe(body.requestId);
      expect(JSON.stringify(body)).not.toContain(privateMessage);
      expect(log).toHaveBeenCalledWith("Import upload failed", {
        requestId: body.requestId,
        code,
        error,
      });
    },
  );

  it("treats malformed multipart as validation and keeps the cause in logs", async () => {
    const request = uploadRequest();
    const cause = new Error(privateMessage);
    vi.spyOn(request, "formData").mockRejectedValueOnce(cause);
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION",
      error: "Check the file or entry values and try again.",
    });
    expect(log).toHaveBeenCalledWith(
      "Import upload failed",
      expect.objectContaining({ error: expect.objectContaining({ cause }) }),
    );
    expect(dependencies.ensureMembership).not.toHaveBeenCalled();
  });

  it("sanitizes authentication-provider failures", async () => {
    const error = new Error(privateMessage);
    dependencies.auth.mockRejectedValueOnce(error);
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});

    const response = await POST(uploadRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "INTERNAL_FAILURE" });
    expect(log).toHaveBeenCalledWith(
      "Import upload failed",
      expect.objectContaining({ error }),
    );
  });

  it("correlates independent concurrent requests with distinct server-generated IDs", async () => {
    const requests = [uploadRequest(), uploadRequest()];
    const failures = requests.map(
      (_, index) => new Error(`${privateMessage}/${index}`),
    );
    for (const [index, request] of requests.entries()) {
      vi.spyOn(request, "formData").mockRejectedValueOnce(failures[index]);
    }
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});

    const responses = await Promise.all(requests.map(POST));
    const bodies = await Promise.all(
      responses.map((response) => response.json()),
    );

    expect(new Set(bodies.map((body) => body.requestId)).size).toBe(2);
    for (const [index, body] of bodies.entries()) {
      expect(body.code).toBe("VALIDATION");
      expect(log).toHaveBeenCalledWith("Import upload failed", {
        requestId: body.requestId,
        code: "VALIDATION",
        error: expect.objectContaining({ cause: failures[index] }),
      });
    }
  });
});
