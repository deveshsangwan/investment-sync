import { parseExactImportFile } from "@investment-sync/importers";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parserGoldenFixtures } from "../../importers/src/golden-fixtures";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { decodeFact } from "./model/portfolioEncoding";
import schema from "./schema";
import { modules } from "./test.setup";

const duplicateMessage =
  "This file and parser version have already been committed";

async function setup() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "fake-dedupe-owner" });
  await owner.mutation(api.users.ensureCurrent);

  const fixture = parserGoldenFixtures()[0];
  if (!fixture) throw new Error("Missing fake CSV fixture");

  const content = fixture.file.content
    .toString("utf8")
    .replace("250.00", "250.1234");
  const file = { ...fixture.file, content: Buffer.from(content) };
  const parsed = parseExactImportFile(file);

  async function upload(uploader = owner, fileName = file.fileName) {
    const { batchId } = await uploader.mutation(api.imports.createUpload, {
      fileName,
      sizeBytes: file.content.byteLength,
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([content], { type: "text/csv" })),
    );
    await uploader.mutation(api.imports.attachUpload, { batchId, storageId });
    await parse(batchId);

    return batchId;
  }

  async function parse(batchId: Id<"importBatches">, attempt = 1) {
    await t.action(internal.actions.parseImport.parseImport, {
      batchId,
      attempt,
    });
  }

  async function publish(batchId: Id<"importBatches">, uploader = owner) {
    const pending = await uploader.mutation(api.imports.commit, { batchId });
    const batch = await t.run((ctx) => ctx.db.get("importBatches", batchId));
    if (!batch?.publicationAttempt)
      throw new Error("Missing publication attempt");

    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: pending.versionId,
      attempt: batch.publicationAttempt,
    });

    const committed = await uploader.mutation(api.imports.commit, { batchId });
    expect(committed.status).toBe("committed");

    return committed;
  }

  return { t, owner, file, parsed, upload, parse, publish };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("duplicate source content", () => {
  it("allows independent simultaneous uploads but commits identical content only once", async () => {
    const { t, owner, upload, parsed } = await setup();
    const batches = await Promise.all([
      upload(owner, "fake-first.csv"),
      upload(owner, "fake-renamed.csv"),
    ]);
    expect(new Set(batches).size).toBe(2);

    const results = await Promise.allSettled(
      batches.map((batchId) => owner.mutation(api.imports.commit, { batchId })),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toMatchObject([{ reason: { data: { code: "PUBLISHING_CONFLICT" } } }]);

    const winnerIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );
    const winner = batches[winnerIndex];
    const loser = batches[1 - winnerIndex];
    const pending = results[winnerIndex];
    if (!winner || !loser || pending?.status !== "fulfilled")
      throw new Error("Missing concurrent commit result");

    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: pending.value.versionId,
      attempt: 1,
    });
    const committed = await owner.mutation(api.imports.commit, {
      batchId: winner,
    });
    expect(committed).toMatchObject({ status: "committed", sequence: 1 });
    await expect(
      owner.mutation(api.imports.commit, { batchId: winner }),
    ).resolves.toEqual(committed);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        owner.mutation(api.imports.commit, { batchId: loser }),
      ).rejects.toMatchObject({
        data: { code: "CONFLICT", message: duplicateMessage },
      });
    }

    await t.run(async (ctx) => {
      expect(await ctx.db.query("importDedupeKeys").collect()).toMatchObject([
        { batchId: winner },
      ]);
      expect(await ctx.db.query("portfolioVersions").collect()).toHaveLength(1);
      expect(await ctx.db.query("sourceFiles").collect()).toHaveLength(2);
      expect(await ctx.db.query("importRowChunks").collect()).toHaveLength(2);
      const facts = await ctx.db.query("holdingSnapshots").collect();
      expect(facts).toHaveLength(1);
      expect(facts.map((fact) => decodeFact(fact.factJson))).toEqual([
        {
          row: parsed.rows[0],
          provenance: expect.objectContaining({
            batchId: winner,
            parserVersion: parsed.parserVersion,
          }),
        },
      ]);
      expect(parsed.rows[0]).toMatchObject({ currentValue: "250.1234" });
      expect(await ctx.db.get("importBatches", loser)).toMatchObject({
        status: "parsed",
      });
    });
  });

  it("finds a committed duplicate after more than ten earlier batches and rejects parse retries", async () => {
    const { t, owner, upload, parse, publish } = await setup();
    const history = await Promise.all(
      Array.from({ length: 12 }, () => upload()),
    );
    const committedId = await upload();
    await publish(committedId);

    const duplicateId = await upload();
    await expect(
      owner.query(api.imports.get, { batchId: duplicateId }),
    ).resolves.toMatchObject({
      status: "failed",
      errorMessage: duplicateMessage,
    });
    await owner.mutation(api.imports.retryParse, { batchId: duplicateId });
    await parse(duplicateId, 2);
    await expect(
      owner.query(api.imports.get, { batchId: duplicateId }),
    ).resolves.toMatchObject({
      status: "failed",
      errorMessage: duplicateMessage,
    });

    const earlierId = history[0];
    if (!earlierId) throw new Error("Missing historical batch");

    await expect(
      owner.mutation(api.imports.commit, { batchId: earlierId }),
    ).rejects.toMatchObject({
      data: { code: "CONFLICT", message: duplicateMessage },
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("importBatches").collect()).toHaveLength(14);
      expect(await ctx.db.query("importDedupeKeys").collect()).toMatchObject([
        { batchId: committedId },
      ]);
      expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(1);
    });
  });

  it("allows a new parser version and another household while retaining source facts", async () => {
    const { t, owner, upload, publish, parsed } = await setup();
    const historicalId = await upload();
    // Represent a batch committed before the currently installed parser version.
    await t.run((ctx) =>
      ctx.db.patch("importBatches", historicalId, {
        parserVersion: "fake-previous-parser",
      }),
    );
    await publish(historicalId);

    const reprocessedId = await upload();
    await publish(reprocessedId);
    const otherOwner = t.withIdentity({ subject: "fake-other-household" });
    await otherOwner.mutation(api.users.ensureCurrent);
    const otherId = await upload(otherOwner);
    await expect(
      owner.mutation(api.imports.commit, { batchId: otherId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await publish(otherId, otherOwner);

    await t.run(async (ctx) => {
      const keys = await ctx.db.query("importDedupeKeys").collect();
      expect(keys).toHaveLength(3);
      expect(new Set(keys.map((key) => key.householdId)).size).toBe(2);
      expect(new Set(keys.map((key) => key.key.split(":").at(-1)))).toEqual(
        new Set(["fake-previous-parser", parsed.parserVersion]),
      );
      const facts = await ctx.db.query("holdingSnapshots").collect();
      expect(facts).toHaveLength(3);
      expect(
        new Set(
          facts.map((fact) => decodeFact(fact.factJson).provenance.batchId),
        ),
      ).toEqual(new Set([historicalId, reprocessedId, otherId]));
      expect(
        facts.every((fact) => decodeFact(fact.factJson).row.kind === "holding"),
      ).toBe(true);
      expect(await ctx.db.query("sourceFiles").collect()).toHaveLength(3);
    });
  });

  it.each(["same batch", "different batch"])(
    "does not consume content identity after publication failure, retrying the %s",
    async (retryKind) => {
      const { t, owner, upload, publish } = await setup();
      const batches = await Promise.all([upload(), upload()]);
      const [first, second] = batches;
      if (!first || !second) throw new Error("Missing test batches");

      const pending = await owner.mutation(api.imports.commit, {
        batchId: first,
      });
      await t.run((ctx) =>
        ctx.db.patch("portfolioVersions", pending.versionId, {
          forcedFailure: true,
        }),
      );
      await t.action(internal.actions.publishPortfolio.publishPortfolio, {
        versionId: pending.versionId,
        attempt: 1,
      });
      await t.run(async (ctx) => {
        expect(await ctx.db.query("importDedupeKeys").collect()).toHaveLength(
          0,
        );
        expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(
          0,
        );
        expect(await ctx.db.get("importBatches", first)).toMatchObject({
          status: "parsed",
        });
      });

      const retryId = retryKind === "same batch" ? first : second;
      const duplicateId = retryId === first ? second : first;
      const committed = await publish(retryId);
      expect(committed.sequence).toBe(1);
      await expect(
        owner.mutation(api.imports.commit, { batchId: duplicateId }),
      ).rejects.toMatchObject({
        data: { code: "CONFLICT", message: duplicateMessage },
      });
      await t.run(async (ctx) => {
        expect(await ctx.db.query("importDedupeKeys").collect()).toMatchObject([
          { batchId: retryId },
        ]);
        expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(
          1,
        );
      });
    },
  );
});
