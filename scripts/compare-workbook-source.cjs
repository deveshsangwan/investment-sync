const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("../packages/importers/node_modules/xlsx");
const postgres = require("../packages/db/node_modules/postgres");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), "apps/web/.env.local"));
loadEnvFile(path.resolve(process.cwd(), "packages/db/.env.local"));

const workbookPath = process.argv[2];

if (!workbookPath) {
  console.error(
    "Usage: node scripts/compare-workbook-source.cjs <workbook.xlsx>",
  );
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
});

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });

async function main() {
  const file = parseWorkbook(workbookPath);
  const db = await loadCurrentDbHoldings();
  const currentComparison = compareHoldings(
    file.currentHoldings,
    db.currentHoldings,
  );
  const historicalComparison = compareHistoricalSnapshots(
    file.allHoldings,
    db.historicalHoldings,
  );

  console.log(
    JSON.stringify(
      {
        file: {
          path: workbookPath,
          currentCount: file.currentHoldings.length,
          historicalSnapshotCount: file.allHoldings.length,
          currentByClass: summarizeByClass(file.currentHoldings),
          latestDateBySheet: file.latestDateBySheet,
        },
        db: {
          currentCount: db.currentHoldings.length,
          historicalSnapshotCount: db.historicalHoldings.length,
          currentByClass: summarizeByClass(db.currentHoldings),
        },
        currentComparison,
        historicalComparison,
      },
      null,
      2,
    ),
  );
}

function parseWorkbook(filePath) {
  const workbook = XLSX.read(fs.readFileSync(filePath), { cellDates: true });
  const rows = (sheetName) =>
    XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: "",
    });

  const initialDate = firstPortfolioDate(rows("Investment Portfolio"));
  const allHoldings = [];

  const add = (holding) => {
    const key = canonicalKey(holding);
    allHoldings.push({ ...holding, key });
  };

  parseBlockSheet(rows("Stock Investments"), initialDate, add, {
    sheet: "Stock Investments",
    assetClass: "indian_stock",
    currency: "INR",
    nameColumn: 0,
    quantityColumn: 2,
    investedColumn: 6,
    currentColumn: 7,
    symbolFromName: true,
  });
  parseBlockSheet(rows("Mutual Funds"), initialDate, add, {
    sheet: "Mutual Funds",
    assetClass: "mutual_fund",
    currency: "INR",
    nameColumn: 0,
    quantityColumn: 7,
    investedColumn: 8,
    currentColumn: 9,
  });
  parseBlockSheet(rows("ULIPS"), initialDate, add, {
    sheet: "ULIPS",
    assetClass: "ulip",
    currency: "INR",
    nameColumn: 0,
    investedColumn: 1,
    currentColumn: 3,
  });
  parseBlockSheet(rows("Crypto"), initialDate, add, {
    sheet: "Crypto",
    assetClass: "crypto",
    currency: "OTHER",
    nameColumn: 0,
    quantityColumn: 1,
    investedColumn: 2,
    currentColumn: 4,
  });
  parseBlockSheet(rows("US stocks"), initialDate, add, {
    sheet: "US stocks",
    assetClass: "us_stock",
    currency: "USD",
    nameColumn: 0,
    quantityColumn: 1,
    investedColumn: 3,
    currentColumn: 2,
    symbolFromName: true,
  });

  let npsDate = initialDate;
  for (const row of rows("NPS")) {
    const date = toIsoDate(row[0]);
    if (date) {
      npsDate = date;
      continue;
    }
    const current = parseNumber(row[0]);
    const invested = parseNumber(row[2]);
    if (npsDate && current !== undefined && invested !== undefined) {
      add({
        sheet: "NPS",
        date: npsDate,
        assetClass: "nps",
        currency: "INR",
        name: "NPS",
        invested,
        current,
      });
    }
  }

  const latestDateBySheet = new Map();
  for (const holding of allHoldings) {
    const current = latestDateBySheet.get(holding.sheet);
    if (!current || holding.date > current) {
      latestDateBySheet.set(holding.sheet, holding.date);
    }
  }

  const currentHoldings = allHoldings
    .filter((holding) => holding.date === latestDateBySheet.get(holding.sheet))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    allHoldings,
    currentHoldings,
    latestDateBySheet: Object.fromEntries(latestDateBySheet),
  };
}

