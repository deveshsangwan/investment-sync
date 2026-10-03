import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parserGoldenFixtures } from "../../packages/importers/src/golden-fixtures.ts";
import { parseExactImportFile } from "../../packages/importers/src/index.ts";

const exec = promisify(execFile);
const selection = await readFile("packages/backend/.env.local", "utf8");
const deployment = selection.match(/^CONVEX_DEPLOYMENT=dev:([a-z0-9-]+)/m)?.[1];
if (!deployment)
  throw new Error("Explicit personal development deployment required");
console.log(`target: dev (${deployment}); generated import fixtures only`);
const identity = {
  subject: `user_fake_import_smoke_${Date.now()}`,
  issuer: "https://fake-development.example",
  email: "fake-import-smoke@example.invalid",
};

async function run(name, args, authenticated = true) {
  const { stdout } = await exec(
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
      ...(authenticated ? ["--identity", JSON.stringify(identity)] : []),
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

await assert.rejects(
  run(
    "imports:list",
    { paginationOpts: { numItems: 10, cursor: null } },
    false,
  ),
  /UNAUTHENTICATED/,
);
await run("users:ensureCurrent", {});
const fixtures = parserGoldenFixtures().map(({ name, file }) => ({
  name,
  file,
}));
const base = fixtures[0].file;
const lines = base.content.toString("utf8").split("\n");
const dataRow = lines.pop();
assert.ok(dataRow);
fixtures.push({
  name: "twice-largest upload transport",
  file: {
    ...base,
    fileName: "fake-transport-stress.csv",
    content: Buffer.from(
      [
        ...lines,
        ...Array.from({ length: 320 }, (_, i) =>
          dataRow.replace(
            "FAKECO",
            `FAKE_TRANSPORT_${i.toString().padStart(4, "0")}`,
          ),
        ),
      ].join("\n"),
    ),
  },
});
assert.ok(fixtures.at(-1).file.content.byteLength >= 23776);
const receipts = [];

const selected = process.argv.includes("--transport-only")
  ? fixtures.slice(-1)
  : fixtures;
for (const { name, file } of selected) {
  const expected = parseExactImportFile(file);
  const started = performance.now();
  const mimeType = file.fileName.endsWith(".csv")
    ? "text/csv"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const reservation = await run("imports:createUpload", {
    fileName: file.fileName,
    mimeType,
    sizeBytes: file.content.byteLength,
  });
  const response = await fetch(reservation.uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: file.content,
  });
  assert.equal(response.ok, true, `Storage upload failed: ${response.status}`);
  const { storageId } = await response.json();
  await run("imports:attachUpload", {
    batchId: reservation.batchId,
    storageId,
  });
  let batch;
  for (let attempt = 0; attempt < 30; attempt++) {
    batch = await run("imports:get", { batchId: reservation.batchId });
    if (["parsed", "failed"].includes(batch.status)) break;
    await delay(500);
  }
  assert.equal(batch.status, "parsed", batch.errorMessage ?? name);
  assert.equal(batch.rowCount, expected.rows.length);
  assert.equal(batch.parserVersion, expected.parserVersion);
  assert.deepEqual(batch.warnings, expected.warnings);
  assert.deepEqual(
    JSON.parse(batch.previewRowsJson),
    JSON.parse(
      JSON.stringify(
        expected.rows.slice(0, JSON.parse(batch.previewRowsJson).length),
      ),
    ),
  );
  assert.equal(batch.fileAvailable, true);
  const receipt = {
    fixture: name,
    sourceBytes: file.content.byteLength,
    rows: batch.rowCount,
    normalizedBytes: Buffer.byteLength(JSON.stringify(expected.rows)),
    elapsedMs: Math.round(performance.now() - started),
    batchId: batch.id,
  };
  receipts.push(receipt);
  console.log(JSON.stringify(receipt));
}
console.log(
  JSON.stringify({
    deployment,
    fixturesPassed: receipts.length,
    anonymousDenied: true,
  }),
);
