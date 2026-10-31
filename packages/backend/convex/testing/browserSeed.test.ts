import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";

const seed = makeFunctionReference<"mutation", Record<string, never>, null>(
  "testing/browserSeed:seed",
);
afterEach(() => vi.unstubAllEnvs());

test("browser fixtures cannot run in production or development", async () => {
  const backend = convexTest(schema, {
    ...modules,
    "./testing/browserSeed.ts": () => import("../../src/testing/browserSeed"),
  });
  for (const environment of ["production", "development", ""]) {
    vi.stubEnv("APP_ENV", environment);
    await expect(backend.mutation(seed, {})).rejects.toThrow(
      "Browser fixtures require an isolated test backend",
    );
  }
});

test("test fixtures seed a viewer with the same household and reject viewer writes", async () => {
  vi.stubEnv("APP_ENV", "test");
  const backend = convexTest(schema, {
    ...modules,
    "./testing/browserSeed.ts": () => import("../../src/testing/browserSeed"),
  });
  await backend.mutation(seed, {});
  const owner = backend.withIdentity({ subject: "e2e_owner" });
  const viewer = backend.withIdentity({ subject: "e2e_viewer" });
  const ownerProfile = await owner.query(api.users.current, {});
  const viewerProfile = await viewer.query(api.users.current, {});

  expect(viewerProfile.householdId).toBe(ownerProfile.householdId);
  expect(viewerProfile.role).toBe("viewer");
  await expect(
    viewer.mutation(api.imports.createUpload, {
      fileName: "fake.csv",
      sizeBytes: 1,
    }),
  ).rejects.toThrow();
});

test("the fake quote replaces an initialized rate slot without creating an ambiguous quote", async () => {
  vi.stubEnv("APP_ENV", "test");
  const backend = convexTest(schema, {
    ...modules,
    "./testing/browserSeed.ts": () => import("../../src/testing/browserSeed"),
  });
  const id = await backend.run((ctx) =>
    ctx.db.insert("currencyRates", {
      base: "USD",
      quote: "INR",
      provider: "frankfurter",
      status: "unavailable",
      refreshRevision: 1,
    }),
  );
  await backend.mutation(seed, {});
  const quotes = await backend.run((ctx) =>
    ctx.db
      .query("currencyRates")
      .withIndex("by_base_and_quote_and_provider", (query) =>
        query
          .eq("base", "USD")
          .eq("quote", "INR")
          .eq("provider", "frankfurter"),
      )
      .collect(),
  );

  expect(quotes).toHaveLength(1);
  expect(quotes[0]).toMatchObject({ _id: id, rate: "80", status: "fresh" });
});
