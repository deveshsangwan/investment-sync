const fs = require("fs");
const path = require("path");
const postgres = require("../packages/db/node_modules/postgres");

const KNOWN_PRODUCTION_DB_MARKERS = ["vmwdfderegynrnsttuym"];

function envValue(key) {
  return process.env[key] ?? loadEnvFile()[key];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    clerkUserId: envValue("SEED_CLERK_USER_ID") ?? "user_dev_fake_portfolio",
    email: envValue("SEED_EMAIL") ?? "fake.portfolio@example.test",
    reset: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--clerk-user-id") {
      options.clerkUserId = args[index + 1];
      index += 1;
    } else if (arg === "--email") {
      options.email = args[index + 1];
      index += 1;
    } else if (arg === "--reset") {
      options.reset = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.clerkUserId) throw new Error("--clerk-user-id is required");
  if (!options.email) throw new Error("--email is required");
  return options;
}

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return {};

  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\n/)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    env[line.slice(0, separator)] = line
      .slice(separator + 1)
      .replace(/^"|"$/g, "");
  }
  return env;
}

function databaseUrl() {
  return process.env.DATABASE_URL ?? loadEnvFile().DATABASE_URL;
}

function assertSafeToSeed(url) {
  if (envValue("ALLOW_FAKE_DEV_SEED") !== "1") {
    throw new Error("Set ALLOW_FAKE_DEV_SEED=1 to seed fake development data.");
  }

  if (KNOWN_PRODUCTION_DB_MARKERS.some((marker) => url.includes(marker))) {
    throw new Error(
      "Refusing to seed fake data into the known production Supabase database.",
    );
  }
}

async function upsertUser(sql, options) {
  const [user] = await sql`
    insert into users (clerk_user_id, email)
    values (${options.clerkUserId}, ${options.email})
    on conflict (clerk_user_id)
    do update set email = excluded.email, updated_at = now()
    returning id
  `;

  return user.id;
}

async function resetExistingFakeData(sql, appUserId) {
  const households = await sql`
    select household_id
    from household_members
    where user_id = ${appUserId}
  `;

  for (const household of households) {
    await sql`
      delete from households
      where id = ${household.household_id}
    `;
  }
}

async function createHousehold(sql, appUserId) {
  const [household] = await sql`
    insert into households (name, owner_user_id)
    values ('Fake Dev Portfolio', ${appUserId})
    returning id
  `;

  await sql`
    insert into household_members (household_id, user_id, role)
    values (${household.id}, ${appUserId}, 'owner')
  `;

  return household.id;
}

async function createAccounts(sql, householdId) {
  const accountRows = [
    ["US Stocks", "Manual Workbook", "other", "INR"],
    ["US Stocks", "Vested / DriveWealth", "broker", "USD"],
    ["Indian Stocks", "Manual Workbook", "indian_stock", "INR"],
    ["Indian Stocks", "Tickertape", "broker", "INR"],
    ["Mutual Funds", "Manual Workbook", "mutual_fund", "INR"],
    ["Mutual Funds", "Tickertape", "mutual_fund", "INR"],
    ["NPS", "Manual Workbook", "nps", "INR"],
    ["NPS", "Manual", "retirement", "INR"],
    ["Crypto", "Manual Workbook", "crypto", "INR"],
    ["Crypto", "Manual", "crypto", "INR"],
  ];

  const accounts = {};
  for (const [name, provider, accountType, currency] of accountRows) {
    const [account] = await sql`
      insert into accounts (
        household_id,
        name,
        provider,
        account_type,
        currency,
        metadata
      )
      values (
        ${householdId},
        ${name},
        ${provider},
        ${accountType},
        ${currency},
        '{"fakeSeed": true}'::jsonb
      )
      returning id, name, provider
    `;

    accounts[`${account.name}|${account.provider}`] = account.id;
  }

  return accounts;
}

