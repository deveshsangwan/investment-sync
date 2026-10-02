const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { validateSemanticCoverage } = require("./view-coverage.cjs");
const { reconcileSnapshot } = require("./reconcile.cjs");
const {
  legacyTables,
  sealSnapshot,
  writeArtifact,
  readSnapshot,
} = require("./phase6-artifacts.cjs");

function sourceFixture() {
  const tables = Object.fromEntries(legacyTables.map((table) => [table, []]));
  tables.households = [{ id: "house" }];
  tables.holding_snapshots = [
    { id: "old", household_id: "house" },
    { id: "current", household_id: "house" },
  ];
  return {
    schemaVersion: 1,
    sourceKind: "synthetic",
    evaluationTime: "2026-06-20T12:00:00.000Z",
    tables,
    sourceFiles: [],
    views: [
      {
        householdId: "house",
        overview: {},
        positions: { current: [{ id: "current" }], exited: [] },
        holdingDetails: [
          { legacyId: "old", value: {} },
          { legacyId: "current", value: {} },
        ],
        assetClassDetails: [
          "indian_stock",
          "mutual_fund",
          "us_stock",
          "nps",
          "ulip",
          "crypto",
          "cash",
          "other",
        ].map((assetClass) => ({ assetClass, value: {} })),
      },
    ],
  };
}

test("semantic coverage includes older UUIDs and every class, including explicit FX failures", () => {
  const source = sourceFixture();
  validateSemanticCoverage(source);
  source.views[0].positions = { error: "CurrencyRateUnavailableError" };
  validateSemanticCoverage(source);
  source.views[0].holdingDetails[0].value = {
    error: "CurrencyRateUnavailableError",
  };
  validateSemanticCoverage(source);
});

test("omitted or duplicate households, classes, historical details and positions fail closed", () => {
  const edits = [
    (source) => {
      source.views = [];
    },
    (source) => {
      source.views.push(source.views[0]);
    },
    (source) => {
      source.views[0].assetClassDetails.pop();
    },
    (source) => {
      source.views[0].holdingDetails.shift();
    },
    (source) => {
      source.views[0].holdingDetails.push(source.views[0].holdingDetails[0]);
    },
    (source) => {
      delete source.views[0].positions.current;
    },
  ];
  for (const edit of edits) {
    const source = sourceFixture();
    edit(source);
    assert.throws(() => validateSemanticCoverage(source), /coverage|Missing/);
  }
});

test("a resealed incomplete snapshot is rejected before any target reads", async () => {
  const source = sourceFixture();
  source.views = [];
  const runId = `phase6-coverage-test-${process.pid}`;
  const file = writeArtifact(runId, "snapshot.json", sealSnapshot(source));
  try {
    assert.throws(() => readSnapshot(file), /coverage/);
    let reads = 0;
    await assert.rejects(
      reconcileSnapshot(
        source,
        {
          invoke: () => {
            reads += 1;
          },
        },
        runId,
      ),
      /coverage/,
    );
    assert.equal(reads, 0);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true });
  }
});
