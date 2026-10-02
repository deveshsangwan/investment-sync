# Phase 6 rollback rehearsal

The reverse adapter restores generated Convex changes into the retained Postgres schema. Production still uses Postgres. The Phase 6 CLI accepts only synthetic artifacts and a dedicated local database whose name starts with `investment_sync_rollback_`. Production replay and application redeployment require the Phase 7 authorization recorded in the migration plan.

## What the adapter verifies

Before any Convex-only write, `rollback.cjs --mode before-writes` reads Postgres in one repeatable-read transaction and compares every retained table with the frozen export. It also compares a fresh frozen Convex export with the archived initial target and verifies that this initial target reconstructs the source dataset without new commits. A new identity counts as a Convex-only write even if no file has been imported. It records the exact old application commit and the SHA-256 of its archived configuration. The commit must exist in Git. The command does not redeploy the application or prove that an external build archive is available.

After Convex-only writes, `--mode after-writes` creates a protected replay plan. New users, Households, memberships, accounts, and batches receive deterministic UUIDs. Migrated entities retain their old IDs. Household-scoped Convex instruments share the appropriate global Postgres instrument. The adapter restores complete normalized rows and persisted holding, transaction, and valuation values in publication sequence. A parsed batch can commit after its file expires because replay uses its normalized rows and facts.

The SQL writer locks every retained application table and checks that Postgres equals the frozen source before writing. It applies the complete replay in one serializable transaction and compares all resulting rows before committing. An interrupted write rolls back the whole transaction. Rerunning the same plan against its reconciled result succeeds without another write. Any other database content stops replay.

Numeric values travel as decimal text. PostgreSQL applies the original numeric precision, including half-up rounding. The adapter preserves archived UTC microseconds instead of passing timestamp text through the driver's JavaScript `Date` serializer.

## Protected input packet

Store every input under `.migration/<run-id>/`. Directories require mode `0700`; files require `0600`. The CLI rejects symlinked paths and never prints identities, amounts, source paths, or credentials. The explicit environment file contains only the rehearsal database connection.

The source packet contains `schemaVersion: 1`, `sourceKind: "synthetic"`, `evaluationTime`, and full snake-case SQL tables. UUIDs and persisted numeric columns are text. Dates use `YYYY-MM-DD`. Timestamps use UTC text with at most six fractional digits. The packet must include every column of the retained schema, including empty `prices` and `currency_rates` tables.

The target packet contains the same envelope fields, `projectorVersion: "portfolio-v1"`, raw Convex documents under `tables`, and enriched migration mappings. Each mapping contains `legacyTable`, `legacyId`, `targetTable`, `targetId`, and optionally the archived `sourceJson`. Join `migrationRecords.sourceJson` onto `migrationMappings` by the legacy table and ID before planning replay. Keep full `publicationReceipts`, portfolio version digests, parser versions, normalized chunks, and fact provenance in this packet through the rollback window. They preserve information the old schema cannot store.

For each newly committed batch, the packet must contain complete current-attempt chunks, its published portfolio version, and one matching immutable fact per normalized row. Their parser versions, row numbers, and publication sequence must agree. This check prevents a batch from appearing committed after a truncated export.

If a new file remains available and unexpired, restore it to the old storage first and independently verify its hash and size. Supply `reverseStorageMappings` entries with `batchId`, `storagePath`, `contentHash`, and `sizeBytes`. The adapter does not upload files or accept an unverified missing download. Expired and unavailable files need no source bytes.

## Commands

Run these commands from the repository root. Archive the actual Postgres-serving commit, configuration, build, and matching source snapshot together before a real cutover. The configuration artifact can contain secrets and must stay protected.

