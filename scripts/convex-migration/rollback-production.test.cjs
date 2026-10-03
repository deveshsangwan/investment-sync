const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");
const nodeCrypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const { sealSnapshot } = require("./phase6-artifacts.cjs");
const {
  TABLE_COLUMNS,
  digest,
  normalizeSqlTables,
} = require("./reverse-replay-postgres.cjs");
const {
  TARGET_TABLES,
  buildReverseReplayPlan,
} = require("./reverse-replay.cjs");
const {
  artifactDigest,
  requireProductionRecovery,
} = require("./rollback-production.cjs");

function productionFixture(scope = "before-writes") {
  const now = Date.now();
  const at = (offset) => new Date(now + offset * 1000).toISOString();
  const sourceSnapshot = sealSnapshot({
    schemaVersion: 1,
    sourceKind: "production",
    evaluationTime: "2026-01-04T00:00:00Z",
    tables: Object.fromEntries(
      Object.keys(TABLE_COLUMNS).map((table) => [table, []]),
    ),
    sourceFiles: [],
    views: [],
  });
  const tables = Object.fromEntries(
    [
      ...TARGET_TABLES,
      "importDedupeKeys",
      "portfolioPositions",
      "portfolioHistoryFacts",
      "portfolioHistoryScopes",
      "portfolioSummaries",
      "assetClassSummaries",
      "portfolioTimeline",
      "legacyHoldingAliases",
      "migrationRuns",
      "migrationRecords",
      "migrationMappings",
    ].map((table) => [table, []]),
  );
  const convex = {
    deployment: "prod:generated-recovery",
    url: "https://generated-recovery.convex.cloud",
    migrationRunKey: "generated-sealed-run",
  };
  tables.migrationRuns.push({
    _id: "run-generated",
    runKey: convex.migrationRunKey,
    sourceKind: "production",
    inputDigest: sourceSnapshot.inputDigest,
    evaluationTime: sourceSnapshot.evaluationTime,
    inputSealed: true,
  });
  const targetSnapshot = {
    schemaVersion: 1,
    sourceKind: "production",
    evaluationTime: sourceSnapshot.evaluationTime,
    inputDigest: sourceSnapshot.inputDigest,
    projectorVersion: "portfolio-v1",
    tables,
    mappings: [],
    deployment: convex.deployment,
    url: convex.url,
    exportedAt: at(-120),
  };
  const baselineSnapshot = {
    ...structuredClone(targetSnapshot),
    exportedAt: at(-180),
  };
  if (scope !== "before-writes") {
    tables.users.push({
      _id: "generated-user",
      _creationTime: Date.parse("2026-01-04T00:00:01Z"),
      clerkSubject: "generated_subject",
      email: "generated@example.invalid",
    });
    tables.households.push({
      _id: "generated-household",
      _creationTime: Date.parse("2026-01-04T00:00:01Z"),
      ownerUserId: "generated-user",
      name: "Generated portfolio",
    });
    tables.householdMembers.push({
      _id: "generated-membership",
      _creationTime: Date.parse("2026-01-04T00:00:01Z"),
      householdId: "generated-household",
      userId: "generated-user",
      role: "owner",
    });
  }
  const plan = buildReverseReplayPlan({
    sourceSnapshot,
    targetSnapshot:
      scope === "before-writes" ? baselineSnapshot : targetSnapshot,
  });
  const sourceContents = JSON.stringify(sourceSnapshot);
  const targetContents = JSON.stringify(targetSnapshot);
  const baselineContents = JSON.stringify(baselineSnapshot);
  const rollbackConfiguration = '{"backend":"Postgres","generated":true}';
  const rollbackBuild = Buffer.from("generated-archived-build");
  const rollbackCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const environment = {
    DATABASE_URL:
      "postgresql://recovery_operator:generated_password@db.generated.example.com:6543/investment_sync_rollback_recovery?sslmode=verify-full",
    ROLLBACK_DATABASE_ENVIRONMENT: "production",
    ROLLBACK_CONVEX_DEPLOYMENT: convex.deployment,
  };
  const environmentContents = Object.entries(environment)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  const database = {
    environment: "production",
    purpose: "isolated-recovery",
    host: "db.generated.example.com",
    port: 6543,
    name: "investment_sync_rollback_recovery",
    username: "recovery_operator",
    role: "recovery_operator",
  };
  const authorization = {
    schemaVersion: 1,
    sourceKind: "production",
    scope,
    authorizationId: "generated-only-authorization",
    authorizedBy: "generated-operator",
    authorizedAt: at(-60),
    expiresAt: at(3600),
    database,
    convex,
    sourceInputDigest: sourceSnapshot.inputDigest,
    sourceDigest: digest(normalizeSqlTables(sourceSnapshot.tables)),
    sourceSnapshotDigest: artifactDigest(sourceContents),
    targetExportDigest: artifactDigest(targetContents),
    rollbackCommit,
    configurationDigest: artifactDigest(rollbackConfiguration),
    rollbackBuildDigest: artifactDigest(rollbackBuild),
    environmentDigest: artifactDigest(environmentContents),
  };
  if (scope === "before-writes")
    authorization.targetBaselineDigest = artifactDigest(baselineContents);
  else {
    authorization.sourceReadOnly = {
      writersDisabled: true,
      evidenceReference: "generated-source-freeze",
      confirmedAt: at(-240),
      validUntil: at(3600),
    };
    authorization.targetDrained = {
      writersDisabled: true,
      activeParses: 0,
      activePublications: 0,
      pendingJobs: 0,
      evidenceReference: "generated-target-drain",
      confirmedAt: at(-240),
      validUntil: at(3600),
    };
  }
  const argumentsMap = new Map([
    ["mode", scope === "before-writes" ? "before-writes" : "after-writes"],
    ["apply", scope === "after-writes-apply" ? "true" : "false"],
    ["target", "production"],
    ["expected-database-host", database.host],
    ["expected-database-name", database.name],
    ["expected-convex-deployment", convex.deployment],
  ]);
  const input = {
    argumentsMap,
    environment,
    environmentContents,
    authorization,
    sourceSnapshot,
    sourceContents,
    targetSnapshot,
    targetContents,
    baselineSnapshot,
    baselineContents,
    rollbackCommit,
    rollbackConfiguration,
    rollbackBuild,
    plan,
    processEnvironment: {},
    now,
  };
  if (scope === "after-writes-apply") {
    input.reviewedPlan = structuredClone(plan);
    input.reviewedPlanContents = `${JSON.stringify(plan, null, 2)}\n`;
    authorization.reviewedPlanDigest = artifactDigest(
      input.reviewedPlanContents,
    );
    authorization.replayDigest = plan.replayDigest;
    authorization.reviewedAt = at(-90);
    authorization.reviewedBy = "generated-reviewer";
  }
  return input;
}

