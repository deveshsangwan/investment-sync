import { describe, expect, it } from "vitest";
import {
  narrowPublicError,
  publicError,
  safePublicErrorMessage,
} from "./errors";

describe("public error contract", () => {
  it.each([
    ["VALIDATION", 400],
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["PROVIDER_UNAVAILABLE", 502],
    ["INTERNAL_FAILURE", 500],
  ] as const)("maps %s to HTTP %s without echoing detail", (code, status) => {
    const error = narrowPublicError({ code, message: "fake provider token" });

    expect(error).toEqual(publicError(code));
    expect(error.status).toBe(status);
    expect(error.message).not.toContain("fake");
  });

  it.each([null, "private detail", {}, { code: "toString" }, { code: 400 }])(
    "treats unknown data as an internal failure: %s",
    (data) => {
      expect(narrowPublicError(data)).toEqual(publicError("INTERNAL_FAILURE"));
    },
  );
});

it("sanitizes historical messages while retaining catalog explanations", () => {
  expect(safePublicErrorMessage("fake-provider://secret")).toBe(
    publicError("INTERNAL_FAILURE").message,
  );
  expect(
    safePublicErrorMessage(publicError("PROVIDER_UNAVAILABLE").message),
  ).toBe(publicError("PROVIDER_UNAVAILABLE").message);
});
