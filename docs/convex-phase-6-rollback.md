# Phase 6 rollback rehearsal

The reverse adapter restores generated Convex changes into the retained Postgres schema. Production still uses Postgres. The Phase 6 CLI accepts only synthetic artifacts and a dedicated local database whose name starts with `investment_sync_rollback_`. Production replay and application redeployment require the Phase 7 authorization recorded in the migration plan.

## What the adapter verifies

Before any Convex-only write, `rollback.cjs --mode before-writes` reads Postgres in one repeatable-read transaction and compares every retained table with the frozen export. It also compares a fresh frozen Convex export with the archived initial target and verifies that this initial target reconstructs the source dataset without new commits. A new identity counts as a Convex-only write even if no file has been imported. It records the exact old application commit and the SHA-256 of its archived configuration. The commit must exist in Git. The command does not redeploy the application or prove that an external build archive is available.

After Convex-only writes, `--mode after-writes` creates a protected replay plan. New users, Households, memberships, accounts, and batches receive deterministic UUIDs. Migrated entities retain their old IDs. Household-scoped Convex instruments share the appropriate global Postgres instrument. The adapter restores complete normalized rows and persisted holding, transaction, and valuation values in publication sequence. A parsed batch can commit after its file expires because replay uses its normalized rows and facts.

New holding UUIDs encode publication sequence and row number before a hash of the native household, batch, and fact identity. This preserves the SQL chart reader's UUID ordering within a Commit and across Commits sharing a timestamp. The format supports all safe integer sequences and row numbers 1–2047, covering the deployed 1100-row limit and 1348-row stress fixture. Repeated snapshots retain their first ID and creation timestamp while accepting their latest financial values. Archived IDs and UTC microseconds remain unchanged.

Before SQL writes, the adapter compares the effective first-creation order of resolved eligible native holdings with SQL's creation timestamp and UUID order per household and snapshot date. It stops when those orders cannot agree, including a reversed Commit clock. It does not adjust timestamps or weaken monetary comparison tolerances. The existing rejection of ambiguous Current-holding selection ties still applies independently.

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

| Failure code                                                | Reason                                                                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identical_same_day_transaction_occurrences_not_reversible` | Distinct resolved Convex transactions share the old transaction unique key. The approved occurrence correction cannot survive an unchanged old database schema.                                    |
| `normalized_row_not_losslessly_representable`               | A financial input cannot round-trip through the legacy normalized-row number schema. Persisted decimals remain exact, but an old Commit would lose input precision.                                |
| `source_metadata_not_reconstructible_in_postgres`           | A new holding uses custom source grouping, completeness, granularity, or priority absent from the old schema.                                                                                      |
| `available_source_file_not_restored`                        | A new unexpired file lacks a matching restored storage record.                                                                                                                                     |
| `target_writes_not_drained`                                 | A parse or publication is still running.                                                                                                                                                           |
| `convex_only_writes_detected`                               | The current target differs from the archived initial dataset, so an instant before-write rollback is unsafe.                                                                                       |
| `incomplete_committed_facts`                                | A committed batch lacks all its exported facts.                                                                                                                                                    |
| `holding_selection_tie_not_reversible`                      | A new holding creates a same-date, same-name, same-priority canonical-position tie across SQL rows. Native fact-key ranking and new SQL UUID ranking need not select the same account.             |
| `holding_chart_order_not_reversible`                        | Effective native snapshot creation order disagrees with retained SQL chart order, or a row ordinal exceeds the encoded deployed bound. Timestamps and archived IDs cannot be rewritten to hide it. |
| `holding_id_collision`                                      | A newly generated holding UUID collides with another retained SQL row.                                                                                                                             |
| `invalid_publication_root_manifest`                         | A new published version lacks a valid stage manifest, publication attempt, or recomputed root checksum.                                                                                            |
| `incomplete_publication_receipts`                           | The complete manifest cannot be matched to exported publication receipts and persisted facts.                                                                                                      |
| `conflicting_publication_receipt`                           | Receipt stage, index, attempt, count, bytes, or checksum disagrees with its sealed manifest.                                                                                                       |

After Convex-only writes, keep both applications' writes disabled until the owner chooses a recovery policy for any such failure. A schema change that preserves the approved correction, or continuing with the Convex build, needs a separate decision. Do not enable the old build after a partial or lossy replay.

Once replay passes, run the portfolio reconciliation against the old Postgres readers and the frozen Convex packet using the same exchange rate and evaluation time. Verify application queries and source-file downloads before redeploying the exact archived Postgres build with its matching configuration. URL changes alone cannot restore removed tRPC routes. The CLI deliberately leaves `applicationRestored: false` in its receipt so a data check cannot be mistaken for a completed deployment rollback.

## Actual local deployment drill

`rehearse-rollback.cjs` drives the public upload, parse and Commit APIs on an explicitly named local synthetic deployment. It temporarily removes the migration write freeze, commits an expired parsed batch without its original file, provisions a generated identity, uploads a tiny Tickertape CSV, waits for parsing and publication, and reinstates `MIGRATION_MODE=synthetic`. It downloads the new stored file, verifies its checksum and size, saves protected restored bytes, and exports the actual native tables. The SQL replay uses the retained migrations in a dedicated database and verifies exact rows and idempotency. Independent retained SQL queries then compare Overview, positions, every SQL holding UUID, and all eight asset classes per household against actual Convex read models with the same saved quote and evaluation time.

Run from the repository root with protected generated inputs and the explicit operator environment:

```sh
node scripts/convex-migration/rehearse-rollback.cjs \
  --snapshot .migration/generated-source-complete/snapshot.json \
  --baseline .migration/rehearsal-complete-a/target.json \
  --fixture-metadata .migration/generated-source-v2/fixture-metadata.json \
  --target-env-file .migration/local-backends/phase6-d/operator.env \
  --source-env-file .migration/generated-source-v2/database.env \
  --run-key rehearsal-complete-a \
  --run-id live-rollback-complete-a \
  --database-name investment_sync_rollback_live_complete_a
