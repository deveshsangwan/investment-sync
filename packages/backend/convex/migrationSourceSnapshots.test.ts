import { normalizedImportRowSchema } from "@investment-sync/importers/types";
import { adaptLegacyRow } from "@investment-sync/importers/exact-adapter";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { decodeFact } from "./model/portfolioEncoding";
import {
  legacyTables,
  parseJson,
  tableCountsSchema,
} from "./model/migrationValidators";
import schema from "./schema";
import { modules } from "./test.setup";
import {
  beginArguments,
  creationTime,
  first,
  fixtures,
  migrate,
  ownerIdentity,
  runKey,
  uuid,
} from "../test/migrationFixtures";

function sourceTables() {
  const tables = fixtures();
  const batch = first(tables.import_batches);
  batch.source_sequence = Date.parse(creationTime) + 10;
  const declaration = adaptLegacyRow({
    kind: "source_snapshot",
    sourceType: "tickertape_stock_csv",
    sourceDate: "2025-05-01",
    accountName: "Fake stocks",
    provider: "Fake broker",
    assetClass: "indian_stock",
    currency: "INR",
    sourceGroup: "",
    completeness: "complete",
    metadata: {},
  });
  const firstHolding = first(tables.holding_snapshots);
  const secondHousehold = tables.holding_snapshots[1];
  if (!secondHousehold) throw new Error("Missing independent holding");
  const instrument = {
    ...first(tables.instruments),
    id: uuid(41),
    name: "Fake Beta",
    symbol: "BETA",
  };
  tables.instruments.push(instrument);
  // An independent earlier fact shifts the legacy ordinal into a declaration's
  // retained batch-row slot. Migration must reserve that slot without renaming it.
  tables.holding_snapshots = [
    secondHousehold,
    firstHolding,
    {
      ...firstHolding,
      id: uuid(73),
      instrument_id: instrument.id,
    },
  ];
  const initial = first(tables.import_rows);
  const initialPayload = normalizedImportRowSchema.parse(
    initial.normalized_payload,
  );
  tables.import_rows = tables.import_rows.filter(
    (row) => row.import_batch_id !== uuid(51),
  );
  tables.import_rows.push(
    initial,
    {
      ...initial,
      id: uuid(64),
      row_number: 2,
      normalized_payload: {
        ...initialPayload,
        symbol: "BETA",
        instrumentName: "Fake Beta",
      },
    },
    {
      ...initial,
      id: uuid(65),
      row_number: 3,
      normalized_payload: declaration,
    },
  );
  batch.row_count = 3;
  tables.source_snapshots.push({
    id: uuid(101),
    household_id: uuid(11),
    account_id: uuid(31),
    import_batch_id: uuid(51),
    row_number: 3,
    source_type: declaration.sourceType,
    snapshot_date: "2025-05-01",
    asset_class: declaration.assetClass,
    currency: declaration.currency,
    source_group: declaration.sourceGroup,
    completeness: "complete",
    normalized_payload: declaration,
    source_sequence: batch.source_sequence,
    parser_version: batch.parser_version,
    fallback_date: "2025-05-01",
    created_at: creationTime,
  });
  const empty = { ...declaration, sourceDate: "2025-05-02" };
  const emptyBatch = {
    ...batch,
    id: uuid(55),
    row_count: 1,
    source_sequence: Date.parse(creationTime) + 20,
    file_hash: "5".repeat(64),
  };
  tables.import_batches.push(emptyBatch);
  tables.import_rows.push({
    ...initial,
    id: uuid(66),
    import_batch_id: emptyBatch.id,
    normalized_payload: empty,
  });
  tables.source_snapshots.push({
    ...first(tables.source_snapshots),
    id: uuid(102),
    import_batch_id: emptyBatch.id,
    row_number: 1,
    snapshot_date: "2025-05-02",
    normalized_payload: empty,
    source_sequence: emptyBatch.source_sequence,
  });
  return tables;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("source snapshot migration protocol", () => {
  it("preserves original declaration identity, reserves its row slot, audits empty exit and advances later observations", async () => {
    const tables = sourceTables();
    const t = await migrate(tables);
    expect(await t.action(internal.migrationAudit.audit, { runKey })).toEqual({
      ok: true,
      findings: [],
    });
    const owner = t.withIdentity(ownerIdentity);
    expect((await owner.query(api.portfolio.positions)).current).toEqual([]);
    expect((await owner.query(api.portfolio.positions)).exited).toHaveLength(2);
    expect(
      (await owner.query(api.portfolio.overview)).summary.currentValue,
    ).toBe(0);
    const facts = await t.run(async (ctx) => ({
      declarations: await ctx.db.query("sourceSnapshots").collect(),
      holdings: await ctx.db.query("holdingSnapshots").collect(),
      household: await ctx.db.query("households").withIndex("by_owner").first(),
    }));
    expect(facts.declarations).toHaveLength(2);
    expect(
      decodeFact(first(facts.declarations).factJson).provenance,
    ).toMatchObject({
      batchId: uuid(51),
      rowNumber: 3,
      sequence: Date.parse(creationTime) + 10,
      sourceSequence: Date.parse(creationTime) + 10,
      legacyId: uuid(101),
    });
    const corrected = facts.holdings.find((fact) => fact.legacyId === uuid(73));
    if (!corrected) throw new Error("Missing reserved-ordinal holding");
    expect(decodeFact(corrected.factJson).provenance).toMatchObject({
      rowNumber: 4,
      sequence: Date.parse(creationTime),
      sourceSequence: Date.parse(creationTime) + 10,
    });
    const initialKeys = new Set(facts.declarations.map((fact) => fact.key));
    for (const holding of facts.holdings)
      expect(initialKeys.has(holding.key)).toBe(false);
    const version = await t.run(async (ctx) => {
      const household = await ctx.db
        .query("households")
        .withIndex("by_owner")
        .first();
      return household?.activePortfolioVersionId
        ? ctx.db.get("portfolioVersions", household.activePortfolioVersionId)
        : null;
    });
    expect(version?.sequence).toBeGreaterThanOrEqual(
      Date.parse(creationTime) + 20,
    );
    const before = await t.query(internal.migration.exportPage, {
      runKey,
      table: "sourceSnapshots",
      paginationOpts: { cursor: null, numItems: 200 },
    });
    for (const row of tables.source_snapshots)
      await t.mutation(internal.migration.loadRecord, {
        runKey,
        legacyTable: "source_snapshots",
        rowJson: JSON.stringify(row),
      });
    expect(
      await t.query(internal.migration.exportPage, {
        runKey,
        table: "sourceSnapshots",
        paginationOpts: { cursor: null, numItems: 200 },
      }),
    ).toEqual(before);
  });

  it("rejects foreign source parents, changed scope and sequence before creating any declaration", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("MIGRATION_MODE", "synthetic");
    const tables = sourceTables();
    const t = convexTest(schema, modules);
    await t.mutation(internal.migration.begin, beginArguments(tables));
    for (const table of legacyTables) {
      if (table === "source_snapshots") break;
      for (const row of tables[table])
        await t.mutation(internal.migration.loadRecord, {
          runKey,
          legacyTable: table,
          rowJson: JSON.stringify(row),
        });
    }
    const source = first(tables.source_snapshots);
    for (const change of [
      { account_id: uuid(32) },
      { household_id: uuid(12) },
      { source_group: "changed" },
      { source_sequence: 3 },
      { snapshot_date: "2025-05-03" },
    ]) {
      await expect(
        t.mutation(internal.migration.loadRecord, {
          runKey,
          legacyTable: "source_snapshots",
          rowJson: JSON.stringify({ ...source, ...change }),
        }),
      ).rejects.toThrow();
    }
    expect(
      await t.run((ctx) => ctx.db.query("sourceSnapshots").collect()),
    ).toEqual([]);
    await expect(
      t.mutation(internal.migration.loadRecord, {
        runKey,
        legacyTable: "holding_snapshots",
        rowJson: JSON.stringify(first(tables.holding_snapshots)),
      }),
    ).rejects.toThrow("Source declarations must load before financial facts");
  });

  it("detects tampered native declaration provenance and source scope during audit", async () => {
    const t = await migrate(sourceTables());
    await t.run(async (ctx) => {
      const declaration = await ctx.db.query("sourceSnapshots").first();
      if (!declaration) throw new Error("Missing declaration");
      const fact = decodeFact(declaration.factJson);
      await ctx.db.patch("sourceSnapshots", declaration._id, {
        factJson: JSON.stringify({
          ...fact,
          provenance: { ...fact.provenance, sourceSequence: 1 },
        }),
      });
    });
    const result = await t.action(internal.migrationAudit.audit, { runKey });
    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(
      expect.stringContaining("source_snapshots/"),
    );
  });

  it("resumes historical zero-declaration count manifests without inventing old boundaries", async () => {
    const t = await migrate();
    await t.run(async (ctx) => {
      const run = await ctx.db
        .query("migrationRuns")
        .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
        .unique();
      if (!run) throw new Error("Missing migration run");
      const expected = tableCountsSchema.parse(
        parseJson(run.expectedCountsJson),
      );
      const loaded = tableCountsSchema.parse(parseJson(run.loadedCountsJson));
      delete expected.source_snapshots;
      delete loaded.source_snapshots;
      await ctx.db.patch("migrationRuns", run._id, {
        expectedCountsJson: JSON.stringify(expected),
        loadedCountsJson: JSON.stringify(loaded),
      });
    });
    await t.mutation(internal.migration.begin, beginArguments(fixtures()));
    expect(await t.action(internal.migrationAudit.audit, { runKey })).toEqual({
      ok: true,
      findings: [],
    });
    expect(
      await t.run((ctx) => ctx.db.query("sourceSnapshots").collect()),
    ).toEqual([]);
  });
});