test("production scopes pin named targets and all artifacts with read-only planning connections", () => {
  for (const scope of [
    "before-writes",
    "after-writes-plan",
    "after-writes-apply",
  ]) {
    const input = productionFixture(scope);
    const result = requireProductionRecovery(input);
    assert.equal(result.receipt.scope, scope);
    assert.equal(result.receipt.database.purpose, "isolated-recovery");
    assert.equal(
      result.postgresOptions.host,
      input.authorization.database.host,
    );
    assert.equal(result.postgresOptions.port, 6543);
    assert.equal(result.postgresOptions.username, "recovery_operator");
    assert.equal(result.postgresOptions.ssl.rejectUnauthorized, true);
    assert.equal(
      result.postgresOptions.connection.default_transaction_read_only,
      scope === "after-writes-apply" ? "off" : "on",
    );
    assert.equal(
      result.receipt.rollbackBuildDigest,
      artifactDigest(input.rollbackBuild),
    );
  }
});

test("authorization rejects changed artifacts, scope reuse, malformed fields and date windows", () => {
  const cases = [
    (input) => {
      input.authorization.scope = "after-writes-apply";
    },
    (input) => {
      input.authorization.unreviewedField = true;
    },
    (input) => {
      input.authorization.database.purpose = "development";
    },
    (input) => {
      input.authorization.database.port = "6543";
    },
    (input) => {
      input.authorization.database.username = "other_user";
    },
    (input) => {
      input.authorization.authorizedAt = new Date(
        input.now + 1000,
      ).toISOString();
    },
    (input) => {
      input.authorization.expiresAt = new Date(input.now).toISOString();
    },
    (input) => {
      input.authorization.authorizedAt = "2026-02-30T00:00:00Z";
    },
    (input) => {
      input.authorization.sourceSnapshotDigest = "0".repeat(64);
    },
    (input) => {
      input.authorization.sourceInputDigest = "0".repeat(64);
    },
    (input) => {
      input.authorization.sourceDigest = "0".repeat(64);
    },
    (input) => {
      input.authorization.targetBaselineDigest = "0".repeat(64);
    },
    (input) => {
      input.targetContents += "\n";
    },
    (input) => {
      input.environmentContents += "\n";
    },
    (input) => {
      input.rollbackConfiguration += "\n";
    },
    (input) => {
      input.rollbackBuild = Buffer.from("different-build");
    },
    (input) => {
      input.rollbackCommit = "0".repeat(40);
    },
    (input) => {
      input.argumentsMap.set("apply", "yes");
    },
    (input) => {
      input.argumentsMap.set("mode", "unexpected");
    },
    (input) => {
      input.argumentsMap.set("reviewed-plan", "wrong-scope.json");
    },
  ];
  for (const mutate of cases) {
    const input = productionFixture();
    mutate(input);
    assert.throws(() => requireProductionRecovery(input));
  }
});

