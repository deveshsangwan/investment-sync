const path = require("node:path");
const { createRequire } = require("node:module");
const {
  assertProductionDatabaseUrl,
  assertAllowedArguments,
  createProtectedRunDirectory,
  fail,
  loadExplicitEnvironment,
  parseArguments,
  requireProductionArguments,
  sourceFingerprint,
  writeProtectedJson,
} = require("./runtime.cjs");

const requireFromDatabasePackage = createRequire(
  path.resolve(process.cwd(), "packages/db/package.json"),
);
const postgres = requireFromDatabasePackage("postgres");

const TABLE_NAMES = [
  "users",
  "households",
  "household_members",
  "accounts",
  "instruments",
  "import_batches",
  "import_rows",
  "transactions",
  "holding_snapshots",
  "prices",
  "portfolio_valuations",
  "currency_rates",
];

const argumentsMap = parseArguments(process.argv.slice(2));
assertAllowedArguments(argumentsMap, ["target", "env-file", "run-id"]);
const { envFile, runId } = requireProductionArguments(argumentsMap);
const environment = loadExplicitEnvironment(envFile);
const database = assertProductionDatabaseUrl(environment.DATABASE_URL);
const fingerprint = sourceFingerprint([
  database.hostname,
  database.port,
  database.pathname,
  database.username,
]);
const client = postgres(environment.DATABASE_URL, {
  max: 1,
  prepare: false,
  connection: { application_name: "investment-sync-read-only-inventory" },
});

main().catch((error) => {
  console.error(`Postgres inventory failed${safeErrorCode(error)}`);
  process.exitCode = 1;
});

async function main() {
  let transactionStarted = false;

  try {
    await client.unsafe(
      "begin transaction isolation level repeatable read read only",
    );
    transactionStarted = true;
    await client.unsafe("set local statement_timeout = '60s'");
    await client.unsafe("set local lock_timeout = '2s'");

    const [readOnly] = await client.unsafe(
      "select current_setting('transaction_read_only') as value",
    );
    if (readOnly?.value !== "on") fail("Database transaction is not read-only");

    const inventory = {
      schemaVersion: 1,
      runId,
      collectedAt: new Date().toISOString(),
      sourceFingerprint: fingerprint,
      databaseFingerprint: fingerprint,
      tableCounts: await tableCounts(),
      batchStatuses: await groupedCounts(
        "select status::text as key, count(*)::bigint as count from import_batches group by status order by status",
      ),
      batchSources: await groupedCounts(
        "select source_type::text as key, count(*)::bigint as count from import_batches group by source_type order by source_type",
      ),
      rowKinds: await groupedCounts(
        "select coalesce(normalized_payload->>'kind', 'missing') as key, count(*)::bigint as count from import_rows group by 1 order by 1",
      ),
      currencies: await currencyCounts(),
      collisions: await collisionChecks(),
      integrity: await integrityChecks(),
      prices: await pricesSummary(),
      sourceFiles: await sourceFileSummary(),
      pendingBatches: await pendingBatchSummary(),
      largestBatch: await largestBatchSummary(),
      largestHousehold: await largestHouseholdSummary(),
    };
    inventory.reconciliationFindings = {
      batchRowCountMismatches:
        inventory.integrity.find(
          (finding) => finding.check === "batch_row_count_mismatch",
        )?.groups ?? 0,
    };

    await client.unsafe("rollback");
    transactionStarted = false;

    const runDirectory = createProtectedRunDirectory(runId);
    writeProtectedJson(runDirectory, "inventory.postgres.json", inventory);
    console.log("Postgres inventory complete");
    console.log("Protected aggregate artifact written under .migration");
  } finally {
    if (transactionStarted)
      await client.unsafe("rollback").catch(() => undefined);
    await client.end({ timeout: 5 });
  }
}

async function tableCounts() {
  const counts = [];

  for (const table of TABLE_NAMES) {
    const [row] = await client.unsafe(
      `select count(*)::bigint as count from ${table}`,
    );
    counts.push({ key: table, count: count(row?.count) });
  }

  return counts;
}

