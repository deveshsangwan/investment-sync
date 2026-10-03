const { parseArguments, assertAllowedArguments } = require("./runtime.cjs");
const {
  legacyTables,
  canonicalJson,
  digest,
  readSnapshot,
  readEnvironment,
  convexConnection,
  writeArtifact,
  requireRunId,
  writeFailure,
  protectedPath,
} = require("./phase6-artifacts.cjs");
const fs = require("node:fs");
const { verifyStoredFile } = require("./load-snapshot.cjs");
const { reconcileRecords } = require("./reconcile-records.cjs");
const { validateSemanticCoverage } = require("./view-coverage.cjs");

const targetTables = [
  "users",
  "households",
  "householdMembers",
  "accounts",
  "instruments",
  "importBatches",
  "sourceFiles",
  "importRowChunks",
  "importDedupeKeys",
  "holdingSnapshots",
  "transactions",
  "portfolioValuations",
  "portfolioVersions",
  "publicationReceipts",
  "portfolioPositions",
  "portfolioHistoryFacts",
  "portfolioHistoryScopes",
  "portfolioSummaries",
  "assetClassSummaries",
  "portfolioTimeline",
  "legacyHoldingAliases",
  "currencyRates",
  "migrationRuns",
  "migrationRecords",
  "migrationMappings",
];
const decimalFields = new Set([
  "quantity",
  "price",
  "amount",
  "investedAmount",
  "currentValue",
  "pnlAmount",
  "pnlPercent",
]);
const incidentalIds = new Set([
  "id",
  "accountId",
  "instrumentId",
  "positionKey",
]);

function canonicalDecimal(value) {
  if (!/^-?\d+(\.\d+)?$/.test(value))
    throw new Error("Invalid decimal comparison input");
  const negative = value.startsWith("-");
  const [integer, fraction = ""] = value.replace(/^-/, "").split(".");
  const whole = integer.replace(/^0+(?=\d)/, "");
  const tail = fraction.replace(/0+$/, "");
  const zero = whole === "0" && tail === "";

  return `${negative && !zero ? "-" : ""}${whole}${tail ? `.${tail}` : ""}`;
}

function semantic(value, key = "") {
  if (typeof value === "string" && decimalFields.has(key))
    return canonicalDecimal(value);
  if (Array.isArray(value)) return value.map((item) => semantic(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([field, child]) => !incidentalIds.has(field) && child !== undefined,
        )
        .map(([field, child]) => [field, semantic(child, field)]),
    );
  }

  return value;
}

function frozenQuote(snapshot) {
  const rates = snapshot.tables.currency_rates.filter(
    (rate) =>
      rate.base === "USD" &&
      rate.quote === "INR" &&
      rate.provider === "frankfurter",
  );
  if (rates.length > 1) throw new Error("Ambiguous source exchange rate");
  const rate = rates[0];
  if (!rate) return { status: "unavailable" };
  const age = Date.parse(snapshot.evaluationTime) - Date.parse(rate.fetched_at);
  if (age >= 7 * 86400000) return { status: "unavailable" };

  return {
    status: age >= 6 * 3600000 ? "stale" : "fresh",
    rate: rate.rate,
    fetchedAt: new Date(rate.fetched_at).toISOString(),
    provider: "frankfurter",
  };
}

function compare(expected, actual, path, findings) {
  if (typeof expected === "number" && typeof actual === "number") {
    if (
      !Number.isFinite(expected) ||
      !Number.isFinite(actual) ||
      Math.abs(expected - actual) > 1e-8
    )
      findings.push({ path, reason: "numeric_difference", expected, actual });
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      findings.push({
        path,
        reason: "array_length",
        expected: expected.length,
        actual: Array.isArray(actual) ? actual.length : null,
      });
      return;
    }
    expected.forEach((value, index) =>
      compare(value, actual[index], `${path}[${index}]`, findings),
    );
    return;
  }
  if (expected !== null && typeof expected === "object") {
    if (
      actual === null ||
      typeof actual !== "object" ||
      Array.isArray(actual)
    ) {
      findings.push({ path, reason: "object_missing" });
      return;
    }
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (canonicalJson(expectedKeys) !== canonicalJson(actualKeys))
      findings.push({
        path,
        reason: "object_fields",
        expected: expectedKeys,
        actual: actualKeys,
      });
    for (const key of expectedKeys)
      compare(expected[key], actual[key], `${path}.${key}`, findings);
    return;
  }

  if (expected !== actual)
    findings.push({
      path,
      reason: "value_difference",
      expected: expected ?? null,
      actual: actual ?? null,
    });
}