test("production refuses URL, ambient PG and deployment retargeting", () => {
  const cases = [
    (input) => {
      input.processEnvironment.PGHOST = "other.example.com";
    },
    (input) => {
      input.processEnvironment.PGOPTIONS = "-c search_path=other";
    },
    (input) => {
      input.environment.PGDATABASE = "other";
    },
    (input) => {
      input.environment.DATABASE_URL += "&host=other.example.com";
    },
    (input) => {
      input.environment.DATABASE_URL += "&sslmode=require";
    },
    (input) => {
      input.environment.DATABASE_URL = input.environment.DATABASE_URL.replace(
        "verify-full",
        "disable",
      );
    },
    (input) => {
      input.environment.DATABASE_URL = input.environment.DATABASE_URL.replace(
        "db.generated.example.com",
        "127.0.0.1",
      );
    },
    (input) => {
      input.environment.DATABASE_URL = input.environment.DATABASE_URL.replace(
        "db.generated.example.com",
        "[::1]",
      );
    },
    (input) => {
      input.environment.DATABASE_URL = input.environment.DATABASE_URL.replace(
        "investment_sync_rollback_recovery",
        "investment_sync_dev",
      );
    },
    (input) => {
      input.argumentsMap.set("expected-database-name", "other");
    },
    (input) => {
      input.argumentsMap.set("expected-database-host", "other.example.com");
    },
    (input) => {
      input.environment.ROLLBACK_CONVEX_DEPLOYMENT = "dev:generated-recovery";
    },
    (input) => {
      input.authorization.convex.url = "https://other.convex.cloud";
    },
    (input) => {
      input.argumentsMap.set("expected-convex-deployment", "prod:other");
    },
  ];
  for (const mutate of cases) {
    const input = productionFixture();
    mutate(input);
    assert.throws(() => requireProductionRecovery(input));
  }
});

test("the complete production baseline rejects identity, read model and migration export divergence", () => {
  for (const table of ["users", "portfolioSummaries", "migrationRecords"]) {
    const input = productionFixture();
    input.targetSnapshot.tables[table].push({
      _id: "unexpected-generated-row",
    });
    input.targetContents = JSON.stringify(input.targetSnapshot);
    input.authorization.targetExportDigest = artifactDigest(
      input.targetContents,
    );
    assert.throws(() => requireProductionRecovery(input), /baseline changed/);
  }
  for (const mutate of [
    (input) => {
      delete input.targetSnapshot.tables.portfolioSummaries;
    },
    (input) => {
      input.targetSnapshot.tables.users = [{}];
    },
    (input) => {
      input.targetSnapshot.tables.migrationRuns[0].inputSealed = false;
    },
    (input) => {
      input.targetSnapshot.tables.migrationRuns.push(
        input.targetSnapshot.tables.migrationRuns[0],
      );
    },
    (input) => {
      input.targetSnapshot.inputDigest = "0".repeat(64);
    },
    (input) => {
      input.targetSnapshot.deployment = "prod:other";
    },
  ]) {
    const input = productionFixture();
    mutate(input);
    input.targetContents = JSON.stringify(input.targetSnapshot);
    input.authorization.targetExportDigest = artifactDigest(
      input.targetContents,
    );
    assert.throws(() => requireProductionRecovery(input));
  }
});