function parseBlockSheet(rows, initialDate, add, options) {
  let date = initialDate;
  for (const row of rows.slice(1)) {
    const rowDate = toIsoDate(row[0]);
    if (rowDate) {
      date = rowDate;
      continue;
    }

    const name = String(row[options.nameColumn] ?? "").trim();
    if (!name || ["total", "stocks/etfs"].includes(name.toLowerCase())) {
      continue;
    }

    const invested = parseNumber(row[options.investedColumn]) ?? 0;
    const current = parseNumber(row[options.currentColumn]) ?? 0;
    if (invested === 0 && current === 0) continue;

    add({
      sheet: options.sheet,
      date,
      assetClass: options.assetClass,
      currency: options.currency,
      name,
      symbol: options.symbolFromName ? name : undefined,
      quantity:
        options.quantityColumn === undefined
          ? undefined
          : parseNumber(row[options.quantityColumn]),
      invested,
      current,
    });
  }
}

async function loadCurrentDbHoldings() {
  const rows = await sql`
    select
      hs.id,
      hs.snapshot_date,
      a.name as account_name,
      a.provider,
      i.name as instrument_name,
      i.symbol,
      i.asset_class,
      hs.currency,
      hs.quantity,
      hs.invested_amount,
      hs.current_value,
      hs.source_payload
    from holding_snapshots hs
    inner join accounts a on hs.account_id = a.id
    inner join instruments i on hs.instrument_id = i.id
    where not (
      coalesce(hs.source_payload->>'isAggregate', 'false') = 'true'
      or coalesce(hs.source_payload->>'sourceSheet', '') = 'Investment Portfolio'
      or i.name ilike '% Summary'
    )
    order by hs.snapshot_date desc
  `;
  const historicalHoldings = rows.map((row) => ({
    id: row.id,
    key: canonicalKey({
      assetClass: row.asset_class,
      symbol: row.symbol,
      name: row.instrument_name,
      currency: row.currency,
    }),
    date: toIsoDate(row.snapshot_date),
    assetClass: row.asset_class,
    currency: row.currency,
    name: row.instrument_name,
    symbol: row.symbol,
    quantity: row.quantity === null ? undefined : Number(row.quantity),
    invested: Number(row.invested_amount),
    current: Number(row.current_value),
    provider: row.provider,
    source: row.source_payload?.sourceSheet ?? null,
  }));

  const latestDateBySourceGroup = new Map();
  for (const row of rows) {
    row.date = toIsoDate(row.snapshot_date);
    const key = sourceGroupKey(row);
    const current = latestDateBySourceGroup.get(key);
    if (!current || row.date > current) {
      latestDateBySourceGroup.set(key, row.date);
    }
  }

  const sourceCurrentRows = rows.filter(
    (row) => row.date === latestDateBySourceGroup.get(sourceGroupKey(row)),
  );
  const selected = new Map();
  for (const row of sourceCurrentRows) {
    const holding = {
      id: row.id,
      key: canonicalKey({
        assetClass: row.asset_class,
        symbol: row.symbol,
        name: row.instrument_name,
        currency: row.currency,
      }),
      date: row.date,
      assetClass: row.asset_class,
      currency: row.currency,
      name: row.instrument_name,
      symbol: row.symbol,
      quantity: row.quantity === null ? undefined : Number(row.quantity),
      invested: Number(row.invested_amount),
      current: Number(row.current_value),
      provider: row.provider,
      source: row.source_payload?.sourceSheet ?? null,
    };
    const current = selected.get(holding.key);
    if (!current || holding.date > current.date) {
      selected.set(holding.key, holding);
    }
  }

  return {
    historicalHoldings,
    currentHoldings: [...selected.values()].sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
  };
}

