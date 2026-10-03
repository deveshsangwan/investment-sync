const nodeCrypto = require("node:crypto");

const TABLE_COLUMNS = {
  users: ["id", "clerk_user_id", "email", "created_at", "updated_at"],
  households: ["id", "name", "owner_user_id", "created_at", "updated_at"],
  household_members: ["id", "household_id", "user_id", "role", "created_at"],
  accounts: [
    "id",
    "household_id",
    "name",
    "provider",
    "account_type",
    "currency",
    "is_archived",
    "metadata",
    "created_at",
    "updated_at",
  ],
  instruments: [
    "id",
    "symbol",
    "isin",
    "name",
    "asset_class",
    "currency",
    "exchange",
    "provider_metadata",
    "created_at",
    "updated_at",
  ],
  import_batches: [
    "id",
    "household_id",
    "uploaded_by_user_id",
    "source_type",
    "status",
    "parser_version",
    "original_file_name",
    "storage_path",
    "file_hash",
    "row_count",
    "warnings",
    "errors",
    "uploaded_at",
    "expires_at",
    "processed_at",
    "committed_at",
  ],
  import_rows: [
    "id",
    "import_batch_id",
    "row_number",
    "normalized_payload",
    "row_errors",
    "is_committed",
    "created_at",
  ],
  holding_snapshots: [
    "id",
    "household_id",
    "account_id",
    "instrument_id",
    "import_batch_id",
    "source_type",
    "snapshot_date",
    "quantity",
    "invested_amount",
    "current_value",
    "pnl_amount",
    "pnl_percent",
    "currency",
    "source_payload",
    "created_at",
  ],
  transactions: [
    "id",
    "household_id",
    "account_id",
    "instrument_id",
    "import_batch_id",
    "type",
    "trade_date",
    "quantity",
    "price",
    "amount",
    "currency",
    "notes",
    "metadata",
    "created_at",
  ],
  portfolio_valuations: [
    "id",
    "household_id",
    "valuation_date",
    "invested_amount",
    "current_value",
    "pnl_amount",
    "currency",
    "metadata",
    "created_at",
  ],
  currency_rates: [
    "id",
    "base",
    "quote",
    "rate",
    "provider",
    "fetched_at",
    "created_at",
    "updated_at",
  ],
  prices: [
    "id",
    "instrument_id",
    "price_date",
    "price",
    "currency",
    "source",
    "created_at",
  ],
};
const NUMERIC_COLUMNS = new Set([
  "quantity",
  "price",
  "amount",
  "invested_amount",
  "current_value",
  "pnl_amount",
  "pnl_percent",
  "rate",
]);
const JSON_COLUMNS = new Set([
  "metadata",
  "provider_metadata",
  "warnings",
  "errors",
  "normalized_payload",
  "row_errors",
  "source_payload",
]);
const TIMESTAMP_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "uploaded_at",
  "expires_at",
  "processed_at",
  "committed_at",
  "fetched_at",
]);
const DATE_COLUMNS = new Set([
  "snapshot_date",
  "trade_date",
  "valuation_date",
  "price_date",
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function digest(value) {
  return nodeCrypto
    .createHash("sha256")
    .update(stableJson(value))
    .digest("hex");
}

function normalizeSqlTables(tables) {
  const result = {};

  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    if (!Array.isArray(tables[table]))
      throw new Error(`Missing source table: ${table}`);

    result[table] = tables[table]
      .map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new Error(`Invalid row in ${table}`);
        if (
          typeof row.id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            row.id,
          )
        )
          throw new Error(`Source ID must be a UUID in ${table}`);

        if (
          Object.keys(row).some((column) => !columns.includes(column)) ||
          columns.some((column) => !Object.hasOwn(row, column))
        ) {
          throw new Error(
            `Source columns differ from the archived Postgres schema: ${table}`,
          );
        }

        return Object.fromEntries(
          columns.map((column) => [
            column,
            normalizeSqlValue(column, row[column]),
          ]),
        );
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    if (
      new Set(result[table].map((row) => row.id)).size !== result[table].length
    )
      throw new Error(`Duplicate source ID in ${table}`);
  }

  return result;
}

