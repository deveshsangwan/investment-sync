const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { parseArguments, assertAllowedArguments } = require("./runtime.cjs");
const {
  buildReverseReplayPlan,
  deterministicUuid,
  verifyNoConvexWrites,
} = require("./reverse-replay.cjs");
const {
  TABLE_COLUMNS,
  applyReverseReplay,
  digest,
  readSqlTables,
  verifyBeforeWrites,
} = require("./reverse-replay-postgres.cjs");

function requireLocalRehearsal(source, connection, databaseUrl) {
  const target = new URL(connection.url);
  const database = new URL(databaseUrl);
  const isLocal = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (
    source.sourceKind !== "synthetic" ||
    !connection.deployment.startsWith("local:") ||
    target.protocol !== "http:" ||
    !isLocal(target.hostname) ||
    !isLocal(database.hostname) ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !/^\/investment_sync_rollback_live(?:_[a-z0-9_]+)?$/.test(database.pathname)
  )
    throw new Error(
      "Live rollback rehearsal requires synthetic data, local Convex, and its dedicated Postgres database",
    );
}

function portableTarget(raw, source) {
  const records = new Map(
    raw.tables.migrationRecords.map((row) => [
      JSON.stringify([row.legacyTable, row.legacyId]),
      row,
    ]),
  );
  return {
    ...raw,
    sourceKind: source.sourceKind,
    evaluationTime: source.evaluationTime,
    inputDigest: source.inputDigest,
    mappings: raw.tables.migrationMappings.map((mapping) => {
      const record = records.get(
        JSON.stringify([mapping.legacyTable, mapping.legacyId]),
      );
      if (!record)
        throw new Error("Migration mapping has no archived source row");
      return { ...mapping, sourceJson: record.sourceJson };
    }),
  };
}

function setMigrationFreeze(
  repositoryRoot,
  environmentPath,
  environment,
  enabled,
) {
  if (
    environment.CONVEX_SELF_HOSTED_URL !== environment.MIGRATION_CONVEX_URL ||
    environment.CONVEX_SELF_HOSTED_ADMIN_KEY !==
      environment.MIGRATION_CONVEX_ADMIN_KEY
  )
    throw new Error(
      "Convex CLI and operator export credentials must identify the same local deployment",
    );

  console.log(
    `Target: ${environment.MIGRATION_CONVEX_DEPLOYMENT}; ${enabled ? "freeze" : "enable"} generated local application writes`,
  );
  const childEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("CONVEX_")),
  );
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@investment-sync/backend",
      "exec",
      "convex",
      "env",
      enabled ? "set" : "remove",
      "MIGRATION_MODE",
      ...(enabled ? ["synthetic"] : []),
      "--env-file",
      path.resolve(environmentPath),
    ],
    {
      cwd: repositoryRoot,
      env: { ...childEnvironment, ...environment },
      stdio: "pipe",
      timeout: 30000,
    },
  );
}

function authenticatedClient(requireBackend, environment, subject) {
  const { ConvexHttpClient } = requireBackend("convex/browser");
  const { makeFunctionReference } = requireBackend("convex/server");
  const client = new ConvexHttpClient(environment.MIGRATION_CONVEX_URL, {
    logger: false,
  });
  const issuer = "https://synthetic-rollback.clerk.accounts.dev";
  client.setAdminAuth(environment.MIGRATION_CONVEX_ADMIN_KEY, {
    subject,
    issuer,
    tokenIdentifier: `${issuer}|${subject}`,
  });
  return {
    mutation: (name, args) =>
      client.mutation(makeFunctionReference(name), args),
    query: (name, args) => client.query(makeFunctionReference(name), args),
  };
}

async function waitForBatch(client, batchId, status) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const batch = await client.query("imports:get", { batchId });
    if (batch.status === status) return batch;
    if (batch.status === "failed")
      throw new Error(`Synthetic import failed while awaiting ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Synthetic import timed out awaiting ${status}`);
}

