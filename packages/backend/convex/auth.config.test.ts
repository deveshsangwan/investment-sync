import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Convex authentication configuration", () => {
  it.each([undefined, ""])(
    "fails closed when the Clerk issuer is %s",
    async (issuer) => {
      vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
      vi.resetModules();

      await expect(import("./auth.config")).rejects.toThrow(
        "CLERK_JWT_ISSUER_DOMAIN must be set",
      );
    },
  );

  it("binds the Convex audience to the configured Clerk issuer", async () => {
    const issuer = "https://example.clerk.accounts.dev";
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
    vi.resetModules();

    const { default: config } = await import("./auth.config");

    expect(config).toEqual({
      providers: [{ domain: issuer, applicationID: "convex" }],
    });
  });
});
