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
    (row) => row.id === deterministicUuid("holding_snapshots", doc._id),
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
