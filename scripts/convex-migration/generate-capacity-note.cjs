const fs = require("node:fs");
const path = require("node:path");
const prettier = require("prettier");
const { evaluateCapacityEvidence } = require("./capacity-evidence.cjs");
const {
  assertAllowedArguments,
  fail,
  parseArguments,
} = require("./runtime.cjs");

if (require.main === module) {
  main().catch(() => fail("Capacity note generation failed"));
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  assertAllowedArguments(argumentsMap, ["run-id"]);
  const runId = argumentsMap.get("run-id");
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId)) {
    fail("Pass a filesystem-safe --run-id");
  }

  const runDirectory = path.resolve(process.cwd(), ".migration", runId);
  const postgres = readJson(path.join(runDirectory, "inventory.postgres.json"));
  const storage = readJson(path.join(runDirectory, "inventory.storage.json"));
  const dispositionPath = path.join(runDirectory, "dispositions.json");
  const dispositions = fs.existsSync(dispositionPath)
    ? readJson(dispositionPath)
    : null;
  const evidence = evaluateCapacityEvidence({
    runId,
    postgres,
    storage,
    dispositions,
  });
  const note = renderNote(runId, postgres, storage, evidence);
  assertRedacted(note);
  const formattedNote = await prettier.format(note, { parser: "markdown" });

  fs.writeFileSync(
    path.resolve(process.cwd(), "docs/convex-migration-capacity.md"),
    formattedNote,
  );
  console.log("Sanitized capacity note generated");
}

function renderNote(
  selectedRunId,
  postgresInventory,
  storageInventory,
  result,
) {
  const tableRows = postgresInventory.tableCounts
    .map(({ key, count }) => `| ${key} | ${count} |`)
    .join("\n");
  const profile = result.coherentProfile;
  const transport = result.transportProfile;
  const candidate = result.candidate;
  const twice = result.twiceLargest;
  const unresolved = result.unresolvedFindings
    .filter((finding) => finding.count > 0)
    .map((finding) => `\`${finding.check}\` (${finding.count})`)
    .join(", ");
  const dispositions = result.findings.filter(
    (finding) => finding.count > 0 && finding.disposition !== null,
  );
  const status = result.evidenceReady
    ? "Production evidence passed compatibility and reconciliation gates. Candidate application ceilings are set below. Phase 3 still validates them against real Convex runtime limits."
    : `Blocked. ${result.compatibilityErrors.length > 0 ? `Compatibility errors: ${result.compatibilityErrors.join(", ")}. ` : ""}${unresolved ? `Unresolved findings: ${unresolved}.` : "Storage evidence or a coherent largest-file profile is incomplete."}`;
  const storageSummary =
    storageInventory.status === "complete"
      ? `${storageInventory.summary.availableFiles} referenced ${plural(storageInventory.summary.availableFiles, "file is", "files are")} available, ${storageInventory.summary.missingFiles} ${plural(storageInventory.summary.missingFiles, "is", "are")} missing, and ${storageInventory.summary.orphanBucketObjects} ${plural(storageInventory.summary.orphanBucketObjects, "unreferenced bucket object exists", "unreferenced bucket objects exist")}.`
      : `Blocked: ${storageInventory.reason}`;
  const candidateText = candidate
    ? `${candidate.compressedBytes} compressed bytes, ${candidate.normalizedRows} normalized rows, and ${candidate.normalizedSerializedBytes} normalized UTF-8 JSON bytes. Each axis uses its applicable observed maximum plus 50 percent, rounded up to 256 KiB, 100 rows, and 64 KiB; compressed bytes are also bounded by the current 4 MiB application limit.`
    : "Not set while compatibility, integrity, collision, Storage, or coherent-profile evidence is unresolved.";
  const compressedTarget = result.twiceLargestTransport
    ? `${result.twiceLargestTransport.compressedBytes} bytes`
    : "unavailable until an available Source File is measured";
  const household = result.largestHousehold;

  return `# Convex migration capacity evidence

Generated from protected inventory run \`${selectedRunId}\`. This file contains sanitized aggregates only.

## Phase 0 status

${status}

## Postgres counts

| Table | Records |
| --- | ---: |
${tableRows}

## Coherent largest persisted-batch profile

${profile ? `Source: ${profile.sourceType}. ${profile.normalizedRows} rows, ${profile.normalizedSerializedBytes} normalized UTF-8 JSON bytes, ${profile.distinctAccounts} distinct accounts, and ${profile.distinctInstruments} distinct instruments. Row kinds: ${formatGroups(profile.rowKindCounts)}. Currencies: ${formatGroups(profile.currencyCounts)}. Projected fact writes are at least ${profile.projectedFactWritesLowerBound}; projected read-model writes are at least ${profile.projectedReadModelWritesLowerBound}. These are lower bounds until the full publication module exists.` : "Unavailable."}

Largest-Household state: ${household ? `${household.accounts} accounts, ${household.instruments} instruments, ${household.importBatches} Import Batches, ${household.importRows} normalized rows, ${household.holdingSnapshots} holding snapshots, ${household.transactions} transactions, ${household.valuations} valuations, and ${household.factRows} total persisted fact rows.` : "Unavailable."}

Storage correlation: ${storageSummary}

## Reconciliation and pending decisions

Unresolved blocking findings: ${unresolved || "none"}.

Recorded sanitized dispositions: ${dispositions.length === 0 ? "none" : dispositions.map((finding) => `\`${finding.check}\` as \`${finding.disposition.reasonCode}\``).join(", ")}.