async function prepareDatabase(repositoryRoot, environment, source) {
  const requireDatabase = createRequire(
    path.join(repositoryRoot, "packages/db/package.json"),
  );
  const postgres = requireDatabase("postgres");
  const database = new URL(environment.DATABASE_URL);
  const databaseName = database.pathname.slice(1);
  const adminUrl = new URL(database);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  let created;
  try {
    const existing =
      await admin`select 1 from pg_database where datname = ${databaseName}`;
    created = existing.length === 0;
    if (created) await admin.unsafe(`create database "${databaseName}"`);
  } finally {
    await admin.end();
  }

  const sql = postgres(database.toString(), { max: 1, onnotice: () => {} });
  try {
    if (created) {
      const directory = path.join(repositoryRoot, "packages/db/drizzle");
      for (const file of fs
        .readdirSync(directory)
        .filter((name) => /^\d.*\.sql$/.test(name))
        .sort()) {
        const statements = fs
          .readFileSync(path.join(directory, file), "utf8")
          .split("--> statement-breakpoint");
        await sql.begin(async (transaction) => {
          for (const statement of statements)
            if (statement.trim()) await transaction.unsafe(statement);
        });
      }
      await sql.begin(async (transaction) => {
        for (const table of Object.keys(TABLE_COLUMNS)) {
          if (!source.tables[table].length) continue;
          await transaction.unsafe(
            `insert into "${table}" select * from jsonb_populate_recordset(null::"${table}", $1::text::jsonb)`,
            [JSON.stringify(source.tables[table])],
          );
        }
      });
    }
    return sql;
  } catch (error) {
    await sql.end();
    throw error;
  }
}

async function exercisePublicCommits(context) {
  const {
    root,
    environmentPath,
    environment,
    requireBackend,
    baseline,
    metadata,
    writeArtifact,
    runId,
  } = context;
  const pending = baseline.tables.importBatches.find(
    (batch) => batch.legacyId === metadata.pendingExpiredBatchId,
  );
  const file = baseline.tables.sourceFiles.find(
    (row) => row.batchId === pending?._id,
  );
  assert.ok(
    pending &&
      pending.status === "parsed" &&
      file?.status === "deleted" &&
      !file.storageId,
    "Expired parsed fixture must have no original file",
  );
  const owner = baseline.tables.users.find(
    (user) => user._id === pending.uploaderId,
  );
  assert.ok(owner, "Expired parsed fixture owner is missing");
  const existing = authenticatedClient(
    requireBackend,
    environment,
    owner.clerkSubject,
  );
  const fresh = authenticatedClient(
    requireBackend,
    environment,
    `generated_rollback_${runId}`,
  );
  const bytes = generatedCsv();
  let upload;
  let newIdentity;

  try {
    setMigrationFreeze(root, environmentPath, environment, false);
    console.log(
      "Committing expired parsed batch through public owner API; original file is absent",
    );
    await existing.mutation("imports:commit", { batchId: pending._id });
    const committedExpired = await waitForBatch(
      existing,
      pending._id,
      "committed",
    );
    writeArtifact(runId, "expired-commit.json", committedExpired);

    console.log(
      "Provisioning generated identity, uploading and parsing generated CSV, then committing through public API",
    );
    await fresh.mutation("users:ensureCurrent", {});
    newIdentity = await fresh.query("users:current", {});
    writeArtifact(runId, "new-identity.json", newIdentity);
    upload = await fresh.mutation("imports:createUpload", {
      fileName: "generated-rollback-stock.csv",
      mimeType: "text/csv",
      sizeBytes: bytes.length,
    });
    writeArtifact(runId, "new-upload-reservation.json", upload);
    const response = await fetch(upload.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: bytes,
    });
    if (!response.ok) throw new Error("Generated CSV upload failed");
    const storage = await response.json();
    await fresh.mutation("imports:attachUpload", {
      batchId: upload.batchId,
      storageId: storage.storageId,
    });
    await waitForBatch(fresh, upload.batchId, "parsed");
    await fresh.mutation("imports:commit", { batchId: upload.batchId });
    const committedNew = await waitForBatch(fresh, upload.batchId, "committed");
    writeArtifact(runId, "new-commit.json", committedNew);
  } finally {
    setMigrationFreeze(root, environmentPath, environment, true);
  }

  return {
    expiredBatchId: pending._id,
    newBatchId: upload.batchId,
    newIdentity,
    bytes,
  };
}

