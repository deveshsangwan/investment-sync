const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  createRollbackFixture,
  CREATED_AT,
} = require("./rollback-fixtures.cjs");
const { buildReverseReplayPlan } = require("./reverse-replay.cjs");
const {
  TABLE_COLUMNS,
  applyReverseReplay,
  digest,
  readSqlTables,
  verifyBeforeWrites,
} = require("./reverse-replay-postgres.cjs");

const databaseUrl = process.env.ROLLBACK_TEST_DATABASE_URL;

test(
  "old Postgres schema replays expired rows and new identities atomically, reconciles exact facts, and refuses divergence",
  { skip: !databaseUrl },
  async () => {
    const parsed = new URL(databaseUrl);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname),
      "Rollback tests require local Postgres",
    );
    assert.match(parsed.pathname, /^\/investment_sync_rollback_[a-z0-9_]+$/);
    const postgres = createRequire(
      path.resolve(process.cwd(), "packages/db/package.json"),
    )("postgres");
    const databaseName = `${parsed.pathname.slice(1)}_${process.pid}`;
    parsed.pathname = "/postgres";
    const admin = postgres(parsed.toString(), { max: 1, onnotice: () => {} });
    const fixture = createRollbackFixture();
    let sql;

    try {
      await admin.unsafe(`create database "${databaseName}"`);
      parsed.pathname = `/${databaseName}`;
      sql = postgres(parsed.toString(), { max: 1, onnotice: () => {} });
      const migrationDirectory = path.resolve(
        process.cwd(),
        "packages/db/drizzle",
      );
      for (const file of fs
        .readdirSync(migrationDirectory)
        .filter((name) => /^\d.*\.sql$/.test(name))
        .sort()) {
        const statements = fs
          .readFileSync(path.join(migrationDirectory, file), "utf8")
          .split("--> statement-breakpoint");
        await sql.begin(async (transaction) => {
          for (const statement of statements)
            if (statement.trim()) await transaction.unsafe(statement);
        });
      }

      // PostgreSQL parses the fixture's JSON into its real numeric/date types.
      for (const table of Object.keys(TABLE_COLUMNS)) {
        if (!fixture.sourceSnapshot.tables[table].length) continue;
        await sql.unsafe(
          `insert into "${table}" select * from jsonb_populate_recordset(null::"${table}", $1::text::jsonb)`,
          [JSON.stringify(fixture.sourceSnapshot.tables[table])],
        );
      }

      const before = await verifyBeforeWrites(
        sql,
        fixture.sourceSnapshot.tables,
      );
      assert.equal(before.unchanged, true);
      const plan = buildReverseReplayPlan(fixture);

      await sql.unsafe(
        "create function pg_temp.reject_replay() returns trigger language plpgsql as $$ begin raise exception 'synthetic interrupted write'; end $$",
      );
      await sql.unsafe(
        "create trigger reject_replay before insert on transactions for each row execute function pg_temp.reject_replay()",
      );
      await assert.rejects(
        applyReverseReplay(sql, plan),
        /synthetic interrupted write/,
      );
      assert.equal(digest(await readSqlTables(sql)), before.sourceDigest);
      await sql.unsafe("drop trigger reject_replay on transactions");

      const cli = prepareCliArtifacts(fixture, parsed.toString());
      const initialOutput = execFileSync(
        process.execPath,
        cli.arguments("before-writes", "false"),
        { encoding: "utf8" },
      );
      assert.match(initialOutput, /verification passed/);
      const initialReceipt = JSON.parse(
        fs.readFileSync(cli.receiptPath("before-writes"), "utf8"),
      );
      assert.equal(initialReceipt.verification.unchanged, true);
      assert.equal(initialReceipt.applicationRestored, false);
      assert.equal(
        fs.statSync(cli.receiptPath("before-writes")).mode & 0o777,
        0o600,
      );

      const applied = await applyReverseReplay(sql, plan);
      assert.equal(applied.applied, true);
      assert.equal(applied.counts.households, 2);
      assert.equal(applied.counts.import_batches, 3);
      assert.equal(applied.counts.import_rows, 4);
      const actual = await readSqlTables(sql);
      assert.equal(digest(actual), plan.replayDigest);
      assert.equal(
        actual.users.find((row) => row.clerk_user_id === "synthetic_old")
          .created_at,
        CREATED_AT,
      );
      assert.equal(actual.transactions[0].amount, "2.125");
      assert.equal(actual.transactions[0].quantity, "0.125");
      assert.ok(
        actual.import_batches.every(
          (row) => row.storage_path === null && row.status === "committed",
        ),
      );
      assert.ok(actual.import_rows.every((row) => row.is_committed));

      const rerun = await applyReverseReplay(sql, plan);
      assert.equal(rerun.alreadyApplied, true);
      const afterOutput = execFileSync(
        process.execPath,
        cli.arguments("after-writes", "true"),
        { encoding: "utf8" },
      );
      assert.match(afterOutput, /verification passed/);
      const afterReceipt = JSON.parse(
        fs.readFileSync(cli.receiptPath("after-writes"), "utf8"),
      );
      assert.equal(afterReceipt.verification.alreadyApplied, true);
      assert.equal(afterReceipt.newCommittedBatches, 3);
      await assert.rejects(
        verifyBeforeWrites(sql, fixture.sourceSnapshot.tables),
        /differs from the frozen source/,
      );
      await sql`update users set email = 'unexpected@example.invalid' where clerk_user_id = 'synthetic_new'`;
      const divergentDigest = digest(await readSqlTables(sql));
      await assert.rejects(
        applyReverseReplay(sql, plan),
        /divergent Postgres data/,
      );
      assert.equal(digest(await readSqlTables(sql)), divergentDigest);
    } finally {
      if (sql) await sql.end();
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.end();
    }
  },
);

