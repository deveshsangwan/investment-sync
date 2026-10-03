const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const {
  assertAllowedArguments,
  createProtectedRunDirectory,
  loadExplicitEnvironment,
  parseArguments,
  writeProtectedJson,
} = require("./runtime.cjs");
const {
  ReverseReplayError,
  buildReverseReplayPlan,
  verifyNoConvexWrites,
} = require("./reverse-replay.cjs");
const {
  applyReverseReplay,
  verifyBeforeWrites,
  stableJson,
} = require("./reverse-replay-postgres.cjs");
const { readSnapshot } = require("./phase6-artifacts.cjs");
const {
  artifactDigest,
  requireProductionRecovery,
} = require("./rollback-production.cjs");

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  assertAllowedArguments(argumentsMap, [
    "mode",
    "snapshot",
    "target-export",
    "target-baseline",
    "env-file",
    "run-id",
    "apply",
    "rollback-commit",
    "rollback-config-file",
    "target",
    "authorization-file",
    "expected-database-host",
    "expected-database-name",
    "expected-convex-deployment",
    "rollback-build-file",
    "reviewed-plan",
  ]);
  const mode = argumentsMap.get("mode");
  if (!["before-writes", "after-writes"].includes(mode))
    throw new Error("Pass --mode before-writes or after-writes");
  const runId = argumentsMap.get("run-id");
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId))
    throw new Error("Pass a filesystem-safe run ID");
  if (!["true", "false"].includes(argumentsMap.get("apply")))
    throw new Error("Pass --apply true or false explicitly");
  if (mode === "before-writes" && argumentsMap.get("apply") === "true")
    throw new Error(
      "Before-write rollback only verifies the frozen source and archived build",
    );

  const rollbackCommit = argumentsMap.get("rollback-commit");
  if (!rollbackCommit || !/^[a-f0-9]{40}$/.test(rollbackCommit))
    throw new Error("Pass the full archived Postgres-serving commit SHA");
  execFileSync("git", ["cat-file", "-e", `${rollbackCommit}^{commit}`], {
    stdio: "ignore",
  });
  const rollbackConfiguration = readProtectedFile(
    argumentsMap.get("rollback-config-file"),
  );
  const sourceContents = readProtectedFile(argumentsMap.get("snapshot"));
  const sourceSnapshot = JSON.parse(sourceContents);
  if (!["synthetic", "production"].includes(sourceSnapshot.sourceKind))
    throw new Error("Rollback source classification is unknown");

  const targetContents = readProtectedFile(argumentsMap.get("target-export"));
  const targetSnapshot = JSON.parse(targetContents);
  const baselineContents =
    mode === "before-writes"
      ? readProtectedFile(argumentsMap.get("target-baseline"))
      : undefined;
  const initialTarget = baselineContents
    ? JSON.parse(baselineContents)
    : undefined;

  const envFile = argumentsMap.get("env-file");
  if (!envFile) throw new Error("Pass an explicit --env-file");
  const environmentContents = readProtectedFile(envFile);
  const environmentKeys = environmentContents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.slice(0, line.indexOf("=")).trim());
  if (new Set(environmentKeys).size !== environmentKeys.length)
    throw new Error("Rollback environment contains duplicate settings");

  const environment = loadExplicitEnvironment(path.resolve(envFile));
  const plan = buildReverseReplayPlan({
    sourceSnapshot,
    targetSnapshot: mode === "before-writes" ? initialTarget : targetSnapshot,
  });
  const parsed = new URL(environment.DATABASE_URL ?? "");
  let production;
  let authorizationContents;
  if (sourceSnapshot.sourceKind === "production") {
    if (
      stableJson(readSnapshot(argumentsMap.get("snapshot"))) !==
      stableJson(sourceSnapshot)
    )
      throw new Error("Production source artifact changed during validation");
    authorizationContents = readProtectedFile(
      argumentsMap.get("authorization-file"),
    );
    const rollbackBuild = readProtectedFile(
      argumentsMap.get("rollback-build-file"),
      null,
    );
    const reviewedPlanContents = argumentsMap.has("reviewed-plan")
      ? readProtectedFile(argumentsMap.get("reviewed-plan"))
      : undefined;
    production = requireProductionRecovery({
      argumentsMap,
      environment,
      authorization: JSON.parse(authorizationContents),
      sourceSnapshot,
      sourceContents,
      targetSnapshot,
      targetContents,
      baselineSnapshot: initialTarget,
      baselineContents,
      rollbackCommit,
      rollbackConfiguration,
      rollbackBuild,
      databaseCa: environment.ROLLBACK_DATABASE_CA_FILE
        ? readProtectedFile(environment.ROLLBACK_DATABASE_CA_FILE, null)
        : undefined,
      environmentContents,
      plan,
      reviewedPlanContents,
      reviewedPlan: reviewedPlanContents
        ? JSON.parse(reviewedPlanContents)
        : undefined,
    });
  } else {
    if (
      [
        "target",
        "authorization-file",
        "expected-database-host",
        "expected-database-name",
        "expected-convex-deployment",
        "rollback-build-file",
        "reviewed-plan",
      ].some((name) => argumentsMap.has(name)) ||
      Object.keys(process.env).some((key) => key.startsWith("PG")) ||
      parsed.search ||
      parsed.hash ||
      !parsed.username ||
      !parsed.password ||
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !/^\/investment_sync_rollback_[a-z0-9_]+$/.test(parsed.pathname)
    )
      throw new Error(
        "Synthetic replay requires a dedicated local investment_sync_rollback_ database",
      );
  }

  const receipt = {
    schemaVersion: 1,
    sourceKind: sourceSnapshot.sourceKind,
    mode,
    apply: argumentsMap.get("apply") === "true",
    rollbackCommit,
    configurationDigest: artifactDigest(rollbackConfiguration),
    applicationRestored: false,
    ...(production
      ? {
          productionAuthorization: {
            ...production.receipt,
            authorizationDigest: artifactDigest(authorizationContents),
          },
        }
      : {}),
  };
  if (mode === "before-writes") {
    receipt.targetVerification = verifyNoConvexWrites(
      initialTarget,
      targetSnapshot,
    );
    if (
      plan.newCommittedBatches.length ||
      plan.sourceDigest !== plan.replayDigest
    )
      throw new ReverseReplayError("target_baseline_differs_from_source");
  }

  const runDirectory = createProtectedRunDirectory(runId);
  if (
    fs.existsSync(path.join(runDirectory, "rollback-receipt.json")) ||
    fs.existsSync(path.join(runDirectory, "reverse-replay-plan.json"))
  )
    throw new Error(
      "Use a new rollback run ID; existing artifacts cannot be overwritten",
    );
  const postgres = createRequire(
    path.resolve(process.cwd(), "packages/db/package.json"),
  )("postgres");
  const sql = postgres({
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    database: parsed.pathname.slice(1),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    max: 1,
    onnotice: () => {},
    ...production?.postgresOptions,
  });

  try {
    if (mode === "before-writes") {
      receipt.verification = await verifyBeforeWrites(
        sql,
        sourceSnapshot.tables,
        production?.databaseIdentity,
      );
    } else {
      writeProtectedJson(runDirectory, "reverse-replay-plan.json", plan);
      receipt.planDigest = plan.replayDigest;
      receipt.planArtifactDigest = artifactDigest(
        `${JSON.stringify(plan, null, 2)}\n`,
      );
      receipt.newCommittedBatches = plan.newCommittedBatches.length;
      receipt.verification =
        argumentsMap.get("apply") === "true"
          ? await applyReverseReplay(sql, plan, production?.databaseIdentity)
          : await verifyBeforeWrites(
              sql,
              sourceSnapshot.tables,
              production?.databaseIdentity,
            );
    }

    writeProtectedJson(runDirectory, "rollback-receipt.json", receipt);
    console.log(
      `Rollback ${mode} verification passed; application restoration remains an operator step.`,
    );
  } finally {
    await sql.end();
  }
}

