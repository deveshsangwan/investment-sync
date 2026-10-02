const { canonicalJson } = require("./phase6-artifacts.cjs");

/** Independent field checks over exported native documents, not archived copies. */
function reconcileRecords(snapshot, target, findings) {
  const tables = target.tables;
  const mappings = tables.migrationMappings;
  const byId = Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [
      table,
      new Map(rows.map((row) => [row._id, row])),
    ]),
  );
  const mapped = (table, id, targetTable) =>
    mappings.filter(
      (entry) =>
        entry.legacyTable === table &&
        entry.legacyId === id &&
        entry.targetTable === targetTable,
    );
  const parentId = (table, id, targetTable) => {
    const values = mapped(table, id, targetTable);
    return values.length === 1 ? values[0].targetId : undefined;
  };
  const equal = (expected, actual, location) => {
    if (canonicalJson(expected ?? null) !== canonicalJson(actual ?? null))
      findings.push({
        path: location,
        reason: "native_record_difference",
        expected: expected ?? null,
        actual: actual ?? null,
      });
  };

  for (const mapping of mappings) {
    const document = byId[mapping.targetTable]?.get(mapping.targetId);
    if (!document)
      findings.push({
        path: `maps.${mapping.legacyTable}.${mapping.legacyId}`,
        reason: "missing_target_document",
      });
  }

  const fieldsByTable = {
    users: {
      target: "users",
      fields: { clerk_user_id: "clerkSubject", email: "email" },
    },
    households: { target: "households", fields: { name: "name" } },
    household_members: { target: "householdMembers", fields: { role: "role" } },
    accounts: {
      target: "accounts",
      fields: {
        name: "name",
        provider: "provider",
        account_type: "accountType",
        currency: "currency",
        is_archived: "isArchived",
      },
    },
    instruments: {
      target: "instruments",
      fields: {
        name: "name",
        symbol: "symbol",
        asset_class: "assetClass",
        currency: "currency",
        isin: "isin",
        exchange: "exchange",
      },
    },
    import_batches: {
      target: "importBatches",
      fields: {
        original_file_name: "fileName",
        file_hash: "contentHash",
        parser_version: "parserVersion",
        source_type: "sourceType",
        status: "legacyStatus",
        row_count: "legacyDeclaredRowCount",
        warnings: "warnings",
        errors: "legacyErrors",
      },
    },
  };

  for (const [table, config] of Object.entries(fieldsByTable)) {
    for (const source of snapshot.tables[table]) {
      const entries = mapped(table, source.id, config.target);
      if (table !== "instruments" && entries.length !== 1)
        findings.push({
          path: `maps.${table}.${source.id}`,
          reason: "parent_mapping_count",
          expected: 1,
          actual: entries.length,
        });
      if (table === "instruments") {
        const households = new Set(
          [
            ...snapshot.tables.holding_snapshots,
            ...snapshot.tables.transactions,
          ]
            .filter((fact) => fact.instrument_id === source.id)
            .map((fact) => fact.household_id),
        );
        equal(
          [...households].sort(),
          entries.map((entry) => entry.householdLegacyId).sort(),
          `maps.instruments.${source.id}.households`,
        );
      }

      for (const entry of entries) {
        const actual = byId[config.target]?.get(entry.targetId);
        if (!actual) continue;
        const base = `native.${config.target}.${source.id}`;
        equal(source.id, actual.legacyId, `${base}.legacyId`);
        for (const [sourceField, targetField] of Object.entries(config.fields))
          equal(
            source[sourceField],
            actual[targetField],
            `${base}.${targetField}`,
          );
        if (source.household_id)
          equal(
            parentId("households", source.household_id, "households"),
            actual.householdId,
            `${base}.householdId`,
          );
        if (table === "households")
          equal(
            parentId("users", source.owner_user_id, "users"),
            actual.ownerUserId,
            `${base}.ownerUserId`,
          );
        if (table === "household_members")
          equal(
            parentId("users", source.user_id, "users"),
            actual.userId,
            `${base}.userId`,
          );
        if (table === "accounts")
          equal(
            source.metadata,
            actual.metadataJson ? JSON.parse(actual.metadataJson) : null,
            `${base}.metadata`,
          );
        if (table === "instruments") {
          equal(
            parentId("households", entry.householdLegacyId, "households"),
            actual.householdId,
            `${base}.householdId`,
          );
          equal(
            source.provider_metadata,
            actual.providerMetadataJson
              ? JSON.parse(actual.providerMetadataJson)
              : null,
            `${base}.providerMetadata`,
          );
        }
        if (table === "import_batches") {
          equal(
            parentId("users", source.uploaded_by_user_id, "users"),
            actual.uploaderId,
            `${base}.uploaderId`,
          );
          const count = snapshot.tables.import_rows.filter(
            (row) => row.import_batch_id === source.id,
          ).length;
          equal(count, actual.rowCount, `${base}.rowCount`);
          const status =
            source.status === "created"
              ? "awaiting_upload"
              : source.status === "expired"
                ? count > 0
                  ? "parsed"
                  : "failed"
                : source.status;
          equal(status, actual.status, `${base}.status`);
          equal(
            Date.parse(source.uploaded_at),
            actual.createdAt,
            `${base}.createdAt`,
          );
          equal(
            source.processed_at ? Date.parse(source.processed_at) : null,
            actual.processedAt,
            `${base}.processedAt`,
          );
          equal(
            source.committed_at ? Date.parse(source.committed_at) : null,
            actual.committedAt,
            `${base}.committedAt`,
          );
          const chunks = tables.importRowChunks
            .filter(
              (chunk) =>
                chunk.batchId === actual._id &&
                chunk.attempt === actual.attempt,
            )
            .sort((left, right) => left.index - right.index);
          equal(
            count,
            chunks.reduce(
              (total, chunk) => total + JSON.parse(chunk.rowsJson).length,
              0,
            ),
            `${base}.normalizedRows`,
          );
        }
      }
    }
  }

  const financialTables = {
    holding_snapshots: {
      target: "holdingSnapshots",
      fields: {
        quantity: "quantity",
        invested_amount: "investedAmount",
        current_value: "currentValue",
        pnl_amount: "pnlAmount",
      },
      date: "snapshot_date",
    },
    transactions: {
      target: "transactions",
      fields: { quantity: "quantity", price: "price", amount: "amount" },
      date: "trade_date",
    },
    portfolio_valuations: {
      target: "portfolioValuations",
      fields: {
        invested_amount: "investedAmount",
        current_value: "currentValue",
        pnl_amount: "pnlAmount",
      },
      date: "valuation_date",
    },
  };
  for (const [table, config] of Object.entries(financialTables)) {
    for (const source of snapshot.tables[table]) {
      const entries = mapped(table, source.id, config.target);
      if (entries.length !== 1) {
        findings.push({
          path: `native.${table}.${source.id}`,
          reason: "financial_mapping_count",
          expected: 1,
          actual: entries.length,
        });
        continue;
      }
      const actual = byId[config.target]?.get(entries[0].targetId);
      if (!actual) continue;
      const fact = JSON.parse(actual.factJson);
      const base = `native.${config.target}.${source.id}`;
      equal(source.id, fact.provenance.legacyId, `${base}.provenance.legacyId`);
      equal(
        parentId("households", source.household_id, "households"),
        actual.householdId,
        `${base}.householdId`,
      );
      equal(
        source.import_batch_id
          ? parentId("import_batches", source.import_batch_id, "importBatches")
          : null,
        actual.batchId,
        `${base}.batchId`,
      );
      equal(source[config.date], actual.date, `${base}.date`);
      equal(source.currency, fact.row.currency, `${base}.currency`);
      for (const [column, field] of Object.entries(config.fields))
        equal(
          source[column] === null ? null : normalizedDecimal(source[column]),
          fact.row[field] === undefined
            ? null
            : normalizedDecimal(fact.row[field]),
          `${base}.${field}`,
        );
      if (table === "transactions")
        equal(source.type, fact.row.type, `${base}.type`);
      if (table === "holding_snapshots") {
        const aliases = tables.legacyHoldingAliases.filter(
          (alias) =>
            alias.householdId === actual.householdId &&
            alias.legacyId === source.id,
        );
        equal(1, aliases.length, `${base}.legacyAliasCount`);
        equal(
          actual.positionKey,
          aliases[0]?.positionKey,
          `${base}.legacyAlias`,
        );
      }
    }
  }
}

function normalizedDecimal(value) {
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value))
    throw new Error("Expected exact financial decimal string");
  const [whole, fraction = ""] = value.split(".");
  const tail = fraction.replace(/0+$/, "");
  return `${whole === "-0" && !tail ? "0" : whole}${tail ? `.${tail}` : ""}`;
}

module.exports = { reconcileRecords };
