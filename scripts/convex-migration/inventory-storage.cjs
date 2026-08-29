const crypto = require("node:crypto");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const {
  assertAllowedArguments,
  assertProductionDatabaseUrl,
  createProtectedRunDirectory,
  fail,
  loadExplicitEnvironment,
  parseArguments,
  sourceFingerprint,
  writeProtectedJson,
} = require("./runtime.cjs");

const requireFromDatabasePackage = createRequire(
  path.resolve(process.cwd(), "packages/db/package.json"),
);
const { createClient } = requireFromDatabasePackage("@supabase/supabase-js");
const postgres = requireFromDatabasePackage("postgres");
const argumentsMap = parseArguments(process.argv.slice(2));
assertAllowedArguments(argumentsMap, [
  "target",
  "database-env-file",
  "storage-env-file",
  "run-id",
]);
if (argumentsMap.get("target") !== "production") {
  fail("Refusing inventory without --target production");
}
const runId = argumentsMap.get("run-id");
if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId)) {
  fail("Pass a filesystem-safe --run-id of at most 80 characters");
}
const databaseEnvFile = argumentsMap.get("database-env-file");
const storageEnvFile = argumentsMap.get("storage-env-file");
if (!databaseEnvFile || !storageEnvFile) {
  fail("Pass separate --database-env-file and --storage-env-file arguments");
}
const resolvedDatabaseEnvFile = path.resolve(databaseEnvFile);
const resolvedStorageEnvFile = path.resolve(storageEnvFile);
if (resolvedDatabaseEnvFile === resolvedStorageEnvFile) {
  fail("Database and Storage credentials must use separate environment files");
}
const databaseEnvironment = loadExplicitEnvironment(resolvedDatabaseEnvFile);
const storageEnvironment = loadExplicitEnvironment(resolvedStorageEnvFile);
const runDirectory = createProtectedRunDirectory(runId);

main().catch((error) => {
  console.error(`Storage inventory failed${safeErrorCode(error)}`);
  process.exitCode = 1;
});

async function main() {
  const databaseUrl = assertProductionDatabaseUrl(
    databaseEnvironment.DATABASE_URL,
  );
  const databaseFingerprint = sourceFingerprint([
    databaseUrl.hostname,
    databaseUrl.port,
    databaseUrl.pathname,
    databaseUrl.username,
  ]);
  const missingStorageKeys = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_IMPORT_BUCKET",
  ].filter((key) => !storageEnvironment[key]);
  if (missingStorageKeys.length > 0) {
    writeProtectedJson(runDirectory, "inventory.storage.json", {
      schemaVersion: 2,
      runId,
      collectedAt: new Date().toISOString(),
      status: "blocked",
      databaseFingerprint,
      storageFingerprint: null,
      reason: `Explicit production Storage environment lacks ${missingStorageKeys.join(", ")}`,
    });
    console.log(
      "Storage inventory blocked: explicit production Storage credentials are incomplete",
    );
    return;
  }

  const storageUrl = new URL(storageEnvironment.SUPABASE_URL);
  if (["localhost", "127.0.0.1", "::1"].includes(storageUrl.hostname)) {
    fail("Production storage inventory refuses a local Supabase URL");
  }

  const references = await loadDatabaseReferences(
    databaseEnvironment.DATABASE_URL,
  );
  const supabase = createClient(
    storageEnvironment.SUPABASE_URL,
    storageEnvironment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const bucket = storageEnvironment.SUPABASE_IMPORT_BUCKET;
  const bucketObjects = await listObjects(supabase, bucket);
  const objectsByPath = new Map(
    bucketObjects.map((object) => [object.path, object]),
  );
  const files = [];

  for (const reference of references) {
    const object = objectsByPath.get(reference.storagePath);
    if (!object) {
      files.push({ ...reference, availability: "missing" });
      continue;
    }

    const result = await supabase.storage
      .from(bucket)
      .download(reference.storagePath);
    if (result.error) {
      files.push({
        ...reference,
        availability: "download_failed",
        storageBytes: numericSize(object.metadata?.size),
      });
      continue;
    }

    const content = Buffer.from(await result.data.arrayBuffer());
    const actualHash = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");
    const storageBytes = numericSize(object.metadata?.size);
    files.push({
      ...reference,
      availability: "available",
      storageBytes,
      downloadedBytes: content.length,
      actualHash,
      hashMatches: reference.fileHash === actualHash,
      storageSizeMatches:
        storageBytes === null ? null : storageBytes === content.length,
      databaseSizeVerification: "unavailable_in_source_schema",
      ...parseSourceFile(content, reference.originalFileName),
    });
  }

  const available = files.filter((file) => file.availability === "available");
  const parsed = available.filter((file) => file.parseStatus === "parsed");
  const largestAvailableFile = [...parsed].sort(
    (left, right) =>
      right.normalizedRows - left.normalizedRows ||
      right.normalizedSerializedBytes - left.normalizedSerializedBytes,
  )[0];
  const referencedPaths = new Set(
    references.map((reference) => reference.storagePath),
  );
  const inventory = {
    schemaVersion: 2,
    runId,
    collectedAt: new Date().toISOString(),
    status: "complete",
    databaseFingerprint,
    storageFingerprint: sourceFingerprint([storageUrl.hostname, bucket]),
    summary: {
      referencedFiles: references.length,
      bucketObjects: bucketObjects.length,
      orphanBucketObjects: bucketObjects.filter(
        (object) => !referencedPaths.has(object.path),
      ).length,
      availableFiles: available.length,
      missingFiles: files.filter((file) => file.availability === "missing")
        .length,
      downloadFailures: files.filter(
        (file) => file.availability === "download_failed",
      ).length,
      hashMismatches: available.filter((file) => !file.hashMatches).length,
      storageSizeMismatches: available.filter(
        (file) => file.storageSizeMatches === false,
      ).length,
      databaseSizeUnverifiable: available.length,
      parseFailures: available.filter((file) => file.parseStatus === "failed")
        .length,
      databaseRowCountMismatches: parsed.filter(
        (file) => file.databaseRowCount !== file.normalizedRows,
      ).length,
      compressedBytes: range(available.map((file) => file.downloadedBytes)),
      normalizedRows: range(parsed.map((file) => file.normalizedRows)),
      normalizedSerializedBytes: range(
        parsed.map((file) => file.normalizedSerializedBytes),
      ),
      maximumDistinctAccounts: maximum(
        parsed.map((file) => file.distinctAccounts),
      ),
      maximumDistinctInstruments: maximum(
        parsed.map((file) => file.distinctInstruments),
      ),
      maximumProjectedFactWrites: maximum(
        parsed.map((file) => file.projectedFactWrites),
      ),
      maximumProjectedReadModelWrites: maximum(
        parsed.map((file) => file.projectedReadModelWrites),
      ),
      largestAvailableFileProfile: largestAvailableFile
        ? {
            sourceType: largestAvailableFile.sourceType,
            normalizedRows: largestAvailableFile.normalizedRows,
            normalizedSerializedBytes:
              largestAvailableFile.normalizedSerializedBytes,
            compressedBytes: largestAvailableFile.downloadedBytes,
            distinctAccounts: largestAvailableFile.distinctAccounts,
            distinctInstruments: largestAvailableFile.distinctInstruments,
            projectedFactWritesLowerBound:
              largestAvailableFile.projectedFactWrites,
            projectedReadModelWritesLowerBound:
              largestAvailableFile.projectedReadModelWrites,
            rowKindCounts: largestAvailableFile.rowKindCounts,
            currencyCounts: largestAvailableFile.currencyCounts,
          }
        : null,
    },
    files,
  };

  writeProtectedJson(runDirectory, "inventory.storage.json", inventory);
  console.log("Referenced Source File inventory complete");
  console.log("Protected detailed artifact written under .migration");
}

