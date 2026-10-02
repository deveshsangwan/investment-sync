import { convexTest } from "convex-test";
import { normalizedImportRowSchema } from "@investment-sync/importers/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import {
  canonicalJson,
  legacyTables,
  parseJson,
  sourceFileManifestSchema,
  type LegacyTable,
} from "./model/migrationValidators";
import { decodeFact } from "./model/portfolioEncoding";
import { digest, parseRows, utf8Bytes } from "./model/importLimits";
import { currencyRatePolicy, toValuationQuote } from "./model/currencyRates";
import schema from "./schema";
import { modules } from "./test.setup";

const evaluationTime = "2025-06-01T00:00:00.000Z";
const creationTime = "2025-05-01T00:00:00.000Z";
const runKey = "synthetic-migration";
const inputDigest = "a".repeat(64);
const ownerIdentity = {
  subject: "fake_migration_owner",
  issuer: "https://fake.example",
  tokenIdentifier: "fake|migration_owner",
};
const quote = { status: "unavailable" } as const;
type LegacyTables = Record<LegacyTable, Array<Record<string, unknown>>>;

function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function first<T>(values: T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("Missing synthetic fixture value");
  return value;
}

function fixtures() {
  const tables: LegacyTables = {
    users: [],
    households: [],
    household_members: [],
    accounts: [],
    instruments: [],
    import_batches: [],
    import_rows: [],
    holding_snapshots: [],
    transactions: [],
    portfolio_valuations: [],
    currency_rates: [],
    prices: [],
  };
  tables.users = [1, 2].map((index) => ({
    id: uuid(index),
    clerk_user_id: index === 1 ? ownerIdentity.subject : "fake_other_owner",
    email: `fake${index}@example.invalid`,
    created_at: creationTime,
    updated_at: creationTime,
  }));
  tables.households = [1, 2].map((index) => ({
    id: uuid(10 + index),
    owner_user_id: uuid(index),
    name: `Saved portfolio ${index}`,
    created_at: creationTime,
    updated_at: creationTime,
  }));
  tables.household_members = [1, 2].map((index) => ({
    id: uuid(20 + index),
    user_id: uuid(index),
    household_id: uuid(10 + index),
    role: "owner",
    created_at: creationTime,
  }));
  tables.accounts = [1, 2].map((index) => ({
    id: uuid(30 + index),
    household_id: uuid(10 + index),
    name: "Fake stocks",
    provider: "Fake broker",
    account_type: "brokerage",
    currency: "INR",
    is_archived: index === 2,
    metadata: { original: "retained" },
    created_at: creationTime,
    updated_at: creationTime,
  }));
  tables.instruments = [
    {
      id: uuid(40),
      name: "Fake Alpha",
      symbol: "ALPHA",
      isin: "FAKE00000001",
      exchange: "FAKE",
      asset_class: "indian_stock",
      currency: "INR",
      provider_metadata: { original: "retained" },
      created_at: creationTime,
      updated_at: creationTime,
    },
  ];
  tables.import_batches = [1, 2, 3, 4].map((index) => ({
    id: uuid(50 + index),
    household_id: uuid(11),
    uploaded_by_user_id: uuid(1),
    source_type: "tickertape_stock_csv",
    status: index === 1 ? "committed" : index === 4 ? "created" : "expired",
    parser_version: index === 4 ? null : "historical-parser-v1",
    original_file_name: `fake-${index}.csv`,
    storage_path: `fake/${index}.csv`,
    file_hash: String(index).repeat(64),
    row_count: index === 1 || index === 2 ? 1 : 0,
    warnings: [],
    errors: [],
    uploaded_at: creationTime,
    expires_at: index === 4 ? "2025-07-01T00:00:00.000Z" : creationTime,
    processed_at: index === 4 ? null : creationTime,
    committed_at: index === 1 ? creationTime : null,
  }));
  const normalized = {
    kind: "holding",
    sourceType: "tickertape_stock_csv",
    sourceDate: "2025-05-01",
    accountName: "Fake stocks",
    provider: "Fake broker",
    instrumentName: "Fake Alpha",
    symbol: "ALPHA",
    assetClass: "indian_stock",
    currency: "INR",
    quantity: 99,
    investedAmount: 100,
    currentValue: 777,
    metadata: {},
  };
  tables.import_rows = [1, 2].map((index) => ({
    id: uuid(60 + index),
    import_batch_id: uuid(50 + index),
    row_number: 1,
    normalized_payload: normalized,
    row_errors: [],
    is_committed: index === 1,
    created_at: creationTime,
  }));
  tables.holding_snapshots = [1, 2].map((index) => ({
    id: uuid(70 + index),
    household_id: uuid(10 + index),
    account_id: uuid(30 + index),
    instrument_id: uuid(40),
    import_batch_id: index === 1 ? uuid(51) : null,
    source_type: "tickertape_stock_csv",
    snapshot_date: "2025-05-01",
    quantity: "123456789.1234567890",
    invested_amount: index === 1 ? "100.0000" : "20.0000",
    current_value: index === 1 ? "150.0000" : "25.0000",
    pnl_amount: null,
    pnl_percent: null,
    currency: "INR",
    source_payload: {},
    created_at: creationTime,
  }));
  tables.transactions = [
    {
      id: uuid(80),
      household_id: uuid(11),
      account_id: uuid(31),
      instrument_id: uuid(40),
      import_batch_id: null,
      type: "buy",
      trade_date: "2024-05-01",
      quantity: null,
      price: null,
      amount: "100.0000",
      currency: "INR",
      notes: null,
      metadata: {},
      created_at: creationTime,
    },
  ];
  tables.portfolio_valuations = [
    {
      id: uuid(90),
      household_id: uuid(11),
      valuation_date: "2025-05-01",
      invested_amount: "100.0000",
      current_value: "150.0000",
      pnl_amount: "50.0000",
      currency: "INR",
      metadata: {},
      created_at: creationTime,
    },
  ];

  return tables;
}

