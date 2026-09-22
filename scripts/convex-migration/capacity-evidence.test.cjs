const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");
const {
  candidateCeilings,
  evaluateCapacityEvidence,
} = require("./capacity-evidence.cjs");
const { assertRedacted, renderNote } = require("./generate-capacity-note.cjs");

describe("capacity evidence", () => {
  it("sets candidates only for compatible and clean coherent evidence", () => {
    const fixture = evidenceFixture();
    const result = evaluateCapacityEvidence(fixture);

    assert.equal(result.evidenceReady, true);
    assert.deepEqual(result.candidate, {
      compressedBytes: 262_144,
      normalizedRows: 200,
      normalizedSerializedBytes: 65_536,
    });
    assert.equal(result.twiceLargest.normalizedRows, 220);
    assert.equal(result.twiceLargest.rowKindCounts[0].count, 220);
  });

  it("fails closed on a row mismatch until a sanitized disposition exists", () => {
    const fixture = evidenceFixture();
    fixture.postgres.integrity[0].groups = 1;
    assert.equal(evaluateCapacityEvidence(fixture).evidenceReady, false);

    fixture.dispositions = {
      schemaVersion: 1,
      runId: fixture.runId,
      findings: [
        {
          check: "batch_row_count_mismatch",
          disposition: "accepted_source_state",
          reasonCode: "source_batch_reviewed",
        },
      ],
    };
    assert.equal(evaluateCapacityEvidence(fixture).evidenceReady, true);
  });

  it("fails closed on collision, orphan, and empty-pending findings", () => {
    const fixture = evidenceFixture();
    fixture.postgres.collisions.push({
      check: "account_identity",
      groups: 1,
      excessRecords: 1,
      maximumGroupSize: 2,
    });
    fixture.postgres.pendingBatches.push({
      key: "failed/unknown/empty/expired",
      count: 1,
    });
    fixture.storage.summary.orphanBucketObjects = 1;

    const result = evaluateCapacityEvidence(fixture);
    assert.equal(result.evidenceReady, false);
    assert.deepEqual(
      result.unresolvedFindings
        .filter((finding) => finding.count > 0)
        .map((finding) => finding.check)
        .sort(),
      [
        "account_identity",
        "pending_empty_expired_batches",
        "storage_orphan_bucket_objects",
      ],
    );
  });

  it("rejects incompatible fingerprints, timestamps, schemas, and runs", () => {
    for (const mutate of [
      (fixture) => (fixture.storage.databaseFingerprint = "other"),
      (fixture) => (fixture.storage.runId = "other"),
      (fixture) => (fixture.storage.schemaVersion = 1),
      (fixture) => (fixture.storage.collectedAt = "2026-09-02T00:00:00.000Z"),
    ]) {
      const fixture = evidenceFixture();
      mutate(fixture);
      assert.equal(evaluateCapacityEvidence(fixture).evidenceReady, false);
    }
  });

  it("rounds candidate ceilings with documented headroom", () => {
    assert.deepEqual(
      candidateCeilings({
        compressedBytes: 262_145,
        normalizedRows: 674,
        normalizedSerializedBytes: 336_090,
      }),
      {
        compressedBytes: 524_288,
        normalizedRows: 1_100,
        normalizedSerializedBytes: 524_288,
      },
    );
  });

  it("renders pending and orphan decisions without leaking protected fields", () => {
    const fixture = evidenceFixture();
    fixture.postgres.pendingBatches = [
      { key: "parsed/unknown/meaningful/expired", count: 8 },
      { key: "failed/unknown/empty/expired", count: 4 },
    ];
    fixture.storage.summary.orphanBucketObjects = 1;
    const result = evaluateCapacityEvidence(fixture);
    const note = renderNote(
      fixture.runId,
      fixture.postgres,
      fixture.storage,
      result,
    );

    assert.match(note, /Preserve 8 meaningful expired batches/);
    assert.match(note, /Preserve empty expired batch history as unavailable/);
    assert.match(note, /1 unreferenced bucket object/);
    assert.doesNotThrow(() => assertRedacted(note));
    assert.throws(() => assertRedacted(`${note}\npostgresql://secret`));
  });
});