function compareHoldings(fileHoldings, dbHoldings) {
  const fileMap = new Map(
    fileHoldings.map((holding) => [holding.key, holding]),
  );
  const dbMap = new Map(dbHoldings.map((holding) => [holding.key, holding]));
  const missingInDb = [];
  const extraInDb = [];
  const mismatched = [];

  for (const [key, fileHolding] of fileMap) {
    const dbHolding = dbMap.get(key);
    if (!dbHolding) {
      missingInDb.push(fileHolding);
      continue;
    }

    const diffs = {};
    if (
      fileHolding.quantity !== undefined &&
      dbHolding.quantity !== undefined &&
      !sameNumber(fileHolding.quantity, dbHolding.quantity, 0.000001)
    ) {
      diffs.quantity = { file: fileHolding.quantity, db: dbHolding.quantity };
    }
    if (!sameNumber(fileHolding.invested, dbHolding.invested, 0.02)) {
      diffs.invested = { file: fileHolding.invested, db: dbHolding.invested };
    }
    if (!sameNumber(fileHolding.current, dbHolding.current, 0.02)) {
      diffs.current = { file: fileHolding.current, db: dbHolding.current };
    }
    if (fileHolding.date !== dbHolding.date) {
      diffs.date = {
        file: fileHolding.date,
        db: dbHolding.date,
        provider: dbHolding.provider,
        source: dbHolding.source,
      };
    }

    if (Object.keys(diffs).length > 0) {
      mismatched.push({
        key,
        name: fileHolding.name,
        symbol: fileHolding.symbol,
        assetClass: fileHolding.assetClass,
        diffs,
      });
    }
  }

  for (const [key, dbHolding] of dbMap) {
    if (!fileMap.has(key)) {
      extraInDb.push(dbHolding);
    }
  }

  return {
    missingInDbCount: missingInDb.length,
    extraInDbCount: extraInDb.length,
    mismatchedCount: mismatched.length,
    missingInDb,
    extraInDb,
    mismatched,
  };
}

function compareHistoricalSnapshots(fileHoldings, dbHoldings) {
  const dbKeys = new Set(dbHoldings.map(snapshotKey));
  const fileKeys = new Set(fileHoldings.map(snapshotKey));
  return {
    missingHistoricalSnapshotsInDb: fileHoldings
      .filter((holding) => !dbKeys.has(snapshotKey(holding)))
      .slice(0, 100),
    missingHistoricalSnapshotsInDbCount: fileHoldings.filter(
      (holding) => !dbKeys.has(snapshotKey(holding)),
    ).length,
    extraHistoricalSnapshotsInDbCount: dbHoldings.filter(
      (holding) => !fileKeys.has(snapshotKey(holding)),
    ).length,
  };
}

function snapshotKey(holding) {
  return [
    holding.key,
    holding.date,
    roundKey(holding.quantity),
    roundKey(holding.invested),
    roundKey(holding.current),
  ].join("|");
}

function roundKey(value) {
  return value === undefined ? "" : Number(value).toFixed(2);
}

function firstPortfolioDate(rows) {
  for (const row of rows.slice(1)) {
    const date = toIsoDate(row[0]);
    if (date) return date;
  }
}

function sourceGroupKey(row) {
  return [
    row.account_name,
    row.provider,
    row.asset_class,
    row.currency,
    row.source_payload?.sourceSheet ?? "",
  ].join("|");
}

function canonicalKey(holding) {
  return [
    holding.assetClass,
    holding.symbol?.trim().toUpperCase() || holding.name.trim().toUpperCase(),
    holding.currency,
  ].join("|");
}

function summarizeByClass(holdings) {
  return holdings.reduce((summary, holding) => {
    summary[holding.assetClass] = (summary[holding.assetClass] ?? 0) + 1;
    return summary;
  }, {});
}

function parseNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sameNumber(left, right, tolerance) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function toIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
}