function readProtectedFile(fileName, encoding = "utf8") {
  if (!fileName)
    throw new Error("A required protected artifact path is missing");
  const root = path.resolve(process.cwd(), ".migration");
  const target = path.resolve(fileName);
  if (!target.startsWith(`${root}${path.sep}`))
    throw new Error("Rollback artifacts must stay under .migration");

  for (
    let current = target;
    current !== path.dirname(root);
    current = path.dirname(current)
  ) {
    const status = fs.lstatSync(current);
    if (status.isSymbolicLink())
      throw new Error("Refusing symlinked rollback artifacts");
    if (
      current === target &&
      (!status.isFile() ||
        status.size > 512 * 1024 * 1024 ||
        (status.mode & 0o077) !== 0)
    )
      throw new Error("Rollback artifacts require a protected regular file");
    if (current !== target && (status.mode & 0o077) !== 0)
      throw new Error("Rollback artifact directories must be private");
  }

  return fs.readFileSync(target, encoding);
}

if (require.main === module) {
  main().catch((error) => {
    const code =
      error &&
      typeof error === "object" &&
      typeof error.code === "string" &&
      /^[a-z_]+$/.test(error.code)
        ? ` (${error.code})`
        : "";
    console.error(
      `Rollback verification failed${code}. Keep application writes disabled; inspect protected artifacts.`,
    );
    process.exitCode = 1;
  });
}

module.exports = { main, readProtectedFile };
