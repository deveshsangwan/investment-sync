import { buildPortfolioPublication } from "@investment-sync/portfolio-domain";
import { projectionRecords } from "./model/publicationProjection";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import {
  chunkRows,
  digest,
  importLimits,
  parseRows,
  utf8Bytes,
} from "./model/importLimits";
import { portfolioLimits } from "./model/portfolioLimits";
import { publicationReadBudget } from "./model/publicationReadBudget";
import { capacityRows } from "./testing/publicationCapacity";
import schema from "./schema";
import { modules } from "./test.setup";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("rejects accumulated large metadata before activation while preserving previous commits", async () => {
  vi.stubEnv("APP_ENV", "development");
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const runId = "fake-capacity-read-budget";
  const owner = t.withIdentity({
    subject: `user_${runId}`,
    issuer: "https://fake-development.example",
    tokenIdentifier: `fake|${runId}`,
  });
  const allRows = parseRows(
    JSON.stringify(
      capacityRows(0)
        .slice(0, 110)
        .map((row, index) => ({
          ...row,
          accountName: `FAKE account ${index}`,
          metadata: { note: "x".repeat(55000) },
          source: { ...row.source, completeness: "partial" },
        })),
    ),
  );
  let committedRows = 0;
  let rejected = false;
  for (let offset = 0; offset < allRows.length; offset += 8) {
    const rows = allRows.slice(offset, offset + 8);
    expect(rows.length).toBeLessThanOrEqual(importLimits.rows);
    expect(utf8Bytes(JSON.stringify(rows))).toBeLessThanOrEqual(
      importLimits.normalizedBytes,
    );
    const prepared = await t.mutation(
      internal.testing.publicationCapacity.prepare,
      { runId, index: 0 },
    );
    const previous = await t.run(async (ctx) => {
      const batch = await ctx.db.get("importBatches", prepared.batchId);
      if (!batch) throw new Error("Missing test batch");
      const chunks = await ctx.db
        .query("importRowChunks")
        .withIndex("by_batchId_and_attempt_and_index", (q) =>
          q.eq("batchId", prepared.batchId),
        )
        .collect();
      for (const chunk of chunks)
        await ctx.db.delete("importRowChunks", chunk._id);
      const manifest = [];
      for (const [index, rowsJson] of chunkRows(rows).entries()) {
        const entry = {
          index,
          count: parseRows(rowsJson).length,
          bytes: utf8Bytes(rowsJson),
          digest: digest(rowsJson),
        };
        await ctx.db.insert("importRowChunks", {
          batchId: prepared.batchId,
          attempt: 1,
          rowsJson,
          ...entry,
        });
        manifest.push(entry);
      }
      await ctx.db.patch("importBatches", prepared.batchId, {
        rowCount: rows.length,
        normalizedBytes: utf8Bytes(JSON.stringify(rows)),
        contentHash: digest(JSON.stringify(rows)),
        manifest,
      });
      const household = await ctx.db.get("households", prepared.householdId);
      const accounts = await ctx.db.query("accounts").collect();
      const facts = await ctx.db.query("holdingSnapshots").collect();
      return {
        versionId: household?.activePortfolioVersionId ?? null,
        accounts: accounts.length,
        facts: facts.length,
        factBytes: facts.reduce(
          (total, fact) => total + utf8Bytes(fact.factJson),
          0,
        ),
      };
    });
    expect(previous.factBytes + utf8Bytes(JSON.stringify(rows))).toBeLessThan(
      portfolioLimits.householdFactBytes,
    );
    const pending = await owner.mutation(api.imports.commit, {
      batchId: prepared.batchId,
    });
    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: pending.versionId,
      attempt: 1,
    });
    const batch = await owner.query(api.imports.get, {
      batchId: prepared.batchId,
    });
    if (batch.status === "committed") {
      committedRows += rows.length;
      continue;
    }

    expect(batch.status).toBe("parsed");
    expect(batch.errorMessage).toContain("public-view read budget");
    expect(committedRows).toBeGreaterThan(0);
    await t.run(async (ctx) => {
      const household = await ctx.db.get("households", prepared.householdId);
      expect(household?.activePortfolioVersionId).toBe(previous.versionId);
      expect(await ctx.db.query("holdingSnapshots").collect()).toHaveLength(
        previous.facts,
      );
      expect(await ctx.db.query("accounts").collect()).toHaveLength(
        previous.accounts,
      );
      const receipts = await ctx.db
        .query("publicationReceipts")
        .withIndex("by_versionId_and_stage_and_index", (q) =>
          q.eq("versionId", pending.versionId),
        )
        .collect();
      const budget = publicationReadBudget(receipts);
      expect(budget.totalBytes).toBeGreaterThan(budget.limitBytes);
      expect(
        await ctx.db.get("portfolioVersions", pending.versionId),
      ).toMatchObject({ publicationState: "failed" });
    });
    rejected = true;
    break;
  }
  expect(rejected).toBe(true);
}, 60000);

it("keeps a conservative budget for the unchanged 1348-row import after 2734 historical rows", () => {
  const historical = [
    ...capacityRows(0),
    ...capacityRows(1),
    ...capacityRows(2).slice(0, 38),
  ];
  const publication = buildPortfolioPublication({
    existingFacts: historical.map((row, index) => ({
      row,
      provenance: {
        batchId: String(Math.floor(index / 684)).padStart(32, "b"),
        rowNumber: (index % 684) + 1,
        sequence: Math.floor(index / 684) + 1,
        parserVersion: "fake-capacity-decimal-v1",
        fallbackDate: "2025-01-01",
      },
    })),
    batch: {
      id: "fake-final".padStart(32, "b"),
      parserVersion: "fake-capacity-decimal-v1",
      sequence: 5,
      fallbackDate: "2025-01-01",
      rows: capacityRows(3),
    },
  });
  expect(publication.facts).toHaveLength(4082);
  const records = projectionRecords(publication.projection);
  const receipts = (
    ["history", "positions", "scopes", "summary", "assets", "timeline"] as const
  ).map((stage) => {
    const storedRows =
      stage === "scopes"
        ? records.scopes.map(({ historyKeys, ...row }) => ({
            ...row,
            factIds: historyKeys.map(() => "h".repeat(32)),
          }))
        : records[stage];
    return {
      stage,
      count: records[stage].length,
      // Include stored document fields and 32-character fact IDs. JSON escaping
      // overestimates logical bytes; live receipts provide the exact measurement.
      modelBytesWritten: storedRows.reduce(
        (total, row) =>
          total +
          utf8Bytes(
            JSON.stringify({
              ...row,
              _id: "x".repeat(32),
              _creationTime: 1780000000000,
              versionId: "v".repeat(32),
            }),
          ),
        0,
      ),
    };
  });
  const budget = publicationReadBudget(receipts);
  expect(budget.totalBytes).toBeLessThanOrEqual(budget.limitBytes);
  console.info("portfolio.test.capacityReadBudget", JSON.stringify(budget));
});