```

The default database is `investment_sync_rollback_live`; an explicit name may only add a lowercase alphanumeric/underscore suffix. Existing databases are retained and must already match the frozen source or exact replay. Use a new dedicated name for a new clean target. `--mode capture` resumes after both protected commit receipts exist, without creating another identity or import. `--mode replay` reuses the frozen packet. `--mode semantic` repeats only the exact SQL check and independent read-model comparison. Any comparison finding causes a nonzero exit and remains in a protected diagnostic artifact; the drill does not approve differences.

The first actual `local:phase6-c` drill used the generated source tables at evaluation time `2026-06-20T12:00:00.000Z`. Its frozen baseline replay digest exactly equaled its source digest, `8a8fd81035033d9bfc7c5cc3a2c4b3de8b095d1206fa513169f3ef62c204244e`. After the two public commits, all retained SQL tables exactly matched replay digest `c2c29e91739f0f171b8ddf01f340a7f1f8a8e5331f227329979a90756c46798a`; a second replay performed no write. Counts were 5 users, 4 households, 5 memberships, 22 accounts, 26 instruments, 26 batches, 44 normalized rows, 38 holdings, 2 transactions, 2 valuations, and 1 currency quote. The new file was downloaded and its restored bytes matched the native storage checksum and size. Protected packets and receipts are under `.migration/live-rollback-final-a/`.

The independent comparison covered all 4 households, all 38 holding UUIDs, and all 32 asset-class views. It exposed one historical Indian-stock chart difference: the old reader sums JavaScript numbers, while the native chart sums exact persisted decimals before display conversion. In the deliberate amount-above-`Number.MAX_SAFE_INTEGER` fixture, adding the new synthetic holding produced a one-ULP difference of 2 INR. The exact stored decimals agree. The failed semantic receipt is retained; this is not an approved behavior difference and that initial semantic gate was blocked until display parity was restored in the final drill below. No production data, storage, authentication settings, or deployment were changed.

The final `local:phase6-d` drill passed after `5cc11f8` restored ordered per-row chart arithmetic. Stored facts and exact native totals were unchanged, and the comparison tolerance remains `1e-8`. All SQL tables exactly match replay digest `e1dd307b48075e2916a94d3598b7ffb87655931c6ad712a22ffb47a7be284a59`; the repeated application is idempotent. Counts match the first drill. Independent portfolio verification covers 4 households, all 38 holding UUIDs and all 32 asset-class views, with zero unexplained differences. The restored new file has matching bytes, hash and size. Before-write recovery refuses the changed target. The final protected receipts are `.migration/live-rollback-complete-a/rollback-receipt.json` and `semantic-receipt.json`. The earlier failed semantic receipt remains preserved, and its chart finding is now resolved. No production action was taken.

The targeted review also reproduced a supported three-row INR Commit whose values are `[1, 1, 9007199254740992]`. Arbitrary hashed holding IDs reversed the SQL accumulation order and changed the chart by 2 INR. Ordered holding IDs now match the actual publication/value helpers and the independent legacy aggregation helper. Regressions cover equal Commit timestamps across batches, household scope, same-date corrections, arbitrary archived UUIDs with microsecond creation timestamps, and a clock reversal that must stop before writes. The full migration-tool suite, including the dedicated Postgres integration test, passed 61 tests. A fresh suffixed rehearsal database is required for another live drill with this revised new-holding ID format; prior receipts and restored proof databases remain preserved.