async function exportTarget(connection, runKey) {
  const tables = {};
  for (const table of targetTables) {
    tables[table] = [];
    let cursor = null;
    do {
      const result = await connection.invoke("migration:exportPage", {
        runKey,
        table,
        paginationOpts: { cursor, numItems: 100, maximumBytesRead: 524288 },
      });
      const page = JSON.parse(result.pageJson);
      if (
        !Array.isArray(page) ||
        (page.length === 0 &&
          !result.isDone &&
          result.continueCursor === cursor)
      )
        throw new Error("Invalid target export pagination");
      tables[table].push(...page);
      cursor = result.isDone ? null : result.continueCursor;
    } while (cursor !== null);
  }

  return { schemaVersion: 1, projectorVersion: "portfolio-v1", tables };
}

function sourceDispositions(snapshot) {
  return snapshot.tables.import_batches.flatMap((batch) => {
    const actualRowCount = snapshot.tables.import_rows.filter(
      (row) => row.import_batch_id === batch.id,
    ).length;
    return batch.row_count === actualRowCount
      ? []
      : [
          {
            legacyBatchId: batch.id,
            reason: "historical_declared_row_count",
            declaredRowCount: batch.row_count,
            actualRowCount,
          },
        ];
  });
}

async function reconcileSnapshot(
  snapshot,
  connection,
  runKey,
  approvedDispositions = [],
) {
  validateSemanticCoverage(snapshot);

  const target = {
    ...(await exportTarget(connection, runKey)),
    sourceKind: snapshot.sourceKind,
    evaluationTime: snapshot.evaluationTime,
    inputDigest: snapshot.inputDigest,
  };
  const findings = [];
  const run = target.tables.migrationRuns.find((run) => run.runKey === runKey);
  if (
    !run ||
    run.inputDigest !== snapshot.inputDigest ||
    run.sourceKind !== snapshot.sourceKind ||
    run.evaluationTime !== snapshot.evaluationTime ||
    !run.inputSealed
  )
    findings.push({
      path: "migrationRun",
      reason: "source_snapshot_or_run_state_mismatch",
    });
  const dispositions = sourceDispositions(snapshot);
  if (snapshot.sourceKind === "production") {
    compare(
      dispositions,
      approvedDispositions,
      "approvedSourceDispositions",
      findings,
    );
  }
  reconcileRecords(snapshot, target, findings);
  const records = target.tables.migrationRecords;
  for (const table of legacyTables) {
    const actual = records
      .filter((record) => record.legacyTable === table)
      .map((record) => JSON.parse(record.sourceJson));
    const sort = (rows) =>
      [...rows].sort((left, right) => left.id.localeCompare(right.id));
    compare(
      sort(snapshot.tables[table]),
      sort(actual),
      `source.${table}`,
      findings,
    );
  }

  const audit = await connection.invoke("migrationAudit:audit", { runKey });
  const auditResult = typeof audit === "string" ? JSON.parse(audit) : audit;
  if (
    !auditResult ||
    typeof auditResult.ok !== "boolean" ||
    !Array.isArray(auditResult.findings)
  )
    throw new Error("Target integrity audit did not complete");
  findings.push(...auditResult.findings);

  const views = [];
  for (const source of snapshot.views) {
    const base = {
      runKey,
      legacyHouseholdId: source.householdId,
      quote: frozenQuote(snapshot),
    };
    const read = async (args) => {
      const response = await connection.invoke("migrationViews:portfolioView", {
        ...base,
        ...args,
      });
      return typeof response === "string" ? JSON.parse(response) : response;
    };
    const overview = await read({ view: "overview" });
    const positions = await read({ view: "positions" });
    const holdingDetails = [];
    for (const detail of source.holdingDetails)
      holdingDetails.push({
        legacyId: detail.legacyId,
        value: await read({
          view: "holdingDetail",
          positionKey: detail.legacyId,
        }),
      });
    const assetClassDetails = [];
    for (const asset of source.assetClassDetails)
      assetClassDetails.push({
        assetClass: asset.assetClass,
        value: await read({
          view: "assetClassDetail",
          assetClass: asset.assetClass,
        }),
      });
    const actual = {
      householdId: source.householdId,
      overview,
      positions,
      holdingDetails,
      assetClassDetails,
    };
    compare(
      semantic(source),
      semantic(actual),
      `views.${source.householdId}`,
      findings,
    );
    views.push(semantic(actual));
  }

  for (const file of snapshot.sourceFiles) {
    const state = await connection.invoke("migration:fileState", {
      runKey,
      legacyBatchId: file.legacyBatchId,
    });
    if (file.status === "available") {
      try {
        await verifyStoredFile(file, state);
      } catch {
        findings.push({
          path: `files.${file.legacyBatchId}`,
          reason: "file_hash_size_or_expiry_difference",
        });
      }
    } else if (
      state.storageId ||
      state.status === "stored" ||
      state.expiresAt !== Date.parse(file.expiresAt)
    ) {
      findings.push({
        path: `files.${file.legacyBatchId}`,
        reason: "unavailable_file_difference",
      });
    }
  }

  target.mappings = target.tables.migrationMappings.map((mapping) => {
    const record = records.find(
      (record) =>
        record.legacyTable === mapping.legacyTable &&
        record.legacyId === mapping.legacyId,
    );
    return { ...mapping, sourceJson: record?.sourceJson };
  });
  const reportBody = {
    schemaVersion: 1,
    inputDigest: snapshot.inputDigest,
    sourceKind: snapshot.sourceKind,
    sourceDispositions: dispositions,
    dispositionPolicy:
      snapshot.sourceKind === "synthetic"
        ? "generated_known_anomalies"
        : "explicit_owner_approval",
    comparison: "legacy_sql_vs_convex_read_models",
    sourceTableCounts: Object.fromEntries(
      snapshot.tableManifest.map(({ table, count }) => [table, count]),
    ),
    targetTableCounts: Object.fromEntries(
      targetTables.map((table) => [table, target.tables[table].length]),
    ),
    sourceSemanticDigest: digest(snapshot.views.map(semantic)),
    targetSemanticDigest: digest(views),
    unexplainedDifferences: findings.length,
    findings,
  };

  return {
    target,
    report: { ...reportBody, reportDigest: digest(reportBody) },
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  assertAllowedArguments(args, [
    "snapshot",
    "target-env-file",
    "run-id",
    "report-id",
    "dispositions",
  ]);
  const snapshot = readSnapshot(args.get("snapshot"));
  const runKey = requireRunId(args.get("run-id"));
  const reportId = requireRunId(args.get("report-id") || runKey);
  let approvedDispositions = [];
  if (args.has("dispositions")) {
    const approval = JSON.parse(
      fs.readFileSync(protectedPath(args.get("dispositions")), "utf8"),
    );
    if (
      approval.inputDigest !== snapshot.inputDigest ||
      !Array.isArray(approval.approvedSourceDispositions)
    )
      throw new Error(
        "Disposition approval must name this exact source snapshot",
      );
    approvedDispositions = approval.approvedSourceDispositions;
  }
  const connection = convexConnection(
    readEnvironment(args.get("target-env-file")),
    snapshot.sourceKind,
  );
  console.log(
    `Reconcile: ${connection.deployment} (${snapshot.sourceKind}); read-only target inspection`,
  );
  const { target, report } = await reconcileSnapshot(
    snapshot,
    connection,
    runKey,
    approvedDispositions,
  );
  writeArtifact(reportId, "target.json", target);
  writeArtifact(reportId, "reconciliation.json", report);
  console.log(
    `Reconciliation complete: ${report.unexplainedDifferences} unexplained differences`,
  );
  if (report.unexplainedDifferences !== 0) process.exitCode = 1;
}

if (require.main === module)
  main().catch((error) => {
    const index = process.argv.indexOf("--run-id");
    if (index >= 0) writeFailure(process.argv[index + 1], "reconcile", error);
    console.error("Reconciliation failed; cutover blocked");
    process.exitCode = 1;
  });
module.exports = {
  targetTables,
  semantic,
  compare,
  exportTarget,
  reconcileSnapshot,
  sourceDispositions,
};
