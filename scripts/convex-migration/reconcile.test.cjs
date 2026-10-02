const assert = require("node:assert/strict");
const { test } = require("node:test");
const { compare, semantic } = require("./reconcile.cjs");
const { reconcileRecords } = require("./reconcile-records.cjs");
const { legacyTables } = require("./phase6-artifacts.cjs");

test("semantic comparison retains ordering, identity fields, status and exact amounts", () => {
  const expected = {
    current: [
      {
        id: "old",
        symbol: "NVDA",
        quantity: "2.0000000000",
        currentValue: "9007199254740993.0001",
      },
    ],
    exited: [],
  };
  const actual = {
    current: [
      {
        id: "new",
        symbol: "NVDA",
        quantity: "2",
        currentValue: "9007199254740993.0002",
      },
    ],
    exited: [],
  };
  const findings = [];
  compare(semantic(expected), semantic(actual), "positions", findings);
  assert.deepEqual(
    findings.map((finding) => finding.path),
    ["positions.current[0].currentValue"],
  );

  const missing = [];
  compare(
    { current: expected.current, exited: [] },
    { current: [], exited: expected.current },
    "positions",
    missing,
  );
  assert.equal(missing.length, 2);
});

test("only approximate numeric analytics use the declared tolerance", () => {
  const findings = [];
  compare(
    { xirr: 0.12345678 },
    { xirr: 0.123456780000001 },
    "performance",
    findings,
  );
  assert.equal(findings.length, 0);
  compare({ xirr: 0.12345678 }, { xirr: 0.1234568 }, "performance", findings);
  assert.equal(findings.length, 1);
  compare(
    { quantity: "0.1000000001" },
    { quantity: "0.1" },
    "holding",
    findings,
  );
  assert.equal(findings.length, 2);
});

test("an intact source archive cannot hide a changed native financial value or household", () => {
  const tables = Object.fromEntries(legacyTables.map((table) => [table, []]));
  tables.holding_snapshots = [
    {
      id: "holding-old",
      household_id: "house-old",
      import_batch_id: null,
      snapshot_date: "2026-01-01",
      currency: "USD",
      quantity: "2.0000000000",
      invested_amount: "10.0000",
      current_value: "12.0000",
      pnl_amount: null,
    },
  ];
  const native = {
    _id: "holding-new",
    legacyId: "holding-old",
    householdId: "house-new",
    date: "2026-01-01",
    positionKey: "position",
    factJson: JSON.stringify({
      row: {
        kind: "holding",
        currency: "USD",
        quantity: "2",
        investedAmount: "10",
        currentValue: "12",
      },
      provenance: { legacyId: "holding-old" },
    }),
  };
  const target = {
    tables: {
      holdingSnapshots: [native],
      legacyHoldingAliases: [
        {
          householdId: "house-new",
          legacyId: "holding-old",
          positionKey: "position",
        },
      ],
      migrationMappings: [
        {
          legacyTable: "households",
          legacyId: "house-old",
          targetTable: "households",
          targetId: "house-new",
        },
        {
          legacyTable: "holding_snapshots",
          legacyId: "holding-old",
          targetTable: "holdingSnapshots",
          targetId: "holding-new",
        },
      ],
      households: [{ _id: "house-new" }],
    },
  };
  const clean = [];
  reconcileRecords({ tables }, target, clean);
  assert.equal(clean.length, 0);

  native.factJson = JSON.stringify({
    row: {
      kind: "holding",
      currency: "USD",
      quantity: "2",
      investedAmount: "10",
      currentValue: "13",
    },
    provenance: { legacyId: "holding-old" },
  });
  native.householdId = "foreign-household";
  const findings = [];
  reconcileRecords({ tables }, target, findings);
  assert.ok(findings.some((finding) => finding.path.endsWith(".currentValue")));
  assert.ok(findings.some((finding) => finding.path.endsWith(".householdId")));
  assert.ok(
    findings.some((finding) => finding.path.endsWith(".legacyAliasCount")),
  );
});

test("a missing mapped native row blocks verification", () => {
  const findings = [];
  reconcileRecords(
    { tables: Object.fromEntries(legacyTables.map((table) => [table, []])) },
    {
      tables: {
        migrationMappings: [
          {
            legacyTable: "users",
            legacyId: "old",
            targetTable: "users",
            targetId: "gone",
          },
        ],
        users: [],
      },
    },
    findings,
  );
  assert.equal(findings[0].reason, "missing_target_document");
});

test("unexpected native rows cannot hide behind complete source mappings", () => {
  const findings = [];
  reconcileRecords(
    { tables: Object.fromEntries(legacyTables.map((table) => [table, []])) },
    {
      tables: { migrationMappings: [], users: [{ _id: "unexpected" }] },
    },
    findings,
  );
  assert.equal(findings[0].reason, "unexpected_native_document");
});
