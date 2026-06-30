import { describe, expect, it } from "vitest";
import { isDataConfigured } from "./config";

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
