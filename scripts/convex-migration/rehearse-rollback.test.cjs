const assert = require("node:assert/strict");
const test = require("node:test");
const {
  portableTarget,
  requireLocalRehearsal,
} = require("./rehearse-rollback.cjs");

test("live rollback rehearsal rejects production classification, remote targets, and unrelated SQL databases", () => {
  const source = { sourceKind: "synthetic" };
  const connection = {
    deployment: "local:generated-rollback",
    url: "http://127.0.0.1:3218",
  };
  const databaseUrl =
    "postgresql://generated@127.0.0.1:54330/investment_sync_rollback_live";
  assert.doesNotThrow(() =>
    requireLocalRehearsal(source, connection, databaseUrl),
  );
  assert.throws(() =>
    requireLocalRehearsal(
      { sourceKind: "production" },
      connection,
      databaseUrl,
    ),
  );
  assert.throws(() =>
    requireLocalRehearsal(
      source,
      { ...connection, deployment: "prod:generated-rollback" },
      databaseUrl,
    ),
  );
  assert.throws(() =>
    requireLocalRehearsal(
      source,
      { ...connection, url: "https://generated.convex.cloud" },
      databaseUrl,
    ),
  );
  assert.throws(() =>
    requireLocalRehearsal(
      source,
      connection,
      databaseUrl.replace(
        "investment_sync_rollback_live",
        "investment_sync_dev",
      ),
    ),
  );
});

test("portable live target attaches full archived source records to real native mappings and refuses missing archives", () => {
  const sourceJson = JSON.stringify({
    id: "legacy-row",
    normalized_payload: { amount: 2.125 },
  });
  const mapping = {
    runKey: "generated",
    legacyTable: "import_rows",
    legacyId: "legacy-row",
    targetTable: "migrationRecords",
    targetId: "archive-row",
  };
  const raw = {
    schemaVersion: 1,
    projectorVersion: "portfolio-v1",
    tables: {
      migrationMappings: [mapping],
      migrationRecords: [
        {
          _id: "archive-row",
          runKey: "generated",
          legacyTable: "import_rows",
          legacyId: "legacy-row",
          sourceJson,
        },
      ],
    },
  };
  const source = {
    sourceKind: "synthetic",
    evaluationTime: "2026-06-20T12:00:00.000Z",
    inputDigest: "fixture",
  };
  const packet = portableTarget(raw, source);
  assert.equal(packet.mappings[0].sourceJson, sourceJson);
  assert.deepEqual(packet.tables, raw.tables);
  raw.tables.migrationRecords = [];
  assert.throws(() => portableTarget(raw, source), /no archived source row/);
});