test("after-write apply requires frozen writers, a drain and the exact reviewed plan", () => {
  const cases = [
    (input) => {
      input.authorization.sourceReadOnly.writersDisabled = false;
    },
    (input) => {
      input.authorization.targetDrained.writersDisabled = false;
    },
    (input) => {
      input.authorization.targetDrained.activeParses = 1;
    },
    (input) => {
      input.authorization.targetDrained.activePublications = 1;
    },
    (input) => {
      input.authorization.targetDrained.pendingJobs = 1;
    },
    (input) => {
      input.authorization.sourceReadOnly.confirmedAt = new Date(
        input.now,
      ).toISOString();
    },
    (input) => {
      input.authorization.targetDrained.validUntil = new Date(
        input.now + 1000,
      ).toISOString();
    },
    (input) => {
      input.authorization.reviewedBy = "";
    },
    (input) => {
      input.authorization.reviewedAt = new Date(input.now).toISOString();
    },
    (input) => {
      input.authorization.replayDigest = "0".repeat(64);
    },
    (input) => {
      input.reviewedPlanContents += "\n";
    },
    (input) => {
      input.reviewedPlan.counts.users += 1;
      input.reviewedPlanContents = JSON.stringify(input.reviewedPlan);
      input.authorization.reviewedPlanDigest = artifactDigest(
        input.reviewedPlanContents,
      );
    },
    (input) => {
      input.argumentsMap.set("target-baseline", "wrong-scope.json");
    },
  ];
  for (const mutate of cases) {
    const input = productionFixture("after-writes-apply");
    mutate(input);
    assert.throws(() => requireProductionRecovery(input));
  }
  const planInput = productionFixture("after-writes-plan");
  planInput.argumentsMap.set("apply", "true");
  assert.throws(
    () => requireProductionRecovery(planInput),
    /malformed operator scope/,
  );
});

test("an explicit database CA keeps TLS verification enabled and pins its bytes", () => {
  const input = productionFixture();
  const certificate = tls.rootCertificates.find(
    (value) =>
      Date.parse(new nodeCrypto.X509Certificate(value).validTo) > input.now,
  );
  input.databaseCa = Buffer.from(certificate);
  input.environment.ROLLBACK_DATABASE_CA_FILE = ".migration/generated/ca.crt";
  input.environmentContents += `ROLLBACK_DATABASE_CA_FILE=${input.environment.ROLLBACK_DATABASE_CA_FILE}\n`;
  input.authorization.environmentDigest = artifactDigest(
    input.environmentContents,
  );
  input.authorization.databaseCaDigest = artifactDigest(input.databaseCa);
  const result = requireProductionRecovery(input);
  assert.equal(result.postgresOptions.ssl.rejectUnauthorized, true);
  assert.equal(result.postgresOptions.ssl.ca, certificate);
  assert.equal(
    result.receipt.databaseCaDigest,
    artifactDigest(input.databaseCa),
  );
  input.databaseCa = Buffer.from("changed");
  assert.throws(() => requireProductionRecovery(input), /CA differs/);
});

