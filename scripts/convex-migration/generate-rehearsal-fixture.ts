import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { drizzle } from "../../packages/db/node_modules/drizzle-orm/postgres-js";
import { migrate } from "../../packages/db/node_modules/drizzle-orm/postgres-js/migrator";
import postgres from "../../packages/db/node_modules/postgres";
import { eq } from "../../packages/db/node_modules/drizzle-orm";
import * as schema from "../../packages/db/src/schema";
import type { Database } from "../../packages/db/src/client";
import { parserGoldenFixtures } from "../../packages/importers/src/golden-fixtures";
import {
  parseImportFile,
  type NormalizedHoldingRow,
  type NormalizedImportRow,
  type ImportSourceType,
} from "../../packages/importers/src/index";
import {
  commitImport,
  runImportEffect,
} from "../../packages/api/src/services/import-service";
import type { MembershipContext } from "../../packages/api/src/services/membership";
import type { ApiContext } from "../../packages/api/src/context";

interface RuntimeHelpers {
  parseArguments: (argv: string[]) => Map<string, string>;
  assertAllowedArguments: (
    args: Map<string, string>,
    allowed: string[],
  ) => void;
  loadExplicitEnvironment: (file: string) => Record<string, string>;
  createProtectedRunDirectory: (runId: string) => string;
  writeProtectedJson: (directory: string, file: string, value: unknown) => void;
}

const requireFromScript = createRequire(path.resolve(__dirname, "runtime.cjs"));
const runtime = requireFromScript("./runtime.cjs") as RuntimeHelpers;
const requireFromDatabase = createRequire(
  path.resolve(__dirname, "../../packages/db/package.json"),
);
const { createClient } = requireFromDatabase("@supabase/supabase-js") as {
  createClient: (
    url: string,
    key: string,
    options: { auth: { persistSession: boolean; autoRefreshToken: boolean } },
  ) => ApiContext["supabase"];
};
const EVALUATION_TIME = "2026-06-20T12:00:00.000Z";
const FIXTURE_VERSION = "phase6-generated-v2";
const FIXED_DATE = new Date(EVALUATION_TIME);
const FUTURE_EXPIRY = new Date("2026-07-20T12:00:00.000Z");
const PAST_EXPIRY = new Date("2026-06-01T12:00:00.000Z");
const TABLES = [
  "users",
  "households",
  "household_members",
  "accounts",
  "instruments",
  "import_batches",
  "import_rows",
  "holding_snapshots",
  "transactions",
  "portfolio_valuations",
  "currency_rates",
  "prices",
] as const;

type FixtureBatch = {
  name: string;
  membership: MembershipContext;
  rows: NormalizedImportRow[];
  sourceType: ImportSourceType;
  parserVersion: string;
  originalFileName: string;
  uploadedAt: Date;
  content?: Buffer;
  expiresAt?: Date;
  status?: typeof schema.importBatches.$inferInsert.status;
  commit?: boolean;
  declaredRowCount?: number;
};

type FixtureFile = { storagePath: string; artifact: string };