async function createInstruments(sql) {
  const instrumentRows = [
    ["FAKENVDA", "Fake Nvidia", "us_stock", "USD", "NASDAQ"],
    ["FAKETCS", "Fake TCS", "indian_stock", "INR", "NSE"],
    ["FAKEFLEXI", "Fake Flexi Cap Fund", "mutual_fund", "INR", null],
    ["FAKENPS", "Fake NPS Tier I", "nps", "INR", null],
    ["FAKEBTC", "Fake Bitcoin", "crypto", "INR", null],
  ];

  const instruments = {};
  for (const [symbol, name, assetClass, currency, exchange] of instrumentRows) {
    const [instrument] = await sql`
      insert into instruments (
        symbol,
        name,
        asset_class,
        currency,
        exchange,
        provider_metadata
      )
      values (
        ${symbol},
        ${name},
        ${assetClass},
        ${currency},
        ${exchange},
        '{"fakeSeed": true}'::jsonb
      )
      returning id, symbol
    `;

    instruments[instrument.symbol] = instrument.id;
  }

  return instruments;
}

function snapshot({ date, quantity, invested, current, currency, source }) {
  const pnl = current - invested;
  const pnlPercent = invested === 0 ? 0 : (pnl / invested) * 100;
  return {
    date,
    quantity,
    invested,
    current,
    pnl,
    pnlPercent,
    currency,
    source,
  };
}

async function createHoldingSnapshots(sql, householdId, accounts, instruments) {
  const rows = [
    {
      accountId: accounts["US Stocks|Manual Workbook"],
      instrumentId: instruments.FAKENVDA,
      values: [
        snapshot({
          date: "2024-07-27",
          quantity: 3,
          invested: 366.18,
          current: 304.47,
          currency: "USD",
          source: "manual workbook backfill",
        }),
        snapshot({
          date: "2025-05-16",
          quantity: 3,
          invested: 366.18,
          current: 406.2,
          currency: "USD",
          source: "manual workbook backfill",
        }),
        snapshot({
          date: "2025-12-05",
          quantity: 3.85,
          invested: 521.8,
          current: 702.89,
          currency: "USD",
          source: "manual workbook backfill",
        }),
      ],
    },
    {
      accountId: accounts["US Stocks|Vested / DriveWealth"],
      instrumentId: instruments.FAKENVDA,
      values: [
        snapshot({
          date: "2026-05-31",
          quantity: 4.88,
          invested: 716.81,
          current: 1100.78,
          currency: "USD",
          source: "broker export",
        }),
      ],
    },
    {
      accountId: accounts["Indian Stocks|Manual Workbook"],
      instrumentId: instruments.FAKETCS,
      values: [
        snapshot({
          date: "2025-01-31",
          quantity: 8,
          invested: 28000,
          current: 31200,
          currency: "INR",
          source: "manual workbook backfill",
        }),
      ],
    },
    {
      accountId: accounts["Indian Stocks|Tickertape"],
      instrumentId: instruments.FAKETCS,
      values: [
        snapshot({
          date: "2026-05-31",
          quantity: 8,
          invested: 28000,
          current: 34640,
          currency: "INR",
          source: "tickertape export",
        }),
      ],
    },
    {
      accountId: accounts["Mutual Funds|Manual Workbook"],
      instrumentId: instruments.FAKEFLEXI,
      values: [
        snapshot({
          date: "2025-03-31",
          quantity: 120,
          invested: 50000,
          current: 54800,
          currency: "INR",
          source: "manual workbook backfill",
        }),
      ],
    },
    {
      accountId: accounts["Mutual Funds|Tickertape"],
      instrumentId: instruments.FAKEFLEXI,
      values: [
        snapshot({
          date: "2026-05-31",
          quantity: 120,
          invested: 50000,
          current: 62100,
          currency: "INR",
          source: "tickertape export",
        }),
      ],
    },
    {
      accountId: accounts["NPS|Manual Workbook"],
      instrumentId: instruments.FAKENPS,
      values: [
        snapshot({
          date: "2025-06-30",
          quantity: null,
          invested: 80000,
          current: 86400,
          currency: "INR",
          source: "manual workbook backfill",
        }),
      ],
    },
    {
      accountId: accounts["NPS|Manual"],
      instrumentId: instruments.FAKENPS,
      values: [
        snapshot({
          date: "2026-05-31",
          quantity: null,
          invested: 95000,
          current: 105450,
          currency: "INR",
          source: "manual snapshot",
        }),
      ],
    },
    {
      accountId: accounts["Crypto|Manual Workbook"],
      instrumentId: instruments.FAKEBTC,
      values: [
        snapshot({
          date: "2025-11-01",
          quantity: 0.03,
          invested: 180000,
          current: 211000,
          currency: "INR",
          source: "manual workbook backfill",
        }),
      ],
    },
    {
      accountId: accounts["Crypto|Manual"],
      instrumentId: instruments.FAKEBTC,
      values: [
        snapshot({
          date: "2026-05-31",
          quantity: 0.03,
          invested: 180000,
          current: 248000,
          currency: "INR",
          source: "manual snapshot",
        }),
      ],
    },
  ];

  let count = 0;
  for (const group of rows) {
    for (const point of group.values) {
      await sql`
        insert into holding_snapshots (
          household_id,
          account_id,
          instrument_id,
          snapshot_date,
          quantity,
          invested_amount,
          current_value,
          pnl_amount,
          pnl_percent,
          currency,
          source_payload
        )
        values (
          ${householdId},
          ${group.accountId},
          ${group.instrumentId},
          ${point.date},
          ${point.quantity},
          ${point.invested},
          ${point.current},
          ${point.pnl},
          ${point.pnlPercent},
          ${point.currency},
          ${sql.json({
            fakeSeed: true,
            source: point.source,
          })}
        )
      `;
      count += 1;
    }
  }

  return count;
}

