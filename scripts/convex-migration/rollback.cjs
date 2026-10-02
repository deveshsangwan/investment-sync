const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const nodeCrypto = require("node:crypto");
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
} = require("./reverse-replay-postgres.cjs");

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
  const sourceSnapshot = JSON.parse(
    readProtectedFile(argumentsMap.get("snapshot")),
  );
  if (sourceSnapshot.sourceKind !== "synthetic")
    throw new Error(
      "Phase 6 rollback refuses production data; production replay requires Phase 7 authorization",
    );

  const envFile = argumentsMap.get("env-file");
  if (!envFile) throw new Error("Pass an explicit --env-file");
  const environment = loadExplicitEnvironment(path.resolve(envFile));
  const parsed = new URL(environment.DATABASE_URL ?? "");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    !/^\/investment_sync_rollback_[a-z0-9_]+$/.test(parsed.pathname)
  )
    throw new Error(
      "Synthetic replay requires a dedicated local investment_sync_rollback_ database",
    );
  const postgres = createRequire(
    path.resolve(process.cwd(), "packages/db/package.json"),
  )("postgres");
  const sql = postgres(parsed.toString(), { max: 1, onnotice: () => {} });
  const runDirectory = createProtectedRunDirectory(runId);
  if (
    fs.existsSync(path.join(runDirectory, "rollback-receipt.json")) ||
    fs.existsSync(path.join(runDirectory, "reverse-replay-plan.json"))
  )
    throw new Error(
      "Use a new rollback run ID; existing artifacts cannot be overwritten",
    );
  const receipt = {
    schemaVersion: 1,
    sourceKind: "synthetic",
    mode,
    rollbackCommit,
    configurationDigest: nodeCrypto
      .createHash("sha256")
      .update(rollbackConfiguration)
      .digest("hex"),
    applicationRestored: false,
  };

  try {
    if (mode === "before-writes") {
      const initialTarget = JSON.parse(
        readProtectedFile(argumentsMap.get("target-baseline")),
      );
      const currentTarget = JSON.parse(
        readProtectedFile(argumentsMap.get("target-export")),
      );
      receipt.targetVerification = verifyNoConvexWrites(
        initialTarget,
        currentTarget,
      );
      const initialPlan = buildReverseReplayPlan({
        sourceSnapshot,
        targetSnapshot: initialTarget,
      });
      if (
        initialPlan.newCommittedBatches.length ||
        initialPlan.sourceDigest !== initialPlan.replayDigest
      )
        throw new ReverseReplayError("target_baseline_differs_from_source");
      receipt.verification = await verifyBeforeWrites(
        sql,
        sourceSnapshot.tables,
      );
    } else {
      const targetSnapshot = JSON.parse(
        readProtectedFile(argumentsMap.get("target-export")),
      );
      const plan = buildReverseReplayPlan({ sourceSnapshot, targetSnapshot });
      writeProtectedJson(runDirectory, "reverse-replay-plan.json", plan);
      receipt.planDigest = plan.replayDigest;
      receipt.newCommittedBatches = plan.newCommittedBatches.length;
      receipt.verification =
        argumentsMap.get("apply") === "true"
          ? await applyReverseReplay(sql, plan)
          : await verifyBeforeWrites(sql, sourceSnapshot.tables);
    }

    writeProtectedJson(runDirectory, "rollback-receipt.json", receipt);
    console.log(
      `Rollback ${mode} verification passed; application restoration remains an operator step.`,
    );
  } finally {
    await sql.end();
  }
}

function readProtectedFile(fileName) {
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

  return fs.readFileSync(target, "utf8");
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

module.exports = { readProtectedFile };