async function currencyCounts() {
  return {
    accounts: await groupedCounts(
      "select currency::text as key, count(*)::bigint as count from accounts group by currency order by currency",
    ),
    instruments: await groupedCounts(
      "select currency::text as key, count(*)::bigint as count from instruments group by currency order by currency",
    ),
    holdingSnapshots: await groupedCounts(
      "select currency::text as key, count(*)::bigint as count from holding_snapshots group by currency order by currency",
    ),
    transactions: await groupedCounts(
      "select currency::text as key, count(*)::bigint as count from transactions group by currency order by currency",
    ),
    portfolioValuations: await groupedCounts(
      "select currency::text as key, count(*)::bigint as count from portfolio_valuations group by currency order by currency",
    ),
    prices: await groupedCounts(
      "select currency::text as key, count(*)::bigint as count from prices group by currency order by currency",
    ),
    currencyRates: await groupedCounts(
      "select base::text || '/' || quote::text as key, count(*)::bigint as count from currency_rates group by base, quote order by base, quote",
    ),
    normalizedRows: await groupedCounts(
      "select coalesce(normalized_payload->>'currency', 'missing') as key, count(*)::bigint as count from import_rows group by 1 order by 1",
    ),
  };
}

async function collisionChecks() {
  return Promise.all([
    checkGroups(
      "account_identity",
      `
      select count(*)::bigint as size
      from accounts
      group by household_id, lower(trim(provider)), lower(trim(name))
      having count(*) > 1
    `,
    ),
    checkGroups(
      "instrument_identity_current",
      `
      select count(*)::bigint as size
      from instruments
      group by asset_class, currency,
        case when nullif(trim(symbol), '') is not null
          then 'symbol:' || upper(trim(symbol))
          else 'name:' || lower(trim(name)) end
      having count(*) > 1
    `,
    ),
    checkGroups(
      "instrument_identity_target_household",
      `
      with ownership as (
        select household_id, instrument_id from holding_snapshots
        union
        select household_id, instrument_id from transactions where instrument_id is not null
      )
      select count(*)::bigint as size
      from ownership join instruments on instruments.id = ownership.instrument_id
      group by ownership.household_id, instruments.asset_class, instruments.currency,
        case when nullif(trim(instruments.symbol), '') is not null
          then 'symbol:' || upper(trim(instruments.symbol))
          else 'name:' || lower(trim(instruments.name)) end
      having count(*) > 1
    `,
    ),
    checkGroups(
      "clerk_subject",
      "select count(*)::bigint as size from users group by clerk_user_id having count(*) > 1",
    ),
    checkGroups(
      "household_membership",
      "select count(*)::bigint as size from household_members group by household_id, user_id having count(*) > 1",
    ),
    checkGroups(
      "committed_import_dedupe",
      "select count(*)::bigint as size from import_batches where status = 'committed' group by household_id, file_hash, parser_version having count(*) > 1",
    ),
    checkGroups(
      "snapshot_key",
      "select count(*)::bigint as size from holding_snapshots group by household_id, account_id, instrument_id, snapshot_date, currency having count(*) > 1",
    ),
    checkGroups(
      "transaction_key",
      "select count(*)::bigint as size from transactions group by household_id, account_id, instrument_id, trade_date, type, amount, currency having count(*) > 1",
    ),
    checkGroups(
      "price_key",
      "select count(*)::bigint as size from prices group by instrument_id, price_date, source having count(*) > 1",
    ),
    checkGroups(
      "valuation_key",
      "select count(*)::bigint as size from portfolio_valuations group by household_id, valuation_date having count(*) > 1",
    ),
    checkGroups(
      "currency_rate_key",
      "select count(*)::bigint as size from currency_rates group by base, quote, provider having count(*) > 1",
    ),
  ]);
}

