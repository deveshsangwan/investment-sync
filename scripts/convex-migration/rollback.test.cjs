const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const test = require("node:test");
const {
  createRollbackFixture,
  CREATED_AT,
  appendCommittedBatch,
  holding,
} = require("./rollback-fixtures.cjs");
const {
  buildReverseReplayPlan,
  deterministicUuid,
  scaled,
  verifyNoConvexWrites,
} = require("./reverse-replay.cjs");
const { normalizeSqlTables } = require("./reverse-replay-postgres.cjs");
const { orderedHoldingUuid } = require("./reverse-replay-facts.cjs");

function appendChartBatch(
  fixture,
  batchId,
  sequence,
  values,
  committedAt,
  { householdId = "household-new", startIndex = 0, investedValues } = {},
) {
  const tables = fixture.targetSnapshot.tables;
  const accountId = `chart-account-${householdId}`;
  if (!tables.accounts.some((row) => row._id === accountId))
    tables.accounts.push({
      _id: accountId,
      _creationTime: committedAt,
      householdId,
      name: "Generated chart",
      provider: "Synthetic",
      accountType: "broker",
      currency: "INR",
    });
  const rows = values.map((amount, index) => {
    const symbol = `CHART${startIndex + index}`;
    if (
      !tables.instruments.some(
        (row) => row.householdId === householdId && row.symbol === symbol,
      )
    )
      tables.instruments.push({
        _id: `chart-instrument-${householdId}-${symbol}`,
        _creationTime: committedAt,
        householdId,
        name: symbol,
        symbol,
        assetClass: "indian_stock",
        currency: "INR",
      });
    return {
      ...holding("2026-01-04", investedValues?.[index] ?? amount, amount),
      accountName: "Generated chart",
      instrumentName: symbol,
      symbol,
      assetClass: "indian_stock",
      currency: "INR",
    };
  });
  appendCommittedBatch(
    fixture.targetSnapshot,
    batchId,
    householdId,
    householdId === "household-old" ? "user-old" : "user-new",
    sequence,
    rows,
    committedAt,
  );
}

function compareChartHelpers(
  fixture,
  plan,
  householdTargetId = "household-new",
  overrideIds,
) {
  require("tsx/cjs");
  const {
    buildPortfolioPublication,
    valuePortfolioPublication,
  } = require("../../packages/portfolio-domain/src/index.ts");
  const {
    aggregateSnapshotTotalsByDate,
    roundMoney,
  } = require("../../packages/api/src/services/portfolio/utils.ts");
  const facts = [
    "holdingSnapshots",
    "transactions",
    "portfolioValuations",
  ].flatMap((table) =>
    fixture.targetSnapshot.tables[table]
      .filter((row) => row.householdId === householdTargetId)
      .map((row) => JSON.parse(row.factJson)),
  );
  const publication = buildPortfolioPublication({ existingFacts: facts });
  const native = valuePortfolioPublication(
    publication.projection,
    {
      status: "fresh",
      rate: "82.25",
      fetchedAt: fixture.targetSnapshot.evaluationTime,
      provider: "frankfurter",
    },
    { view: "assetClassDetail", assetClass: "indian_stock" },
  );
  const householdId =
    fixture.targetSnapshot.mappings.find(
      (mapping) =>
        mapping.targetTable === "households" &&
        mapping.targetId === householdTargetId,
    )?.legacyId ?? deterministicUuid("households", householdTargetId);
  const rows = plan.tables.holding_snapshots
    .filter(
      (row) =>
        row.household_id === householdId && row.snapshot_date === "2026-01-04",
    )
    .map((row) => {
      const account = plan.tables.accounts.find(
        (value) => value.id === row.account_id,
      );
      const instrument = plan.tables.instruments.find(
        (value) => value.id === row.instrument_id,
      );
      return {
        id: overrideIds?.get(instrument.symbol) ?? row.id,
        createdAt: `${row.created_at.replace(/Z$/, "").split(".")[0]}.${(row.created_at.replace(/Z$/, "").split(".")[1] ?? "").padEnd(6, "0")}`,
        accountId: row.account_id,
        instrumentId: row.instrument_id,
        snapshotDate: row.snapshot_date,
        investedAmount: row.invested_amount,
        currentValue: row.current_value,
        currency: row.currency,
        sourcePayload: row.source_payload,
        sourceSheet: row.source_payload.sourceSheet ?? "",
        accountName: account.name,
        provider: account.provider,
        instrumentName: instrument.name,
        assetClass: instrument.asset_class,
      };
    })
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  const old = aggregateSnapshotTotalsByDate(rows).get("2026-01-04");
  return {
    native: native.timeline.find((point) =>
      point.snapshotDate.startsWith("2026-01-04"),
    ),
    legacy: {
      investedAmount: roundMoney(old.investedAmount),
      currentValue: roundMoney(old.currentValue),
    },
  };
}

