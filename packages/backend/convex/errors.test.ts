import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import schema from "./schema";
import { withMutationDiagnostics } from "./model/errors";
import { modules } from "./test.setup";

const errorMatcher: unknown = expect.any(Error);
const stringMatcher: unknown = expect.any(String);
const safeMessageMatcher: unknown =
  expect.not.stringContaining("fake-provider");

const identity = {
  subject: "error_contract_owner",
  issuer: "https://example.clerk.accounts.dev",
  tokenIdentifier: "test|error_contract_owner",
};

afterEach(() => vi.restoreAllMocks());

it("correlates independent concurrent mutation failures and hides database detail", async () => {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(identity);
  await owner.mutation(api.users.ensureCurrent);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const reservations = await Promise.all(
    ["first.csv", "second.csv"].map((fileName) =>
      owner.mutation(api.imports.createUpload, { fileName, sizeBytes: 4 }),
    ),
  );

  const storageId = await t.run(async (ctx) => {
    for (const { batchId } of reservations) {
      const file = await ctx.db
        .query("sourceFiles")
        .withIndex("by_batchId", (q) => q.eq("batchId", batchId))
        .unique();

      if (!file) throw new Error("Missing test source reservation");

      await ctx.db.insert("sourceFiles", {
        batchId,
        householdId: file.householdId,
        uploaderId: file.uploaderId,
        status: "reserved",
        expiresAt: file.expiresAt,
      });
    }

    return ctx.storage.store(new Blob(["fake"]));
  });
  const results = await Promise.allSettled(
    reservations.map(({ batchId }) =>
      owner.mutation(api.imports.attachUpload, { batchId, storageId }),
    ),
  );
  const diagnosticIds = new Set<string>();

  for (const [index, result] of results.entries()) {
    expect(result.status).toBe("rejected");

    if (result.status !== "rejected") continue;

    const error: unknown = result.reason;
    expect(error).toBeInstanceOf(ConvexError);

    if (!(error instanceof ConvexError)) continue;

    expect(error.data).toMatchObject({ code: "INTERNAL_FAILURE" });
    expect(JSON.stringify(error.data)).not.toContain("unique");
    const data: unknown = error.data;

    if (
      typeof data !== "object" ||
      !data ||
      !("diagnosticId" in data) ||
      typeof data.diagnosticId !== "string"
    ) {
      throw new Error("Missing public diagnostic ID");
    }

    diagnosticIds.add(data.diagnosticId);
    expect(log).toHaveBeenCalledWith("Mutation failed", {
      operation: "imports.attachUpload",
      diagnosticId: data.diagnosticId,
      batchId: reservations[index]?.batchId,
      requestId: undefined,
      error: errorMatcher,
    });
  }

  expect(diagnosticIds.size).toBe(2);
  expect(log).toHaveBeenCalledTimes(2);
}, 30_000);

it.each([
  [
    new ConvexError({ code: "VALIDATION", message: "fake-provider://token" }),
    "VALIDATION",
  ],
  [new ConvexError("fake-provider://token"), "INTERNAL_FAILURE"],
  [
    new ConvexError({ code: "unknown", message: "fake-provider://token" }),
    "INTERNAL_FAILURE",
  ],
])(
  "enforces the public contract for direct callers: %s",
  async (cause, code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      withMutationDiagnostics(
        "test.operation",
        { requestId: "fake-request" },
        () => Promise.reject(cause),
      ),
    ).rejects.toMatchObject({
      data: {
        code,
        message: safeMessageMatcher,
        diagnosticId: stringMatcher,
      },
    });
    expect(log).toHaveBeenCalledWith(
      "Mutation failed",
      expect.objectContaining({ requestId: "fake-request", error: cause }),
    );
  },
);