function generatedCsv() {
  return Buffer.from(
    [
      ",,,Holdings - 16-May-26 IST",
      "Visit: https://tickertape.in/portfolio?tab=holdings",
      "",
      "Security,No. of Smallcases,Quantity,Average Cost ₹,Portfolio Weight %,LTP ₹,Invested Value ₹,Current Value ₹,P & L ₹,Net Change %,Daily Change ₹,Daily Change %",
      "",
      "Stocks/ETFs",
      "",
      "FAKECO,0.00,2.00,100.00,100,125.00,200.00,250.00,50.00,25.00,1.00,0.84",
      "",
    ].join("\n"),
  );
}

async function verifySemanticViews(
  sql,
  plan,
  target,
  connection,
  runKey,
  evaluationTime,
) {
  require("tsx/cjs");
  const { requireDatabase } = require("./phase6-artifacts.cjs");
  const { collectLegacyViews } = require("./legacy-views.ts");
  const { drizzle } = requireDatabase("drizzle-orm/postgres-js");
  const schema = require("../../packages/db/src/schema.ts");
  const { semantic, compare } = require("./reconcile.cjs");
  const db = drizzle(sql, { schema });
  const legacyViews = await db.transaction(
    (transaction) =>
      collectLegacyViews(
        transaction,
        plan.tables.households.map((row) => row.id),
        evaluationTime,
        plan.tables.holding_snapshots,
      ),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const rate = plan.tables.currency_rates.find(
    (row) =>
      row.base === "USD" &&
      row.quote === "INR" &&
      row.provider === "frankfurter",
  );
  const age = rate
    ? Date.parse(evaluationTime) - Date.parse(rate.fetched_at)
    : Infinity;
  const quote =
    age >= 7 * 86400000
      ? { status: "unavailable" }
      : {
          status: age >= 6 * 3600000 ? "stale" : "fresh",
          rate: rate.rate,
          fetchedAt: new Date(rate.fetched_at).toISOString(),
          provider: "frankfurter",
        };
  const findings = [];
  const actualViews = [];
  for (const legacy of legacyViews) {
    const household = target.tables.households.find(
      (row) =>
        (target.mappings.find(
          (mapping) =>
            mapping.targetTable === "households" &&
            mapping.targetId === row._id,
        )?.legacyId ?? deterministicUuid("households", row._id)) ===
        legacy.householdId,
    );
    assert.ok(household, "Replayed SQL household has no native household");
    const read = async (args) =>
      JSON.parse(
        await connection.invoke("migrationViews:portfolioView", {
          runKey,
          targetHouseholdId: household._id,
          quote,
          ...args,
        }),
      );
    const actual = {
      householdId: legacy.householdId,
      overview: await read({ view: "overview" }),
      positions: await read({ view: "positions" }),
      holdingDetails: [],
      assetClassDetails: [],
    };
    for (const detail of legacy.holdingDetails) {
      const alias = target.tables.legacyHoldingAliases.find(
        (row) =>
          row.householdId === household._id && row.legacyId === detail.legacyId,
      );
      const fact = target.tables.holdingSnapshots.find(
        (row) =>
          row.householdId === household._id &&
          deterministicUuid("holding_snapshots", row._id) === detail.legacyId,
      );
      const positionKey = alias?.legacyId ?? fact?.positionKey;
      assert.ok(
        positionKey,
        "Replayed SQL holding detail has no native holding key",
      );
      actual.holdingDetails.push({
        legacyId: detail.legacyId,
        value: await read({ view: "holdingDetail", positionKey }),
      });
    }
    for (const detail of legacy.assetClassDetails)
      actual.assetClassDetails.push({
        assetClass: detail.assetClass,
        value: await read({
          view: "assetClassDetail",
          assetClass: detail.assetClass,
        }),
      });
    compare(
      semantic(legacy),
      semantic(actual),
      `views.${legacy.householdId}`,
      findings,
    );
    actualViews.push(actual);
  }

  return {
    schemaVersion: 1,
    evaluationTime,
    quote,
    legacyViews,
    actualViews,
    findings,
    unexplainedDifferences: findings.length,
    householdCount: legacyViews.length,
    holdingDetailCount: legacyViews.reduce(
      (count, view) => count + view.holdingDetails.length,
      0,
    ),
    assetClassDetailCount: legacyViews.reduce(
      (count, view) => count + view.assetClassDetails.length,
      0,
    ),
    legacySemanticDigest: digest(semantic(legacyViews)),
    nativeSemanticDigest: digest(semantic(actualViews)),
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  assertAllowedArguments(args, [
    "snapshot",
    "baseline",
    "fixture-metadata",
    "target-env-file",
    "source-env-file",
    "run-key",
    "run-id",
    "mode",
    "database-name",
  ]);
  const root = process.cwd();
  const helpers = require("./phase6-artifacts.cjs");
  const { exportTarget } = require("./reconcile.cjs");
  const {
    readSnapshot,
    readEnvironment,
    convexConnection,
    requireRunId,
    writeArtifact,
    protectedPath,
    requireBackend,
    writeFileBytes,
    sha256,
  } = helpers;
  const source = readSnapshot(args.get("snapshot"));
  const baseline = JSON.parse(
    fs.readFileSync(protectedPath(args.get("baseline")), "utf8"),
  );
  const metadata = JSON.parse(
    fs.readFileSync(protectedPath(args.get("fixture-metadata")), "utf8"),
  );
  const runId = requireRunId(args.get("run-id"));
  const runKey = requireRunId(args.get("run-key"));
  const mode = args.get("mode") ?? "exercise";
  if (!["exercise", "capture", "replay", "semantic"].includes(mode))
    throw new Error("Mode must be exercise, capture, replay, or semantic");
  const environmentPath = args.get("target-env-file");
  const environment = readEnvironment(environmentPath);
  const databaseEnvironment = readEnvironment(args.get("source-env-file"));
  const databaseUrl = new URL(databaseEnvironment.DATABASE_URL);
  databaseUrl.pathname = `/${args.get("database-name") ?? "investment_sync_rollback_live"}`;
  const connection = convexConnection(environment, source.sourceKind);
  requireLocalRehearsal(source, connection, databaseUrl.toString());
  const initial = buildReverseReplayPlan({
    sourceSnapshot: source,
    targetSnapshot: baseline,
  });
  assert.equal(
    initial.sourceDigest,
    initial.replayDigest,
    "Frozen native baseline must reproduce every original SQL row exactly",
  );
  const sql = await prepareDatabase(
    root,
    { DATABASE_URL: databaseUrl.toString() },
    source,
  );

  try {
    if (mode === "exercise") {
      const actualBaseline = portableTarget(
        await exportTarget(connection, runKey),
        source,
      );
      const targetBefore = verifyNoConvexWrites(baseline, actualBaseline);
      const postgresBefore = await verifyBeforeWrites(sql, source.tables);
      writeArtifact(runId, "before-writes-receipt.json", {
        targetBefore,
        postgresBefore,
        sourceDigest: initial.sourceDigest,
        replayDigest: initial.replayDigest,
      });
    }

    if (["exercise", "capture"].includes(mode)) {
      const readReceipt = (file) =>
        JSON.parse(
          fs.readFileSync(
            protectedPath(path.join(root, ".migration", runId, file)),
            "utf8",
          ),
        );
      const commits =
        mode === "exercise"
          ? await exercisePublicCommits({
              root,
              environmentPath,
              environment,
              requireBackend,
              baseline,
              metadata,
              writeArtifact,
              runId,
            })
          : {
              expiredBatchId: readReceipt("expired-commit.json").id,
              newBatchId: readReceipt("new-commit.json").id,
              newIdentity: readReceipt("new-identity.json"),
              bytes: generatedCsv(),
            };
      if (mode === "capture")
        setMigrationFreeze(root, environmentPath, environment, true);
      const target = portableTarget(
        await exportTarget(connection, runKey),
        source,
      );
      const file = target.tables.sourceFiles.find(
        (row) => row.batchId === commits.newBatchId,
      );
      assert.ok(file?.storageId && file.status === "stored");
      const storedFile = await connection.invoke("migration:fileState", {
        runKey,
        targetBatchId: file.batchId,
      });
      assert.equal(storedFile.storageId, file.storageId);
      assert.equal(storedFile.contentHash, file.contentHash);
      assert.equal(storedFile.sizeBytes, file.sizeBytes);
      const storageUrl = new URL(storedFile.url);
      assert.equal(storageUrl.origin, connection.url);
      const download = await fetch(storageUrl);
      if (!download.ok)
        throw new Error(
          "Generated source file could not be restored from Convex storage",
        );
      const restored = Buffer.from(await download.arrayBuffer());
      assert.ok(restored.equals(commits.bytes));
      assert.equal(sha256(restored), file.contentHash);
      assert.equal(restored.length, file.sizeBytes);
      const stored = writeFileBytes(runId, restored);
      target.reverseStorageMappings = [
        {
          batchId: file.batchId,
          storagePath: `generated-rollback/${stored.contentHash}.csv`,
          contentHash: stored.contentHash,
          sizeBytes: stored.sizeBytes,
        },
      ];
      writeArtifact(runId, "storage-restore-receipt.json", {
        ...stored,
        storagePath: target.reverseStorageMappings[0].storagePath,
        verified: true,
        productionStorageTouched: false,
      });
      writeArtifact(runId, "post-write-target.json", target);
    }

    const target = JSON.parse(
      fs.readFileSync(
        protectedPath(
          path.join(root, ".migration", runId, "post-write-target.json"),
        ),
        "utf8",
      ),
    );
    assert.throws(() => verifyNoConvexWrites(baseline, target), {
      code: "convex_only_writes_detected",
    });
    const current = portableTarget(
      await exportTarget(connection, runKey),
      source,
    );
    verifyNoConvexWrites(target, current);
    const plan = buildReverseReplayPlan({
      sourceSnapshot: source,
      targetSnapshot: target,
    });
    assert.equal(plan.newCommittedBatches.length, 2);
    assert.equal(plan.counts.users, initial.counts.users + 1);
    assert.equal(plan.counts.households, initial.counts.households + 1);
    if (mode === "semantic") {
      assert.equal(digest(await readSqlTables(sql)), plan.replayDigest);
      const semanticReceipt = await verifySemanticViews(
        sql,
        plan,
        target,
        connection,
        runKey,
        source.evaluationTime,
      );
      writeArtifact(runId, "semantic-receipt.json", semanticReceipt);
      assert.equal(
        semanticReceipt.unexplainedDifferences,
        0,
        "Independent old SQL and native read-model comparison failed",
      );
      console.log(
        "Independent SQL and native portfolio views match for every household, holding UUID, and asset class",
      );
      return;
    }
    writeArtifact(runId, "reverse-replay-plan.json", plan);
    const first = await applyReverseReplay(sql, plan);
    const fullSqlDigest = digest(await readSqlTables(sql));
    assert.equal(fullSqlDigest, plan.replayDigest);
    const repeated = await applyReverseReplay(sql, plan);
    assert.equal(repeated.alreadyApplied, true);
    const semanticReceipt = await verifySemanticViews(
      sql,
      plan,
      target,
      connection,
      runKey,
      source.evaluationTime,
    );
    writeArtifact(runId, "semantic-receipt.json", semanticReceipt);
    assert.equal(
      semanticReceipt.unexplainedDifferences,
      0,
      "Independent old SQL and native read-model comparison failed",
    );
    writeArtifact(runId, "rollback-receipt.json", {
      schemaVersion: 1,
      sourceKind: "synthetic",
      deployment: connection.deployment,
      evaluationTime: source.evaluationTime,
      inputDigest: source.inputDigest,
      sourceDigest: plan.sourceDigest,
      targetDigest: plan.targetDigest,
      replayDigest: plan.replayDigest,
      fullSqlDigest,
      counts: plan.counts,
      newCommittedBatches: plan.newCommittedBatches.length,
      first,
      repeated,
      beforeWritesRefusedAfterNewCommits: true,
      exactTablesVerified: true,
      semanticVerification: {
        unexplainedDifferences: 0,
        households: semanticReceipt.householdCount,
        holdingDetails: semanticReceipt.holdingDetailCount,
        assetClassDetails: semanticReceipt.assetClassDetailCount,
        legacySemanticDigest: semanticReceipt.legacySemanticDigest,
        nativeSemanticDigest: semanticReceipt.nativeSemanticDigest,
      },
      productionTouched: false,
    });
    console.log(
      "Actual Convex rollback passed: two public commits, restored generated file, exact full SQL rows, idempotent replay",
    );
  } finally {
    await sql.end();
  }
}

if (require.main === module)
  main().catch((error) => {
    const index = process.argv.indexOf("--run-id");
    if (index >= 0) {
      const { writeFailure } = require("./phase6-artifacts.cjs");
      writeFailure(process.argv[index + 1], "live-rollback", error);
    }
    console.error(
      `Generated live rollback failed: ${error.code ?? error.name ?? "error"}; details saved in protected artifact`,
    );
    process.exitCode = 1;
  });

module.exports = { portableTarget, requireLocalRehearsal };
