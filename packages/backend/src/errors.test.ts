import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { clientErrorMessage } from "./errors";

const secret = "postgres://private-provider/fake-token";
const fallback = "Please try again.";

describe("client error contract", () => {
  it.each([
    new Error(secret),
    secret,
    null,
    { data: { code: "VALIDATION", message: secret } },
    new ConvexError(secret),
    new ConvexError({ code: "unknown", message: secret }),
    new ConvexError({ code: "constructor", message: secret }),
    new ConvexError({ message: secret }),
  ])("uses a safe fallback for unrecognized errors: %s", (cause) => {
    expect(clientErrorMessage(cause, fallback)).toBe(fallback);
  });

  it.each([
    ["VALIDATION", "Check the file or entry values and try again."],
    ["CONFLICT", "The data has changed. Reload and try again."],
    ["NOT_FOUND", "The requested item is unavailable."],
    ["UNAUTHENTICATED", "Sign in to continue."],
    [
      "PROVIDER_UNAVAILABLE",
      "The service is temporarily unavailable. Please try again.",
    ],
  ])("uses only the catalog message for %s", (code, message) => {
    expect(
      clientErrorMessage(new ConvexError({ code, message: secret }), fallback),
    ).toBe(message);
  });
});
