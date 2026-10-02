const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { validateSemanticCoverage } = require("./view-coverage.cjs");
const { createRequire } = require("node:module");
const {
  createProtectedRunDirectory,
  loadExplicitEnvironment,
} = require("./runtime.cjs");

const legacyTables = [
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
];
const requireDatabase = createRequire(
  path.resolve(__dirname, "../../packages/db/package.json"),
);
const requireBackend = createRequire(
  path.resolve(__dirname, "../../packages/backend/package.json"),
);
const migrationRoot = path.resolve(__dirname, "../../.migration");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  if (
    value === undefined ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new Error("Artifact contains a non-JSON value");
  }

  return JSON.stringify(value);
}

function sha256(value) {
  return nodeCrypto.createHash("sha256").update(value).digest("hex");
}

function digest(value) {
  return sha256(canonicalJson(value));
}

function requireRunId(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)
  ) {
    throw new Error("Pass a filesystem-safe --run-id of at most 80 characters");
  }

  return value;
}

function protectedPath(value) {
  const resolved = path.resolve(value);
  if (!resolved.startsWith(`${migrationRoot}${path.sep}`))
    throw new Error("Artifacts must stay under .migration");

  let current = migrationRoot;
  for (const part of path.relative(migrationRoot, resolved).split(path.sep)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error("Symlinked artifact path");
    current = path.join(current, part);
  }

  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink())
    throw new Error("Symlinked artifact path");

  return resolved;
}

function writeArtifact(runId, name, value) {
  const directory = createProtectedRunDirectory(requireRunId(runId));
  const target = protectedPath(path.join(directory, name));
  const contents = `${canonicalJson(value)}\n`;
  if (fs.existsSync(target)) {
    if (fs.readFileSync(target, "utf8") !== contents)
      throw new Error("Conflicting immutable artifact");
    return target;
  }

  publishImmutableFile(target, contents);
  return target;
}