Pending batches: ${result.pending.meaningfulExpired} meaningful expired, ${result.pending.emptyExpired} empty expired, and ${result.pending.other} in other pending groups. Preserve ${result.pending.meaningfulExpired} meaningful expired ${plural(result.pending.meaningfulExpired, "batch", "batches")} with their persisted rows. Preserve empty expired batch history as unavailable with the approved typed target reason; do not invent rows.

Prices: ${postgresInventory.prices.records === 0 ? "no records observed; removal still waits for consumer verification" : `${postgresInventory.prices.records} records observed; preserve and investigate consumers`}.

## Candidate ceilings

${candidateText}

The compressed ceiling uses the largest available parsed Source File (${transport?.compressedBytes ?? "unavailable"} bytes) independently from the persisted-batch profile. The largest persisted batch's Source File is past retention, so a coherent compressed measurement does not exist.

The current 4 MiB and 25,000-row checks are legacy implementation limits. They do not override these evidence gates.

## Twice-largest synthetic fixture

${twice ? `Publication fixture: use source type ${twice.sourceType}. Generate exactly ${twice.normalizedRows} rows and at least ${twice.normalizedSerializedBytes} normalized UTF-8 JSON bytes. Preserve ${twice.distinctAccounts} distinct accounts, ${twice.distinctInstruments} distinct instruments, row kinds ${formatGroups(twice.rowKindCounts)}, and currencies ${formatGroups(twice.currencyCounts)}. Expected writes are lower bounds: at least ${twice.projectedFactWritesLowerBound} facts and ${twice.projectedReadModelWritesLowerBound} read-model documents. Upload-transport fixture: generate a supported file of at least ${compressedTarget}. The fixtures test independent observed axes and must not be represented as one coherent production file.` : "Unavailable until a coherent largest persisted-batch profile is recorded."}

Use obviously fake identities and amounts. Phase 3 runs this fixture on a real Convex development deployment and records reads, writes, bytes, duration, and failures. If the simple Commit path lacks the required headroom, use the staged builder fallback.
`;
}

function formatGroups(groups) {
  return groups.map((group) => `${group.key}=${group.count}`).join(", ");
}

function plural(count, singular, pluralForm) {
  return count === 1 ? singular : pluralForm;
}

function readJson(fileName) {
  if (!fs.existsSync(fileName)) fail("Protected inventory artifact is missing");
  return JSON.parse(fs.readFileSync(fileName, "utf8"));
}

function assertRedacted(note) {
  const unsafe = [
    /postgres(?:ql)?:\/\//i,
    /https?:\/\//i,
    /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i,
    /\b[0-9a-f]{64}\b/i,
    /storage_path/i,
    /original_file_name/i,
  ];
  if (unsafe.some((pattern) => pattern.test(note))) {
    throw new Error("Generated capacity note failed redaction checks");
  }
}

module.exports = { assertRedacted, renderNote };