async function main() {
  const args = runtime.parseArguments(process.argv.slice(2));
  runtime.assertAllowedArguments(args, ["env-file", "run-id"]);
  const envFile = args.get("env-file");
  const runId = args.get("run-id");
  if (!envFile || !runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId)) {
    throw new Error("Pass an explicit --env-file and filesystem-safe --run-id");
  }

  const environment = runtime.loadExplicitEnvironment(path.resolve(envFile));
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("Explicit environment lacks DATABASE_URL");
  const database = new URL(databaseUrl);
  const databaseName = database.pathname.slice(1);
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
    !/^investment_sync_migration_[a-z0-9_]+$/.test(databaseName)
  ) {
    throw new Error(
      "Fixture generation requires a dedicated loopback migration database",
    );
  }

  const runDirectory = runtime.createProtectedRunDirectory(runId);
  await createFixtureDatabase(database, databaseName);
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });

  try {
    await client`select pg_advisory_lock(hashtext('investment-sync-generated-migration-fixture'))`;
    if (!(await isEmptyFixtureDatabase(client))) {
      await verifyExistingFixture(client, runDirectory);
      console.log(
        JSON.stringify({
          fixtureVersion: FIXTURE_VERSION,
          reused: true,
          evaluationTime: EVALUATION_TIME,
        }),
      );
      return;
    }

    const metadataPath = path.join(runDirectory, "fixture-metadata.json");
    if (fs.existsSync(metadataPath))
      throw new Error("Fixture artifacts exist for an empty database");

    await migrate(db, {
      migrationsFolder: path.resolve(__dirname, "../../packages/db/drizzle"),
    });

    const memberships = await seedIdentities(db);
    const batches = fixtureBatches(memberships);
    await seedCanonicalIdentities(db, batches);
    const files: FixtureFile[] = [];
    for (const batch of batches)
      await seedBatch(db, batch, files, runDirectory);
    await seedOperationalHistory(db, memberships);
    await preservePersistedPrecision(client);
    await normalizeGeneratedIdsAndTimestamps(client);

    const contents = await fixtureContents(client);
    runtime.writeProtectedJson(
      runDirectory,
      "fixture-files.json",
      files.sort((a, b) => a.storagePath.localeCompare(b.storagePath)),
    );
    runtime.writeProtectedJson(runDirectory, "fixture-metadata.json", {
      fixtureVersion: FIXTURE_VERSION,
      evaluationTime: EVALUATION_TIME,
      sourceDigest: contents.digest,
      counts: contents.counts,
      pendingExpiredBatchId: fixtureId("batch:expired-pending"),
      declaredRowCountBatchId: fixtureId("batch:historical-declared-seven"),
      ownerClerkSubjects: memberships.map((membership) => membership.userId),
    });
    console.log(
      JSON.stringify({
        fixtureVersion: FIXTURE_VERSION,
        reused: false,
        counts: contents.counts,
        availableFiles: files.length,
        evaluationTime: EVALUATION_TIME,
      }),
    );
  } finally {
    await client.end();
  }
}

