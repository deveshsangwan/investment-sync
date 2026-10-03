const nodeCrypto = require("node:crypto");
const {
  digest,
  normalizeSqlTables,
  stableJson,
  tableCounts,
} = require("./reverse-replay-postgres.cjs");
const {
  ReverseReplayError,
  TARGET_TABLES,
  assertLegacyHoldingSemantics,
  deterministicUuid,
  integer,
  legacyNormalizedRow,
  mapped,
  object,
  optionalTimestamp,
  reject,
  scaled,
  stringArray,
  text,
  timestamp,
  unique,
  validateExactRow,
} = require("./reverse-replay-values.cjs");
const {
  createIdentityMaps,
  replayParents,
} = require("./reverse-replay-identities.cjs");
const { replayFacts } = require("./reverse-replay-facts.cjs");

function buildReverseReplayPlan({ sourceSnapshot, targetSnapshot }) {
  assertEnvelope(sourceSnapshot);
  assertEnvelope(targetSnapshot);
  if (sourceSnapshot.sourceKind !== targetSnapshot.sourceKind)
    reject("source_kind_mismatch");
  if (targetSnapshot.projectorVersion !== "portfolio-v1")
    reject("unsupported_projector_version");

  const sourceTables = normalizeSqlTables(sourceSnapshot.tables);
  const tables = structuredClone(sourceTables);
  const targetTables = requireTargetTables(targetSnapshot.tables);
  const maps = createIdentityMaps(
    sourceTables,
    targetTables,
    targetSnapshot.mappings,
  );
  const rowsByTable = Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [
      table,
      new Map(rows.map((row) => [row.id, row])),
    ]),
  );
  const newCommittedBatches = [];
  const normalizedRowsByBatch = new Map();

  replayParents({ tables: targetTables, maps, rowsByTable });
  const versions = new Map(
    targetTables.portfolioVersions.map((version) => [version._id, version]),
  );
  const batches = new Map(
    targetTables.importBatches.map((batch) => [batch._id, batch]),
  );

  for (const batch of [...batches.values()].sort(
    (a, b) =>
      batchSequence(a, versions) - batchSequence(b, versions) ||
      a._id.localeCompare(b._id),
  )) {
    const mappedId = maps.importBatches.get(batch._id);
    const baseline = mappedId
      ? rowsByTable.import_batches.get(mappedId)
      : undefined;
    const batchId = mappedId ?? deterministicUuid("import_batches", batch._id);
    maps.importBatches.set(batch._id, batchId);

    if (["parsing", "publishing"].includes(batch.status))
      reject("target_writes_not_drained");
    const rows = normalizedRowsForBatch(
      targetTables.importRowChunks,
      batch,
      baseline?.status !== "committed",
    );
    normalizedRowsByBatch.set(batch._id, rows);
    const newlyCommitted =
      batch.status === "committed" && baseline?.status !== "committed";
    const createdAt = timestamp(batch.createdAt);
    const sourceFile = unique(
      targetTables.sourceFiles.filter((file) => file.batchId === batch._id),
      "source_file_cardinality",
    );
    if (
      !sourceFile ||
      sourceFile.householdId !== batch.householdId ||
      sourceFile.uploaderId !== batch.uploaderId
    )
      reject("invalid_source_file_ownership");

    const storagePath =
      baseline?.storage_path ?? restoredStoragePath(sourceFile, targetSnapshot);
    const row = baseline
      ? { ...baseline }
      : {
          id: batchId,
          household_id: mapped(maps.households, batch.householdId),
          uploaded_by_user_id: mapped(maps.users, batch.uploaderId),
          source_type: batch.sourceType ?? "unknown",
          status: legacyStatus(batch.status),
          parser_version: batch.parserVersion ?? null,
          original_file_name: text(batch.fileName),
          storage_path: storagePath,
          file_hash: batch.contentHash ?? null,
          row_count: batch.rowCount,
          warnings: stringArray(batch.warnings),
          errors: batch.errorMessage ? [text(batch.errorMessage)] : [],
          uploaded_at: createdAt,
          expires_at: timestamp(sourceFile.expiresAt),
          processed_at: optionalTimestamp(batch.processedAt),
          committed_at: optionalTimestamp(batch.committedAt),
        };

    if (
      baseline &&
      (row.household_id !== mapped(maps.households, batch.householdId) ||
        row.uploaded_by_user_id !== mapped(maps.users, batch.uploaderId))
    )
      reject("changed_batch_ownership");
    if (
      baseline &&
      (baseline.original_file_name !== batch.fileName ||
        baseline.source_type !== (batch.sourceType ?? "unknown") ||
        (baseline.file_hash && baseline.file_hash !== batch.contentHash) ||
        (baseline.parser_version &&
          baseline.parser_version !== batch.parserVersion))
    )
      reject("changed_immutable_batch_metadata");
    if (newlyCommitted) {
      const version = versions.get(batch.committedVersionId);
      if (
        !version ||
        version.batchId !== batch._id ||
        version.householdId !== batch.householdId ||
        version.publicationState !== "published" ||
        !version.digest ||
        !version.rootDigest
      )
        reject("missing_commit_receipt");
      validatePublicationReceipts(version, batch, targetTables);

      row.status = "committed";
      row.row_count = rows.length;
      row.committed_at = timestamp(batch.committedAt);
      newCommittedBatches.push({
        targetBatchId: batch._id,
        legacyBatchId: batchId,
        householdId: row.household_id,
        sequence: integer(version.sequence),
        parserVersion: text(batch.parserVersion),
        projectorVersion: targetSnapshot.projectorVersion,
        versionDigest: text(version.digest),
        rootDigest: text(version.rootDigest),
      });
    }

    rowsByTable.import_batches.set(batchId, row);
    preserveNormalizedRows(rows, batch, row, rowsByTable.import_rows, baseline);
  }

  replayFacts({
    targetTables,
    maps,
    rowsByTable,
    batches,
    newCommittedBatches,
    normalizedRowsByBatch,
  });
  replayQuote(targetTables.currencyRates, rowsByTable.currency_rates);

  for (const [table, rows] of Object.entries(rowsByTable))
    tables[table] = [...rows.values()];
  const normalizedTables = normalizeSqlTables(tables);

  return {
    schemaVersion: 1,
    sourceKind: sourceSnapshot.sourceKind,
    sourceDigest: digest(sourceTables),
    targetDigest: digest(targetSnapshot),
    replayDigest: digest(normalizedTables),
    projectorVersion: targetSnapshot.projectorVersion,
    newCommittedBatches,
    counts: tableCounts(normalizedTables),
    sourceTables,
    tables: normalizedTables,
  };
}