async function integrityChecks() {
  const checks = [
    [
      "batch_row_count_mismatch",
      `select 1 as item from import_batches b left join import_rows r on r.import_batch_id = b.id group by b.id, b.row_count having count(r.id) <> b.row_count`,
    ],
    [
      "import_row_missing_batch",
      `select 1 as item from import_rows r left join import_batches b on b.id = r.import_batch_id where b.id is null`,
    ],
    [
      "batch_missing_household",
      `select 1 as item from import_batches b left join households h on h.id = b.household_id where h.id is null`,
    ],
    [
      "batch_missing_uploader",
      `select 1 as item from import_batches b left join users u on u.id = b.uploaded_by_user_id where u.id is null`,
    ],
    [
      "membership_missing_parent",
      `select 1 as item from household_members m left join households h on h.id = m.household_id left join users u on u.id = m.user_id where h.id is null or u.id is null`,
    ],
    [
      "snapshot_reference_or_scope",
      `select 1 as item from holding_snapshots f left join households h on h.id=f.household_id left join accounts a on a.id=f.account_id left join instruments i on i.id=f.instrument_id left join import_batches b on b.id=f.import_batch_id where h.id is null or a.id is null or i.id is null or a.household_id <> f.household_id or (b.id is not null and b.household_id <> f.household_id)`,
    ],
    [
      "transaction_reference_or_scope",
      `select 1 as item from transactions f left join households h on h.id=f.household_id left join accounts a on a.id=f.account_id left join instruments i on i.id=f.instrument_id left join import_batches b on b.id=f.import_batch_id where h.id is null or a.id is null or a.household_id <> f.household_id or (f.instrument_id is not null and i.id is null) or (b.id is not null and b.household_id <> f.household_id)`,
    ],
    [
      "valuation_missing_household",
      `select 1 as item from portfolio_valuations f left join households h on h.id=f.household_id where h.id is null`,
    ],
    [
      "price_missing_instrument",
      `select 1 as item from prices p left join instruments i on i.id=p.instrument_id where i.id is null`,
    ],
  ];

  return Promise.all(checks.map(([name, query]) => checkRows(name, query)));
}

async function pricesSummary() {
  const [total] = await client.unsafe(
    "select count(*)::bigint as count from prices",
  );
  const groups = await groupedCounts(
    "select currency::text || '/' || source as key, count(*)::bigint as count from prices group by currency, source order by currency, source",
  );
  return { records: count(total?.count), groups };
}

async function sourceFileSummary() {
  const [row] = await client.unsafe(`
    select
      count(*) filter (where storage_path is not null)::bigint as referenced,
      count(*) filter (where storage_path is not null and expires_at <= now())::bigint as expired_referenced,
      count(*) filter (where storage_path is not null and expires_at > now())::bigint as unexpired_referenced
    from import_batches
  `);
  return {
    referenced: count(row?.referenced),
    expiredReferenced: count(row?.expired_referenced),
    unexpiredReferenced: count(row?.unexpired_referenced),
  };
}

async function pendingBatchSummary() {
  return groupedCounts(`
    select status::text || '/' || source_type::text || '/' ||
      case
        when row_count > 0 or storage_path is not null then 'meaningful'
        else 'empty'
      end || '/' ||
      case when expires_at <= now() then 'expired' else 'unexpired' end as key,
      count(*)::bigint as count
    from import_batches
    where status <> 'committed'
    group by 1 order by 1
  `);
}

async function largestBatchSummary() {
  const [row] = await client.unsafe(`
    with batch_metrics as (
      select
        b.id,
        b.source_type::text as source_type,
        count(r.id)::bigint as normalized_rows,
        coalesce(sum(octet_length(r.normalized_payload::text)), 0)::bigint as normalized_bytes,
        coalesce(max(octet_length(r.normalized_payload::text)), 0)::bigint as maximum_row_bytes,
        count(distinct (lower(trim(r.normalized_payload->>'provider')), lower(trim(r.normalized_payload->>'accountName')))) filter (where r.normalized_payload ? 'accountName')::bigint as accounts,
        count(distinct (r.normalized_payload->>'assetClass', r.normalized_payload->>'currency', coalesce('symbol:' || upper(trim(r.normalized_payload->>'symbol')), 'name:' || lower(trim(r.normalized_payload->>'instrumentName'))))) filter (where r.normalized_payload ? 'instrumentName')::bigint as instruments,
        count(*) filter (where r.normalized_payload->>'kind' in ('holding', 'transaction', 'valuation'))::bigint as fact_writes,
        count(distinct case when r.normalized_payload->>'kind' = 'holding' then concat_ws('|', r.normalized_payload->>'provider', r.normalized_payload->>'accountName', r.normalized_payload->>'assetClass', r.normalized_payload->>'currency', coalesce(r.normalized_payload->>'symbol', r.normalized_payload->>'instrumentName')) end)::bigint as positions,
        count(distinct r.normalized_payload->>'assetClass') filter (where r.normalized_payload->>'kind' = 'holding')::bigint as asset_classes,
        count(distinct coalesce(r.normalized_payload->>'sourceDate', r.normalized_payload->>'valuationDate', r.normalized_payload->>'tradeDate'))::bigint as timeline_points
      from import_batches b left join import_rows r on r.import_batch_id = b.id
      group by b.id, b.source_type
    )
    select * from batch_metrics order by normalized_rows desc, normalized_bytes desc limit 1
  `);
  if (!row) return null;
  const rowKindCounts = await client`
    select case when normalized_payload->>'kind' in ('holding', 'transaction', 'valuation')
      then normalized_payload->>'kind' else 'other' end as key,
      count(*)::bigint as count
    from import_rows where import_batch_id = ${row.id}
    group by 1 order by 1
  `;
  const currencyCounts = await client`
    select case when normalized_payload->>'currency' in ('INR', 'USD', 'BTC', 'ETH', 'OTHER')
      then normalized_payload->>'currency' else 'other' end as key,
      count(*)::bigint as count
    from import_rows where import_batch_id = ${row.id}
    group by 1 order by 1
  `;

  return {
    batchFingerprint: sourceFingerprint([runId, String(row.id)]),
    sourceType: row.source_type,
    normalizedRows: count(row.normalized_rows),
    normalizedSerializedBytes: count(row.normalized_bytes),
    maximumNormalizedRowBytes: count(row.maximum_row_bytes),
    distinctAccounts: count(row.accounts),
    distinctInstruments: count(row.instruments),
    projectedFactWritesLowerBound: count(row.fact_writes),
    projectedReadModelWritesLowerBound:
      count(row.positions) +
      count(row.asset_classes) +
      count(row.timeline_points) +
      2,
    rowKindCounts: rowKindCounts.map((item) => ({
      key: String(item.key),
      count: count(item.count),
    })),
    currencyCounts: currencyCounts.map((item) => ({
      key: String(item.key),
      count: count(item.count),
    })),
  };
}

