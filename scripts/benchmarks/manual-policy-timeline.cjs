// Run with node scripts/benchmarks/manual-policy-timeline.cjs --output /tmp/before.json.
// Repeat after the change with --compare /tmp/before.json. No backend is contacted.
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { parseArgs, promisify } = require("node:util");
const path = require("node:path");

const { values } = parseArgs({
  options: {
    worker: { type: "boolean", default: false },
    workers: { type: "string", default: "1" },
    output: { type: "string" },
    compare: { type: "string" },
    "domain-source": {
      type: "string",
      default: path.resolve(__dirname, "../../packages/portfolio-domain/src"),
    },
  },
});

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function measurePublication() {
  require("tsx/cjs");
  const {
    projectionRecords,
  } = require("../../packages/backend/convex/model/publicationProjection.ts");
  const { buildPortfolioPublication } = require(
    path.resolve(values["domain-source"], "publication.ts"),
  );
  const { snapshotTimeline, timelineWithManualPolicies } = require(
    path.resolve(values["domain-source"], "sourceSnapshots.ts"),
  );
  const {
    adaptLegacyRow,
  } = require("../../packages/importers/src/exact-adapter.ts");
  const isoDate = (index) =>
    new Date(Date.UTC(2010, 0, index + 1)).toISOString().slice(0, 10);
  const stocks = Array.from({ length: 1000 }, (_, index) =>
    adaptLegacyRow({
      kind: "holding",
      sourceType: "tickertape_stock_csv",
      sourceDate: isoDate(0),
      accountName: "Stocks",
      provider: "Broker",
      instrumentName: `STOCK${index}`,
      symbol: `STOCK${index}`,
      assetClass: "indian_stock",
      currency: "INR",
      investedAmount: 100,
      currentValue: 120,
      pnlAmount: 20,
      metadata: {},
    }),
  );
  const policies = Array.from({ length: 1499 }, (_, index) => {
    const row = adaptLegacyRow({
      kind: "holding",
      sourceType: "manual_snapshot",
      sourceDate: isoDate(index + 1),
      accountName: "Policy",
      provider: "Insurer",
      instrumentName: "One policy",
      assetClass: "ulip",
      currency: "INR",
      investedAmount: 100,
      currentValue: 120 + index,
      pnlAmount: 20 + index,
      metadata: {},
    });
    assert.equal(row.kind, "holding");

    return {
      ...row,
      policyId: "policy-1",
      source: {
        ...row.source,
        group: "manual-policy:policy-1",
        completeness: "partial",
      },
    };
  });
  const rows = [...stocks, ...policies];
  const existingFacts = rows.slice(0, -1).map((row, index) => ({
    row,
    provenance: {
      batchId: `prior-${Math.floor(index / 1000)}`,
      parserVersion: "benchmark-v1",
      sequence: Math.floor(index / 1000) + 1,
      fallbackDate: isoDate(0),
      rowNumber: (index % 1000) + 1,
    },
  }));
  const builderCpuStart = process.cpuUsage();
  const started = performance.now();
  const publication = buildPortfolioPublication({
    existingFacts,
    batch: {
      id: "latest",
      parserVersion: "benchmark-v1",
      sequence: 5,
      fallbackDate: isoDate(1499),
      rows: rows.slice(-1),
    },
  });
  const builderMs = Math.round(performance.now() - started);
  const builderCpu = process.cpuUsage(builderCpuStart);
  const builderCpuMs = (builderCpu.user + builderCpu.system) / 1000;
  const records = projectionRecords(publication.projection);
  const counts = Object.fromEntries(
    Object.entries(records).map(([stage, entries]) => [stage, entries.length]),
  );
  assert.equal(publication.facts.length, 2499);
  assert.equal(publication.reconciliation.currentCount, 1001);
  assert.equal(counts.positions, 1001);
  assert.equal(counts.history, 2499);
  assert.equal(counts.timeline, 3000);

  const holdings = publication.projection.positions.flatMap(
    (position) => position.history,
  );
  const baseline = snapshotTimeline(holdings);
  const work = {
    unchangedPositionKeyReads: 0,
    unchangedInvestedAmountReads: 0,
  };
  for (const fact of holdings.filter((fact) => !fact.row.policyId)) {
    const key = fact.canonicalPositionKey;
    const amount = fact.row.investedAmount;
    Object.defineProperty(fact, "canonicalPositionKey", {
      get() {
        work.unchangedPositionKeyReads++;
        return key;
      },
    });
    Object.defineProperty(fact.row, "investedAmount", {
      get() {
        work.unchangedInvestedAmountReads++;
        return amount;
      },
    });
  }

  const isolatedCpuStart = process.cpuUsage();
  const isolatedStarted = performance.now();
  const timeline = timelineWithManualPolicies(holdings, baseline);
  const isolatedMs = Math.round(performance.now() - isolatedStarted);
  const isolatedCpu = process.cpuUsage(isolatedCpuStart);
  const isolatedCpuMs = (isolatedCpu.user + isolatedCpu.system) / 1000;
  const isolatedWork = { ...work };
  assert.deepEqual(timeline, publication.projection.timeline);

  return {
    builderMs,
    builderCpuMs,
    isolatedMs,
    isolatedCpuMs,
    counts,
    work: isolatedWork,
    publicationFingerprint: fingerprint(publication),
    timelineFingerprint: fingerprint(timeline),
  };
}

async function main() {
  if (values.worker) {
    console.log(JSON.stringify(measurePublication()));
    return;
  }

  const workers = Number(values.workers);
  assert.ok(
    workers === 1 || workers === 2,
    "Use one or two independent processes on the shared host",
  );
  const run = promisify(execFile);
  const results = await Promise.all(
    Array.from({ length: workers }, async () => {
      const { stdout } = await run(
        process.execPath,
        [__filename, "--worker", "--domain-source", values["domain-source"]],
        {
          maxBuffer: 1024 * 1024,
        },
      );
      return JSON.parse(stdout);
    }),
  );
  const report = {
    domainSource: values["domain-source"],
    fixture: "1000-stocks-1499-policy-snapshots-v1",
    workers,
    results,
  };

  for (const result of results) {
    assert.deepEqual(result.counts, results[0].counts);
    assert.equal(
      result.publicationFingerprint,
      results[0].publicationFingerprint,
    );
    assert.equal(result.timelineFingerprint, results[0].timelineFingerprint);
  }

  if (values.compare) {
    const before = JSON.parse(readFileSync(values.compare, "utf8"));
    assert.equal(before.fixture, report.fixture);
    assert.equal(before.workers, workers, "Compare equivalent concurrency");
    assert.equal(before.results.length, results.length);
    results.forEach((result, index) => {
      assert.deepEqual(result.counts, before.results[index].counts);
      assert.equal(
        result.publicationFingerprint,
        before.results[index].publicationFingerprint,
      );
      assert.equal(
        result.timelineFingerprint,
        before.results[index].timelineFingerprint,
      );
    });
    report.comparison =
      "Identical full publication and isolated timeline fingerprints and projection counts";
  }

  if (values.output)
    writeFileSync(values.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