test("production CLI rejects malformed packets before connecting and keeps valid before-write checks read-only", () => {
  const root = path.resolve(".migration");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const directory = fs.mkdtempSync(
    path.join(root, "production-rollback-generated-"),
  );
  const write = (name, value) => {
    const destination = path.join(directory, name);
    fs.writeFileSync(destination, value, { mode: 0o600 });
    return destination;
  };
  const marker = path.join(directory, "connection-attempted");
  const preload = write(
    "refuse-network.cjs",
    `const Module = require('node:module'); const fs = require('node:fs'); const original = Module._load; Module._load = function(name, ...args) { if (name === 'postgres') return () => { fs.writeFileSync(${JSON.stringify(marker)}, 'attempted'); throw new Error('Generated test must not connect'); }; return original.call(this, name, ...args); };`,
  );
  const input = productionFixture();
  const source = write("source.json", input.sourceContents);
  const target = write("target.json", input.targetContents);
  const baseline = write("baseline.json", input.baselineContents);
  const environment = write("operator.env", input.environmentContents);
  const configuration = write(
    "configuration.json",
    input.rollbackConfiguration,
  );
  const build = write("build.bin", input.rollbackBuild);
  const authorizationFile = write(
    "authorization.json",
    JSON.stringify(input.authorization),
  );
  const runId = `production-rollback-rejected-${process.pid}`;
  const argv = [
    "--require",
    preload,
    "scripts/convex-migration/rollback.cjs",
    "--mode",
    "before-writes",
    "--apply",
    "false",
    "--run-id",
    runId,
    "--snapshot",
    source,
    "--target-export",
    target,
    "--target-baseline",
    baseline,
    "--env-file",
    environment,
    "--rollback-commit",
    input.rollbackCommit,
    "--rollback-config-file",
    configuration,
    "--rollback-build-file",
    build,
    "--authorization-file",
    authorizationFile,
    "--target",
    "production",
    "--expected-database-host",
    input.authorization.database.host,
    "--expected-database-name",
    input.authorization.database.name,
    "--expected-convex-deployment",
    input.authorization.convex.deployment,
  ];
  try {
    const attempts = [
      [...argv, "--apply", "true"],
      [...argv, "--unknown", "value"],
      argv.map((value) => (value === "false" ? "yes" : value)),
      argv.map((value) => (value === "before-writes" ? "unexpected" : value)),
      argv.map((value) =>
        value === input.authorization.database.name ? "other" : value,
      ),
    ];
    for (const attempt of attempts) {
      const result = spawnSync(process.execPath, attempt, { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(fs.existsSync(marker), false);
      assert.equal(fs.existsSync(path.join(root, runId)), false);
      assert.doesNotMatch(
        result.stderr,
        /generated_password|generated@example/,
      );
    }
    write(
      "authorization.json",
      JSON.stringify({ ...input.authorization, scope: "after-writes-apply" }),
    );
    const result = spawnSync(process.execPath, argv, { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(marker), false);

    write("authorization.json", JSON.stringify(input.authorization));
    write(
      "refuse-network.cjs",
      `
      const Module = require('node:module');
      const fs = require('node:fs');
      const assert = require('node:assert/strict');
      const columns = ${JSON.stringify(TABLE_COLUMNS)};
      const original = Module._load;
      Module._load = function(name, ...args) {
        if (name !== 'postgres') return original.call(this, name, ...args);

        return (options) => {
          assert.equal(options.connection.default_transaction_read_only, 'on');
          assert.equal(options.ssl.rejectUnauthorized, true);
          assert.equal(options.host, ${JSON.stringify(input.authorization.database.host)});
          const transaction = {
            unsafe: async (query) => {
              if (/^set local (statement_timeout|lock_timeout) = '[0-9]+ms'$/.test(query)) return [];
              assert.match(query, /^select /);
              if (query.includes('current_database()')) return [{
                database_name: ${JSON.stringify(input.authorization.database.name)},
                database_user: 'recovery_operator', session_user: 'recovery_operator',
                schema_name: 'public', read_only: 'on'
              }];
              if (query.includes('information_schema.columns')) return Object.entries(columns).flatMap(([table, fields]) => fields.map((field) => ({ table_name: table, column_name: field })));
              return [];
            }
          };
          return {
            begin: async (mode, callback) => {
              assert.equal(mode, 'isolation level repeatable read read only');
              fs.writeFileSync(${JSON.stringify(marker)}, mode);
              return callback(transaction);
            },
            end: async () => {}
          };
        };
      };
    `,
    );
    const valid = spawnSync(process.execPath, argv, { encoding: "utf8" });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(
      fs.readFileSync(marker, "utf8"),
      "isolation level repeatable read read only",
    );
    const receiptFile = path.join(root, runId, "rollback-receipt.json");
    const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    assert.equal(receipt.apply, false);
    assert.equal(receipt.applicationRestored, false);
    assert.equal(receipt.verification.readOnlyTransaction, true);
    assert.equal(
      receipt.productionAuthorization.authorizationId,
      input.authorization.authorizationId,
    );
    assert.equal(
      receipt.productionAuthorization.authorizationDigest,
      artifactDigest(JSON.stringify(input.authorization)),
    );
    assert.equal(
      receipt.productionAuthorization.rollbackBuildDigest,
      artifactDigest(input.rollbackBuild),
    );
    assert.equal(fs.statSync(receiptFile).mode & 0o777, 0o600);
    assert.equal(
      fs.existsSync(path.join(root, runId, "reverse-replay-plan.json")),
      false,
    );
  } finally {
    fs.rmSync(path.join(root, runId), { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true });
  }
});
