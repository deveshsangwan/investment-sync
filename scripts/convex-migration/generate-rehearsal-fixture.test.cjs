const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const fixtureScript = path.join(__dirname, "generate-rehearsal-fixture.ts");
const tsxCli = require.resolve("tsx/cli");

test("generated migration fixtures refuse remote and ordinary local databases", () => {
  for (const databaseUrl of [
    "postgresql://generated@production.example.test/investment_sync_migration_source",
    "postgresql://generated@127.0.0.1/investment_sync_dev",
    "https://127.0.0.1/investment_sync_migration_source",
  ]) {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "migration-fixture-guard-"),
    );

    try {
      const envFile = path.join(directory, "database.env");
      fs.writeFileSync(envFile, `DATABASE_URL=${databaseUrl}\n`, {
        mode: 0o600,
      });
      const result = spawnSync(
        process.execPath,
        [tsxCli, fixtureScript, "--env-file", envFile, "--run-id", "generated"],
        {
          cwd: directory,
          env: { PATH: process.env.PATH },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Generated fixture creation failed/);
      assert.equal(fs.existsSync(path.join(directory, ".migration")), false);
      assert.equal(result.stdout, "");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("generated migration fixtures require an explicit environment and safe run id", () => {
  for (const args of [
    ["--run-id", "generated"],
    ["--env-file", "database.env", "--run-id", "../../outside"],
  ]) {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "migration-fixture-arguments-"),
    );

    try {
      fs.writeFileSync(
        path.join(directory, "database.env"),
        "DATABASE_URL=postgresql://generated@127.0.0.1/investment_sync_dev\n",
        { mode: 0o600 },
      );
      const result = spawnSync(
        process.execPath,
        [tsxCli, fixtureScript, ...args],
        {
          cwd: directory,
          env: { PATH: process.env.PATH },
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Generated fixture creation failed/);
      assert.equal(fs.existsSync(path.join(directory, ".migration")), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});