function validatePublicationReceipts(version, batch, tables) {
  const manifest = version.rootManifest;
  if (
    !Array.isArray(manifest) ||
    manifest.length === 0 ||
    manifest.length > 512 ||
    !/^[a-f0-9]{64}$/.test(version.digest) ||
    version.attempt !== batch.publicationAttempt
  )
    reject("invalid_publication_root_manifest");
  const expected = new Map();
  const nextIndex = new Map();
  for (const entry of manifest) {
    object(entry);
    const key = `${entry.stage}:${entry.index}`;
    if (
      ![
        "history",
        "positions",
        "scopes",
        "summary",
        "assets",
        "timeline",
        "facts",
      ].includes(entry.stage) ||
      entry.index !== (nextIndex.get(entry.stage) ?? 0) ||
      expected.has(key) ||
      !Number.isSafeInteger(entry.count) ||
      entry.count < 1 ||
      entry.count > 100 ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      entry.bytes > 65536 ||
      !/^[a-f0-9]{64}$/.test(entry.digest)
    )
      reject("invalid_publication_root_manifest");
    expected.set(key, entry);
    nextIndex.set(entry.stage, entry.index + 1);
  }

  const sum = (stage) =>
    manifest
      .filter((entry) => entry.stage === stage)
      .reduce((total, entry) => total + entry.count, 0);
  const rootJson = JSON.stringify(
    manifest.map((entry) => [
      entry.stage,
      entry.index,
      entry.count,
      entry.bytes,
      entry.digest,
    ]),
  );
  if (
    sum("facts") !== batch.rowCount ||
    sum("summary") !== 1 ||
    sha256(rootJson) !== version.rootDigest
  )
    reject("invalid_publication_root_manifest");
  const receipts = tables.publicationReceipts.filter(
    (receipt) => receipt.versionId === version._id,
  );
  if (receipts.length !== manifest.length)
    reject("incomplete_publication_receipts");
  const persistedFacts = new Map(
    ["holdingSnapshots", "transactions", "portfolioValuations"].flatMap(
      (table) =>
        tables[table]
          .filter((doc) => doc.batchId === batch._id)
          .map((doc) => {
            const fact = JSON.parse(text(doc.factJson));
            return [fact.provenance.rowNumber, fact];
          }),
    ),
  );
  const factRows = new Set();

  for (const receipt of receipts) {
    const key = `${receipt.stage}:${receipt.index}`;
    const entry = expected.get(key);
    if (
      !entry ||
      receipt.attempt !== version.attempt ||
      receipt.count !== entry.count ||
      receipt.bytes !== entry.bytes ||
      receipt.digest !== entry.digest
    )
      reject("conflicting_publication_receipt");
    expected.delete(key);
    if (receipt.stage !== "facts") continue;
    const payload = text(receipt.payloadJson);
    if (
      Buffer.byteLength(payload) !== receipt.bytes ||
      sha256(payload) !== receipt.digest
    )
      reject("conflicting_publication_fact_payload");
    const values = JSON.parse(payload);
    if (!Array.isArray(values) || values.length !== receipt.count)
      reject("conflicting_publication_fact_payload");
    for (const value of values) {
      object(value);
      object(value.provenance);
      const rowNumber = value.provenance.rowNumber;
      if (
        factRows.has(rowNumber) ||
        stableJson(persistedFacts.get(rowNumber)) !==
          stableJson({ row: value.row, provenance: value.provenance })
      )
        reject("conflicting_publication_fact_payload");
      factRows.add(rowNumber);
    }
  }
  if (expected.size || factRows.size !== batch.rowCount)
    reject("incomplete_publication_receipts");
}

