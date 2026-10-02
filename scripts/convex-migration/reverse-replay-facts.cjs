const { stableJson } = require("./reverse-replay-postgres.cjs");
const {
  assertLegacyHoldingSemantics,
  date,
  deterministicUuid,
  integer,
  mapped,
  object,
  optionalScaled,
  reject,
  scaled,
  subtractScaled,
  text,
  timestamp,
  validateExactRow,
} = require("./reverse-replay-values.cjs");
const {
  findAccountId,
  findInstrumentId,
  transactionUniqueKey,
} = require("./reverse-replay-identities.cjs");

function replayFacts({
  targetTables,
  maps,
  rowsByTable,
  batches,
  newCommittedBatches,
  normalizedRowsByBatch,
}) {
  const newBatchIds = new Set(
    newCommittedBatches.map((batch) => batch.targetBatchId),
  );
  const facts = [];

  for (const [table, kind] of [
    ["holdingSnapshots", "holding"],
    ["transactions", "transaction"],
    ["portfolioValuations", "valuation"],
  ]) {
    for (const doc of targetTables[table]) {
      const fact = JSON.parse(text(doc.factJson));
      validateExactRow(fact.row);
      object(fact.provenance);
      const batch = batches.get(doc.batchId);
      if (
        !batch ||
        batch.status !== "committed" ||
        batch.householdId !== doc.householdId ||
        fact.row.kind !== kind ||
        fact.provenance.batchId !== doc.batchId ||
        fact.provenance.parserVersion !== batch.parserVersion
      )
        reject("invalid_fact_provenance");
      integer(fact.provenance.sequence);
      integer(fact.provenance.rowNumber);
      facts.push({ doc, row: fact.row, provenance: fact.provenance, table });
    }
  }

  facts.sort(
    (a, b) =>
      a.provenance.sequence - b.provenance.sequence ||
      a.doc.batchId.localeCompare(b.doc.batchId) ||
      a.provenance.rowNumber - b.provenance.rowNumber,
  );
  for (const batch of newCommittedBatches) {
    const expectedRows = normalizedRowsByBatch.get(batch.targetBatchId);
    const publishedFacts = facts.filter(
      (fact) => fact.doc.batchId === batch.targetBatchId,
    );
    if (expectedRows.length !== publishedFacts.length)
      reject("incomplete_committed_facts");

    for (const [index, fact] of publishedFacts.entries()) {
      assertLegacyHoldingSemantics(fact.row);
      if (
        fact.provenance.rowNumber !== index + 1 ||
        fact.provenance.sequence !== batch.sequence ||
        stableJson(fact.row) !== stableJson(expectedRows[index])
      )
        reject("committed_fact_input_mismatch");
    }
  }
  const resolvedTransactions = new Map();

  for (const fact of facts) {
    if (fact.row.kind !== "transaction") continue;
    const householdId = mapped(maps.households, fact.doc.householdId);
    const key = JSON.stringify([householdId, text(fact.doc.occurrenceKey)]);
    resolvedTransactions.set(key, fact);
  }

  const legacyTransactionKeys = new Set();
  for (const fact of resolvedTransactions.values()) {
    const key = transactionUniqueKey(fact, maps, targetTables);
    if (legacyTransactionKeys.has(key))
      reject("identical_same_day_transaction_occurrences_not_reversible");
    legacyTransactionKeys.add(key);
  }

  for (const fact of facts) {
    if (!newBatchIds.has(fact.doc.batchId)) continue;
    const row = fact.row;
    const householdId = mapped(maps.households, fact.doc.householdId);
    const batchId = mapped(maps.importBatches, fact.doc.batchId);
    const createdAt = timestamp(batches.get(fact.doc.batchId).committedAt);

    if (row.kind === "valuation") {
      const previous = [...rowsByTable.portfolio_valuations.values()].find(
        (candidate) =>
          candidate.household_id === householdId &&
          candidate.valuation_date === row.valuationDate,
      );
      const value = {
        id:
          previous?.id ??
          deterministicUuid("portfolio_valuations", fact.doc._id),
        household_id: householdId,
        valuation_date: date(row.valuationDate),
        invested_amount: scaled(row.investedAmount, 4),
        current_value: scaled(row.currentValue, 4),
        pnl_amount:
          row.pnlAmount === undefined
            ? subtractScaled(row.currentValue, row.investedAmount, 4)
            : scaled(row.pnlAmount, 4),
        currency: row.currency,
        metadata: row.metadata,
        created_at: previous?.created_at ?? createdAt,
      };
      rowsByTable.portfolio_valuations.set(value.id, value);
      continue;
    }

    const accountId = findAccountId(fact, maps, targetTables);
    const instrumentId = findInstrumentId(fact, maps, targetTables);
    if (row.kind === "holding") {
      const snapshotDate = date(row.sourceDate ?? fact.provenance.fallbackDate);
      const previous = [...rowsByTable.holding_snapshots.values()].find(
        (candidate) =>
          candidate.household_id === householdId &&
          candidate.account_id === accountId &&
          candidate.instrument_id === instrumentId &&
          candidate.snapshot_date === snapshotDate &&
          candidate.currency === row.currency,
      );
      if (previous?.source_type === "nps_csv" && row.sourceType !== "nps_csv")
        continue;
      const value = {
        id:
          previous?.id ?? deterministicUuid("holding_snapshots", fact.doc._id),
        household_id: householdId,
        account_id: accountId,
        instrument_id: instrumentId,
        import_batch_id: batchId,
        source_type: row.sourceType,
        snapshot_date: snapshotDate,
        quantity: optionalScaled(row.quantity, 10),
        invested_amount: scaled(row.investedAmount, 4),
        current_value: scaled(row.currentValue, 4),
        pnl_amount: optionalScaled(row.pnlAmount, 4),
        pnl_percent:
          row.pnlPercent === undefined
            ? null
            : scaled(String(row.pnlPercent), 6, 12),
        currency: row.currency,
        source_payload: row.metadata,
        created_at: previous?.created_at ?? createdAt,
      };
      rowsByTable.holding_snapshots.set(value.id, value);
      continue;
    }

    const tradeDate = date(row.tradeDate);
    const amount = scaled(row.amount, 4);
    const previous = [...rowsByTable.transactions.values()].find(
      (candidate) =>
        candidate.household_id === householdId &&
        candidate.account_id === accountId &&
        candidate.instrument_id === instrumentId &&
        candidate.trade_date === tradeDate &&
        candidate.type === row.type &&
        candidate.amount === amount &&
        candidate.currency === row.currency,
    );
    const value = {
      id: previous?.id ?? deterministicUuid("transactions", fact.doc._id),
      household_id: householdId,
      account_id: accountId,
      instrument_id: instrumentId,
      import_batch_id: batchId,
      type: row.type,
      trade_date: tradeDate,
      quantity: optionalScaled(row.quantity, 10),
      price: optionalScaled(row.price, 10),
      amount,
      currency: row.currency,
      notes: previous?.notes ?? null,
      metadata: row.metadata,
      created_at: previous?.created_at ?? createdAt,
    };
    rowsByTable.transactions.set(value.id, value);
  }
}

module.exports = { replayFacts };
