const nodeCrypto = require("node:crypto");
const { TABLE_COLUMNS } = require("./reverse-replay-postgres.cjs");
const { TARGET_TABLES, deterministicUuid } = require("./reverse-replay.cjs");

const CREATED_AT = "2026-01-01T00:00:00.123456Z";
const EPOCH = Date.parse("2026-01-01T00:00:00Z");

function createRollbackFixture() {
  const sourceTables = Object.fromEntries(
    Object.keys(TABLE_COLUMNS).map((table) => [table, []]),
  );
  const tables = Object.fromEntries(TARGET_TABLES.map((table) => [table, []]));
  const mappings = [];
  const sourceSnapshot = {
    schemaVersion: 1,
    sourceKind: "synthetic",
    evaluationTime: "2026-01-04T00:00:00Z",
    tables: sourceTables,
  };
  const targetSnapshot = {
    schemaVersion: 1,
    sourceKind: "synthetic",
    evaluationTime: "2026-01-04T00:00:00Z",
    projectorVersion: "portfolio-v1",
    tables,
    mappings,
  };
  const sourceId = (table) => deterministicUuid(table, "source");
  const register = (legacyTable, targetTable, target, source) => {
    sourceTables[legacyTable].push(source);
    tables[targetTable].push(target);
    mappings.push({
      legacyTable,
      legacyId: source.id,
      targetTable,
      targetId: target._id,
      sourceJson: JSON.stringify(source),
    });
  };

  register(
    "users",
    "users",
    {
      _id: "user-old",
      _creationTime: EPOCH,
      clerkSubject: "synthetic_old",
      email: "old@example.invalid",
    },
    {
      id: sourceId("users"),
      clerk_user_id: "synthetic_old",
      email: "old@example.invalid",
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    },
  );
  register(
    "households",
    "households",
    {
      _id: "household-old",
      _creationTime: EPOCH,
      ownerUserId: "user-old",
      name: "Synthetic old portfolio",
    },
    {
      id: sourceId("households"),
      owner_user_id: sourceId("users"),
      name: "Synthetic old portfolio",
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    },
  );
  register(
    "household_members",
    "householdMembers",
    {
      _id: "member-old",
      _creationTime: EPOCH,
      householdId: "household-old",
      userId: "user-old",
      role: "owner",
    },
    {
      id: sourceId("household_members"),
      household_id: sourceId("households"),
      user_id: sourceId("users"),
      role: "owner",
      created_at: CREATED_AT,
    },
  );
  register(
    "accounts",
    "accounts",
    {
      _id: "account-old",
      _creationTime: EPOCH,
      householdId: "household-old",
      name: "Synthetic broker",
      provider: "Synthetic",
      accountType: "broker",
      currency: "USD",
    },
    {
      id: sourceId("accounts"),
      household_id: sourceId("households"),
      name: "Synthetic broker",
      provider: "Synthetic",
      account_type: "broker",
      currency: "USD",
      is_archived: false,
      metadata: { retained: true },
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    },
  );
  register(
    "instruments",
    "instruments",
    {
      _id: "instrument-old",
      _creationTime: EPOCH,
      householdId: "household-old",
      name: "Synthetic equity",
      symbol: "FAKE",
      assetClass: "us_stock",
      currency: "USD",
    },
    {
      id: sourceId("instruments"),
      symbol: "FAKE",
      isin: null,
      name: "Synthetic equity",
      asset_class: "us_stock",
      currency: "USD",
      exchange: "TEST",
      provider_metadata: { retained: true },
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    },
  );

  const expiredRow = holding("2026-01-01", "100.125", "110.375");
  sourceTables.import_batches.push({
    id: sourceId("import_batches"),
    household_id: sourceId("households"),
    uploaded_by_user_id: sourceId("users"),
    source_type: "manual_snapshot",
    status: "expired",
    parser_version: "fixture-decimal-v1",
    original_file_name: "synthetic-expired.csv",
    storage_path: null,
    file_hash: "1".repeat(64),
    row_count: 1,
    warnings: [],
    errors: [],
    uploaded_at: CREATED_AT,
    expires_at: "2026-01-02T00:00:00Z",
    processed_at: CREATED_AT,
    committed_at: null,
  });
  sourceTables.import_rows.push({
    id: sourceId("import_rows"),
    import_batch_id: sourceId("import_batches"),
    row_number: 1,
    normalized_payload: legacyRow(expiredRow),
    row_errors: [],
    is_committed: false,
    created_at: CREATED_AT,
  });
  appendCommittedBatch(
    targetSnapshot,
    "batch-expired",
    "household-old",
    "user-old",
    1,
    [expiredRow],
    EPOCH + 86400000,
  );
  const expiredBatch = tables.importBatches[0];
  expiredBatch.fileName = sourceTables.import_batches[0].original_file_name;
  expiredBatch.contentHash = sourceTables.import_batches[0].file_hash;
  expiredBatch.createdAt = Date.parse(CREATED_AT);
  expiredBatch.processedAt = Date.parse(CREATED_AT);
  tables.sourceFiles[0].contentHash = expiredBatch.contentHash;
  tables.sourceFiles[0].expiresAt = Date.parse(
    sourceTables.import_batches[0].expires_at,
  );
  mappings.push({
    legacyTable: "import_batches",
    legacyId: sourceId("import_batches"),
    targetTable: "importBatches",
    targetId: "batch-expired",
    sourceJson: JSON.stringify(sourceTables.import_batches[0]),
  });

  const secondRow = holding("2026-01-02", "100.125", "120.75");
  const sale = {
    kind: "transaction",
    sourceType: "manual_snapshot",
    accountName: "Synthetic broker",
    provider: "Synthetic",
    instrumentName: "Synthetic equity",
    symbol: "FAKE",
    assetClass: "us_stock",
    currency: "USD",
    tradeDate: "2026-01-02",
    type: "sell",
    amount: "2.125",
    quantity: "0.125",
    price: "17",
    metadata: { sourceLine: 2 },
    source: {
      group: "",
      completeness: "partial",
      granularity: "instrument",
      priority: 0,
    },
    numericProvenance: {
      amount: "source_decimal",
      quantity: "source_decimal",
      price: "source_decimal",
    },
  };
  appendCommittedBatch(
    targetSnapshot,
    "batch-second",
    "household-old",
    "user-old",
    2,
    [secondRow, sale],
    EPOCH + 2 * 86400000,
  );

  tables.users.push({
    _id: "user-new",
    _creationTime: EPOCH + 2 * 86400000,
    clerkSubject: "synthetic_new",
    email: "new@example.invalid",
  });
  tables.households.push({
    _id: "household-new",
    _creationTime: EPOCH + 2 * 86400000,
    ownerUserId: "user-new",
    name: "My Portfolio",
  });
  tables.householdMembers.push({
    _id: "member-new",
    _creationTime: EPOCH + 2 * 86400000,
    householdId: "household-new",
    userId: "user-new",
    role: "owner",
  });
  tables.accounts.push({
    _id: "account-new",
    _creationTime: EPOCH + 2 * 86400000,
    householdId: "household-new",
    name: "Synthetic broker",
    provider: "Synthetic",
    accountType: "broker",
    currency: "USD",
  });
  tables.instruments.push({
    _id: "instrument-new",
    _creationTime: EPOCH + 2 * 86400000,
    householdId: "household-new",
    name: "Synthetic equity",
    symbol: "FAKE",
    assetClass: "us_stock",
    currency: "USD",
  });
  appendCommittedBatch(
    targetSnapshot,
    "batch-new-identity",
    "household-new",
    "user-new",
    1,
    [holding("2026-01-03", "200.1", "250.25")],
    EPOCH + 2 * 86400000,
  );

  return { sourceSnapshot, targetSnapshot };
}