async function largestHouseholdSummary() {
  const [row] = await client.unsafe(`
    with household_metrics as (
      select h.id,
        (select count(*) from accounts a where a.household_id=h.id)::bigint as accounts,
        (select count(*) from import_batches b where b.household_id=h.id)::bigint as import_batches,
        (select count(*) from import_rows r join import_batches b on b.id=r.import_batch_id where b.household_id=h.id)::bigint as import_rows,
        (select count(*) from holding_snapshots f where f.household_id=h.id)::bigint as holding_snapshots,
        (select count(*) from transactions f where f.household_id=h.id)::bigint as transactions,
        (select count(*) from portfolio_valuations f where f.household_id=h.id)::bigint as valuations,
        (select count(distinct instrument_id) from (
          select instrument_id from holding_snapshots f where f.household_id=h.id
          union all
          select instrument_id from transactions f where f.household_id=h.id and instrument_id is not null
        ) owned_instruments)::bigint as instruments,
        ((select count(*) from holding_snapshots f where f.household_id=h.id) +
         (select count(*) from transactions f where f.household_id=h.id) +
         (select count(*) from portfolio_valuations f where f.household_id=h.id))::bigint as fact_rows
      from households h
    )
    select accounts, instruments, import_batches, import_rows, holding_snapshots,
      transactions, valuations, fact_rows
    from household_metrics order by import_rows desc, fact_rows desc limit 1
  `);
  return row
    ? {
        accounts: count(row.accounts),
        instruments: count(row.instruments),
        importBatches: count(row.import_batches),
        importRows: count(row.import_rows),
        holdingSnapshots: count(row.holding_snapshots),
        transactions: count(row.transactions),
        valuations: count(row.valuations),
        factRows: count(row.fact_rows),
      }
    : null;
}

async function groupedCounts(query) {
  const rows = await client.unsafe(query);
  return rows.map((row) => ({ key: String(row.key), count: count(row.count) }));
}

async function checkGroups(check, query) {
  const rows = await client.unsafe(query);
  const sizes = rows.map((row) => count(row.size));
  return {
    check,
    groups: sizes.length,
    excessRecords: sizes.reduce((total, size) => total + size - 1, 0),
    maximumGroupSize: sizes.length === 0 ? 0 : Math.max(...sizes),
  };
}

async function checkRows(check, query) {
  const rows = await client.unsafe(query);
  return {
    check,
    groups: rows.length,
    excessRecords: rows.length,
    maximumGroupSize: rows.length === 0 ? 0 : 1,
  };
}

function count(value) {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result) || result < 0)
    fail("Inventory count exceeds safe integer range");
  return result;
}

function safeErrorCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9]{2,10}$/.test(code)
    ? ` (${code})`
    : "";
}
