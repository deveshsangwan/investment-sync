const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
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
  return crypto.createHash("sha256").update(value).digest("hex");
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

  fs.writeFileSync(target, contents, { flag: "wx", mode: 0o600 });
  return target;
}

function writeFileBytes(runId, bytes) {
  const directory = createProtectedRunDirectory(requireRunId(runId));
  const hash = sha256(bytes);
  const target = protectedPath(path.join(directory, `${hash}.bin`));
  if (fs.existsSync(target)) {
    if (sha256(fs.readFileSync(target)) !== hash)
      throw new Error("Source file artifact changed");
  } else {
    fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
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
  const perHouseholdCounts = body.tables.households.map(({ id }) => ({
    householdId: id,
    counts: Object.fromEntries(
      legacyTables
        .filter((table) =>
          body.tables[table].some((row) => "household_id" in row),
        )
        .map((table) => [
          table,
          body.tables[table].filter((row) => row.household_id === id).length,
        ]),
    ),
  }));
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

module.exports = {
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
