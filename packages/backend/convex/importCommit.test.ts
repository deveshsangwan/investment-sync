import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parserGoldenFixtures } from "../../importers/src/golden-fixtures";
import { api, internal } from "./_generated/api";
import { digest, utf8Bytes } from "./model/importLimits";
import schema from "./schema";
import { modules } from "./test.setup";

const identity = {
  subject: "fake_commit_owner",
  issuer: "https://fake.example",
  tokenIdentifier: "fake|commit_owner",
};

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function parsedImport() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(identity);
  await owner.mutation(api.users.ensureCurrent);

  const fixture = parserGoldenFixtures()[0];
  if (!fixture) throw new Error("Missing fake stock fixture");

  const blob = new Blob([fixture.file.content.toString("utf8")]);
  const { batchId } = await owner.mutation(api.imports.createUpload, {
    fileName: fixture.file.fileName,
    sizeBytes: blob.size,
  });
  const storageId = await t.run((ctx) => ctx.storage.store(blob));
  await owner.mutation(api.imports.attachUpload, { batchId, storageId });
  await t.action(internal.actions.parseImport.parseImport, {
    batchId,
    attempt: 1,
  });
  await expect(
    owner.query(api.imports.get, { batchId }),
  ).resolves.toMatchObject({
    status: "parsed",
    rowCount: 1,
  });

  return { t, owner, batchId };
}

async function storedState(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => ({
    batches: await ctx.db.query("importBatches").collect(),
    households: await ctx.db.query("households").collect(),
    versions: await ctx.db.query("portfolioVersions").collect(),
    chunks: await ctx.db.query("importRowChunks").collect(),
    sources: await ctx.db.query("sourceFiles").collect(),
    holdings: await ctx.db.query("holdingSnapshots").collect(),
    transactions: await ctx.db.query("transactions").collect(),
    valuations: await ctx.db.query("portfolioValuations").collect(),
    accounts: await ctx.db.query("accounts").collect(),
    instruments: await ctx.db.query("instruments").collect(),
    dedupeKeys: await ctx.db.query("importDedupeKeys").collect(),
    jobs: await ctx.db.system.query("_scheduled_functions").collect(),
  }));
}

