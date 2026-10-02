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
      if (doc.legacyId) {
        validateMigratedFact({
          doc,
          fact,
          table,
          kind,
          batch,
          maps,
          rowsByTable,
          targetTables,
        });
      } else if (
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
      a.provenance.batchId.localeCompare(b.provenance.batchId) ||
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
      const holdingId =
        previous?.id ?? orderedHoldingUuid(fact.doc, fact.provenance);
      if (!previous && rowsByTable.holding_snapshots.has(holdingId))
        reject("holding_id_collision");
      const value = {
        id: holdingId,
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

  rejectNewHoldingSelectionTies(rowsByTable, newCommittedBatches);
  verifyHoldingChartOrder(facts, maps, targetTables, rowsByTable, newBatchIds);
}

function orderedHoldingUuid(doc, provenance) {
  const sequence = integer(provenance.sequence);
  const rowNumber = integer(provenance.rowNumber);
  // The deployed 1,100-row limit and 1,348-row stress fixture fit 11 row bits.
  if (rowNumber < 1 || rowNumber >= 2048)
    reject("holding_chart_order_not_reversible");
  const order = ((BigInt(sequence) << 11n) | BigInt(rowNumber))
    .toString(16)
    .padStart(16, "0");
  const identity = deterministicUuid(
    "holding_snapshots",
    JSON.stringify([text(doc.householdId), text(doc.batchId), text(doc._id)]),
  )
    .replaceAll("-", "")
    .slice(-14);
  const payload = `${order}${identity}`;
  // Inserting fixed UUID version/variant nibbles preserves the ordered payload.
  const hex = `${payload.slice(0, 12)}5${payload.slice(12, 15)}8${payload.slice(15)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function holdingLogicalKey(
  householdId,
  accountId,
  instrumentId,
  snapshotDate,
  currency,
) {
  return JSON.stringify([
    householdId,
    accountId,
    instrumentId,
    snapshotDate,
    currency,
  ]);
}

function verifyHoldingChartOrder(
  facts,
  maps,
  targetTables,
  rowsByTable,
  newBatchIds,
) {
  const sqlRows = new Map(
    [...rowsByTable.holding_snapshots.values()].map((row) => [
      holdingLogicalKey(
        row.household_id,
        row.account_id,
        row.instrument_id,
        row.snapshot_date,
        row.currency,
      ),
      row,
    ]),
  );
  const resolved = new Map();
  for (const fact of facts) {
    if (fact.row.kind !== "holding") continue;
    const householdId = mapped(maps.households, fact.doc.householdId);
    const accountId = findAccountId(fact, maps, targetTables);
    const snapshotDate = date(
      fact.row.sourceDate ?? fact.provenance.fallbackDate,
    );
    const key = holdingLogicalKey(
      householdId,
      accountId,
      findInstrumentId(fact, maps, targetTables),
      snapshotDate,
      fact.row.currency,
    );
    const previous = resolved.get(key);
    if (
      previous &&
      previous.fact.row.source.priority > fact.row.source.priority
    )
      continue;
    const sqlRow = sqlRows.get(key);
    if (!sqlRow) reject("holding_chart_order_not_reversible");
    resolved.set(key, {
      fact,
      sqlRow,
      creationOrder: previous?.creationOrder ?? fact.provenance,
      groupKey: JSON.stringify([
        householdId,
        accountId,
        fact.row.assetClass,
        fact.row.currency,
        fact.row.source.group,
        snapshotDate,
      ]),
    });
  }

  const detailedGroups = new Set(
    [...resolved.values()]
      .filter(({ fact }) => fact.row.source.granularity === "instrument")
      .map(({ groupKey }) => groupKey),
  );
  const chartGroups = new Map();
  for (const entry of resolved.values()) {
    if (
      entry.fact.row.source.granularity !== "instrument" &&
      detailedGroups.has(entry.groupKey)
    )
      continue;
    const key = JSON.stringify([
      entry.sqlRow.household_id,
      entry.sqlRow.snapshot_date,
    ]);
    const group = chartGroups.get(key) ?? [];
    group.push(entry);
    chartGroups.set(key, group);
  }

  for (const group of chartGroups.values()) {
    if (!group.some(({ fact }) => newBatchIds.has(fact.doc.batchId))) continue;
    const native = [...group]
      .sort(
        (left, right) =>
          left.creationOrder.sequence - right.creationOrder.sequence ||
          left.creationOrder.rowNumber - right.creationOrder.rowNumber,
      )
      .map(({ sqlRow }) => sqlRow.id);
    const sql = [...group]
      .sort(
        (left, right) =>
          compareText(
            utcMicrosecondOrder(left.sqlRow.created_at),
            utcMicrosecondOrder(right.sqlRow.created_at),
          ) || compareText(left.sqlRow.id, right.sqlRow.id),
      )
      .map(({ sqlRow }) => sqlRow.id);
    if (stableJson(native) !== stableJson(sql))
      reject("holding_chart_order_not_reversible");
  }
}

function utcMicrosecondOrder(value) {
  const [whole, fraction = ""] = value.replace(/Z$/, "").split(".");
  return `${whole}.${fraction.padEnd(6, "0")}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rejectNewHoldingSelectionTies(rowsByTable, newCommittedBatches) {
  const newBatchIds = new Set(
    newCommittedBatches.map((batch) => batch.legacyBatchId),
  );
  const groups = new Map();
  for (const row of rowsByTable.holding_snapshots.values()) {
    const instrument = rowsByTable.instruments.get(row.instrument_id);
    const account = rowsByTable.accounts.get(row.account_id);
    const isVested =
      row.source_type === "vested_drivewealth_xlsx" &&
      account.name === "US Stocks" &&
      account.provider === "Vested / DriveWealth" &&
      instrument.asset_class === "us_stock" &&
      row.currency === "USD" &&
      (row.source_payload.sourceSheet ?? "") === "";
    const key = JSON.stringify([
      row.household_id,
      instrument.asset_class,
      row.currency,
      (instrument.symbol?.trim() || instrument.name.trim()).toUpperCase(),
      row.snapshot_date,
      isVested ? 1 : 0,
      instrument.name,
    ]);
    const previous = groups.get(key);
    if (
      previous &&
      (newBatchIds.has(previous.import_batch_id) ||
        newBatchIds.has(row.import_batch_id))
    )
      reject("holding_selection_tie_not_reversible");
    groups.set(key, row);
  }
}

function validateMigratedFact({
  doc,
  fact,
  table,
  kind,
  batch,
  maps,
  rowsByTable,
  targetTables,
}) {
  const legacyTable = {
    holdingSnapshots: "holding_snapshots",
    transactions: "transactions",
    portfolioValuations: "portfolio_valuations",
  }[table];
  const source = rowsByTable[legacyTable].get(mapped(maps[table], doc._id));
  const legacyBatchId = source?.import_batch_id ?? null;
  if (
    !source ||
    source.id !== doc.legacyId ||
    fact.provenance.legacyId !== source.id ||
    source.household_id !== mapped(maps.households, doc.householdId) ||
    (legacyBatchId
      ? !batch || mapped(maps.importBatches, batch._id) !== legacyBatchId
      : doc.batchId !== undefined) ||
    fact.row.kind !== kind ||
    fact.provenance.batchId !== (legacyBatchId ?? `legacy:${source.id}`) ||
    fact.provenance.parserVersion !==
      (batch?.parserVersion ?? "legacy-postgres") ||
    fact.provenance.sequence !== Date.parse(source.created_at) ||
    fact.row.currency !== source.currency
  )
    reject("invalid_migrated_fact_provenance");

  const fields =
    kind === "transaction"
      ? { amount: "amount", quantity: "quantity", price: "price" }
      : {
          investedAmount: "invested_amount",
          currentValue: "current_value",
          pnlAmount: "pnl_amount",
          ...(kind === "holding" ? { quantity: "quantity" } : {}),
        };
  for (const [field, column] of Object.entries(fields)) {
    const value = source[column];
    const scale = ["quantity", "price"].includes(field) ? 10 : 4;
    if (
      value === null
        ? fact.row[field] !== undefined
        : fact.row[field] === undefined ||
          scaled(fact.row[field], scale) !== value
    )
      reject("changed_migrated_fact_values");
  }

  if (kind === "valuation") {
    if (
      fact.row.valuationDate !== source.valuation_date ||
      stableJson(fact.row.metadata) !== stableJson(source.metadata)
    )
      reject("changed_migrated_fact_values");
    return;
  }

  if (
    findAccountId({ ...fact, doc }, maps, targetTables) !== source.account_id ||
    findInstrumentId({ ...fact, doc }, maps, targetTables) !==
      source.instrument_id
  )
    reject("changed_migrated_fact_values");
  const instrument = rowsByTable.instruments.get(source.instrument_id);
  const metadata =
    kind === "holding"
      ? {
          ...source.source_payload,
          ...(instrument.exchange === null
            ? {}
            : { exchange: instrument.exchange }),
        }
      : { ...source.metadata, notes: source.notes };
  if (
    stableJson(fact.row.metadata) !== stableJson(metadata) ||
    (kind === "holding"
      ? fact.row.sourceDate !== source.snapshot_date ||
        fact.row.sourceType !== source.source_type
      : fact.row.tradeDate !== source.trade_date ||
        fact.row.type !== source.type)
  )
    reject("changed_migrated_fact_values");
  if (
    kind === "holding" &&
    (source.pnl_percent === null
      ? fact.row.pnlPercent !== undefined
      : fact.row.pnlPercent === undefined ||
        scaled(String(fact.row.pnlPercent), 6, 12) !== source.pnl_percent)
  )
    reject("changed_migrated_fact_values");
  assertLegacyHoldingSemantics(fact.row);
}

module.exports = { replayFacts, orderedHoldingUuid };