describe("runtime safeguards", () => {
  const runtimePath = path.resolve(__dirname, "runtime.cjs");

  it("rejects duplicate arguments and local production URLs", () => {
    assert.notEqual(
      runNode(
        `const r=require(${JSON.stringify(runtimePath)}); r.parseArguments(['--run-id','one','--run-id','two']);`,
      ).status,
      0,
    );
    assert.notEqual(
      runNode(
        `const r=require(${JSON.stringify(runtimePath)}); r.assertProductionDatabaseUrl('postgresql://user:pass@localhost/db');`,
      ).status,
      0,
    );
  });

  it("rejects IPv6 loopback database URLs before collecting inventory", () => {
    for (const host of ["[::1]", "[0:0:0:0:0:0:0:1]"]) {
      const result = runNode(
        `const r=require(${JSON.stringify(runtimePath)}); r.assertProductionDatabaseUrl(${JSON.stringify(`postgresql://user:pass@${host}/db`)});`,
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /refuses a local database URL/);
    }
  });

  it("rejects local Storage URLs before collecting inventory", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "[0:0:0:0:0:0:0:1]",
    ]) {
      const result = runNode(
        `const r=require(${JSON.stringify(runtimePath)}); r.assertProductionStorageUrl(${JSON.stringify(`http://${host}:54321`)});`,
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /refuses a local Supabase URL/);
    }
  });

  it("accepts non-local inventory URLs without connecting", () => {
    const result = runNode(
      `const r=require(${JSON.stringify(runtimePath)}); r.assertProductionDatabaseUrl('postgresql://user:pass@db.example.invalid/db'); r.assertProductionStorageUrl('https://storage.example.invalid');`,
    );

    assert.equal(result.status, 0, result.stderr);
  });

  it("uses protected modes and refuses overwrite", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "phase0-runtime-"));
    try {
      const code = `const r=require(${JSON.stringify(runtimePath)}); const d=r.createProtectedRunDirectory('run'); r.writeProtectedJson(d,'result.json',{ok:true}); r.writeProtectedJson(d,'result.json',{ok:true});`;
      const result = runNode(code, directory);
      assert.notEqual(result.status, 0);
      assert.equal(
        fs.statSync(path.join(directory, ".migration")).mode & 0o777,
        0o700,
      );
      assert.equal(
        fs.statSync(path.join(directory, ".migration/run/result.json")).mode &
          0o777,
        0o600,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses artifact paths outside the migration root", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "phase0-path-"));
    try {
      const outside = path.join(directory, "outside");
      fs.mkdirSync(outside);
      const result = runNode(
        `const r=require(${JSON.stringify(runtimePath)}); r.writeProtectedJson(${JSON.stringify(outside)},'result.json',{ok:true});`,
        directory,
      );
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(path.join(outside, "result.json")), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked migration directory", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "phase0-symlink-"));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "phase0-target-"));
    try {
      fs.symlinkSync(target, path.join(directory, ".migration"));
      const result = runNode(
        `const r=require(${JSON.stringify(runtimePath)}); r.createProtectedRunDirectory('run');`,
        directory,
      );
      assert.notEqual(result.status, 0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("keeps the Storage inventory read-only in source", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "inventory-storage.cjs"),
      "utf8",
    );
    assert.match(
      source,
      /transaction isolation level repeatable read read only/,
    );
    assert.match(source, /\.download\(/);
    assert.doesNotMatch(source, /\.upload\(|\.remove\(|createBucket\(/);
  });
});

function runNode(code, cwd = process.cwd()) {
  return spawnSync(process.execPath, ["-e", code], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function evidenceFixture() {
  const runId = "fixture-run";
  const collectedAt = "2026-08-29T00:00:00.000Z";
  const largestBatch = {
    batchFingerprint: "batch-fingerprint",
    sourceType: "tickertape_stock_csv",
    normalizedRows: 110,
    normalizedSerializedBytes: 1_000,
    maximumNormalizedRowBytes: 20,
    distinctAccounts: 1,
    distinctInstruments: 10,
    projectedFactWritesLowerBound: 110,
    projectedReadModelWritesLowerBound: 20,
    rowKindCounts: [{ key: "holding", count: 110 }],
    currencyCounts: [{ key: "INR", count: 110 }],
  };
  return {
    runId,
    dispositions: null,
    postgres: {
      schemaVersion: 1,
      runId,
      collectedAt,
      databaseFingerprint: "database-fingerprint",
      tableCounts: [{ key: "import_rows", count: 110 }],
      integrity: [
        {
          check: "batch_row_count_mismatch",
          groups: 0,
          excessRecords: 0,
          maximumGroupSize: 0,
        },
      ],
      collisions: [],
      pendingBatches: [],
      prices: { records: 0, groups: [] },
      largestBatch,
      largestHousehold: {
        accounts: 1,
        instruments: 10,
        importBatches: 1,
        importRows: 110,
        holdingSnapshots: 100,
        transactions: 0,
        valuations: 0,
        factRows: 100,
      },
    },
    storage: {
      schemaVersion: 2,
      runId,
      collectedAt: "2026-08-29T00:05:00.000Z",
      status: "complete",
      databaseFingerprint: "database-fingerprint",
      storageFingerprint: "storage-fingerprint",
      summary: {
        referencedFiles: 1,
        bucketObjects: 1,
        orphanBucketObjects: 0,
        availableFiles: 1,
        missingFiles: 0,
        downloadFailures: 0,
        hashMismatches: 0,
        storageSizeMismatches: 0,
        databaseSizeUnverifiable: 1,
        parseFailures: 0,
        databaseRowCountMismatches: 0,
      },
      files: [
        {
          batchFingerprint: "batch-fingerprint",
          availability: "available",
          parseStatus: "parsed",
          downloadedBytes: 1_000,
        },
      ],
    },
  };
}