function normalizeSqlValue(column, value) {
  if (value === null) return null;

  if (TIMESTAMP_COLUMNS.has(column)) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(
        value,
      ) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new Error(
        "Source timestamps must be UTC text with at most microsecond precision",
      );

    return value
      .replace(/\+00:00$/, "Z")
      .replace(/(\.\d*?)0+Z$/, "$1Z")
      .replace(/\.Z$/, "Z");
  }

  if (NUMERIC_COLUMNS.has(column)) {
    if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value))
      throw new Error("Persisted numerics must be decimal text");

    const [whole, fraction = ""] = value.split(".");
    const normalized = `${whole}${fraction.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : ""}`;
    return /^-?0(?:\.0+)?$/.test(normalized) ? "0" : normalized;
  }

  return value;
}

async function readSqlTables(sql) {
  const tables = {};
  const actualColumns = await sql.unsafe(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1::text[])",
    [Object.keys(TABLE_COLUMNS)],
  );
  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const actual = actualColumns
      .filter((row) => row.table_name === table)
      .map((row) => row.column_name)
      .sort();
    if (stableJson(actual) !== stableJson([...columns].sort()))
      throw new Error(
        "Postgres schema differs from the archived rollback adapter",
      );
  }

  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const entries = columns.map((column) => {
      const expression = TIMESTAMP_COLUMNS.has(column)
        ? `to_char("${column}" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
        : NUMERIC_COLUMNS.has(column) || DATE_COLUMNS.has(column)
          ? `"${column}"::text`
          : `"${column}"`;
      return `'${column}', ${expression}`;
    });
    const rows = await sql.unsafe(
      `select jsonb_build_object(${entries.join(", ")}) as row from "public"."${table}" order by id`,
    );
    tables[table] = rows.map((item) => item.row);
  }

  return normalizeSqlTables(tables);
}

async function verifyBeforeWrites(sql, sourceTables, expectedDatabaseName) {
  return sql.begin(
    "isolation level repeatable read read only",
    async (transaction) => {
      await configureRecoveryTimeouts(transaction, expectedDatabaseName);
      await verifyDatabaseIdentity(transaction, expectedDatabaseName, true);

      const currentTables = await readSqlTables(transaction);
      if (digest(currentTables) !== digest(normalizeSqlTables(sourceTables)))
        throw new Error("Postgres differs from the frozen source snapshot");

      requireCurrentScope(expectedDatabaseName);

      return {
        sourceDigest: digest(currentTables),
        counts: tableCounts(currentTables),
        unchanged: true,
        readOnlyTransaction: true,
      };
    },
  );
}

async function applyReverseReplay(sql, plan, expectedDatabaseName) {
  if (
    typeof expectedDatabaseName === "object" &&
    plan.sourceKind !== "production"
  )
    throw new Error("Production replay requires a production plan");

  const desiredTables = normalizeSqlTables(plan.tables);
  const baselineTables = normalizeSqlTables(plan.sourceTables);
  if (
    plan.schemaVersion !== 1 ||
    plan.sourceDigest !== digest(baselineTables) ||
    plan.replayDigest !== digest(desiredTables)
  ) {
    throw new Error("Reverse replay plan integrity check failed");
  }

  return sql.begin("isolation level serializable", async (transaction) => {
    await configureRecoveryTimeouts(transaction, expectedDatabaseName);

    // Lock before any SELECT establishes the serializable snapshot so commits
    // made while waiting for a source writer remain visible to reconciliation.
    await transaction.unsafe(
      `lock table ${Object.keys(TABLE_COLUMNS)
        .map((table) => `"public"."${table}"`)
        .join(", ")} in exclusive mode`,
    );
    await verifyDatabaseIdentity(transaction, expectedDatabaseName);

    if (typeof expectedDatabaseName === "object") {
      const sideEffects = await transaction.unsafe(
        "select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1::text[]) and not t.tgisinternal union all select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1::text[]) and (c.relkind <> 'r' or c.relrowsecurity or c.relhassubclass) union all select 1 from pg_catalog.pg_inherits i join pg_catalog.pg_class c on c.oid = i.inhrelid or c.oid = i.inhparent join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1::text[]) union all select 1 from pg_catalog.pg_rewrite r join pg_catalog.pg_class c on c.oid = r.ev_class join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1::text[])",
        [Object.keys(TABLE_COLUMNS)],
      );
      if (sideEffects.length)
        throw new Error(
          "Production replay refuses custom database write behavior",
        );
    }

    const currentTables = await readSqlTables(transaction);
    const currentDigest = digest(currentTables);
    const desiredDigest = digest(desiredTables);

    if (currentDigest === desiredDigest) {
      requireCurrentScope(expectedDatabaseName);

      return {
        applied: false,
        alreadyApplied: true,
        digest: desiredDigest,
        counts: tableCounts(currentTables),
      };
    }

    if (currentDigest !== digest(baselineTables))
      throw new Error("Refusing reverse replay into divergent Postgres data");

    for (const [table, rows] of Object.entries(desiredTables)) {
      requireCurrentScope(expectedDatabaseName);

      const previous = new Map(
        baselineTables[table].map((row) => [row.id, row]),
      );
      const columns = TABLE_COLUMNS[table];
      // Force text transport before PostgreSQL casts. The driver's timestamp
      // serializer passes through Date and would discard archived microseconds.
      const placeholders = columns.map(
        (column, index) => `$${index + 1}::text::${columnSqlType(column)}`,
      );
      const updates = columns
        .filter((column) => column !== "id")
        .map((column) => `"${column}" = excluded."${column}"`);

      for (const row of rows) {
        if (stableJson(previous.get(row.id)) === stableJson(row)) continue;

        const values = columns.map((column) =>
          JSON_COLUMNS.has(column) ? JSON.stringify(row[column]) : row[column],
        );
        await transaction.unsafe(
          `insert into "public"."${table}" (${columns.map((column) => `"${column}"`).join(", ")}) values (${placeholders.join(", ")}) on conflict (id) do update set ${updates.join(", ")}`,
          values,
        );
      }
    }

    const actualTables = await readSqlTables(transaction);
    if (digest(actualTables) !== desiredDigest)
      throw new Error(
        "Reverse replay reconciliation failed; transaction rolled back",
      );

    requireCurrentScope(expectedDatabaseName);

    return {
      applied: true,
      alreadyApplied: false,
      digest: desiredDigest,
      counts: tableCounts(actualTables),
    };
  });
}

async function verifyDatabaseIdentity(
  sql,
  expectedDatabase,
  isReadOnly = false,
) {
  const [identity] = await sql.unsafe(
    "select current_database() as database_name, current_user as database_user, session_user as session_user, current_schema() as schema_name, current_setting('transaction_read_only') as read_only",
  );
  if (isReadOnly && identity?.read_only !== "on")
    throw new Error("Rollback verification requires a read-only transaction");

  if (expectedDatabase === undefined) return;

  const name =
    typeof expectedDatabase === "string"
      ? expectedDatabase
      : expectedDatabase.name;
  if (
    identity?.database_name !== name ||
    (typeof expectedDatabase === "object" &&
      (identity.database_user !== expectedDatabase.username ||
        identity.session_user !== expectedDatabase.username ||
        identity.schema_name !== "public"))
  )
    throw new Error(
      "Postgres session does not match the expected recovery database",
    );

  requireCurrentScope(expectedDatabase);
}

async function configureRecoveryTimeouts(sql, expectedDatabase) {
  requireCurrentScope(expectedDatabase);

  if (typeof expectedDatabase === "object") {
    const remaining = Date.parse(expectedDatabase.expiresAt) - Date.now();
    await sql.unsafe(
      `set local statement_timeout = '${Math.max(1, Math.min(remaining, 60000))}ms'`,
    );
    await sql.unsafe(
      `set local lock_timeout = '${Math.max(1, Math.min(remaining, 10000))}ms'`,
    );
  }
}

function requireCurrentScope(expectedDatabase) {
  if (
    typeof expectedDatabase === "object" &&
    (!Number.isFinite(Date.parse(expectedDatabase.expiresAt)) ||
      Date.parse(expectedDatabase.expiresAt) <= Date.now())
  )
    throw new Error(
      "Production recovery operator scope expired during verification",
    );
}

function tableCounts(tables) {
  return Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, rows.length]),
  );
}

function columnSqlType(column) {
  if (NUMERIC_COLUMNS.has(column)) return "numeric";
  if (JSON_COLUMNS.has(column)) return "jsonb";
  if (TIMESTAMP_COLUMNS.has(column)) return "timestamptz";
  if (DATE_COLUMNS.has(column)) return "date";
  if (column === "id" || (column.endsWith("_id") && column !== "clerk_user_id"))
    return "uuid";
  if (["row_count", "row_number"].includes(column)) return "integer";
  if (["is_archived", "is_committed"].includes(column)) return "boolean";
  if (["currency", "base", "quote"].includes(column)) return "currency";
  if (column === "asset_class") return "asset_class";
  if (column === "status") return "import_status";
  if (column === "source_type") return "import_source";
  if (column === "type") return "transaction_type";

  return "text";
}

module.exports = {
  TABLE_COLUMNS,
  applyReverseReplay,
  digest,
  normalizeSqlTables,
  readSqlTables,
  stableJson,
  tableCounts,
  verifyBeforeWrites,
};
