const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadSnapshot } = require("./load-snapshot.cjs");
const {
  legacyTables,
  canonicalJson,
  digest,
  sealSnapshot,
  readSnapshot,
  writeArtifact,
  protectedPath,
  requireDatabaseUrl,
  convexConnection,
} = require("./phase6-artifacts.cjs");

function fixture() {
  return sealSnapshot({
    schemaVersion: 1,
    sourceKind: "synthetic",
    evaluationTime: "2026-06-20T12:00:00.000Z",
    tables: Object.fromEntries(legacyTables.map((table) => [table, []])),
    sourceFiles: [],
    views: [],
  });
}

function unsealedFixture() {
  const source = fixture();
  delete source.inputDigest;
  delete source.tableManifest;
  delete source.perHouseholdCounts;
  return source;
}

test("canonical digests ignore object ordering but retain array order and exact decimals", () => {
  assert.equal(
    digest({ b: "9007199254740993.0001", a: [1, 2] }),
    digest({ a: [1, 2], b: "9007199254740993.0001" }),
  );
  assert.notEqual(digest([1, 2]), digest([2, 1]));
  assert.notEqual(
    digest("9007199254740993.0001"),
    digest("9007199254740993.0002"),
  );
  assert.throws(() => canonicalJson({ amount: NaN }));
});

test("protected artifacts replay identically and reject altered data or manifests", () => {
  const runId = `phase6-artifact-test-${process.pid}`;
  const file = writeArtifact(runId, "snapshot.json", fixture());
  try {
    assert.equal(writeArtifact(runId, "snapshot.json", fixture()), file);
    assert.equal(readSnapshot(file).inputDigest, fixture().inputDigest);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.throws(() =>
      writeArtifact(runId, "snapshot.json", { changed: true }),
    );

    const altered = fixture();
    altered.tables.users.push({
      id: "new",
      email: "generated@example.invalid",
    });
    fs.writeFileSync(file, JSON.stringify(altered));
    assert.throws(() => readSnapshot(file), /checksum/);

    const missing = fixture();
    delete missing.tables.accounts;
    fs.writeFileSync(file, JSON.stringify(missing));
    assert.throws(() => readSnapshot(file), /incomplete/);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true });
  }
});

test("artifacts reject paths outside the protected root and symlink escapes", () => {
  assert.throws(() => protectedPath("/tmp/unprotected-snapshot.json"));
  const link = path.resolve(".migration", `phase6-symlink-test-${process.pid}`);
  fs.symlinkSync("/tmp", link);
  try {
    assert.throws(
      () => protectedPath(path.join(link, "file.json")),
      /Symlinked/,
    );
  } finally {
    fs.unlinkSync(link);
  }
});

test("household manifests count normalized rows through batches and shared instruments through facts", () => {
  const source = unsealedFixture();
  source.tables.households = [{ id: "house-a" }, { id: "house-b" }];
  source.tables.import_batches = [{ id: "batch-a", household_id: "house-a" }];
  source.tables.import_rows = [{ id: "row-a", import_batch_id: "batch-a" }];
  source.tables.holding_snapshots = [
    { id: "holding-a", household_id: "house-a", instrument_id: "shared" },
    { id: "holding-b", household_id: "house-b", instrument_id: "shared" },
  ];
  const manifest = sealSnapshot(source).perHouseholdCounts;
  assert.equal(manifest[0].counts.import_rows, 1);
  assert.equal(manifest[1].counts.import_rows, 0);
  assert.equal(manifest[0].counts.instruments, 1);
  assert.equal(manifest[1].counts.instruments, 1);
});

test("missing source bytes fail before the first target mutation", async () => {
  const runId = `phase6-preflight-test-${process.pid}`;
  const source = unsealedFixture();
  source.tables.import_batches = [
    {
      id: "batch",
      expires_at: "2026-06-30T00:00:00.000Z",
      storage_path: "generated/path",
      file_hash: "a".repeat(64),
    },
  ];
  source.sourceFiles = [
    {
      legacyBatchId: "batch",
      expiresAt: "2026-06-30T00:00:00.000Z",
      legacyStoragePath: "generated/path",
      status: "available",
      contentHash: "a".repeat(64),
      sizeBytes: 10,
      artifact: `${"a".repeat(64)}.bin`,
    },
  ];
  const file = writeArtifact(runId, "snapshot.json", sealSnapshot(source));
  let writes = 0;
  try {
    const snapshot = readSnapshot(file);
    await assert.rejects(
      loadSnapshot(
        snapshot,
        file,
        {
          invoke: () => {
            writes += 1;
          },
        },
        runId,
      ),
      /ENOENT/,
    );
    assert.equal(writes, 0);
    snapshot.sourceFiles[0].artifact = "../outside.bin";
    source.sourceFiles = snapshot.sourceFiles;
    const bad = writeArtifact(runId, "bad.json", sealSnapshot(source));
    assert.throws(() => readSnapshot(bad), /Invalid available/);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true });
  }
});

test("synthetic and production database classes cannot cross", () => {
  assert.throws(() =>
    requireDatabaseUrl(
      { DATABASE_URL: "postgres://u@remote.invalid/source" },
      "synthetic",
    ),
  );
  assert.throws(() =>
    requireDatabaseUrl(
      { DATABASE_URL: "postgres://u@localhost/source" },
      "production",
    ),
  );
  assert.throws(() =>
    requireDatabaseUrl(
      { DATABASE_URL: "postgres://u@localhost/real_dev" },
      "synthetic",
      "investment_sync_migration_",
    ),
  );
  assert.equal(
    requireDatabaseUrl(
      {
        DATABASE_URL: "postgres://u@localhost/investment_sync_migration_source",
      },
      "synthetic",
      "investment_sync_migration_",
    ).hostname,
    "localhost",
  );
});

test("Convex targets require exact deployment classification without ambient credentials", () => {
  const env = {
    MIGRATION_CONVEX_URL: "https://example.convex.cloud",
    MIGRATION_CONVEX_DEPLOYMENT: "dev:example",
    MIGRATION_CONVEX_ADMIN_KEY: "synthetic-key",
  };
  assert.throws(() => convexConnection(env, "production"));
  assert.throws(() =>
    convexConnection(
      {
        ...env,
        MIGRATION_CONVEX_URL: "https://another.convex.cloud",
        MIGRATION_CONVEX_DEPLOYMENT: "prod:example",
      },
      "production",
    ),
  );
  assert.throws(() =>
    convexConnection(
      {
        ...env,
        MIGRATION_CONVEX_URL: "http://127.0.0.1:3214",
        MIGRATION_CONVEX_DEPLOYMENT: "prod:example",
      },
      "synthetic",
    ),
  );
  assert.throws(() =>
    convexConnection(
      { ...env, MIGRATION_CONVEX_ADMIN_KEY: undefined },
      "synthetic",
    ),
  );
});
