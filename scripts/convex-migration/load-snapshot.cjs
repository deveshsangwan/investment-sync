const fs = require("node:fs");
const path = require("node:path");
const { parseArguments, assertAllowedArguments } = require("./runtime.cjs");
const {
  legacyTables,
  readSnapshot,
  readEnvironment,
  convexConnection,
  canonicalJson,
  sha256,
  protectedPath,
  writeArtifact,
  requireRunId,
  writeFailure,
} = require("./phase6-artifacts.cjs");

async function loadSnapshot(snapshot, snapshotPath, connection, runKey) {
  verifySourceArtifacts(snapshot, snapshotPath);

  await connection.invoke("migration:begin", {
    runKey,
    inputDigest: snapshot.inputDigest,
    sourceKind: snapshot.sourceKind,
    evaluationTime: snapshot.evaluationTime,
    expectedCountsJson: canonicalJson(
      Object.fromEntries(
        snapshot.tableManifest.map(({ table, count }) => [table, count]),
      ),
    ),
    sourceFilesJson: canonicalJson(
      snapshot.sourceFiles.map((file) =>
        Object.fromEntries(
          Object.entries(file).filter(([key]) => key !== "artifact"),
        ),
      ),
    ),
  });

  for (const legacyTable of legacyTables) {
    for (const row of snapshot.tables[legacyTable]) {
      await connection.invoke("migration:loadRecord", {
        runKey,
        legacyTable,
        rowJson: canonicalJson(row),
      });
    }
  }

  for (const file of snapshot.sourceFiles) {
    if (file.status !== "available") {
      await connection.invoke("migration:markFileMissing", {
        runKey,
        legacyBatchId: file.legacyBatchId,
      });
      continue;
    }

    const bytes = fs.readFileSync(
      protectedPath(path.resolve(path.dirname(snapshotPath), file.artifact)),
    );
    if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.contentHash)
      throw new Error("Protected source file does not match snapshot");
    const state = await connection.invoke("migration:fileState", {
      runKey,
      legacyBatchId: file.legacyBatchId,
    });
    if (state.storageId) {
      await verifyStoredFile(file, state);
      continue;
    }

    const url = await connection.invoke("migration:fileUploadUrl", {
      runKey,
      legacyBatchId: file.legacyBatchId,
    });
    if (!url) throw new Error("Source file upload was not available");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    if (!response.ok) throw new Error("Convex source file upload failed");
    const uploaded = await response.json();
    if (typeof uploaded.storageId !== "string")
      throw new Error("Invalid source file upload response");
    await connection.invoke("migration:attachFile", {
      runKey,
      legacyBatchId: file.legacyBatchId,
      storageId: uploaded.storageId,
      contentHash: file.contentHash,
      sizeBytes: file.sizeBytes,
    });
    await verifyStoredFile(
      file,
      await connection.invoke("migration:fileState", {
        runKey,
        legacyBatchId: file.legacyBatchId,
      }),
    );
  }

  for (const batch of snapshot.tables.import_batches) {
    await connection.invoke("migration:finalizeBatch", {
      runKey,
      legacyBatchId: batch.id,
    });
  }
  await connection.invoke("migration:completeRun", { runKey });

  for (const household of snapshot.tables.households) {
    await connection.invoke("migrationPublication:publish", {
      runKey,
      legacyHouseholdId: household.id,
    });
  }

  return {
    schemaVersion: 1,
    inputDigest: snapshot.inputDigest,
    runKey,
    deployment: connection.deployment,
    sourceKind: snapshot.sourceKind,
    loadedCounts: Object.fromEntries(
      snapshot.tableManifest.map(({ table, count }) => [table, count]),
    ),
  };
}

function verifySourceArtifacts(snapshot, snapshotPath) {
  for (const file of snapshot.sourceFiles.filter(
    (file) => file.status === "available",
  )) {
    const bytes = fs.readFileSync(
      protectedPath(path.resolve(path.dirname(snapshotPath), file.artifact)),
    );
    if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.contentHash)
      throw new Error("Protected source file does not match snapshot");
  }
}

async function verifyStoredFile(expected, actual) {
  if (
    !actual.url ||
    actual.contentHash !== expected.contentHash ||
    actual.sizeBytes !== expected.sizeBytes ||
    actual.expiresAt !== Date.parse(expected.expiresAt)
  )
    throw new Error("Target source file metadata differs");
  const response = await fetch(actual.url);
  if (!response.ok) throw new Error("Target source file download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length !== expected.sizeBytes ||
    sha256(bytes) !== expected.contentHash
  )
    throw new Error("Target source file bytes differ");
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  assertAllowedArguments(args, [
    "snapshot",
    "target-env-file",
    "run-id",
    "apply",
  ]);
  const snapshotPath = protectedPath(args.get("snapshot"));
  const snapshot = readSnapshot(snapshotPath);
  const connection = convexConnection(
    readEnvironment(args.get("target-env-file")),
    snapshot.sourceKind,
  );
  const runKey = requireRunId(args.get("run-id"));
  verifySourceArtifacts(snapshot, snapshotPath);
  console.log(
    `Target: ${connection.deployment} (${snapshot.sourceKind}); ${connection.url}`,
  );
  if (args.get("apply") !== "yes") {
    console.log(
      "Dry run: snapshot checksums and target classification passed; no target writes",
    );
    return;
  }

  const receipt = await loadSnapshot(
    snapshot,
    snapshotPath,
    connection,
    runKey,
  );
  writeArtifact(runKey, "load-receipt.json", receipt);
  console.log(
    `Migration load complete: ${snapshot.tables.households.length} households; reconciliation required before cutover`,
  );
}

if (require.main === module)
  main().catch((error) => {
    const index = process.argv.indexOf("--run-id");
    if (index >= 0) writeFailure(process.argv[index + 1], "load", error);
    console.error("Migration load failed; target remains inactive");
    process.exitCode = 1;
  });
module.exports = { loadSnapshot, verifyStoredFile, verifySourceArtifacts };