function sha256(value) {
  return nodeCrypto.createHash("sha256").update(value).digest("hex");
}

function assertEnvelope(envelope) {
  object(envelope);
  if (
    envelope.schemaVersion !== 1 ||
    !["synthetic", "production"].includes(envelope.sourceKind)
  )
    reject("invalid_replay_envelope");
  if (
    typeof envelope.evaluationTime !== "string" ||
    !Number.isFinite(Date.parse(envelope.evaluationTime))
  )
    reject("invalid_evaluation_time");
  object(envelope.tables);
}

function verifyNoConvexWrites(initialSnapshot, currentSnapshot) {
  assertEnvelope(initialSnapshot);
  assertEnvelope(currentSnapshot);
  if (initialSnapshot.sourceKind !== currentSnapshot.sourceKind)
    reject("source_kind_mismatch");
  const normalize = (snapshot) => {
    const tables = requireTargetTables(snapshot.tables);
    return Object.fromEntries(
      TARGET_TABLES.map((table) => [
        table,
        [...tables[table]].sort((a, b) => a._id.localeCompare(b._id)),
      ]),
    );
  };
  const initialDigest = digest(normalize(initialSnapshot));
  if (initialDigest !== digest(normalize(currentSnapshot)))
    reject("convex_only_writes_detected");

  return { targetDigest: initialDigest, unchanged: true };
}

function requireTargetTables(tables) {
  for (const table of TARGET_TABLES) {
    if (!Array.isArray(tables[table])) reject("incomplete_target_export");
    const ids = new Set();

    for (const row of tables[table]) {
      object(row);
      if (ids.has(text(row._id))) reject("duplicate_target_id");
      ids.add(row._id);
    }
  }

  return tables;
}