function beginArguments(
  tables: LegacyTables,
  sourceKind: "synthetic" | "production" = "synthetic",
) {
  return {
    runKey,
    inputDigest,
    sourceKind,
    evaluationTime,
    expectedCountsJson: canonicalJson(
      Object.fromEntries(
        legacyTables.map((table) => [table, tables[table].length]),
      ),
    ),
    sourceFilesJson: JSON.stringify(
      tables.import_batches.map((row) => ({
        legacyBatchId: row.id,
        expiresAt: row.expires_at,
        legacyStoragePath: row.storage_path,
        status: "unavailable",
      })),
    ),
  };
}

async function migrate(tables = fixtures()) {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("MIGRATION_MODE", "synthetic");
  const t = convexTest(schema, modules);
  await t.mutation(internal.migration.begin, beginArguments(tables));
  for (const table of legacyTables)
    for (const row of tables[table])
      await t.mutation(internal.migration.loadRecord, {
        runKey,
        legacyTable: table,
        rowJson: JSON.stringify(row),
      });
  for (const batch of tables.import_batches)
    await t.action(internal.migration.finalizeBatch, {
      runKey,
      legacyBatchId: String(batch.id),
    });
  await t.mutation(internal.migration.completeRun, { runKey });
  for (const household of tables.households)
    await t.action(internal.migrationPublication.publish, {
      runKey,
      legacyHouseholdId: String(household.id),
    });

  return t;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("guarded migration loading", () => {
  it("rejects changed pending normalized rows even when packed checksums and manifests were recomputed", async () => {
    const t = await migrate();
    await t.run(async (ctx) => {
      const batch = (await ctx.db.query("importBatches").collect()).find(
        (batch) => batch.legacyId === uuid(52),
      );
      if (!batch) throw new Error("Missing pending migrated batch");
      const chunk = await ctx.db
        .query("importRowChunks")
        .withIndex("by_batchId_and_attempt_and_index", (q) =>
          q
            .eq("batchId", batch._id)
            .eq("attempt", batch.attempt)
            .eq("index", 0),
        )
        .unique();
      if (!chunk) throw new Error("Missing pending normalized chunk");
      const row = first(parseRows(chunk.rowsJson));
      const changed = parseRows(
        JSON.stringify([{ ...row, currentValue: "778" }]),
      );
      const rowsJson = JSON.stringify(changed);
      const entry = {
        index: 0,
        count: changed.length,
        bytes: utf8Bytes(rowsJson),
        digest: digest(rowsJson),
      };
      await ctx.db.patch("importRowChunks", chunk._id, { ...entry, rowsJson });
      await ctx.db.patch("importBatches", batch._id, {
        manifest: [entry],
        normalizedBytes: utf8Bytes(rowsJson),
        previewRowsJson: rowsJson,
      });
    });

    const audit = await t.action(internal.migrationAudit.audit, { runKey });
    expect(audit.ok).toBe(false);
    expect(audit.findings).toContain(
      `import_batches/${uuid(52)}: Packed normalized rows differ from authoritative source payloads or row order`,
    );
  });

  it("requires the complete ordered source rows when packed rows were reordered or omitted consistently", async () => {
    const tables = fixtures();
    const original = tables.import_rows.find(
      (row) => row.import_batch_id === uuid(52),
    );
    if (!original) throw new Error("Missing normalized source fixture");
    tables.import_rows.push({
      ...original,
      id: uuid(63),
      row_number: 7,
      normalized_payload: {
        ...normalizedImportRowSchema.parse(original.normalized_payload),
        currentValue: 888,
      },
    });
    const t = await migrate(tables);
    expect(await t.action(internal.migrationAudit.audit, { runKey })).toEqual({
      ok: true,
      findings: [],
    });
    const originalRows = await t.run(async (ctx) => {
      const batch = (await ctx.db.query("importBatches").collect()).find(
        (batch) => batch.legacyId === uuid(52),
      );
      if (!batch) throw new Error("Missing migrated batch");
      const chunk = await ctx.db
        .query("importRowChunks")
        .withIndex("by_batchId_and_attempt_and_index", (q) =>
          q
            .eq("batchId", batch._id)
            .eq("attempt", batch.attempt)
            .eq("index", 0),
        )
        .unique();
      if (!chunk) throw new Error("Missing normalized chunk");
      return {
        batchId: batch._id,
        chunkId: chunk._id,
        rows: parseRows(chunk.rowsJson),
      };
    });
    for (const rows of [
      [...originalRows.rows].reverse(),
      originalRows.rows.slice(0, 1),
    ]) {
      await t.run(async (ctx) => {
        const rowsJson = JSON.stringify(rows);
        const entry = {
          index: 0,
          count: rows.length,
          bytes: utf8Bytes(rowsJson),
          digest: digest(rowsJson),
        };
        await ctx.db.patch("importRowChunks", originalRows.chunkId, {
          ...entry,
          rowsJson,
        });
        await ctx.db.patch("importBatches", originalRows.batchId, {
          manifest: [entry],
          rowCount: rows.length,
          normalizedBytes: utf8Bytes(rowsJson),
          previewRowsJson: rowsJson,
        });
      });
      const audit = await t.action(internal.migrationAudit.audit, { runKey });
      expect(audit.ok).toBe(false);
      expect(audit.findings).toContain(
        `import_batches/${uuid(52)}: Packed normalized rows differ from authoritative source payloads or row order`,
      );
    }
  });

  it("expires an imported quote reactively through a migration freeze and failed refreshes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(evaluationTime));
    const tables = fixtures();
    for (const account of tables.accounts) account.currency = "USD";
    for (const instrument of tables.instruments) {
      instrument.currency = "USD";
      instrument.asset_class = "us_stock";
    }
    for (const table of [
      "holding_snapshots",
      "transactions",
      "portfolio_valuations",
    ] as const)
      for (const row of tables[table]) row.currency = "USD";
    tables.currency_rates.push({
      id: uuid(100),
      base: "USD",
      quote: "INR",
      rate: "83.2500000000",
      provider: "frankfurter",
      fetched_at: evaluationTime,
      created_at: creationTime,
      updated_at: evaluationTime,
    });
    const t = await migrate(tables);
    const owner = t.withIdentity(ownerIdentity);
    const readQuote = () =>
      t.run(async (ctx) => {
        const rate = first(await ctx.db.query("currencyRates").collect());
        return { rate, quote: toValuationQuote(rate) };
      });
    expect((await readQuote()).rate).toMatchObject({
      status: "fresh",
      refreshRevision: 1,
      quoteRevision: 1,
      rate: "83.25",
    });
    expect(
      (await owner.query(api.portfolio.overview)).summary.exchangeRates,
    ).toMatchObject([{ isStale: false, rate: 83.25 }]);
    expect(
      await t.action(internal.actions.refreshCurrencyRate.refreshCurrencyRate),
    ).toEqual({ outcome: "superseded", attempts: 0 });
    await vi.advanceTimersByTimeAsync(currencyRatePolicy.freshMilliseconds - 1);
    await t.finishInProgressScheduledFunctions();
    expect((await readQuote()).quote.status).toBe("fresh");

    await vi.advanceTimersByTimeAsync(1);
    await t.finishInProgressScheduledFunctions();
    expect((await readQuote()).quote.status).toBe("stale");
    expect(
      (await owner.query(api.portfolio.overview)).summary.exchangeRates,
    ).toMatchObject([{ isStale: true, rate: 83.25 }]);
    expect(await t.action(internal.migrationAudit.audit, { runKey })).toEqual({
      ok: true,
      findings: [],
    });
    vi.stubEnv("MIGRATION_MODE", "");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 400 })),
    );
    expect(
      await t.action(internal.actions.refreshCurrencyRate.refreshCurrencyRate),
    ).toEqual({ outcome: "failed", attempts: 1 });
    expect((await readQuote()).rate).toMatchObject({
      status: "stale",
      refreshRevision: 2,
      quoteRevision: 1,
    });
    vi.stubEnv("MIGRATION_MODE", "synthetic");
    await vi.advanceTimersByTimeAsync(
      currencyRatePolicy.usableMilliseconds -
        currencyRatePolicy.freshMilliseconds -
        1,
    );
    await t.finishInProgressScheduledFunctions();
    expect((await readQuote()).quote.status).toBe("stale");

    await vi.advanceTimersByTimeAsync(1);
    await t.finishInProgressScheduledFunctions();
    expect((await readQuote()).quote).toEqual({ status: "unavailable" });
    await expect(owner.query(api.portfolio.overview)).rejects.toThrow(
      "exchange rate is unavailable",
    );
    vi.stubEnv("MIGRATION_MODE", "");
    expect(
      await t.action(internal.actions.refreshCurrencyRate.refreshCurrencyRate),
    ).toEqual({ outcome: "failed", attempts: 1 });
    expect((await readQuote()).quote).toEqual({ status: "unavailable" });
    expect((await readQuote()).rate).toMatchObject({
      rate: "83.25",
      fetchedAt: evaluationTime,
      quoteRevision: 1,
    });
  });

  it.each([
    { age: currencyRatePolicy.freshMilliseconds, status: "stale" },
    { age: currencyRatePolicy.usableMilliseconds, status: "unavailable" },
  ])(
    "classifies an imported quote as $status exactly at its age boundary",
    async ({ age, status }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(evaluationTime));
      const tables = fixtures();
      tables.currency_rates.push({
        id: uuid(100),
        base: "USD",
        quote: "INR",
        rate: "83.2500000000",
        provider: "frankfurter",
        fetched_at: new Date(Date.parse(evaluationTime) - age).toISOString(),
        created_at: creationTime,
        updated_at: evaluationTime,
      });
      const t = await migrate(tables);
      expect(
        await t.run(async (ctx) =>
          first(await ctx.db.query("currencyRates").collect()),
        ),
      ).toMatchObject({ status, quoteRevision: 1, refreshRevision: 1 });
    },
  );

  it("exports a native batch source file for rollback and rejects mismatched ownership", async () => {
    const t = await migrate();
    vi.stubEnv("MIGRATION_MODE", "");
    const owner = t.withIdentity(ownerIdentity);
    const upload = await owner.mutation(api.imports.createUpload, {
      fileName: "generated-native.csv",
      sizeBytes: 12,
    });
    vi.stubEnv("MIGRATION_MODE", "synthetic");
    expect(
      await t.query(internal.migration.fileState, {
        runKey,
        targetBatchId: upload.batchId,
      }),
    ).toMatchObject({ status: "reserved", storageId: null });
    await t.run(async (ctx) => {
      const file = await ctx.db
        .query("sourceFiles")
        .withIndex("by_batchId", (q) => q.eq("batchId", upload.batchId))
        .unique();
      const other = (await ctx.db.query("households").collect()).find(
        (household) => household.legacyId === uuid(12),
      );
      if (!file || !other)
        throw new Error("Missing native rollback ownership fixture");
      await ctx.db.patch("sourceFiles", file._id, { householdId: other._id });
    });

    await expect(
      t.query(internal.migration.fileState, {
        runKey,
        targetBatchId: upload.batchId,
      }),
    ).rejects.toThrow("ownership does not match");
  });
  it("blocks reconciliation while an interrupted upload leaves an unclaimed storage object", async () => {
    const t = await migrate();
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["unclaimed generated file"])),
    );
    const audit = await t.action(internal.migrationAudit.audit, { runKey });
    expect(audit.ok).toBe(false);
    expect(audit.findings).toContain(
      "Unclaimed storage object remains in the migration target",
    );

    await t.run((ctx) => ctx.storage.delete(storageId));
    expect(await t.action(internal.migrationAudit.audit, { runKey })).toEqual({
      ok: true,
      findings: [],
    });
  });

  it("closes operator access by default and rejects production data in development", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("MIGRATION_MODE", "");
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.migration.begin, beginArguments(fixtures())),
    ).rejects.toThrow("does not authorize");
    vi.stubEnv("MIGRATION_MODE", "production");
    await expect(
      t.mutation(
        internal.migration.begin,
        beginArguments(fixtures(), "production"),
      ),
    ).rejects.toThrow("does not authorize");
    vi.stubEnv("MIGRATION_MODE", "synthetic");
    await t.run((ctx) =>
      ctx.db.insert("users", { clerkSubject: "existing_development_account" }),
    );
    await expect(
      t.mutation(internal.migration.begin, beginArguments(fixtures())),
    ).rejects.toThrow("empty target");
  });

  it("preserves authoritative facts, nullable references, legacy names, and household instrument splits", async () => {
    const t = await migrate();
    const owner = t.withIdentity(ownerIdentity);
    await expect(owner.query(api.users.current)).resolves.toMatchObject({
      email: "fake1@example.invalid",
      householdName: "Saved portfolio 1",
    });
    const positions = await owner.query(api.portfolio.positions);
    expect(positions.current).toHaveLength(1);
    expect(first(positions.current)).toMatchObject({
      quantity: "123456789.123456789",
      currentValue: "150",
      investedAmount: "100",
    });
    const detail = await owner.query(api.portfolio.holdingDetail, {
      positionKey: uuid(71),
    });
    expect(detail?.transactions).toHaveLength(1);
    expect(detail?.holding.currentValue).toBe("150");
    await t.run(async (ctx) => {
      const instruments = await ctx.db.query("instruments").collect();
      expect(instruments).toHaveLength(2);
      expect(
        new Set(instruments.map((instrument) => instrument.householdId)).size,
      ).toBe(2);
      expect(
        instruments.every((instrument) => instrument.legacyId === uuid(40)),
      ).toBe(true);
      const facts = await ctx.db.query("holdingSnapshots").collect();
      expect(facts.some((fact) => fact.batchId === undefined)).toBe(true);
      expect(facts.map((fact) => decodeFact(fact.factJson).row)).toMatchObject([
        { quantity: "123456789.123456789" },
        { quantity: "123456789.123456789" },
      ]);
      const valuation = first(
        await ctx.db.query("portfolioValuations").collect(),
      );
      expect(valuation.batchId).toBeUndefined();
      expect(valuation.date).toBe("2025-05-01");
      const transaction = first(await ctx.db.query("transactions").collect());
      expect(transaction.batchId).toBeUndefined();
      const transactionRow = decodeFact(transaction.factJson).row;
      expect(transactionRow.kind).toBe("transaction");
      if (transactionRow.kind !== "transaction")
        throw new Error("Wrong fixture transaction kind");
      expect(transactionRow.quantity).toBeUndefined();
      expect(transactionRow.price).toBeUndefined();
      expect(transactionRow.amount).toBe("100");
    });
    expect(await t.action(internal.migrationAudit.audit, { runKey })).toEqual({
      ok: true,
      findings: [],
    });
    const internalView = await t.query(internal.migrationViews.portfolioView, {
      runKey,
      legacyHouseholdId: uuid(11),
      view: "positions",
      quote,
    });
    expect(JSON.parse(internalView)).toEqual(positions);
  });

  it("replays identical input without new IDs and produces deterministic outputs on another clean target", async () => {
    const tables = fixtures();
    const t = await migrate(tables);
    const before = await t.query(internal.migration.exportPage, {
      runKey,
      table: "migrationMappings",
      paginationOpts: { cursor: null, numItems: 200 },
    });
    await t.mutation(internal.migration.begin, beginArguments(tables));
    for (const table of legacyTables)
      for (const row of tables[table])
        await t.mutation(internal.migration.loadRecord, {
          runKey,
          legacyTable: table,
          rowJson: JSON.stringify(row),
        });
    for (const batch of tables.import_batches)
      await t.action(internal.migration.finalizeBatch, {
        runKey,
        legacyBatchId: String(batch.id),
      });
    for (const household of tables.households)
      await t.action(internal.migrationPublication.publish, {
        runKey,
        legacyHouseholdId: String(household.id),
      });
    expect(
      await t.query(internal.migration.exportPage, {
        runKey,
        table: "migrationMappings",
        paginationOpts: { cursor: null, numItems: 200 },
      }),
    ).toEqual(before);
    const other = await migrate(tables);
    const digests = await t.run(async (ctx) =>
      (await ctx.db.query("portfolioVersions").collect()).map(
        (version) => version.digest,
      ),
    );
    expect(
      await other.run(async (ctx) =>
        (await ctx.db.query("portfolioVersions").collect()).map(
          (version) => version.digest,
        ),
      ),
    ).toEqual(digests);
    const viewArgs = {
      runKey,
      legacyHouseholdId: uuid(11),
      view: "overview" as const,
      quote,
    };
    expect(
      await other.query(internal.migrationViews.portfolioView, viewArgs),
    ).toEqual(await t.query(internal.migrationViews.portfolioView, viewArgs));
    await expect(
      t.mutation(internal.migration.begin, {
        ...beginArguments(tables),
        inputDigest: "b".repeat(64),
      }),
    ).rejects.toThrow("Conflicting migration input");
    await expect(
      t.mutation(internal.migration.loadRecord, {
        runKey,
        legacyTable: "users",
        rowJson: JSON.stringify({
          ...first(tables.users),
          email: "different@example.invalid",
        }),
      }),
    ).rejects.toThrow("Conflicting legacy record");
  });

  it("keeps expired normalized inputs committable and lets a later same-date correction override migrated facts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(evaluationTime));
    const t = await migrate();
    const owner = t.withIdentity(ownerIdentity);
    const expiredBatch = await t.run(async (ctx) => {
      const batches = await ctx.db.query("importBatches").collect();
      const batch = batches.find((batch) => batch.legacyId === uuid(52));
      if (!batch) throw new Error("Missing migrated expired batch");
      const failed = batches.find((batch) => batch.legacyId === uuid(53));
      expect(failed).toMatchObject({
        status: "failed",
        legacyStatus: "expired",
        failureReason: "source_expired_no_rows",
      });
      expect(batch).toMatchObject({
        status: "parsed",
        legacyStatus: "expired",
        parserVersion: "historical-parser-v1",
      });
      const file = await ctx.db
        .query("sourceFiles")
        .withIndex("by_batchId", (q) => q.eq("batchId", batch._id))
        .unique();
      expect(file).toMatchObject({
        status: "deleted",
        expiresAt: Date.parse(creationTime),
      });
      return batch;
    });
    await expect(
      owner.mutation(api.imports.commit, { batchId: expiredBatch._id }),
    ).rejects.toThrow("writes are disabled");
    vi.stubEnv("MIGRATION_MODE", "");
    const committed = await owner.mutation(api.imports.commit, {
      batchId: expiredBatch._id,
    });
    expect(committed.sequence).toBeGreaterThan(Date.parse(creationTime));
    await t.action(internal.actions.publishPortfolio.publishPortfolio, {
      versionId: committed.versionId,
      attempt: 1,
    });
    const positions = await owner.query(api.portfolio.positions);
    expect(first(positions.current)).toMatchObject({
      quantity: "99",
      currentValue: "777",
    });
    await expect(
      owner.mutation(api.imports.commit, { batchId: expiredBatch._id }),
    ).resolves.toMatchObject({
      status: "committed",
      versionId: committed.versionId,
    });
    const historical = await t.run(async (ctx) =>
      (await ctx.db.query("importBatches").collect()).find(
        (batch) => batch.legacyId === uuid(51),
      ),
    );
    if (!historical) throw new Error("Missing migrated committed batch");
    await expect(
      owner.mutation(api.imports.commit, { batchId: historical._id }),
    ).resolves.toMatchObject({ status: "committed" });
  });

  it("freezes provisioning, cleanup, and rate refresh while verification runs", async () => {
    const t = await migrate();
    await expect(
      t
        .withIdentity({ ...ownerIdentity, subject: "new_fake_identity" })
        .mutation(api.users.ensureCurrent),
    ).rejects.toThrow("writes are disabled");
    await t.mutation(internal.importCleanup.expireFiles);
    await t.mutation(internal.publicationCleanup.sweep, { cursor: null });
    await expect(
      t.action(internal.actions.refreshCurrencyRate.refreshCurrencyRate),
    ).resolves.toEqual({ outcome: "superseded", attempts: 0 });
    expect(await t.action(internal.migrationAudit.audit, { runKey })).toEqual({
      ok: true,
      findings: [],
    });
  });

  it("reports tampered actual target values instead of trusting retained source JSON", async () => {
    const t = await migrate();
    await t.run(async (ctx) => {
      const holding = first(await ctx.db.query("holdingSnapshots").collect());
      const fact = decodeFact(holding.factJson);
      await ctx.db.patch("holdingSnapshots", holding._id, {
        factJson: JSON.stringify({
          ...fact,
          row: { ...fact.row, currentValue: "151" },
        }),
      });
    });
    const report = await t.action(internal.migrationAudit.audit, { runKey });
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      expect.stringContaining("holding_snapshots/" + uuid(71)),
    ]);
  });

  it("rejects foreign references and logical account collisions transactionally", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("MIGRATION_MODE", "synthetic");
    const tables = fixtures();
    tables.accounts.push({ ...first(tables.accounts), id: uuid(33) });
    const t = convexTest(schema, modules);
    await t.mutation(internal.migration.begin, beginArguments(tables));
    for (const table of ["users", "households", "household_members"] as const)
      for (const row of tables[table])
        await t.mutation(internal.migration.loadRecord, {
          runKey,
          legacyTable: table,
          rowJson: JSON.stringify(row),
        });
    await expect(
      t.mutation(internal.migration.loadRecord, {
        runKey,
        legacyTable: "accounts",
        rowJson: JSON.stringify({
          ...first(tables.accounts),
          household_id: uuid(999),
        }),
      }),
    ).rejects.toThrow("Missing or ambiguous");
    await t.mutation(internal.migration.loadRecord, {
      runKey,
      legacyTable: "accounts",
      rowJson: JSON.stringify(first(tables.accounts)),
    });
    await expect(
      t.mutation(internal.migration.loadRecord, {
        runKey,
        legacyTable: "accounts",
        rowJson: JSON.stringify({ ...first(tables.accounts), id: uuid(33) }),
      }),
    ).rejects.toThrow("canonical key collision");
    expect(
      await t.run((ctx) => ctx.db.query("accounts").collect()),
    ).toHaveLength(1);
    await expect(
      t.mutation(internal.migration.completeRun, { runKey }),
    ).rejects.toThrow("record counts");
  });

  it("preserves orphan-instrument transactions but blocks publication and cutover", async () => {
    const tables = fixtures();
    first(tables.transactions).instrument_id = null;
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("MIGRATION_MODE", "synthetic");
    const t = convexTest(schema, modules);
    await t.mutation(internal.migration.begin, beginArguments(tables));
    for (const table of legacyTables)
      for (const row of tables[table])
        await t.mutation(internal.migration.loadRecord, {
          runKey,
          legacyTable: table,
          rowJson: JSON.stringify(row),
        });
    for (const row of tables.import_batches)
      await t.action(internal.migration.finalizeBatch, {
        runKey,
        legacyBatchId: String(row.id),
      });
    await expect(
      t.mutation(internal.migration.completeRun, { runKey }),
    ).rejects.toThrow("without instruments");
    const record = await t.run((ctx) =>
      ctx.db
        .query("migrationRecords")
        .withIndex("by_runKey_and_legacyTable_and_legacyId", (q) =>
          q
            .eq("runKey", runKey)
            .eq("legacyTable", "transactions")
            .eq("legacyId", uuid(80)),
        )
        .unique(),
    );
    expect(record?.unsupportedReason).toBe("transaction_without_instrument");
    expect(
      await t.run((ctx) => ctx.db.query("transactions").collect()),
    ).toHaveLength(0);
  });

  it("checks copied bytes and expiry, retains a claimed object on replay, and deletes a rejected upload", async () => {
    const tables = fixtures();
    const batch = first(tables.import_batches);
    batch.expires_at = "2025-07-01T00:00:00.000Z";
    const bytes = "generated source bytes";
    batch.file_hash = digest(bytes);
    const args = beginArguments(tables);
    const manifest = sourceFileManifestSchema.parse(
      parseJson(args.sourceFilesJson),
    );
    const file = first(manifest);
    file.status = "available";
    file.contentHash = digest(bytes);
    file.sizeBytes = new TextEncoder().encode(bytes).byteLength;
    args.sourceFilesJson = JSON.stringify(manifest);
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("MIGRATION_MODE", "synthetic");
    const t = convexTest(schema, modules);
    await t.mutation(internal.migration.begin, args);
    for (const table of [
      "users",
      "households",
      "household_members",
      "import_batches",
    ] as const)
      for (const row of tables[table])
        await t.mutation(internal.migration.loadRecord, {
          runKey,
          legacyTable: table,
          rowJson: JSON.stringify(row),
        });
    const rejected = await t.run((ctx) =>
      ctx.storage.store(new Blob(["wrong bytes"])),
    );
    await expect(
      t.action(internal.migration.attachFile, {
        runKey,
        legacyBatchId: uuid(51),
        storageId: rejected,
        contentHash: digest(bytes),
        sizeBytes: file.sizeBytes,
      }),
    ).rejects.toThrow("checksum or byte size");
    expect(await t.run((ctx) => ctx.storage.get(rejected))).toBeNull();
    const stored = await t.run((ctx) => ctx.storage.store(new Blob([bytes])));
    const claim = {
      runKey,
      legacyBatchId: uuid(51),
      storageId: stored,
      contentHash: digest(bytes),
      sizeBytes: file.sizeBytes,
    };
    await t.action(internal.migration.attachFile, claim);
    await t.action(internal.migration.attachFile, claim);
    expect(
      await t.query(internal.migration.fileState, {
        runKey,
        legacyBatchId: uuid(51),
      }),
    ).toMatchObject({
      status: "stored",
      storageId: stored,
      contentHash: digest(bytes),
      sizeBytes: file.sizeBytes,
      expiresAt: Date.parse("2025-07-01T00:00:00.000Z"),
    });
    expect(
      await t.mutation(internal.migration.fileUploadUrl, {
        runKey,
        legacyBatchId: uuid(51),
      }),
    ).toBeNull();
  });
});