async function loadDatabaseReferences(databaseUrl) {
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connection: { application_name: "investment-sync-storage-inventory" },
  });
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
    const rows = await client.unsafe(`
      select id::text as batch_id, storage_path, file_hash, original_file_name,
        row_count, status::text, source_type::text, parser_version
      from import_batches
      where storage_path is not null
      order by id
    `);
    await client.unsafe("rollback");
    transactionStarted = false;
    return rows.map((row) => ({
      batchFingerprint: sourceFingerprint([runId, String(row.batch_id)]),
      batchId: row.batch_id,
      storagePath: row.storage_path,
      fileHash: row.file_hash,
      originalFileName: row.original_file_name,
      databaseRowCount: Number(row.row_count),
      databaseStatus: row.status,
      databaseSourceType: row.source_type,
      databaseParserVersion: row.parser_version,
    }));
  } finally {
    if (transactionStarted)
      await client.unsafe("rollback").catch(() => undefined);
    await client.end({ timeout: 5 });
  }
}

async function listObjects(supabase, bucket) {
  const pendingPrefixes = [""];
  const files = [];
  while (pendingPrefixes.length > 0) {
    const prefix = pendingPrefixes.pop();
    let offset = 0;
    while (true) {
      const result = await supabase.storage.from(bucket).list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (result.error) throw result.error;
      for (const object of result.data) {
        const child = prefix ? `${prefix}/${object.name}` : object.name;
        if (object.id === null) pendingPrefixes.push(child);
        else files.push({ ...object, path: child });
      }
      if (result.data.length < 100) break;
      offset += result.data.length;
    }
  }
  return files;
}

function parseSourceFile(content, originalFileName) {
  const child = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/convex-migration/parse-source-file.ts"],
    {
      cwd: process.cwd(),
      input: JSON.stringify({
        originalFileName,
        contentBase64: content.toString("base64"),
      }),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (child.status !== 0) return { parseStatus: "failed" };
  try {
    return { parseStatus: "parsed", ...JSON.parse(child.stdout) };
  } catch {
    return { parseStatus: "failed" };
  }
}

function numericSize(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function range(values) {
  return {
    minimum: values.length === 0 ? 0 : Math.min(...values),
    maximum: values.length === 0 ? 0 : Math.max(...values),
  };
}

function maximum(values) {
  return values.length === 0 ? 0 : Math.max(...values);
}

function safeErrorCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9]{2,10}$/.test(code)
    ? ` (${code})`
    : "";
}