test("new multi-row holding IDs preserve native chart accumulation order in independent legacy helpers", () => {
  const fixture = createRollbackFixture();
  appendChartBatch(
    fixture,
    "chart-order-7",
    2,
    ["1", "1", "9007199254740992"],
    Date.parse("2026-01-03T12:00:00Z"),
  );
  const plan = buildReverseReplayPlan(fixture);
  const result = compareChartHelpers(fixture, plan);
  assert.equal(result.native.currentValue, 9007199254740994);
  assert.equal(result.legacy.currentValue, result.native.currentValue);
  assert.equal(result.legacy.investedAmount, result.native.investedAmount);
  const originalIds = new Map(
    fixture.targetSnapshot.tables.holdingSnapshots
      .filter((row) => row.batchId === "chart-order-7")
      .map((row) => [
        JSON.parse(row.factJson).row.symbol,
        deterministicUuid("holding_snapshots", row._id),
      ]),
  );
  assert.equal(
    compareChartHelpers(fixture, plan, "household-new", originalIds).legacy
      .currentValue,
    9007199254740992,
  );
  assert.equal(
    plan.replayDigest,
    buildReverseReplayPlan(structuredClone(fixture)).replayDigest,
  );
});

test("holding UUID order covers equal commit clocks across batches and scopes identical row ordinals by household", () => {
  const fixture = createRollbackFixture();
  const committedAt = Date.parse("2026-01-03T12:00:00Z");
  appendChartBatch(fixture, "chart-equal-clock-a", 2, ["1"], committedAt);
  appendChartBatch(fixture, "chart-equal-clock-b", 3, ["1"], committedAt, {
    startIndex: 1,
  });
  appendChartBatch(
    fixture,
    "chart-equal-clock-c",
    4,
    ["9007199254740992"],
    committedAt,
    { startIndex: 2 },
  );
  appendChartBatch(fixture, "chart-other-household", 2, ["1"], committedAt, {
    householdId: "household-old",
  });
  const plan = buildReverseReplayPlan(fixture);
  const result = compareChartHelpers(fixture, plan);
  assert.equal(result.native.currentValue, 9007199254740994);
  assert.equal(result.legacy.currentValue, result.native.currentValue);
  const ids = plan.tables.holding_snapshots.map((row) => row.id);
  assert.equal(ids.length, new Set(ids).size);
});

test("same-date corrections keep first-creation IDs and native chart order", () => {
  const fixture = createRollbackFixture();
  const committedAt = Date.parse("2026-01-03T12:00:00Z");
  appendChartBatch(
    fixture,
    "chart-before-update",
    2,
    ["9007199254740992", "1", "1"],
    committedAt,
  );
  const original = buildReverseReplayPlan(fixture);
  appendChartBatch(
    fixture,
    "chart-after-update",
    3,
    ["9007199254740996"],
    committedAt + 1000,
    { investedValues: ["9007199254740992"] },
  );
  const plan = buildReverseReplayPlan(fixture);
  const result = compareChartHelpers(fixture, plan);
  assert.equal(result.legacy.currentValue, result.native.currentValue);
  const originalIds = new Set(
    original.tables.holding_snapshots.map((row) => row.id),
  );
  assert.ok(
    plan.tables.holding_snapshots.every((row) => originalIds.has(row.id)),
  );
  const corrected = plan.tables.holding_snapshots.find(
    (row) =>
      row.import_batch_id ===
      plan.newCommittedBatches.find(
        (batch) => batch.targetBatchId === "chart-after-update",
      ).legacyBatchId,
  );
  assert.equal(corrected.current_value, "9007199254740996");
  assert.equal(
    corrected.created_at,
    original.tables.holding_snapshots.find((row) => row.id === corrected.id)
      .created_at,
  );
});