async function isEmptyFixtureDatabase(client: postgres.Sql) {
  const tables = await client<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `;
  let hasRows = false;
  for (const { tablename } of tables) {
    if (!TABLES.some((name) => name === tablename)) {
      throw new Error(
        "Refusing a fixture database containing an unrelated table",
      );
    }

    const count = await client.unsafe<{ count: string }[]>(
      `select count(*)::text as count from ${tablename}`,
    );
    if (count[0]?.count !== "0") hasRows = true;
  }

  return !hasRows;
}

async function createFixtureDatabase(database: URL, databaseName: string) {
  const administrativeUrl = new URL(database);
  administrativeUrl.pathname = "/postgres";
  const client = postgres(administrativeUrl.toString(), {
    max: 1,
    prepare: false,
  });

  try {
    const existing =
      await client`select datname from pg_database where datname = ${databaseName}`;
    if (existing.length === 0)
      await client.unsafe(`create database "${databaseName}"`);
  } finally {
    await client.end();
  }
}

function fixtureId(value: string) {
  const digest = createHash("sha256")
    .update(`${FIXTURE_VERSION}:${value}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function seedIdentities(db: Database) {
  const memberships: MembershipContext[] = [];
  for (const name of ["primary", "secondary", "parsers"]) {
    const userId = `user_rehearsal_${name}`;
    const appUserId = fixtureId(`user:${name}`);
    const householdId = fixtureId(`household:${name}`);
    await db.insert(schema.users).values({
      id: appUserId,
      clerkUserId: userId,
      email: `${name}@example.test`,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    });
    await db.insert(schema.households).values({
      id: householdId,
      ownerUserId: appUserId,
      name: `Generated ${name} portfolio`,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    });
    await db.insert(schema.householdMembers).values({
      id: fixtureId(`member:${name}`),
      householdId,
      userId: appUserId,
      role: "owner",
      createdAt: FIXED_DATE,
    });
    memberships.push({ userId, appUserId, householdId, role: "owner" });
  }

  const primary = memberships[0];
  if (!primary) throw new Error("Missing primary fixture identity");
  const viewerId = fixtureId("user:viewer");
  await db.insert(schema.users).values({
    id: viewerId,
    clerkUserId: "user_rehearsal_viewer",
    email: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  });
  await db.insert(schema.householdMembers).values({
    id: fixtureId("member:viewer"),
    householdId: primary.householdId,
    userId: viewerId,
    role: "viewer",
    createdAt: FIXED_DATE,
  });
  await db.insert(schema.accounts).values({
    id: fixtureId("account:unused-archived"),
    householdId: primary.householdId,
    name: "Archived generated account",
    provider: "Generated Provider",
    accountType: "broker",
    currency: "INR",
    isArchived: true,
    metadata: { generated: true, nested: { preserved: ["0.0001", null] } },
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  });

  return memberships;
}

function holding(
  symbol: string,
  sourceDate: string,
  overrides: Partial<NormalizedHoldingRow> = {},
): NormalizedHoldingRow {
  return {
    kind: "holding",
    sourceType: "tickertape_stock_csv",
    sourceDate,
    accountName: "Indian Stocks",
    provider: "Tickertape",
    instrumentName: symbol,
    symbol,
    assetClass: "indian_stock",
    currency: "INR",
    quantity: 10,
    investedAmount: 100,
    currentValue: 125,
    pnlAmount: 25,
    pnlPercent: 25,
    metadata: {},
    ...overrides,
  };
}

function usHolding(
  symbol: string,
  date: string,
  workbook = false,
  overrides: Partial<NormalizedHoldingRow> = {},
) {
  return holding(symbol, date, {
    sourceType: workbook
      ? "investment_portfolio_xlsx"
      : "vested_drivewealth_xlsx",
    accountName: "US Stocks",
    provider: workbook ? "Manual Workbook" : "Vested / DriveWealth",
    assetClass: "us_stock",
    currency: "USD",
    metadata: workbook ? { sourceSheet: "US stocks" } : {},
    ...overrides,
  });
}

function fixtureBatches(memberships: MembershipContext[]): FixtureBatch[] {
  const [primary, secondary, parsers] = memberships;
  if (!primary || !secondary || !parsers)
    throw new Error("Missing fixture memberships");
  const batch = (
    name: string,
    rows: NormalizedImportRow[],
    membership = primary,
  ): FixtureBatch => ({
    name,
    membership,
    rows,
    sourceType: rows[0]?.sourceType ?? "unknown",
    parserVersion: "rehearsal-historical-v1",
    originalFileName: `${name}.csv`,
    uploadedAt: new Date("2026-06-16T12:00:00.000Z"),
    expiresAt: PAST_EXPIRY,
    commit: true,
  });
  const nps = (
    sourceType: "nps_csv" | "investment_portfolio_xlsx",
    currentValue: number,
  ) =>
    holding("NPS", "2026-06-16", {
      sourceType,
      accountName: "NPS",
      provider: "NPS",
      symbol: undefined,
      assetClass: "nps",
      currency: "INR",
      quantity: undefined,
      investedAmount: 900,
      currentValue,
      pnlAmount: currentValue - 900,
      metadata: {
        sourceSheet: "NPS",
        ...(sourceType === "nps_csv"
          ? {
              npsDetails: {
                schemaVersion: 1,
                tier: "I",
                totalContribution: 900,
                totalWithdrawal: 0,
                schemes: [
                  {
                    code: "E",
                    sourceName: "Generated scheme E",
                    currentValue,
                    units: 10,
                    nav: currentValue / 10,
                  },
                ],
                contributionEvents: [],
                activities: [],
              },
            }
          : {}),
      },
    });

  const batches = [
    batch("us-workbook-old", [
      usHolding("BBAI", "2026-06-01", true),
      usHolding("NVDA", "2026-06-01", true),
      usHolding("OLD", "2026-06-01", true),
    ]),
    batch("us-vested-history", [
      usHolding("BBAI", "2026-06-05"),
      usHolding("NVDA", "2026-06-05", false, {
        quantity: 2,
        currentValue: 260,
      }),
    ]),
    batch("us-workbook-same-day", [
      usHolding("BBAI", "2026-06-16", true),
      usHolding("NVDA", "2026-06-16", true, { quantity: 7, currentValue: 700 }),
    ]),
    batch("us-vested-same-day", [
      usHolding("NVDA", "2026-06-16", false, {
        quantity: 1,
        currentValue: 250,
      }),
      {
        kind: "transaction",
        sourceType: "vested_drivewealth_xlsx",
        accountName: "US Stocks",
        provider: "Vested / DriveWealth",
        instrumentName: "NVDA",
        symbol: "NVDA",
        assetClass: "us_stock",
        currency: "USD",
        tradeDate: "2026-06-12",
        type: "sell",
        quantity: 1,
        price: 130,
        amount: 130,
        metadata: { generatedPartialSale: true },
      },
    ]),
    batch("independent-current", [
      holding("SHARED", "2026-06-01", {
        sourceType: "investment_portfolio_xlsx",
        accountName: "Independent Indian Stocks",
        provider: "Manual Workbook",
        metadata: { sourceSheet: "Stock Investments" },
      }),
    ]),
    batch("indian-history", [
      holding("SHARED", "2026-06-05"),
      holding("PARTIAL", "2026-06-05"),
      holding("PRECISE", "2026-06-05"),
    ]),
    batch("indian-current", [
      holding("PARTIAL", "2026-06-16", {
        quantity: 6,
        investedAmount: 60,
        currentValue: 90,
        pnlAmount: 30,
        pnlPercent: 50,
      }),
      holding("PRECISE", "2026-06-16"),
      {
        kind: "transaction",
        sourceType: "tickertape_stock_csv",
        accountName: "Indian Stocks",
        provider: "Tickertape",
        instrumentName: "PARTIAL",
        symbol: "PARTIAL",
        assetClass: "indian_stock",
        currency: "INR",
        tradeDate: "2026-06-12",
        type: "sell",
        quantity: 4,
        price: 15,
        amount: 60,
        metadata: { generatedPartialSale: true },
      },
    ]),
    batch("nps-workbook", [nps("investment_portfolio_xlsx", 1100)]),
    batch("nps-portal", [nps("nps_csv", 1200)]),
    batch("nps-workbook-late", [nps("investment_portfolio_xlsx", 1300)]),
    batch("aggregate-and-details", [
      holding("INDIAN STOCKS TOTAL", "2026-06-16", {
        sourceType: "investment_portfolio_xlsx",
        accountName: "Aggregate demonstration",
        provider: "Manual Workbook",
        symbol: undefined,
        metadata: { sourceSheet: "Stock Investments", isAggregate: true },
      }),
      holding("DETAIL", "2026-06-16", {
        sourceType: "investment_portfolio_xlsx",
        accountName: "Aggregate demonstration",
        provider: "Manual Workbook",
        metadata: { sourceSheet: "Stock Investments" },
      }),
    ]),
    batch("valuations", [
      {
        kind: "valuation",
        sourceType: "investment_portfolio_xlsx",
        valuationDate: "2026-06-01",
        investedAmount: 1000,
        currentValue: 1100,
        pnlAmount: 100,
        currency: "INR",
        metadata: { generatedExplicitValuation: true },
      },
      {
        kind: "valuation",
        sourceType: "investment_portfolio_xlsx",
        valuationDate: "2026-06-16",
        investedAmount: 1200,
        currentValue: 1500,
        pnlAmount: 300,
        currency: "INR",
        metadata: { generatedExplicitValuation: true },
      },
    ]),
    batch(
      "secondary-shared",
      [
        holding("SHARED", "2026-06-16", {
          quantity: 3,
          investedAmount: 300,
          currentValue: 375,
        }),
      ],
      secondary,
    ),
    batch(
      "secondary-other-asset-classes",
      (
        [
          ["GENERATED_CASH", "cash", "INR"],
          ["GENERATED_ULIP", "ulip", "INR"],
          ["GENERATED_CRYPTO", "crypto", "INR"],
          ["GENERATED_OTHER", "other", "INR"],
          ["GENERATED_BTC_NATIVE", "cash", "BTC"],
          ["GENERATED_ETH_NATIVE", "other", "ETH"],
          ["GENERATED_OTHER_NATIVE", "other", "OTHER"],
        ] as const
      ).map(([symbol, assetClass, currency]) =>
        holding(symbol, "2026-06-16", {
          sourceType: "manual_snapshot",
          accountName: `Generated ${assetClass} ${currency}`,
          provider: "Generated Provider",
          assetClass,
          currency,
          metadata: { generated: true },
        }),
      ),
      secondary,
    ),
  ];

  for (const fixture of parserGoldenFixtures()) {
    // Move only the generated NPS statement into the common comparison window.
    const content =
      fixture.expected.sourceType === "nps_csv"
        ? Buffer.from(
            fixture.file.content
              .toString("utf8")
              .replaceAll("August 08 2026", "June 16 2026")
              .replaceAll("07-Aug-2026", "15-Jun-2026")
              .replaceAll("01/08/2026", "01/06/2026")
              .replaceAll("08/08/2026", "16/06/2026"),
          )
        : fixture.file.content;
    const parsed = parseImportFile({ ...fixture.file, content });
    batches.push({
      name: `parser-${parsed.sourceType}`,
      membership: parsers,
      rows: parsed.rows,
      sourceType: parsed.sourceType,
      parserVersion: parsed.parserVersion,
      originalFileName: fixture.file.fileName,
      uploadedAt: new Date("2026-06-16T12:00:00.000Z"),
      expiresAt: FUTURE_EXPIRY,
      content,
      commit: true,
    });
  }

  batches.push({
    ...batch(
      "historical-declared-seven",
      Array.from({ length: 6 }, (_, index) =>
        holding(`Generated Fund ${index + 1}`, "2026-06-06", {
          sourceType: "tickertape_mutual_fund_csv",
          accountName: "Mutual Funds",
          provider: "Tickertape",
          symbol: undefined,
          assetClass: "mutual_fund",
          quantity: index + 1,
          investedAmount: (index + 1) * 100,
          currentValue: (index + 1) * 125,
        }),
      ),
      parsers,
    ),
    declaredRowCount: 7,
  });
  batches.push({
    ...batch("expired-pending", [
      holding("PENDING", "2026-06-16", {
        accountName: "Pending generated account",
      }),
    ]),
    status: "expired",
    commit: false,
  });

  return batches;
}

function accountIdentity(
  row:
    | NormalizedHoldingRow
    | Extract<NormalizedImportRow, { kind: "transaction" }>,
) {
  return JSON.stringify([
    row.provider.trim().toLowerCase(),
    row.accountName.trim().toLowerCase(),
  ]);
}

function instrumentIdentity(
  row:
    | NormalizedHoldingRow
    | Extract<NormalizedImportRow, { kind: "transaction" }>,
) {
  const symbol = row.symbol?.trim().toUpperCase();
  return JSON.stringify([
    row.assetClass,
    row.currency,
    symbol ? "symbol" : "name",
    symbol || row.instrumentName.trim().toLowerCase(),
  ]);
}

async function seedCanonicalIdentities(db: Database, batches: FixtureBatch[]) {
  const accounts = new Set<string>();
  const instruments = new Set<string>();
  for (const batch of batches) {
    if (!batch.commit) continue;
    for (const row of batch.rows) {
      if (row.kind === "valuation") continue;
      const accountKey = `${batch.membership.householdId}:${accountIdentity(row)}`;
      if (!accounts.has(accountKey)) {
        await db.insert(schema.accounts).values({
          id: fixtureId(`account:${accountKey}`),
          householdId: batch.membership.householdId,
          name: row.accountName.trim(),
          provider: row.provider.trim(),
          accountType: row.assetClass,
          currency: row.currency,
          createdAt: FIXED_DATE,
          updatedAt: FIXED_DATE,
        });
        accounts.add(accountKey);
      }

      const instrumentKey = instrumentIdentity(row);
      if (!instruments.has(instrumentKey)) {
        await db.insert(schema.instruments).values({
          id: fixtureId(`instrument:${instrumentKey}`),
          name: row.instrumentName.trim(),
          symbol: row.symbol?.trim(),
          isin: "isin" in row ? row.isin : undefined,
          assetClass: row.assetClass,
          currency: row.currency,
          ...(row.symbol === "SHARED"
            ? {
                isin: "GENERATED0001",
                exchange: "GENERATED",
                providerMetadata: {
                  generated: true,
                  exactMetadata: "0.0000000001",
                },
              }
            : {}),
          createdAt: FIXED_DATE,
          updatedAt: FIXED_DATE,
        });
        instruments.add(instrumentKey);
      }
    }
  }
}

async function seedBatch(
  db: Database,
  batch: FixtureBatch,
  files: FixtureFile[],
  runDirectory: string,
) {
  const id = fixtureId(`batch:${batch.name}`);
  const storagePath = batch.content
    ? `${batch.membership.userId}/${id}/${batch.originalFileName}`
    : null;
  const fileHash = createHash("sha256")
    .update(batch.content ?? Buffer.from(batch.name))
    .digest("hex");
  await db.insert(schema.importBatches).values({
    id,
    householdId: batch.membership.householdId,
    uploadedByUserId: batch.membership.appUserId,
    sourceType: batch.sourceType,
    parserVersion: batch.parserVersion,
    originalFileName: batch.originalFileName,
    storagePath,
    fileHash,
    rowCount: batch.rows.length,
    status: batch.status ?? "parsed",
    uploadedAt: batch.uploadedAt,
    expiresAt: batch.expiresAt ?? PAST_EXPIRY,
    processedAt: FIXED_DATE,
  });
  if (batch.rows.length > 0) {
    await db.insert(schema.importRows).values(
      batch.rows.map((row, index) => ({
        id: fixtureId(`row:${batch.name}:${index}`),
        importBatchId: id,
        rowNumber: index + 1,
        normalizedPayload: { ...row },
        createdAt: FIXED_DATE,
      })),
    );
  }

  if (batch.content && storagePath) {
    const artifact = `${fileHash}.bin`;
    const filePath = path.join(runDirectory, artifact);
    if (fs.existsSync(filePath)) {
      if (
        fs.lstatSync(filePath).isSymbolicLink() ||
        !fs.readFileSync(filePath).equals(batch.content)
      )
        throw new Error(
          "Generated source artifact differs from its content hash",
        );
    } else {
      fs.writeFileSync(filePath, batch.content, { mode: 0o600, flag: "wx" });
    }
    files.push({ storagePath, artifact });
  }

  if (batch.commit) {
    await runImportEffect(
      commitImport(
        {
          db,
          supabase: createClient(
            "https://generated-fixture.invalid",
            "generated-fixture-key",
            { auth: { persistSession: false, autoRefreshToken: false } },
          ),
        },
        batch.membership,
        id,
      ),
    );
  }

  if (batch.declaredRowCount !== undefined) {
    await db
      .update(schema.importBatches)
      .set({ rowCount: batch.declaredRowCount })
      .where(eq(schema.importBatches.id, id));
  }
}

async function seedOperationalHistory(
  db: Database,
  memberships: MembershipContext[],
) {
  const primary = memberships[0];
  if (!primary) throw new Error("Missing primary fixture identity");
  await db.insert(schema.importBatches).values([
    {
      id: fixtureId("batch:expired-without-rows"),
      householdId: primary.householdId,
      uploadedByUserId: primary.appUserId,
      sourceType: "unknown",
      originalFileName: "generated-expired-no-rows.csv",
      status: "expired",
      storagePath: "generated/expired-no-rows.csv",
      fileHash: createHash("sha256").update("expired-no-rows").digest("hex"),
      rowCount: 0,
      warnings: ["Generated expired source"],
      uploadedAt: new Date("2026-05-01T12:00:00.000Z"),
      expiresAt: PAST_EXPIRY,
    },
    {
      id: fixtureId("batch:missing-unexpired-file"),
      householdId: primary.householdId,
      uploadedByUserId: primary.appUserId,
      sourceType: "unknown",
      originalFileName: "generated-missing-upload.csv",
      status: "uploaded",
      storagePath: "generated/missing-unexpired.csv",
      fileHash: createHash("sha256").update("missing-unexpired").digest("hex"),
      rowCount: 0,
      uploadedAt: FIXED_DATE,
      expiresAt: FUTURE_EXPIRY,
    },
    {
      id: fixtureId("batch:created"),
      householdId: primary.householdId,
      uploadedByUserId: primary.appUserId,
      sourceType: "unknown",
      originalFileName: "generated-not-uploaded.csv",
      status: "created",
      rowCount: 0,
      uploadedAt: FIXED_DATE,
      expiresAt: FUTURE_EXPIRY,
    },
    {
      id: fixtureId("batch:failed"),
      householdId: primary.householdId,
      uploadedByUserId: primary.appUserId,
      sourceType: "tickertape_stock_csv",
      originalFileName: "generated-failed.csv",
      status: "failed",
      errors: ["Generated parse failure"],
      rowCount: 0,
      uploadedAt: FIXED_DATE,
      expiresAt: FUTURE_EXPIRY,
      processedAt: FIXED_DATE,
    },
  ]);
  await db.insert(schema.currencyRates).values({
    id: fixtureId("rate:usd-inr"),
    base: "USD",
    quote: "INR",
    rate: "85.1234567890",
    provider: "frankfurter",
    fetchedAt: FIXED_DATE,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  });
}

async function preservePersistedPrecision(client: postgres.Sql) {
  await client`update holding_snapshots set quantity = '123456789.1234567890', invested_amount = '9007199254740992.0000', current_value = '9007199254740993.1250', pnl_amount = '1.1250', pnl_percent = '0.000001' where instrument_id = ${fixtureId(`instrument:${JSON.stringify(["indian_stock", "INR", "symbol", "PRECISE"])}`)} and snapshot_date = '2026-06-16'`;
}

async function normalizeGeneratedIdsAndTimestamps(client: postgres.Sql) {
  for (const table of [
    "holding_snapshots",
    "transactions",
    "portfolio_valuations",
  ] as const) {
    const rows = await client.unsafe<{ id: string; identity: string }[]>(
      `select id::text as id, (to_jsonb(t) - 'id' - 'created_at')::text as identity from ${table} t order by (to_jsonb(t) - 'id' - 'created_at')::text`,
    );
    for (const row of rows)
      await client.unsafe(`update ${table} set id = $1 where id = $2`, [
        fixtureId(`${table}:${row.identity}`),
        row.id,
      ]);
  }

  for (const table of TABLES) {
    if (table === "import_batches") {
      await client`update import_batches set committed_at = ${EVALUATION_TIME} where status = 'committed'`;
      continue;
    }
    await client.unsafe(`update ${table} set created_at = $1`, [
      EVALUATION_TIME,
    ]);
  }
}

async function fixtureContents(client: postgres.Sql) {
  const digest = createHash("sha256");
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await client.unsafe<{ id: string; contents: string }[]>(
      `select id::text as id, to_jsonb(t)::text as contents from ${table} t order by id`,
    );
    counts[table] = rows.length;
    digest.update(JSON.stringify([table, rows]));
  }

  return { digest: digest.digest("hex"), counts };
}