function appendCommittedBatch(
  snapshot,
  id,
  householdId,
  uploaderId,
  sequence,
  rows,
  committedAt,
) {
  const tables = snapshot.tables;
  const rowsJson = JSON.stringify(rows);
  const versionId = `version-${id}`;
  tables.importBatches.push({
    _id: id,
    _creationTime: committedAt - 1000,
    householdId,
    uploaderId,
    fileName: `${id}.csv`,
    sizeBytes: rowsJson.length,
    status: "committed",
    attempt: 1,
    createdAt: committedAt - 1000,
    rowCount: rows.length,
    normalizedBytes: Buffer.byteLength(rowsJson),
    previewRowsJson: rowsJson,
    warnings: [],
    contentHash: nodeCrypto.createHash("sha256").update(id).digest("hex"),
    parserVersion: "fixture-decimal-v1",
    sourceType: "manual_snapshot",
    committedVersionId: versionId,
    processedAt: committedAt - 500,
    committedAt,
  });
  tables.sourceFiles.push({
    _id: `file-${id}`,
    _creationTime: committedAt - 1000,
    batchId: id,
    householdId,
    uploaderId,
    status: "expired",
    expiresAt: committedAt - 100,
    contentHash: nodeCrypto.createHash("sha256").update(id).digest("hex"),
    sizeBytes: rowsJson.length,
  });
  tables.importRowChunks.push({
    _id: `chunk-${id}`,
    _creationTime: committedAt - 500,
    batchId: id,
    attempt: 1,
    index: 0,
    count: rows.length,
    bytes: Buffer.byteLength(rowsJson),
    digest: nodeCrypto.createHash("sha256").update(rowsJson).digest("hex"),
    rowsJson,
  });
  tables.portfolioVersions.push({
    _id: versionId,
    _creationTime: committedAt,
    householdId,
    batchId: id,
    sequence,
    digest: "a".repeat(64),
    rootDigest: "b".repeat(64),
    publicationState: "published",
    createdAt: committedAt,
  });
  tables.publicationReceipts.push({
    _id: `receipt-${id}`,
    _creationTime: committedAt,
    versionId,
    attempt: 1,
    stage: "facts",
    index: 0,
    count: rows.length,
    digest: "c".repeat(64),
    bytes: rowsJson.length,
  });

  for (const [index, row] of rows.entries()) {
    const date =
      row.kind === "holding"
        ? row.sourceDate
        : row.kind === "transaction"
          ? row.tradeDate
          : row.valuationDate;
    const doc = {
      _id: `fact-${id}-${index}`,
      _creationTime: committedAt,
      householdId,
      batchId: id,
      key: JSON.stringify([id, index + 1]),
      date,
      factJson: JSON.stringify({
        row,
        provenance: {
          batchId: id,
          parserVersion: "fixture-decimal-v1",
          sequence,
          rowNumber: index + 1,
          fallbackDate: new Date(committedAt).toISOString().slice(0, 10),
        },
      }),
    };
    const table =
      row.kind === "holding"
        ? "holdingSnapshots"
        : row.kind === "transaction"
          ? "transactions"
          : "portfolioValuations";
    if (row.kind === "transaction")
      doc.occurrenceKey = JSON.stringify([
        row.tradeDate,
        row.type,
        row.amount,
        index + 1,
      ]);
    tables[table].push(doc);
  }
}

function holding(sourceDate, investedAmount, currentValue) {
  return {
    kind: "holding",
    sourceType: "manual_snapshot",
    sourceDate,
    accountName: "Synthetic broker",
    provider: "Synthetic",
    instrumentName: "Synthetic equity",
    symbol: "FAKE",
    assetClass: "us_stock",
    currency: "USD",
    quantity: "1.25",
    investedAmount,
    currentValue,
    metadata: { sourceLine: 1 },
    source: {
      group: "",
      completeness: "complete",
      granularity: "instrument",
      priority: 0,
    },
    numericProvenance: {
      quantity: "source_decimal",
      investedAmount: "source_decimal",
      currentValue: "source_decimal",
    },
  };
}

function legacyRow(exact) {
  const row = { ...exact };
  delete row.source;
  delete row.numericProvenance;
  for (const field of [
    "quantity",
    "investedAmount",
    "currentValue",
    "pnlAmount",
    "price",
    "amount",
  ])
    if (row[field] !== undefined) row[field] = Number(row[field]);
  return row;
}

module.exports = {
  CREATED_AT,
  appendCommittedBatch,
  createRollbackFixture,
  holding,
};
