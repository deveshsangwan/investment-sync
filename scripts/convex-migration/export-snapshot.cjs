const fs = require("node:fs");
const path = require("node:path");
const { parseArguments, assertAllowedArguments } = require("./runtime.cjs");
const {
  legacyTables,
  requireDatabase,
  readEnvironment,
  requireDatabaseUrl,
  requireRunId,
  sealSnapshot,
  writeArtifact,
  writeFileBytes,
  sha256,
  protectedPath,
  writeFailure,
} = require("./phase6-artifacts.cjs");

async function extractSnapshot({
  environment,
  storageEnvironment,
  sourceKind,
  runId,
  evaluationTime,
  collectViews,
  syntheticFiles,
}) {
  requireDatabaseUrl(
    environment,
    sourceKind,
    sourceKind === "synthetic" ? "investment_sync_migration_" : undefined,
  );
  const postgres = requireDatabase("postgres");
  const { drizzle } = requireDatabase("drizzle-orm/postgres-js");
  const { sql } = requireDatabase("drizzle-orm");
  const schema = require("../../packages/db/src/schema.ts");
  const client = postgres(environment.DATABASE_URL, { max: 1, prepare: false });
  const db = drizzle(client, { schema });

  try {
    return await db.transaction(
      async (transaction) => {
        await transaction.execute(sql.raw("set local timezone = 'UTC'"));
        const [clock] = await transaction.execute(
          sql.raw("select transaction_timestamp()::text as timestamp"),
        );
        const frozenTime =
          evaluationTime ?? new Date(clock.timestamp).toISOString();
        if (!Number.isFinite(Date.parse(frozenTime)))
          throw new Error("Invalid evaluation time");
        const tables = {};
        for (const table of legacyTables) {
          const columns = await transaction.execute(
            sql`select column_name, data_type from information_schema.columns where table_schema='public' and table_name=${table} order by ordinal_position`,
          );
          if (columns.length === 0)
            throw new Error("Source schema is incomplete");

          const selection = columns
            .map(({ column_name: name, data_type: type }) => {
              if (!/^[a-z_]+$/.test(name))
                throw new Error("Unsupported source column");
              if (type === "timestamp with time zone")
                return `to_char("${name}" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "${name}"`;
              if (["uuid", "numeric", "date", "USER-DEFINED"].includes(type))
                return `"${name}"::text as "${name}"`;
              return `"${name}"`;
            })
            .join(", ");
          const order = columns.some(
            (column) => column.column_name === "created_at",
          )
            ? "created_at, id"
            : table === "import_rows"
              ? "import_batch_id, row_number, id"
              : "id";
          tables[table] = Array.from(
            await transaction.execute(
              sql.raw(`select ${selection} from "${table}" order by ${order}`),
            ),
          );
        }

        const views = await collectViews(
          transaction,
          tables.households.map((row) => row.id),
          frozenTime,
          tables.holding_snapshots,
        );
        const sourceFiles = await captureFiles(
          tables.import_batches,
          frozenTime,
          sourceKind,
          runId,
          storageEnvironment,
          syntheticFiles,
        );
        return sealSnapshot({
          schemaVersion: 1,
          sourceKind,
          evaluationTime: frozenTime,
          tables,
          sourceFiles,
          views,
        });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function captureFiles(
  batches,
  evaluationTime,
  sourceKind,
  runId,
  environment,
  syntheticFiles,
) {
  let storage;
  if (sourceKind === "production") {
    if (
      !environment?.SUPABASE_URL ||
      !environment.SUPABASE_SERVICE_ROLE_KEY ||
      !environment.SUPABASE_IMPORT_BUCKET
    )
      throw new Error("Separate production Storage environment is required");
    const storageUrl = new URL(environment.SUPABASE_URL);
    if (
      storageUrl.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(storageUrl.hostname)
    )
      throw new Error("Production Storage must be explicitly remote HTTPS");
    const { createClient } = requireDatabase("@supabase/supabase-js");
    storage = createClient(
      storageUrl.origin,
      environment.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ).storage.from(environment.SUPABASE_IMPORT_BUCKET);
  }

  const files = [];
  for (const batch of batches) {
    const base = {
      legacyBatchId: batch.id,
      expiresAt: batch.expires_at,
      legacyStoragePath: batch.storage_path,
    };
    if (
      !batch.storage_path ||
      Date.parse(batch.expires_at) <= Date.parse(evaluationTime)
    ) {
      files.push({
        ...base,
        status: "unavailable",
        reason: batch.storage_path ? "expired" : "missing",
      });
      continue;
    }

    let bytes;
    if (sourceKind === "synthetic") {
      bytes = syntheticFiles?.get(batch.storage_path);
    } else {
      const result = await storage.download(batch.storage_path);
      if (result.error) {
        if (
          !["404", "400"].includes(String(result.error.statusCode)) ||
          !/not found|does not exist/i.test(result.error.message)
        )
          throw new Error("Source file download failed");
      } else {
        bytes = Buffer.from(await result.data.arrayBuffer());
      }
    }

    if (!bytes) {
      files.push({ ...base, status: "unavailable", reason: "missing" });
      continue;
    }
    if (!batch.file_hash || sha256(bytes) !== batch.file_hash)
      throw new Error("Source file checksum mismatch");
    files.push({
      ...base,
      status: "available",
      ...writeFileBytes(runId, bytes),
    });
  }

  return files;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  assertAllowedArguments(args, [
    "source",
    "database-env-file",
    "storage-env-file",
    "run-id",
    "evaluation-time",
    "synthetic-files",
  ]);
  const sourceKind = args.get("source");
  if (!["synthetic", "production"].includes(sourceKind))
    throw new Error("Pass --source synthetic or production");
  const runId = requireRunId(args.get("run-id"));
  const databaseEnv = args.get("database-env-file");
  const storageEnv = args.get("storage-env-file");
  if (storageEnv && path.resolve(databaseEnv) === path.resolve(storageEnv))
    throw new Error("Database and Storage credentials must be separate");
  let syntheticFiles;
  if (args.has("synthetic-files")) {
    if (sourceKind !== "synthetic")
      throw new Error("Production extraction refuses synthetic files");
    const file = protectedPath(args.get("synthetic-files"));
    const records = JSON.parse(fs.readFileSync(file, "utf8"));
    syntheticFiles = new Map(
      records.map((record) => [
        record.storagePath,
        fs.readFileSync(
          protectedPath(path.resolve(path.dirname(file), record.artifact)),
        ),
      ]),
    );
  }

  const { collectLegacyViews } = require("./legacy-views.ts");
  const snapshot = await extractSnapshot({
    environment: readEnvironment(databaseEnv),
    storageEnvironment: storageEnv ? readEnvironment(storageEnv) : undefined,
    sourceKind,
    runId,
    evaluationTime: args.get("evaluation-time"),
    collectViews: collectLegacyViews,
    syntheticFiles,
  });
  writeArtifact(runId, "snapshot.json", snapshot);
  console.log(
    `Snapshot verified: ${legacyTables.length} tables, ${snapshot.tables.households.length} households, ${snapshot.sourceFiles.filter((file) => file.status === "available").length} available files`,
  );
}

if (require.main === module)
  main().catch((error) => {
    const index = process.argv.indexOf("--run-id");
    if (index >= 0) writeFailure(process.argv[index + 1], "export", error);
    console.error("Snapshot export failed; no production writes performed");
    process.exitCode = 1;
  });
module.exports = { extractSnapshot, captureFiles };
