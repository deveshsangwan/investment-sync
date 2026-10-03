const { parseArguments, assertAllowedArguments } = require("./runtime.cjs");
const {
  readSnapshot,
  readEnvironment,
  convexConnection,
  requireRunId,
  writeArtifact,
  writeFailure,
  canonicalJson,
} = require("./phase6-artifacts.cjs");
const { loadSnapshot } = require("./load-snapshot.cjs");
const { reconcileSnapshot } = require("./reconcile.cjs");

async function main() {
  const args = parseArguments(process.argv.slice(2));
  assertAllowedArguments(args, [
    "snapshot",
    "first-target-env-file",
    "second-target-env-file",
    "run-id",
  ]);
  const snapshotPath = args.get("snapshot");
  const snapshot = readSnapshot(snapshotPath);
  if (snapshot.sourceKind !== "synthetic")
    throw new Error("Rehearsal accepts generated data only");
  const runId = requireRunId(args.get("run-id"));
  const connections = ["first-target-env-file", "second-target-env-file"].map(
    (key) => convexConnection(readEnvironment(args.get(key)), "synthetic"),
  );
  if (
    connections.some((target) => !target.deployment.startsWith("local:")) ||
    connections[0].url === connections[1].url
  )
    throw new Error("Rehearsal requires two distinct disposable local targets");

  const reports = [];
  for (const [index, connection] of connections.entries()) {
    const runKey = `${runId}-${index === 0 ? "a" : "b"}`;
    console.log(
      `Rehearsal target: ${connection.deployment}; synthetic local writes`,
    );
    const receipt = await loadSnapshot(
      snapshot,
      snapshotPath,
      connection,
      runKey,
    );
    writeArtifact(runKey, "load-receipt.json", receipt);
    const { target, report } = await reconcileSnapshot(
      snapshot,
      connection,
      runKey,
    );
    writeArtifact(runKey, "target.json", target);
    writeArtifact(runKey, "rehearsal-reconciliation.json", report);
    if (report.unexplainedDifferences !== 0)
      throw new Error("Rehearsal reconciliation failed");
    reports.push(report);
  }

  if (
    reports[0].targetSemanticDigest !== reports[1].targetSemanticDigest ||
    canonicalJson(reports[0].targetTableCounts) !==
      canonicalJson(reports[1].targetTableCounts)
  )
    throw new Error("Clean target results differ");
  writeArtifact(runId, "rehearsal-receipt.json", {
    schemaVersion: 1,
    inputDigest: snapshot.inputDigest,
    evaluationTime: snapshot.evaluationTime,
    deployments: connections.map((target) => target.deployment),
    targetSemanticDigest: reports[0].targetSemanticDigest,
    reconciliationDigests: reports.map((report) => report.reportDigest),
    unexplainedDifferences: 0,
  });
  console.log(
    "Both local migrations passed independent reconciliation with identical semantic digests",
  );
}

if (require.main === module)
  main().catch((error) => {
    const index = process.argv.indexOf("--run-id");
    if (index >= 0) writeFailure(process.argv[index + 1], "rehearsal", error);
    console.error("Generated migration rehearsal failed");
    process.exitCode = 1;
  });
