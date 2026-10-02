# Phase 6 migration operator runbook

Production continues to use Postgres. These tools prepare the migration and verify generated rehearsals. Loading real data, changing production settings, and switching traffic require Phase 7 authorization.

## Prepare and protect inputs

Use `.migration/<run-id>/` for snapshots, source bytes, operator environments, configuration archives, exports, and receipts. This directory is ignored by Git. Directories are mode `0700`; files are mode `0600`. Protect these artifacts as database backups. Hashes alone are not recoverable backups.

Pass explicit environment files. Source extraction needs `DATABASE_URL`. A production file export also needs a separate file containing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_IMPORT_BUCKET`. Target commands need `MIGRATION_CONVEX_URL`, `MIGRATION_CONVEX_DEPLOYMENT`, and `MIGRATION_CONVEX_ADMIN_KEY`. No command selects its target from ambient application credentials.

Before the real final export, freeze every Postgres writer, including identity provisioning, Commit, lazy currency refresh, and retention. Capture a restorable database backup and all retained file bytes. Archive the exact last Postgres-serving commit, redeployable build, and matching configuration. These production backup locations are operator choices still to be recorded in Phase 7. The retained source database must remain available throughout the rollback window.

The inactive target must be empty and explicitly named. Configure its `APP_ENV` and `MIGRATION_MODE` to match the source classification. Synthetic migration requires test/development configuration; production data requires the named production deployment. Migration functions are internal. The migration freeze disables ordinary writes, cleanup, and currency refresh until validation passes. Expiry-only callbacks still advance the saved quote from fresh to stale to unavailable; they cannot change its amount or fetch time.

## Generated rehearsal commands

The fixture generator creates only a loopback database whose name begins with `investment_sync_migration_`. It uses generated reports and applies the retained SQL schema. Its fixed recipe and source digest make repeat invocation safe.

```sh
pnpm exec tsx scripts/convex-migration/generate-rehearsal-fixture.ts \
  --env-file .migration/generated-source-v2/database.env \
  --run-id generated-source-v2

pnpm migration:export \
  --source synthetic \
  --database-env-file .migration/generated-source-v2/database.env \
  --synthetic-files .migration/generated-source-v2/fixture-files.json \
  --run-id generated-source-complete \
  --evaluation-time 2026-06-20T12:00:00.000Z

pnpm migration:rehearse \
  --snapshot .migration/generated-source-complete/snapshot.json \
  --first-target-env-file .migration/local-backends/phase6-d/operator.env \
  --second-target-env-file .migration/local-backends/phase6-e/operator.env \
  --run-id rehearsal-complete
```

The last command is restricted to two distinct disposable local targets. It loads the same snapshot twice, executes independent reconciliation, and requires identical target semantic digests and table counts. Expected output is `Both local migrations passed independent reconciliation with identical semantic digests`.

The rehearsed targets are `local:phase6-d` at `127.0.0.1:3220` and `local:phase6-e` at `127.0.0.1:3222`. Each receives 3 Households, 4 users, 20 accounts, 25 historical batches, 43 normalized rows, 36 holdings, 2 transactions, 2 valuations, and 5 available generated files. Twenty-five global legacy instruments map to 27 household-scoped instruments. Unreferenced global data remains in the source archive. No duplicate identity is silently merged.

A load plus independent reconciliation of this small fixture takes seconds locally. The measured repeat load plus full reconciliation took 4.750 seconds. This is not a production downtime estimate. Measure production-sized rehearsals and restore backups before assigning a cutover window.

## Individual loading and reconciliation

```sh
pnpm migration:load \
  --snapshot .migration/generated-source-complete/snapshot.json \
  --target-env-file .migration/local-backends/phase6-e/operator.env \
  --run-id rehearsal-complete-b
```

Without `--apply yes`, loading checks the source checksums, source bytes, and target classification without writing. Add that flag only for the already authorized target. Loading in the same run is idempotent; changing a source record or reusing the run with different input stops execution. An interrupted load leaves the target inactive. Correct the failure and resume the same input; do not reset or silently overwrite it.

```sh
pnpm migration:reconcile \
  --snapshot .migration/generated-source-complete/snapshot.json \
  --target-env-file .migration/local-backends/phase6-e/operator.env \
  --run-id rehearsal-complete-b \
  --report-id rehearsal-complete-b-verified
```

Expected output is `Reconciliation complete: 0 unexplained differences`. Every report is immutable. Use a new report ID after a code fix while retaining the failed report as evidence. `target.json` contains the actual native records and enriched mappings needed for reverse replay. Failures produce protected diagnostics and exit nonzero.

## Comparison and approval gates

One read-only repeatable-read transaction captures every SQL table and executes the retained Postgres readers. UUIDs, numeric values, dates, and UTC timestamps retain their source representations. The source manifest contains whole-table digests and household counts, including normalized rows reached through their batch and shared instruments reached through facts. Available file bytes are checked against their stored SHA-256 and copied unchanged. Expired and missing files retain their unavailable metadata.

The independent target checker verifies native records, ID mappings and household relationships, normalized chunks, import workflow states, dedupe keys, all legacy holding aliases, source-file metadata and actual downloaded bytes. Exact monetary and quantity strings compare after decimal canonicalization. Orphan uploads, unexpected native documents, incomplete exports, and unsupported source facts block the result. Source archives alone cannot prove a correct target.

Portfolio comparison calls the retained Postgres implementation and the Convex read models independently. It covers Overview, Current and Exited positions, every asset class, every legacy holding detail, including older and suppressed UUIDs, histories, transactions, timelines, XIRR and quality labels. Both use the same persisted exchange-rate quote and evaluation time. Approximate numeric analytics allow only the plan's absolute tolerance of `1e-8`; persisted financial values remain exact.

Historical declared row counts are reported separately from actual normalized counts. The generated fixture deliberately declares 7 while preserving 6 rows. Production anomalies require an owner-approved protected disposition file bound to the exact `inputDigest`. Pass it with `--dispositions`; the complete `approvedSourceDispositions` array must match the report's `sourceDispositions`. Without that approval, the discrepancy blocks the production report. Never approve a different value or missing fact merely to make a report pass.

A successful generated rehearsal does not certify production data. Phase 7 must run this same comparison against the frozen real source and inactive production Convex target. Require zero unexplained differences, authenticated read-only page and file checks, verified backups, and an agreed recovery policy before switching traffic. Imports remain disabled until the read-only verification passes.

## Rollback

Follow [the rollback runbook](convex-phase-6-rollback.md). Before any Convex-only write, prove both the source database and frozen target remain unchanged, then restore the exact archived application build and configuration. After writes, freeze and drain Convex, preserve a full export with commit receipts and normalized rows, restore any new available files, and reverse replay in original publication order into Postgres. Reconcile the resulting database and portfolio queries before enabling the old build.

The reverse adapter stops on data that the old schema cannot represent, including distinct transaction occurrences colliding under its old unique key. A successful data replay deliberately reports `applicationRestored: false`; it cannot substitute for redeploying and checking the archived application.