async function verifyExistingFixture(
  client: postgres.Sql,
  runDirectory: string,
) {
  const metadataPath = path.join(runDirectory, "fixture-metadata.json");
  const filesPath = path.join(runDirectory, "fixture-files.json");
  if (
    !fs.existsSync(metadataPath) ||
    !fs.existsSync(filesPath) ||
    fs.lstatSync(metadataPath).isSymbolicLink() ||
    fs.lstatSync(filesPath).isSymbolicLink()
  ) {
    throw new Error(
      "Refusing to modify a nonempty database without its generated-fixture receipt",
    );
  }

  const metadata: unknown = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const contents = await fixtureContents(client);
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("fixtureVersion" in metadata) ||
    metadata.fixtureVersion !== FIXTURE_VERSION ||
    !("sourceDigest" in metadata) ||
    metadata.sourceDigest !== contents.digest
  ) {
    throw new Error(
      "Existing fixture differs from its generated-fixture receipt",
    );
  }

  const files: unknown = JSON.parse(fs.readFileSync(filesPath, "utf8"));
  if (!Array.isArray(files))
    throw new Error("Generated source-file manifest is invalid");
  for (const untrustedEntry of files) {
    const entry: unknown = untrustedEntry;
    if (
      !entry ||
      typeof entry !== "object" ||
      !("artifact" in entry) ||
      typeof entry.artifact !== "string" ||
      !/^[0-9a-f]{64}\.bin$/.test(entry.artifact)
    )
      throw new Error("Generated source-file manifest is invalid");
    const artifact = path.join(runDirectory, entry.artifact);
    if (
      fs.lstatSync(artifact).isSymbolicLink() ||
      createHash("sha256").update(fs.readFileSync(artifact)).digest("hex") !==
        entry.artifact.slice(0, -4)
    )
      throw new Error("Generated source-file artifact changed");
  }
}

main().catch(() => {
  console.error(
    "Generated fixture creation failed; no production or non-loopback database was modified",
  );
  process.exitCode = 1;
});