test("mapped old holding upserts preserve arbitrary archived UUIDs, microsecond timestamps, and chart order", () => {
  const fixture = createRollbackFixture();
  const committedAt = Date.parse("2026-01-03T12:00:00Z");
  const batchTargetId = "chart-archived";
  appendChartBatch(
    fixture,
    batchTargetId,
    3,
    ["9007199254740992", "1", "1"],
    committedAt,
    { householdId: "household-old" },
  );
  const initial = buildReverseReplayPlan(fixture);
  const batch = initial.tables.import_batches.find(
    (row) =>
      row.id ===
      initial.newCommittedBatches.find(
        (value) => value.targetBatchId === batchTargetId,
      ).legacyBatchId,
  );
  const register = (legacyTable, targetTable, target, source) => {
    fixture.sourceSnapshot.tables[legacyTable].push(source);
    fixture.targetSnapshot.mappings.push({
      legacyTable,
      legacyId: source.id,
      targetTable,
      targetId: target._id,
      sourceJson: JSON.stringify(source),
    });
    target.legacyId = source.id;
  };
  register(
    "import_batches",
    "importBatches",
    fixture.targetSnapshot.tables.importBatches.find(
      (row) => row._id === batchTargetId,
    ),
    batch,
  );
  fixture.sourceSnapshot.tables.import_rows.push(
    ...initial.tables.import_rows.filter(
      (row) => row.import_batch_id === batch.id,
    ),
  );
  const account = initial.tables.accounts.find(
    (row) => row.name === "Generated chart",
  );
  register(
    "accounts",
    "accounts",
    fixture.targetSnapshot.tables.accounts.find(
      (row) => row._id === "chart-account-household-old",
    ),
    account,
  );
  for (const [index, doc] of fixture.targetSnapshot.tables.holdingSnapshots
    .filter((row) => row.batchId === batchTargetId)
    .entries()) {
    const fact = JSON.parse(doc.factJson);
    const instrument = initial.tables.instruments.find(
      (row) => row.symbol === fact.row.symbol,
    );
    register(
      "instruments",
      "instruments",
      fixture.targetSnapshot.tables.instruments.find(
        (row) =>
          row.householdId === doc.householdId && row.symbol === fact.row.symbol,
      ),
      instrument,
    );
    const source = {
      ...initial.tables.holding_snapshots.find(
        (row) => row.instrument_id === instrument.id,
      ),
      id: deterministicUuid("holding_snapshots", `archived-${fact.row.symbol}`),
      created_at: `2026-01-03T12:00:00.000${index + 1}00Z`,
    };
    register("holding_snapshots", "holdingSnapshots", doc, source);
    fact.provenance = {
      ...fact.provenance,
      legacyId: source.id,
      batchId: batch.id,
      sequence: Date.parse(source.created_at),
      rowNumber: index + 1,
    };
    doc.factJson = JSON.stringify(fact);
  }

  const archived = normalizeSqlTables(
    fixture.sourceSnapshot.tables,
  ).holding_snapshots;
  appendChartBatch(
    fixture,
    "chart-archived-correction",
    committedAt + 1,
    ["9007199254740996"],
    committedAt + 1000,
    { householdId: "household-old", investedValues: ["9007199254740992"] },
  );
  const plan = buildReverseReplayPlan(fixture);
  const result = compareChartHelpers(fixture, plan, "household-old");
  assert.equal(result.legacy.currentValue, result.native.currentValue);
  assert.equal(result.legacy.investedAmount, result.native.investedAmount);
  for (const row of archived) {
    const restored = plan.tables.holding_snapshots.find(
      (value) => value.id === row.id,
    );
    assert.equal(restored.created_at, row.created_at);
    assert.equal(restored.invested_amount, row.invested_amount);
  }
});