function normalizedRowsForBatch(chunks, batch, requireCommittedCount) {
  const current = chunks
    .filter(
      (chunk) => chunk.batchId === batch._id && chunk.attempt === batch.attempt,
    )
    .sort((a, b) => a.index - b.index);
  const rows = [];

  for (const [index, chunk] of current.entries()) {
    const rawDigest =
      typeof chunk.rowsJson === "string"
        ? nodeCrypto.createHash("sha256").update(chunk.rowsJson).digest("hex")
        : "";
    if (
      chunk.index !== index ||
      typeof chunk.rowsJson !== "string" ||
      Buffer.byteLength(chunk.rowsJson, "utf8") !== chunk.bytes ||
      rawDigest !== chunk.digest
    )
      reject("invalid_normalized_chunk");
    const part = JSON.parse(chunk.rowsJson);
    if (!Array.isArray(part) || part.length !== chunk.count)
      reject("invalid_normalized_chunk");
    rows.push(...part);
  }

  if (
    (batch.status === "parsed" ||
      (batch.status === "committed" && requireCommittedCount)) &&
    rows.length !== batch.rowCount
  )
    reject("incomplete_normalized_rows");
  return rows;
}

function preserveNormalizedRows(
  rows,
  batch,
  legacyBatch,
  destination,
  baseline,
) {
  const originals = [...destination.values()]
    .filter((row) => row.import_batch_id === legacyBatch.id)
    .sort((a, b) => a.row_number - b.row_number);
  if (baseline && originals.length !== rows.length) {
    if (rows.length === 0 && !["parsed", "committed"].includes(batch.status))
      return;
    reject("legacy_normalized_row_count_changed");
  }

  for (const [index, row] of rows.entries()) {
    validateExactRow(row);
    assertLegacyHoldingSemantics(row);
    const previous = originals[index];
    const payload = legacyNormalizedRow(row);
    if (
      previous &&
      stableJson(previous.normalized_payload) !== stableJson(payload)
    )
      reject("legacy_normalized_rows_changed");
    const value = previous
      ? { ...previous }
      : {
          id: deterministicUuid("import_rows", `${batch._id}:${index + 1}`),
          import_batch_id: legacyBatch.id,
          row_number: index + 1,
          normalized_payload: payload,
          row_errors: [],
          is_committed: false,
          created_at: legacyBatch.uploaded_at,
        };
    value.is_committed = batch.status === "committed";
    destination.set(value.id, value);
  }
}

function replayQuote(quotes, destination) {
  for (const quote of quotes) {
    if (quote.status === "unavailable") continue;
    if (
      quote.base !== "USD" ||
      quote.quote !== "INR" ||
      quote.provider !== "frankfurter"
    )
      reject("unsupported_currency_quote");
    const previous = [...destination.values()].find(
      (row) =>
        row.base === quote.base &&
        row.quote === quote.quote &&
        row.provider === quote.provider,
    );
    const fetchedAt = text(quote.fetchedAt);
    const row = {
      id: previous?.id ?? deterministicUuid("currency_rates", quote._id),
      base: quote.base,
      quote: quote.quote,
      rate: scaled(quote.rate, 10),
      provider: quote.provider,
      fetched_at: fetchedAt,
      created_at: previous?.created_at ?? fetchedAt,
      updated_at: previous?.updated_at ?? fetchedAt,
    };
    destination.set(row.id, row);
  }
}

function restoredStoragePath(file, snapshot) {
  if (
    !["stored", "delete_failed", "available"].includes(file.status) ||
    file.expiresAt <= Date.parse(snapshot.evaluationTime)
  )
    return null;
  const mapping = unique(
    (snapshot.reverseStorageMappings ?? []).filter(
      (item) => item.batchId === file.batchId,
    ),
    "reverse_storage_mapping_collision",
  );
  if (
    !mapping ||
    mapping.contentHash !== file.contentHash ||
    mapping.sizeBytes !== file.sizeBytes
  )
    reject("available_source_file_not_restored");
  return text(mapping.storagePath);
}

function legacyStatus(status) {
  const statuses = {
    awaiting_upload: "created",
    uploaded: "uploaded",
    parsed: "parsed",
    committed: "committed",
    failed: "failed",
  };
  if (!statuses[status]) reject("unsupported_import_status");
  return statuses[status];
}

function batchSequence(batch, versions) {
  return batch.status === "committed"
    ? integer(versions.get(batch.committedVersionId)?.sequence ?? 0)
    : Number.MAX_SAFE_INTEGER;
}

module.exports = {
  ReverseReplayError,
  TARGET_TABLES,
  buildReverseReplayPlan,
  deterministicUuid,
  scaled,
  verifyNoConvexWrites,
};
