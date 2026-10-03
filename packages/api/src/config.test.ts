import { describe, expect, it } from "vitest";
import { getAppEnv, isDataConfigured, isSourceWritesPaused } from "./config";

describe("SOURCE_WRITES_PAUSED", () => {
  it("defaults to allowing writes", () => {
    expect(getAppEnv({}).SOURCE_WRITES_PAUSED).toBe(false);
    expect(isSourceWritesPaused({})).toBe(false);
    expect(isSourceWritesPaused({ SOURCE_WRITES_PAUSED: "false" })).toBe(false);
  });

  it("requires an explicit true value to pause writes", () => {
    expect(
      getAppEnv({ SOURCE_WRITES_PAUSED: "true" }).SOURCE_WRITES_PAUSED,
    ).toBe(true);
  });

  it.each(["", "1", "0", "TRUE", "yes"])(
    "rejects ambiguous switch value %j",
    (value) => {
      expect(() =>
        isSourceWritesPaused({ SOURCE_WRITES_PAUSED: value }),
      ).toThrow();
    },
  );
});

describe("isDataConfigured", () => {
  it("checks only the data-service credentials", () => {
    expect(
      isDataConfigured({
        DATABASE_URL: "postgresql://localhost/investment_sync",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        NEXT_PUBLIC_APP_URL: "not a URL",
      }),
    ).toBe(true);
  });
});