describe("import commit lifecycle", () => {
  it.each([
    "awaiting_upload",
    "uploaded",
    "parsing",
    "failed",
    "publishing",
    "committed",
  ] as const)(
    "rejects %s without a valid publication receipt",
    async (status) => {
      const { t, owner, batchId } = await parsedImport();
      await t.run((ctx) => ctx.db.patch("importBatches", batchId, { status }));
      const before = await storedState(t);

      await expect(
        owner.mutation(api.imports.commit, { batchId }),
      ).rejects.toMatchObject({
        data: {
          code: "CONFLICT",
          message: "Only a parsed import can be committed",
        },
      });
      expect(await storedState(t)).toEqual(before);
    },
  );

  it.each(["contentHash", "parserVersion"] as const)(
    "rejects parsed input missing %s without reserving a publication",
    async (field) => {
      const { t, owner, batchId } = await parsedImport();
      await t.run((ctx) =>
        ctx.db.patch("importBatches", batchId, { [field]: undefined }),
      );
      const before = await storedState(t);

      await expect(
        owner.mutation(api.imports.commit, { batchId }),
      ).rejects.toMatchObject({
        data: { code: "CONFLICT" },
      });
      expect(await storedState(t)).toEqual(before);
    },
  );

  it("rejects an empty parsed batch without reserving a publication", async () => {
    const { t, owner, batchId } = await parsedImport();
    await t.run(async (ctx) => {
      for (const chunk of await ctx.db.query("importRowChunks").collect())
        await ctx.db.delete("importRowChunks", chunk._id);

      await ctx.db.patch("importBatches", batchId, {
        rowCount: 0,
        normalizedBytes: utf8Bytes("[]"),
        manifest: [],
      });
    });
    const before = await storedState(t);

    await expect(
      owner.mutation(api.imports.commit, { batchId }),
    ).rejects.toMatchObject({
      data: { code: "CONFLICT" },
    });
    expect(await storedState(t)).toEqual(before);
  });

  it("returns the same not-found error for foreign and deleted batches", async () => {
    const { t, batchId } = await parsedImport();
    const other = t.withIdentity({
      ...identity,
      subject: "fake_other",
      tokenIdentifier: "fake|other",
    });
    await other.mutation(api.users.ensureCurrent);
    const before = await storedState(t);

    await expect(
      other.mutation(api.imports.commit, { batchId }),
    ).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
    expect(await storedState(t)).toEqual(before);

    await t.run((ctx) => ctx.db.delete("importBatches", batchId));
    const afterDeletion = await storedState(t);
    await expect(
      other.mutation(api.imports.commit, { batchId }),
    ).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
    expect(await storedState(t)).toEqual(afterDeletion);
  });

  it("shares one publication across concurrent requests and preserves the committed receipt on replay", async () => {
    const { t, owner, batchId } = await parsedImport();
    const otherRequest = t.withIdentity(identity);
    const [first, second] = await Promise.all([
      owner.mutation(api.imports.commit, { batchId }),
      otherRequest.mutation(api.imports.commit, { batchId }),
    ]);
    expect(first).toEqual(second);
    expect(first.status).toBe("publishing");
    const pending = await storedState(t);
    expect(pending.versions).toHaveLength(1);
    expect(pending.batches[0]).toMatchObject({
      status: "publishing",
      publicationAttempt: 1,
    });
    expect(pending.holdings).toHaveLength(0);

    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: first.versionId,
      attempt: 1,
    });
    const committed = await owner.mutation(api.imports.commit, { batchId });
    expect(committed).toMatchObject({
      status: "committed",
      versionId: first.versionId,
      sequence: 1,
    });
    const beforeReplay = await storedState(t);
    expect(beforeReplay.holdings).toHaveLength(1);
    expect(beforeReplay.versions).toHaveLength(1);
    expect(beforeReplay.batches[0]).toHaveProperty("committedAt");

    vi.setSystemTime(Date.now() + 60_000);
    await expect(
      Promise.all([
        owner.mutation(api.imports.commit, { batchId }),
        otherRequest.mutation(api.imports.commit, { batchId }),
        t.mutation(internal.publicationWorkers.finalize, {
          versionId: first.versionId,
          attempt: 1,
        }),
      ]),
    ).resolves.toEqual([committed, committed, committed]);
    expect(await storedState(t)).toEqual(beforeReplay);
  });

  it("commits retained parsed rows after Source File expiration", async () => {
    const { t, owner, batchId } = await parsedImport();
    await t.run(async (ctx) => {
      const source = await ctx.db.query("sourceFiles").unique();
      if (!source) throw new Error("Missing test source");

      await ctx.db.patch("sourceFiles", source._id, { expiresAt: 0 });
    });
    await t.mutation(internal.importCleanup.expireFiles, {});
    await expect(
      owner.query(api.imports.get, { batchId }),
    ).resolves.toMatchObject({
      status: "parsed",
      fileAvailable: false,
      rowCount: 1,
    });

    const pending = await owner.mutation(api.imports.commit, { batchId });
    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: pending.versionId,
      attempt: 1,
    });
    await expect(
      owner.mutation(api.imports.commit, { batchId }),
    ).resolves.toMatchObject({
      status: "committed",
      versionId: pending.versionId,
    });
    expect((await storedState(t)).holdings).toHaveLength(1);
  });

  it.each([
    "missing chunks",
    "stale parse attempt",
    "row count mismatch",
    "invalid payload",
    "empty input",
  ])(
    "leaves portfolio data unpublished when the worker encounters %s",
    async (failure) => {
      const { t, owner, batchId } = await parsedImport();
      const pending = await owner.mutation(api.imports.commit, { batchId });
      await t.run(async (ctx) => {
        const chunk = await ctx.db.query("importRowChunks").unique();
        if (!chunk) throw new Error("Missing test chunk");

        if (failure === "missing chunks" || failure === "empty input")
          await ctx.db.delete("importRowChunks", chunk._id);
        if (failure === "stale parse attempt")
          await ctx.db.patch("importRowChunks", chunk._id, { attempt: 0 });
        if (failure === "row count mismatch")
          await ctx.db.patch("importBatches", batchId, { rowCount: 2 });
        if (failure === "empty input")
          await ctx.db.patch("importBatches", batchId, {
            rowCount: 0,
            normalizedBytes: 2,
            manifest: [],
          });
        if (failure === "invalid payload") {
          const rowsJson = JSON.stringify([
            { kind: "holding", instrumentName: "" },
          ]);
          const entry = {
            index: 0,
            count: 1,
            bytes: utf8Bytes(rowsJson),
            digest: digest(rowsJson),
          };
          await ctx.db.patch("importRowChunks", chunk._id, {
            ...entry,
            rowsJson,
          });
          await ctx.db.patch("importBatches", batchId, {
            normalizedBytes: entry.bytes,
            manifest: [entry],
          });
        }
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      await t.action(internal.actions.publishPortfolio.publishPortfolio, {
        versionId: pending.versionId,
        attempt: 1,
      });
      const failed = await storedState(t);
      expect(failed.batches[0]).toMatchObject({
        status: "parsed",
        publicationAttempt: 1,
      });
      expect(failed.batches[0]).not.toHaveProperty("committedAt");
      expect(failed.versions[0]).toMatchObject({ publicationState: "failed" });
      expect(failed.households[0]).not.toHaveProperty(
        "activePortfolioVersionId",
      );
      expect(failed.households[0]).not.toHaveProperty("publishingVersionId");
      expect(failed.holdings).toHaveLength(0);
      expect(failed.accounts).toHaveLength(0);
      expect(failed.instruments).toHaveLength(0);
      expect(failed.dedupeKeys).toHaveLength(0);
    },
  );
});
