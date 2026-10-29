import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const failure = vi.hoisted(() => new Error("fake-provider://private-token"));
vi.mock("@investment-sync/importers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@investment-sync/importers")>()),
  parseExactImportFile: () => {
    throw failure;
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("stores a safe parse failure and logs the original cause with batch and attempt", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "parser_error_owner" });
  await owner.mutation(api.users.ensureCurrent);
  const { batchId } = await owner.mutation(api.imports.createUpload, {
    fileName: "fake.csv",
    sizeBytes: 4,
  });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["fake"])));
  await owner.mutation(api.imports.attachUpload, { batchId, storageId });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  await t.action(internal.actions.parseImport.parseImport, {
    batchId,
    attempt: 1,
  });

  const batch = await owner.query(api.imports.get, { batchId });
  expect(batch.errorMessage).toBe(
    "This file could not be parsed. Try again or choose another file.",
  );
  expect(log).toHaveBeenCalledWith("Import parsing failed", {
    batchId,
    attempt: 1,
    error: expect.objectContaining({ cause: failure }),
  });
}, 30_000);