```sh
node scripts/convex-migration/rollback.cjs \
  --mode before-writes \
  --snapshot .migration/rehearsal/source-snapshot.json \
  --target-baseline .migration/rehearsal/target-initial.json \
  --target-export .migration/rehearsal/target-current-frozen.json \
  --env-file .migration/rehearsal/rollback.env \
  --run-id rehearsal-rollback-before \
  --apply false \
  --rollback-commit "$POSTGRES_ROLLBACK_COMMIT" \
  --rollback-config-file .migration/rehearsal/postgres-configuration.json

node scripts/convex-migration/rollback.cjs \
  --mode after-writes \
  --snapshot .migration/rehearsal/source-snapshot.json \
  --target-export .migration/rehearsal/target-after-commits.json \
  --env-file .migration/rehearsal/rollback.env \
  --run-id rehearsal-rollback-plan \
  --apply false \
  --rollback-commit "$POSTGRES_ROLLBACK_COMMIT" \
  --rollback-config-file .migration/rehearsal/postgres-configuration.json

node scripts/convex-migration/rollback.cjs \
  --mode after-writes \
  --snapshot .migration/rehearsal/source-snapshot.json \
  --target-export .migration/rehearsal/target-after-commits.json \
  --env-file .migration/rehearsal/rollback.env \
  --run-id rehearsal-rollback-apply \
  --apply true \
  --rollback-commit "$POSTGRES_ROLLBACK_COMMIT" \
  --rollback-config-file .migration/rehearsal/postgres-configuration.json
```

Each successful command prints `Rollback <mode> verification passed; application restoration remains an operator step.` The new run directory contains `rollback-receipt.json`. After-write runs also contain `reverse-replay-plan.json` with source and replay checksums, exact rows, counts, and ordered commit receipts. Use a new run ID for each invocation; the tool refuses to overwrite receipts. Repeating application against the same completed dataset records `alreadyApplied: true`.

The integration test creates its own disposable local database, applies the actual archived SQL migrations, and drops only that database afterward:

```sh
node --test scripts/convex-migration/rollback.test.cjs

ROLLBACK_TEST_DATABASE_URL=postgresql://investment_sync:investment_sync@127.0.0.1:54330/investment_sync_rollback_rehearsal \
  node --test scripts/convex-migration/rollback.integration.test.cjs
```

The measured small rehearsal takes about half a second on the local Postgres service. It covers three commits, an expired-file batch, a new identity, exact fact reconciliation, CLI receipts, a forced SQL failure, rerun idempotency, and a divergent database. This duration does not estimate a production replay.

## Recovery gates

Some Convex data cannot be represented by the retained schema. The adapter stops instead of discarding it:

| Failure code                                                | Reason                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identical_same_day_transaction_occurrences_not_reversible` | Distinct resolved Convex transactions share the old transaction unique key. The approved occurrence correction cannot survive an unchanged old database schema.     |
| `normalized_row_not_losslessly_representable`               | A financial input cannot round-trip through the legacy normalized-row number schema. Persisted decimals remain exact, but an old Commit would lose input precision. |
| `source_metadata_not_reconstructible_in_postgres`           | A new holding uses custom source grouping, completeness, granularity, or priority absent from the old schema.                                                       |
| `available_source_file_not_restored`                        | A new unexpired file lacks a matching restored storage record.                                                                                                      |
| `target_writes_not_drained`                                 | A parse or publication is still running.                                                                                                                            |
| `convex_only_writes_detected`                               | The current target differs from the archived initial dataset, so an instant before-write rollback is unsafe.                                                        |
| `incomplete_committed_facts`                                | A committed batch lacks all its exported facts.                                                                                                                     |

After Convex-only writes, keep both applications' writes disabled until the owner chooses a recovery policy for any such failure. A schema change that preserves the approved correction, or continuing with the Convex build, needs a separate decision. Do not enable the old build after a partial or lossy replay.

Once replay passes, run the portfolio reconciliation against the old Postgres readers and the frozen Convex packet using the same exchange rate and evaluation time. Verify application queries and source-file downloads before redeploying the exact archived Postgres build with its matching configuration. URL changes alone cannot restore removed tRPC routes. The CLI deliberately leaves `applicationRestored: false` in its receipt so a data check cannot be mistaken for a completed deployment rollback.