function publishImmutableFile(target, contents) {
  const temporary = `${target}.${nodeCrypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, contents);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }

  try {
    fs.linkSync(temporary, target);
  } catch (error) {
    if (
      error.code !== "EEXIST" ||
      !fs.readFileSync(target).equals(Buffer.from(contents))
    )
      throw error;
  } finally {
    fs.unlinkSync(temporary);
  }
}

function writeFileBytes(runId, bytes) {
  const directory = createProtectedRunDirectory(requireRunId(runId));
  const hash = sha256(bytes);
  const target = protectedPath(path.join(directory, `${hash}.bin`));
  if (fs.existsSync(target)) {
    if (sha256(fs.readFileSync(target)) !== hash)
      throw new Error("Source file artifact changed");
  } else {
    publishImmutableFile(target, bytes);
  }

  return {
    artifact: `${hash}.bin`,
    contentHash: hash,
    sizeBytes: bytes.length,
  };
}

function sealSnapshot(body) {
  const tableManifest = legacyTables.map((table) => ({
    table,
    count: body.tables[table].length,
    digest: digest(body.tables[table]),
  }));
  const perHouseholdCounts = body.tables.households.map(({ id }) => {
    const batches = body.tables.import_batches.filter(
      (row) => row.household_id === id,
    );
    const batchIds = new Set(batches.map((row) => row.id));
    const instrumentIds = new Set(
      [...body.tables.holding_snapshots, ...body.tables.transactions]
        .filter((row) => row.household_id === id && row.instrument_id !== null)
        .map((row) => row.instrument_id),
    );
    const counts = Object.fromEntries(
      legacyTables
        .filter(
          (table) =>
            ![
              "users",
              "households",
              "instruments",
              "import_rows",
              "prices",
              "currency_rates",
            ].includes(table),
        )
        .map((table) => [
          table,
          body.tables[table].filter((row) => row.household_id === id).length,
        ]),
    );

    return {
      householdId: id,
      counts: {
        ...counts,
        import_rows: body.tables.import_rows.filter((row) =>
          batchIds.has(row.import_batch_id),
        ).length,
        instruments: instrumentIds.size,
        prices: body.tables.prices.filter((row) =>
          instrumentIds.has(row.instrument_id),
        ).length,
      },
    };
  });
  const payload = { ...body, tableManifest, perHouseholdCounts };

  return { ...payload, inputDigest: digest(payload) };
}

function readSnapshot(file) {
  const snapshot = JSON.parse(fs.readFileSync(protectedPath(file), "utf8"));
  if (
    snapshot.schemaVersion !== 1 ||
    !["synthetic", "production"].includes(snapshot.sourceKind) ||
    !Number.isFinite(Date.parse(snapshot.evaluationTime))
  )
    throw new Error("Invalid snapshot header");
  if (
    !snapshot.tables ||
    Object.keys(snapshot.tables).sort().join() !==
      [...legacyTables].sort().join()
  )
    throw new Error("Snapshot table manifest is incomplete");

  for (const table of legacyTables) {
    if (!Array.isArray(snapshot.tables[table]))
      throw new Error("Snapshot table is not an array");
    const ids = new Set();
    for (const row of snapshot.tables[table]) {
      if (
        !row ||
        typeof row !== "object" ||
        typeof row.id !== "string" ||
        ids.has(row.id)
      )
        throw new Error("Snapshot contains a duplicate or invalid legacy ID");
      ids.add(row.id);
    }
  }

  validateSourceFiles(snapshot);
  validateSemanticCoverage(snapshot);

  const { inputDigest, tableManifest, perHouseholdCounts, ...body } = snapshot;
  const expected = sealSnapshot(body);
  if (
    inputDigest !== expected.inputDigest ||
    canonicalJson(tableManifest) !== canonicalJson(expected.tableManifest) ||
    canonicalJson(perHouseholdCounts) !==
      canonicalJson(expected.perHouseholdCounts)
  )
    throw new Error("Snapshot checksum mismatch");

  return snapshot;
}

function validateSourceFiles(snapshot) {
  if (
    !Array.isArray(snapshot.sourceFiles) ||
    snapshot.sourceFiles.length !== snapshot.tables.import_batches.length
  )
    throw new Error("Source file manifest is incomplete");
  const batches = new Map(
    snapshot.tables.import_batches.map((batch) => [batch.id, batch]),
  );
  const seen = new Set();
  for (const file of snapshot.sourceFiles) {
    const batch = batches.get(file.legacyBatchId);
    if (
      !batch ||
      seen.has(file.legacyBatchId) ||
      file.expiresAt !== batch.expires_at ||
      file.legacyStoragePath !== batch.storage_path ||
      !Number.isFinite(Date.parse(file.expiresAt))
    )
      throw new Error("Invalid source file manifest entry");
    seen.add(file.legacyBatchId);

    if (file.status === "available") {
      if (
        !/^[a-f0-9]{64}$/.test(file.contentHash) ||
        file.contentHash !== batch.file_hash ||
        file.artifact !== `${file.contentHash}.bin` ||
        !Number.isSafeInteger(file.sizeBytes) ||
        file.sizeBytes < 0 ||
        Date.parse(file.expiresAt) <= Date.parse(snapshot.evaluationTime)
      )
        throw new Error("Invalid available source file manifest");
    } else if (
      file.status !== "unavailable" ||
      !["expired", "missing"].includes(file.reason)
    ) {
      throw new Error("Invalid source file availability");
    }
  }
}

function requireDatabaseUrl(environment, sourceKind, prefix) {
  const url = new URL(environment.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Expected a PostgreSQL URL");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((sourceKind === "synthetic") !== local)
    throw new Error("Database target does not match source classification");
  if (prefix && !url.pathname.slice(1).startsWith(prefix))
    throw new Error("Synthetic database name does not match rehearsal prefix");

  return url;
}

function convexConnection(environment, sourceKind) {
  const url = new URL(environment.MIGRATION_CONVEX_URL);
  const deployment = environment.MIGRATION_CONVEX_DEPLOYMENT;
  const key = environment.MIGRATION_CONVEX_ADMIN_KEY;
  if (
    !key ||
    !deployment ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Explicit Convex operator environment is incomplete");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (sourceKind === "production") {
    if (
      !deployment.startsWith("prod:") ||
      url.protocol !== "https:" ||
      url.hostname !== `${deployment.slice(5)}.convex.cloud`
    )
      throw new Error(
        "Production data requires its explicitly named production Convex target",
      );
  } else if (local) {
    if (!deployment.startsWith("local:") || url.protocol !== "http:")
      throw new Error("Synthetic local deployment must be classified local");
  } else if (
    !deployment.startsWith("dev:") ||
    url.protocol !== "https:" ||
    url.hostname !== `${deployment.slice(4)}.convex.cloud`
  ) {
    throw new Error(
      "Synthetic cloud deployment must be explicitly classified development",
    );
  }

  const { ConvexHttpClient } = requireBackend("convex/browser");
  const { makeFunctionReference } = requireBackend("convex/server");
  const client = new ConvexHttpClient(url.origin, { logger: false });
  // This is the admin-only API used by the installed Convex CLI itself.
  client.setAdminAuth(key);

  return {
    url: url.origin,
    deployment,
    invoke: (name, args) =>
      client.function(makeFunctionReference(name), undefined, args),
  };
}

function readEnvironment(file) {
  if (!file) throw new Error("Pass an explicit environment file");
  return loadExplicitEnvironment(path.resolve(file));
}

function writeFailure(runId, stage, error) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  const stack = error instanceof Error ? (error.stack ?? null) : null;
  writeArtifact(requireRunId(runId), `${stage}-failure-${Date.now()}.json`, {
    stage,
    message,
    stack,
  });
}

module.exports = {
  writeFailure,
  legacyTables,
  requireDatabase,
  requireBackend,
  canonicalJson,
  sha256,
  digest,
  requireRunId,
  protectedPath,
  writeArtifact,
  writeFileBytes,
  sealSnapshot,
  readSnapshot,
  requireDatabaseUrl,
  convexConnection,
  readEnvironment,
};