function prepareCliArtifacts(fixture, databaseUrl) {
  const root = path.resolve(process.cwd(), ".migration");
  const prefix = `rollback-cli-${process.pid}`;
  const directory = path.join(root, `${prefix}-input`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(directory, 0o700);
  const write = (name, contents) => {
    const destination = path.join(directory, name);
    fs.writeFileSync(destination, contents, { mode: 0o600, flag: "wx" });
    return destination;
  };
  const snapshot = write("source.json", JSON.stringify(fixture.sourceSnapshot));
  const target = write("target.json", JSON.stringify(fixture.targetSnapshot));
  const initialTarget = structuredClone(fixture.targetSnapshot);
  for (const table of [
    "users",
    "households",
    "householdMembers",
    "accounts",
    "instruments",
  ])
    initialTarget.tables[table] = initialTarget.tables[table].filter((row) =>
      row._id.endsWith("-old"),
    );
  for (const table of ["sourceFiles", "importRowChunks"])
    initialTarget.tables[table] = initialTarget.tables[table].filter(
      (row) => row.batchId === "batch-expired",
    );
  initialTarget.tables.importBatches =
    initialTarget.tables.importBatches.filter(
      (row) => row._id === "batch-expired",
    );
  initialTarget.tables.importBatches[0].status = "parsed";
  delete initialTarget.tables.importBatches[0].committedAt;
  delete initialTarget.tables.importBatches[0].committedVersionId;
  for (const table of [
    "holdingSnapshots",
    "transactions",
    "portfolioValuations",
    "portfolioVersions",
    "publicationReceipts",
  ])
    initialTarget.tables[table] = [];
  const targetBaseline = write(
    "target-baseline.json",
    JSON.stringify(initialTarget),
  );
  const configuration = write(
    "rollback-config.json",
    JSON.stringify({ sourceKind: "synthetic", backend: "Postgres" }),
  );
  const environment = write("rollback.env", `DATABASE_URL=${databaseUrl}\n`);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  return {
    arguments: (mode, apply) => [
      "scripts/convex-migration/rollback.cjs",
      "--mode",
      mode,
      "--snapshot",
      snapshot,
      "--target-export",
      mode === "before-writes" ? targetBaseline : target,
      "--target-baseline",
      targetBaseline,
      "--env-file",
      environment,
      "--run-id",
      `${prefix}-${mode}`,
      "--apply",
      apply,
      "--rollback-commit",
      commit,
      "--rollback-config-file",
      configuration,
    ],
    receiptPath: (mode) =>
      path.join(root, `${prefix}-${mode}`, "rollback-receipt.json"),
  };
}