test("rejects a cross-batch clock reversal that cannot retain native chart order without changing timestamps", () => {
  const fixture = createRollbackFixture();
  const committedAt = Date.parse("2026-01-03T12:00:00Z");
  appendChartBatch(fixture, "chart-clock-later", 2, ["1"], committedAt + 1000);
  appendChartBatch(
    fixture,
    "chart-clock-earlier",
    3,
    ["9007199254740992"],
    committedAt,
    { startIndex: 1 },
  );
  assert.throws(() => buildReverseReplayPlan(fixture), {
    code: "holding_chart_order_not_reversible",
  });
});

test("ordered holding UUIDs retain full safe sequences and reject row counts outside the encoded deployment bound", () => {
  const doc = {
    householdId: "generated-household",
    batchId: "generated-batch",
    _id: "generated-fact",
  };
  const first = orderedHoldingUuid(doc, {
    sequence: Number.MAX_SAFE_INTEGER,
    rowNumber: 2046,
  });
  const second = orderedHoldingUuid(
    { ...doc, _id: "next-fact" },
    { sequence: Number.MAX_SAFE_INTEGER, rowNumber: 2047 },
  );
  assert.match(
    first,
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  assert.ok(first < second);
  assert.throws(
    () => orderedHoldingUuid(doc, { sequence: 1, rowNumber: 2048 }),
    { code: "holding_chart_order_not_reversible" },
  );
});

test("replays multiple commits, a parsed expired-file batch, and a new identity without source bytes", () => {
  const fixture = createRollbackFixture();
  const plan = buildReverseReplayPlan(fixture);
  assert.equal(plan.newCommittedBatches.length, 3);
  assert.equal(plan.counts.users, 2);
  assert.equal(plan.counts.households, 2);
  assert.equal(plan.counts.instruments, 1);
  assert.equal(plan.counts.holding_snapshots, 3);
  assert.equal(plan.counts.transactions, 1);
  assert.equal(plan.counts.import_rows, 4);
  assert.equal(plan.tables.users[0].created_at, CREATED_AT);
  assert.equal(plan.tables.transactions[0].amount, "2.125");
  assert.equal(plan.tables.transactions[0].metadata.sourceLine, 2);
  assert.ok(
    plan.tables.import_batches.every(
      (row) => row.storage_path === null && row.status === "committed",
    ),
  );
  assert.equal(
    plan.replayDigest,
    buildReverseReplayPlan(structuredClone(fixture)).replayDigest,
  );
  assert.equal(
    plan.targetDigest,
    buildReverseReplayPlan(structuredClone(fixture)).targetDigest,
  );
});

test("rejects the approved identical-occurrence correction when the old unique key would collapse it", () => {
  const fixture = createRollbackFixture();
  const original = JSON.parse(
    fixture.targetSnapshot.tables.transactions[0].factJson,
  ).row;
  appendCommittedBatch(
    fixture.targetSnapshot,
    "batch-identical-sales",
    "household-old",
    "user-old",
    3,
    [original, original],
    Date.parse("2026-01-03T12:00:00Z"),
  );
  assert.throws(() => buildReverseReplayPlan(fixture), {
    code: "identical_same_day_transaction_occurrences_not_reversible",
  });
});

test("does not convert an exact source amount into a rounded JS numeric normalized row", () => {
  const fixture = createRollbackFixture();
  appendCommittedBatch(
    fixture.targetSnapshot,
    "batch-precise",
    "household-new",
    "user-new",
    2,
    [holding("2026-01-04", "12345678901234.1234", "12345678901235.1234")],
    Date.parse("2026-01-03T12:00:00Z"),
  );
  assert.throws(() => buildReverseReplayPlan(fixture), {
    code: "normalized_row_not_losslessly_representable",
  });
});

test("retains lossless normalized quantities that JS formats with an exponent", () => {
  const fixture = createRollbackFixture();
  const row = holding("2026-01-04", "10", "11");
  row.quantity = "0.0000000001";
  appendCommittedBatch(
    fixture.targetSnapshot,
    "batch-small-quantity",
    "household-new",
    "user-new",
    2,
    [row],
    Date.parse("2026-01-03T12:00:00Z"),
  );
  const plan = buildReverseReplayPlan(fixture);
  assert.equal(
    plan.tables.holding_snapshots.find(
      (fact) => fact.snapshot_date === "2026-01-04",
    ).quantity,
    "0.0000000001",
  );
});

test("rejects corrupted chunks and committed facts missing from an otherwise complete batch", () => {
  const corrupted = createRollbackFixture();
  corrupted.targetSnapshot.tables.importRowChunks[0].digest = "0".repeat(64);
  assert.throws(() => buildReverseReplayPlan(corrupted), {
    code: "invalid_normalized_chunk",
  });

  const missing = createRollbackFixture();
  missing.targetSnapshot.tables.holdingSnapshots.pop();
  assert.throws(() => buildReverseReplayPlan(missing), {
    code: "conflicting_publication_fact_payload",
  });
});

test("keeps rollback blocked when a new holdings source uses completeness metadata absent from old SQL", () => {
  const fixture = createRollbackFixture();
  const row = holding("2026-01-04", "10", "11");
  row.source.completeness = "partial";
  appendCommittedBatch(
    fixture.targetSnapshot,
    "batch-partial",
    "household-new",
    "user-new",
    2,
    [row],
    Date.parse("2026-01-03T12:00:00Z"),
  );
  assert.throws(() => buildReverseReplayPlan(fixture), {
    code: "source_metadata_not_reconstructible_in_postgres",
  });
});

test("rejects crossed ownership and publication attempts still in flight", () => {
  const crossed = createRollbackFixture();
  crossed.targetSnapshot.tables.sourceFiles[0].householdId = "household-new";
  assert.throws(() => buildReverseReplayPlan(crossed), {
    code: "invalid_source_file_ownership",
  });

  const pending = createRollbackFixture();
  pending.targetSnapshot.tables.importBatches[0].status = "publishing";
  assert.throws(() => buildReverseReplayPlan(pending), {
    code: "target_writes_not_drained",
  });
});

test("requires restored downloads for a new source file that remains available", () => {
  const fixture = createRollbackFixture();
  const file = fixture.targetSnapshot.tables.sourceFiles[1];
  file.status = "available";
  file.expiresAt = Date.parse("2026-01-05T00:00:00Z");
  assert.throws(() => buildReverseReplayPlan(fixture), {
    code: "available_source_file_not_restored",
  });
  fixture.targetSnapshot.reverseStorageMappings = [
    {
      batchId: file.batchId,
      storagePath: "synthetic/restored.csv",
      contentHash: file.contentHash,
      sizeBytes: file.sizeBytes,
    },
  ];
  const plan = buildReverseReplayPlan(fixture);
  assert.equal(
    plan.tables.import_batches.find(
      (row) => row.original_file_name === "batch-second.csv",
    ).storage_path,
    "synthetic/restored.csv",
  );
});

test("validates native archival row mappings without treating archive records as SQL identities", () => {
  const fixture = createRollbackFixture();
  const source = fixture.sourceSnapshot.tables.import_rows[0];
  const record = {
    _id: "archive-normalized-row",
    _creationTime: Date.parse(CREATED_AT),
    legacyTable: "import_rows",
    legacyId: source.id,
    sourceJson: JSON.stringify(source),
  };
  fixture.targetSnapshot.tables.migrationRecords = [record];
  fixture.targetSnapshot.mappings.push({
    legacyTable: "import_rows",
    legacyId: source.id,
    targetTable: "migrationRecords",
    targetId: record._id,
    sourceJson: record.sourceJson,
  });
  assert.equal(buildReverseReplayPlan(fixture).counts.import_rows, 4);
  fixture.targetSnapshot.mappings.at(-1).targetTable = "users";
  assert.throws(() => buildReverseReplayPlan(fixture), {
    code: "unsupported_id_mapping_target",
  });
});

test("requires restored bytes for actual native stored and delete_failed source files", () => {
  for (const status of ["stored", "delete_failed"]) {
    const fixture = createRollbackFixture();
    const file = fixture.targetSnapshot.tables.sourceFiles[1];
    file.status = status;
    file.expiresAt = Date.parse("2026-01-05T00:00:00Z");
    assert.throws(() => buildReverseReplayPlan(fixture), {
      code: "available_source_file_not_restored",
    });
    fixture.targetSnapshot.reverseStorageMappings = [
      {
        batchId: file.batchId,
        storagePath: "synthetic/native-restored.csv",
        contentHash: file.contentHash,
        sizeBytes: file.sizeBytes,
      },
    ];
    assert.equal(
      buildReverseReplayPlan(fixture).tables.import_batches.find(
        (row) => row.original_file_name === "batch-second.csv",
      ).storage_path,
      "synthetic/native-restored.csv",
    );
  }
});

test("requires the same immutable normalized source rows and valid published receipts", () => {
  const changed = createRollbackFixture();
  const chunk = changed.targetSnapshot.tables.importRowChunks[0];
  const rows = JSON.parse(chunk.rowsJson);
  rows[0].currentValue = "999";
  chunk.rowsJson = JSON.stringify(rows);
  chunk.bytes = Buffer.byteLength(chunk.rowsJson);
  chunk.digest = nodeCrypto
    .createHash("sha256")
    .update(chunk.rowsJson)
    .digest("hex");
  assert.throws(() => buildReverseReplayPlan(changed), {
    code: "legacy_normalized_rows_changed",
  });

  const missing = createRollbackFixture();
  missing.targetSnapshot.tables.portfolioVersions[0].rootDigest = undefined;
  assert.throws(() => buildReverseReplayPlan(missing), {
    code: "missing_commit_receipt",
  });
});

test("decimal scaling follows Postgres half-up precision without a floating point conversion", () => {
  assert.equal(scaled("12345678901234.12345", 4), "12345678901234.1235");
  assert.equal(scaled("-1.23455", 4), "-1.2346");
  assert.equal(scaled("-0.00001", 4), "0");
  assert.throws(() => scaled("1000000000000000000000000", 4), {
    code: "numeric_capacity_exceeded",
  });
});

test("retains archived microsecond timestamps and exact persisted decimal strings", () => {
  const fixture = createRollbackFixture();
  const normalized = normalizeSqlTables(fixture.sourceSnapshot.tables);
  assert.equal(normalized.users[0].created_at, CREATED_AT);
});

test("accepts actual Convex fractional-millisecond creation times at Postgres microsecond precision", () => {
  const fixture = createRollbackFixture();
  const user = fixture.targetSnapshot.tables.users.find(
    (row) => row._id === "user-new",
  );
  user._creationTime = 1767398400000.125;
  const plan = buildReverseReplayPlan(fixture);
  assert.equal(
    plan.tables.users.find((row) => row.clerk_user_id === user.clerkSubject)
      .created_at,
    "2026-01-03T00:00:00.000125Z",
  );
});

test("validates migrated persisted facts independently of rounded normalized rows and preserves batchless legacy valuations", () => {
  const fixture = createRollbackFixture();
  const published = buildReverseReplayPlan(fixture);
  const batch = fixture.sourceSnapshot.tables.import_batches[0];
  batch.status = "committed";
  batch.committed_at = published.tables.import_batches.find(
    (row) => row.id === batch.id,
  ).committed_at;
  fixture.targetSnapshot.mappings.find(
    (mapping) => mapping.legacyTable === "import_batches",
  ).sourceJson = JSON.stringify(batch);
  fixture.sourceSnapshot.tables.import_rows[0].is_committed = true;
  const doc = fixture.targetSnapshot.tables.holdingSnapshots[0];
  const source = published.tables.holding_snapshots.find(
    (row) =>
      row.id === orderedHoldingUuid(doc, JSON.parse(doc.factJson).provenance),
  );
  source.invested_amount = "9007199254740993.1234";
  fixture.sourceSnapshot.tables.holding_snapshots.push(source);
  const fact = JSON.parse(doc.factJson);
  fact.row.investedAmount = source.invested_amount;
  fact.row.metadata.exchange = "TEST";
  fact.provenance = {
    ...fact.provenance,
    legacyId: source.id,
    batchId: batch.id,
    sequence: Date.parse(source.created_at),
  };
  doc.legacyId = source.id;
  doc.factJson = JSON.stringify(fact);
  fixture.targetSnapshot.mappings.push({
    legacyTable: "holding_snapshots",
    legacyId: source.id,
    targetTable: "holdingSnapshots",
    targetId: doc._id,
    sourceJson: JSON.stringify(source),
  });
  const valuation = {
    id: deterministicUuid("portfolio_valuations", "source-valuation"),
    household_id: source.household_id,
    valuation_date: "2026-01-01",
    invested_amount: "9007199254740993.1234",
    current_value: "9007199254740994.1234",
    pnl_amount: "1",
    currency: "USD",
    metadata: {},
    created_at: CREATED_AT,
  };
  fixture.sourceSnapshot.tables.portfolio_valuations.push(valuation);
  fixture.targetSnapshot.tables.portfolioValuations.push({
    _id: "legacy-valuation",
    _creationTime: Date.parse(CREATED_AT),
    householdId: doc.householdId,
    legacyId: valuation.id,
    factJson: JSON.stringify({
      row: {
        kind: "valuation",
        sourceType: "investment_portfolio_xlsx",
        valuationDate: valuation.valuation_date,
        investedAmount: valuation.invested_amount,
        currentValue: valuation.current_value,
        pnlAmount: valuation.pnl_amount,
        currency: valuation.currency,
        metadata: {},
        source: {
          group: "",
          completeness: "complete",
          granularity: "portfolio",
          priority: 0,
        },
        numericProvenance: {
          investedAmount: "persisted_decimal",
          currentValue: "persisted_decimal",
          pnlAmount: "persisted_decimal",
        },
      },
      provenance: {
        legacyId: valuation.id,
        batchId: `legacy:${valuation.id}`,
        parserVersion: "legacy-postgres",
        sequence: Date.parse(CREATED_AT),
        rowNumber: 100,
        fallbackDate: "2026-01-01",
      },
    }),
  });
  fixture.targetSnapshot.mappings.push({
    legacyTable: "portfolio_valuations",
    legacyId: valuation.id,
    targetTable: "portfolioValuations",
    targetId: "legacy-valuation",
    sourceJson: JSON.stringify(valuation),
  });

  const plan = buildReverseReplayPlan(fixture);
  assert.equal(
    plan.tables.holding_snapshots.find((row) => row.id === source.id)
      .invested_amount,
    source.invested_amount,
  );
  assert.deepEqual(
    plan.tables.portfolio_valuations.find((row) => row.id === valuation.id),
    valuation,
  );
  fact.row.investedAmount = "9007199254740993.1235";
  doc.factJson = JSON.stringify(fact);
  assert.throws(() => buildReverseReplayPlan(fixture), {
    code: "changed_migrated_fact_values",
  });
  fact.row.investedAmount = source.invested_amount;
  fact.row.pnlPercent = 25;
  doc.factJson = JSON.stringify(fact);
  assert.throws(() => buildReverseReplayPlan(fixture), {
    code: "changed_migrated_fact_values",
  });
});

test("requires the actual publication root manifest and complete matching stage receipts", () => {
  const check = (mutate, code) => {
    const fixture = createRollbackFixture();
    mutate(fixture.targetSnapshot.tables);
    assert.throws(() => buildReverseReplayPlan(fixture), { code });
  };
  check((tables) => {
    tables.publicationReceipts = [];
  }, "incomplete_publication_receipts");
  check((tables) => {
    tables.publicationReceipts.pop();
  }, "incomplete_publication_receipts");
  check((tables) => {
    tables.publicationReceipts[0].digest = "0".repeat(64);
  }, "conflicting_publication_receipt");
  check((tables) => {
    tables.portfolioVersions[0].rootDigest = "0".repeat(64);
  }, "invalid_publication_root_manifest");
  check((tables) => {
    tables.portfolioVersions[0].rootManifest[0].index = 1;
  }, "invalid_publication_root_manifest");
  check((tables) => {
    tables.publicationReceipts[1] = {
      ...tables.publicationReceipts[0],
      _id: "conflicting-receipt",
    };
  }, "conflicting_publication_receipt");
  check((tables) => {
    tables.publicationReceipts.find(
      (receipt) => receipt.stage === "facts",
    ).payloadJson = "[]";
  }, "conflicting_publication_fact_payload");
});

test("refuses same-date cross-account holdings whose arbitrary new SQL UUID order could change selection", () => {
  const fixture = createRollbackFixture();
  const epoch = Date.parse("2026-01-03T12:00:00Z");
  for (const [index, name] of ["Generated A", "Generated B"].entries()) {
    fixture.targetSnapshot.tables.accounts.push({
      _id: `cross-account-${index}`,
      _creationTime: epoch,
      householdId: "household-new",
      name,
      provider: "Synthetic",
      accountType: "broker",
      currency: "USD",
    });
    const row = holding("2026-01-04", "100", index === 0 ? "100" : "200");
    row.accountName = name;
    appendCommittedBatch(
      fixture.targetSnapshot,
      index === 0 ? "cross-A" : "cross-B",
      "household-new",
      "user-new",
      index + 2,
      [row],
      epoch + index,
    );
  }
  assert.throws(() => buildReverseReplayPlan(fixture), {
    code: "holding_selection_tie_not_reversible",
  });
});

test("preserves a currency quote's UTC microseconds", () => {
  const fixture = createRollbackFixture();
  fixture.sourceSnapshot.tables.currency_rates.push({
    id: deterministicUuid("currency_rates", "source"),
    base: "USD",
    quote: "INR",
    rate: "82.2500000000",
    provider: "frankfurter",
    fetched_at: CREATED_AT,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  });
  fixture.targetSnapshot.tables.currencyRates.push({
    _id: "rate-old",
    _creationTime: Date.parse(CREATED_AT),
    base: "USD",
    quote: "INR",
    rate: "82.25",
    provider: "frankfurter",
    status: "fresh",
    fetchedAt: CREATED_AT,
    refreshRevision: 0,
  });
  const plan = buildReverseReplayPlan(fixture);
  assert.equal(plan.tables.currency_rates[0].rate, "82.25");
  assert.equal(plan.tables.currency_rates[0].fetched_at, CREATED_AT);
});

test("before-write rollback requires an unchanged Convex target, including new identity writes", () => {
  const fixture = createRollbackFixture();
  const initial = fixture.targetSnapshot;
  const current = structuredClone(initial);
  current.evaluationTime = "2026-01-05T00:00:00Z";
  assert.equal(verifyNoConvexWrites(initial, current).unchanged, true);
  current.tables.users.push({
    _id: "post-cutover-user",
    _creationTime: Date.parse(current.evaluationTime),
    clerkSubject: "synthetic_post_cutover",
  });
  assert.throws(() => verifyNoConvexWrites(initial, current), {
    code: "convex_only_writes_detected",
  });
});

test("restores the first source ISIN for a newly created global instrument", () => {
  const fixture = createRollbackFixture();
  const row = holding("2026-01-04", "10", "11");
  row.symbol = "NEWFAKE";
  row.isin = "SYNTHETIC-ISIN";
  fixture.targetSnapshot.tables.instruments.push({
    _id: "instrument-with-isin",
    _creationTime: Date.parse("2026-01-03T12:00:00Z"),
    householdId: "household-new",
    name: row.instrumentName,
    symbol: row.symbol,
    assetClass: row.assetClass,
    currency: row.currency,
  });
  appendCommittedBatch(
    fixture.targetSnapshot,
    "batch-isin",
    "household-new",
    "user-new",
    2,
    [row],
    Date.parse("2026-01-03T12:00:00Z"),
  );
  const plan = buildReverseReplayPlan(fixture);
  assert.equal(
    plan.tables.instruments.find(
      (instrument) => instrument.symbol === "NEWFAKE",
    ).isin,
    row.isin,
  );
});