async function createPortfolioValuations(sql, householdId) {
  const valuations = [
    ["2025-01-31", 580000, 621000],
    ["2025-06-30", 710000, 783000],
    ["2025-12-05", 820000, 944000],
    ["2026-05-31", 965000, 1242500],
  ];

  for (const [date, invested, current] of valuations) {
    await sql`
      insert into portfolio_valuations (
        household_id,
        valuation_date,
        invested_amount,
        current_value,
        pnl_amount,
        currency,
        metadata
      )
      values (
        ${householdId},
        ${date},
        ${invested},
        ${current},
        ${current - invested},
        'INR',
        '{"fakeSeed": true}'::jsonb
      )
    `;
  }

  return valuations.length;
}

async function main() {
  const options = parseArgs();
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is required");
  assertSafeToSeed(url);

  const sql = postgres(url, { max: 1, prepare: false });

  try {
    const result = await sql.begin(async (transaction) => {
      const appUserId = await upsertUser(transaction, options);
      if (options.reset) {
        await resetExistingFakeData(transaction, appUserId);
      }

      const householdId = await createHousehold(transaction, appUserId);
      const accounts = await createAccounts(transaction, householdId);
      const instruments = await createInstruments(transaction);
      const holdingSnapshotCount = await createHoldingSnapshots(
        transaction,
        householdId,
        accounts,
        instruments,
      );
      const valuationCount = await createPortfolioValuations(
        transaction,
        householdId,
      );

      return {
        appUserId,
        householdId,
        holdingSnapshotCount,
        valuationCount,
        sampleHoldingUrl: `/dashboard/holdings/${await latestFakeHoldingId(
          transaction,
          householdId,
          instruments.FAKENVDA,
        )}`,
      };
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sql.end();
  }
}

async function latestFakeHoldingId(sql, householdId, instrumentId) {
  const [holding] = await sql`
    select id
    from holding_snapshots
    where household_id = ${householdId}
      and instrument_id = ${instrumentId}
    order by snapshot_date desc
    limit 1
  `;

  return holding.id;
}

main().catch((error) => {
  console.error(`SEED_FAILED ${error.message}`);
  process.exit(1);
});
