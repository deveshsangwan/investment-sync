import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";

const exec = promisify(execFile);
const selection = await readFile("packages/backend/.env.local", "utf8");
const deployment = selection.match(/^CONVEX_DEPLOYMENT=dev:([a-z0-9-]+)/m)?.[1];
if (!deployment)
  throw new Error("Explicit personal development deployment required");
console.log(`target: dev (${deployment}); generated publication fixtures only`);
const runId = `fake-capacity-${Date.now()}`;
const receipts = [];

async function run(name, args) {
  const { stdout, stderr } = await exec(
    "pnpm",
    [
      "--filter",
      "@investment-sync/backend",
      "exec",
      "convex",
      "run",
      name,
      JSON.stringify(args),
      "--deployment",
      deployment,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  if (stderr) process.stderr.write(stderr);
  return JSON.parse(stdout);
}

for (let index = 0; index <= 4; index++) {
  const prepared = await run("testing/publicationCapacity:prepare", {
    runId,
    index,
  });
  if (index === 4) {
    assert.equal(prepared.rows, 1348);
    assert.ok(prepared.bytes >= 672180);
    assert.ok(
      receipts.reduce((total, receipt) => total + receipt.rows, 0) >= 2734,
    );
  }
  const started = performance.now();
  const pending = await run("testing/publicationCapacity:execute", {
    batchId: prepared.batchId,
  });
  assert.equal(pending.status, "publishing");
  const deadline = Date.now() + 15 * 60 * 1000;
  let inspection;
  do {
    inspection = await run("testing/publicationCapacity:inspect", {
      batchId: prepared.batchId,
    });
    if (inspection.batchStatus === "committed") break;
    assert.equal(
      inspection.batchStatus,
      "publishing",
      inspection.errorMessage ?? "Publication stopped",
    );
    assert.ok(
      Date.now() < deadline,
      "Publication did not finish before its lease expired",
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (true);
  const result = await run("testing/publicationCapacity:execute", {
    batchId: prepared.batchId,
  });
  assert.equal(result.status, "committed");
  assert.equal(result.versionId, pending.versionId);
  assert.equal(inspection.factsForBatch, prepared.rows);
  const receipt = {
    runId,
    deployment,
    index,
    ...prepared,
    ...result,
    ...inspection,
    elapsedMs: performance.now() - started,
  };
  receipts.push(receipt);
  console.log(JSON.stringify(receipt));
  await writeFile(
    "/tmp/phase4-staged-capacity-receipts.json",
    JSON.stringify(receipts, null, 2),
  );
}
console.log(
  "Staged publication completed; inspect cloud userExecutionTime, portfolio.stage.metrics and portfolio.finalize.metrics against the 50% gate, plus portfolio.builder.metrics for bounded Node reduction.",
);
