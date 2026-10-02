# Phase 6: migration tooling and verification

The owner authorized syncing the migration branch with current Postgres behavior and implementing Phase 6 on 2026-10-03. Production continues to use Postgres. Production data loading and traffic cutover remain Phase 7 actions requiring separate authorization.

Review baseline: `dfffa66043bf8a93863ac4c197ae0b521de208c7`. The first commit merges current `main` (`068e18f`) without rewriting the legacy portfolio implementation. Initial unrelated untracked agent configuration remains outside the change.

Opus is unavailable by the owner's instruction. This work uses independent Codex reviews; it does not claim a new Opus approval.

| Milestone             | Objective                                                      | Assigned                 | Files                                      | Completion criterion                                                                           | Task ID                | Status   | Receipts                                                                                | Findings                                                   |
| --------------------- | -------------------------------------------------------------- | ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------- | -------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Sync                  | Merge current Postgres changes                                 | Lead                     | Existing Postgres services and tests       | Clean merge preserving independent oracle                                                      | root                   | Verified | `git merge --no-ff origin/main`; exit 0; `fe18039`                                      | New workbook/Vested selection rule needs Convex parity     |
| Parity                | Match the latest source overlap correction                     | Codex                    | Portfolio domain and parity tests          | Domain tests and independent Postgres comparison pass                                          | phase6_postgres_parity | Verified | `39bd77e`; 36 domain tests and 29 independent SQL comparisons                           | Other overlapping source groups retain both legacy entries |
| Load                  | Guarded, repeatable parent/fact/file loading and publication   | Codex                    | Backend migration functions, schema, tests | Replay and conflict tests; actual target export; generated rehearsal                           | phase6_backend_loader  | Verified | `702dbda`, `13ec59f`; real local codegen/deploy; 110 backend tests                      | Operator functions remain internal and disabled by default |
| Extract and reconcile | Consistent source snapshot and independent semantic comparison | Lead                     | Migration scripts and runbook              | Tamper detection; exact structural reconciliation; legacy queries compared with target queries | root                   | Verified | `19e6f46`, `dcb4c64`; exact native checks, files, all portfolio views; zero differences | Same quote and evaluation time; protected artifacts only   |
| Rollback              | Reverse replay after new Convex commits                        | Codex                    | Reverse adapter and rollback tooling       | New identity, multiple commits, expired-file input, replay idempotency                         | phase6_rollback        | Returned | `8e806b4`; real SQL transaction rehearsal passed; live export exercise in progress      | Unsupported legacy constraints must stop replay            |
| Rehearsal and review  | Two clean generated migrations, rollback, independent reviews  | Lead and fresh reviewers | Complete change                            | Required checks pass; identical semantic digests; findings triaged                             | Pending                | Returned | Two clean local migrations have identical digests; independent final reviews pending    | Real production reconciliation is a separate Phase 7 gate  |

## Comparison contract

The source is one read-only, repeatable-read Postgres snapshot. UUIDs and numerics are text; civil dates and UTC timestamps retain their source representation. Every exported table and referenced available source file has a count or digest. Global instruments are mapped separately for each referencing household. Full source records remain available for the rollback window.

Structural comparison covers actual target records and their relationships, normalized rows, historical metadata, import states, dedupe keys, file bytes, and exact persisted financial values. Reading an archived source record alone cannot prove that its target document is correct.

Semantic comparison executes the retained Postgres portfolio implementation independently and reads the Convex portfolio query models. It compares overview, Current and Exited positions, each asset class, each holding detail and history, timeline, transactions, XIRR and quality labels. Both use the same persisted exchange-rate quote and evaluation time. Decimal strings compare exactly after canonicalization; approximate analytics allow the plan's absolute tolerance of `1e-8`.

Only explicit, tested dispositions may explain differences. An unexplained discrepancy, missing comparison, failed integrity check, or unsupported source record blocks cutover. Matching a portfolio total is insufficient.

## Latest production parity

Current `main` groups the specific Manual Workbook and Vested/DriveWealth US Stocks reports together for position selection. At the same date, Vested wins. This restores the behavior approved and shipped in PR #51. Physical source histories remain separate. The earlier owner decision to preserve both Current and Exited entries for other overlapping source groups still applies.

## Production verification gate

Phase 6 uses generated data in disposable local databases. It cannot establish that the real production dataset migrated correctly. In Phase 7, after explicit authorization, freeze all Postgres writers, capture restorable database/file backups and the exact previous web build/configuration, export the real snapshot, load the inactive production Convex target, and run this same comparison. Production traffic switches only after zero unexplained differences and authenticated read-only smoke tests. Imports remain disabled until the read-only validation passes.

## Generated migration receipts

The frozen generated source has 4 users, 3 Households, 4 memberships, 20 accounts, 25 global instruments, 25 historical batches, 43 normalized rows, 36 holding snapshots, 2 transactions, 2 portfolio valuations, one currency quote, and zero stored prices. Five available generated files were copied and downloaded with matching hashes. The native instrument count is 27 because shared global instruments split by Household; all 36 legacy holding IDs have aliases.

Input digest: `0f3d2bd0689157ba38f4579b12141cf204e5aad27035d37325aeac3c58ab4cc5`.

Both `local:phase6-c` and `local:phase6-b` reconciled with zero unexplained differences. Both target semantic digests equal `9d63cfc03836342ea93767b3ce05fd3cfe6f4aa1e64ef28f0b21dd0296054f7b`. The protected source, actual exports, file bytes and receipts are under `.migration/generated-source-final/`, `.migration/rehearsal-final-a/`, `.migration/rehearsal-final-b/` and `.migration/rehearsal-final/`. No source contents or operator credentials are committed.

The same run was replayed against the frozen second target. Its complete exported packet remained unchanged, with digest `aa73cf45ad9d8624c4b967161df4b0ace3e35fe4e9ef8e5c82b59d45f079dfe8`. Load replay plus full reconciliation took 4.574 seconds. The receipt is `.migration/rehearsal-final-b-replay/replay-receipt.json`. This small local duration does not estimate production downtime.

The source deliberately retains one historical count discrepancy, seven declared rows versus six actual rows. Both counts remain available. Production reports require explicit owner-approved dispositions bound to the source digest; no anomaly is silently accepted for production.

## Verification findings resolved

The first actual comparison found NVDA gain contribution at 16.19% in the detail query against 16.18% in Postgres. Detail hydration moved the selected holding to the end of the current positions array, changing Float64 summation order for large and small values. The asset-class reader used the same reorder. Both now preserve publication order. A regression test fails against the previous implementation with 100% versus 50% contribution, and passes against the fix. The original failed report remains protected under `.migration/rehearsal-a/`. The comparison tolerance was not relaxed.

The audit also blocks unclaimed storage objects left by interrupted uploads and unexpected native entities without source mappings. Regression tests prove these failures and recovery after removing the unclaimed object.

## Workspace checks

Root verification completed with exit zero:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` across all eight workspaces. Lint retains the existing instrument-image warning.
- `pnpm lint:migration-tools`, `pnpm typecheck:migration-tools`, and `pnpm test:migration-tools`.
- Actual retained-schema rollback integration on a dedicated local Postgres database. It verifies exact tables, three commits, an expired batch, a new identity, forced SQL failure, replay idempotency and divergence rejection.
- Full API integration suite on `investment_sync_migration_integration`: 136 tests passed. DB migration integration: one test passed. The Linux service uses a standalone local Postgres 17 backend because Docker socket access and the Apple container CLI are unavailable. Equivalent explicit database commands were run; `test:db:integration` itself was not claimed as executed.
- Targeted backend migration tests: ten passed, including the orphan upload audit. The whole backend suite baseline had 109 passes before that additional regression.
- The precision-sensitive detail-order regression was checked against both old and fixed implementations. Changed-file formatting and `git diff --check` passed.

CI now includes migration script lint/type checks, tool tests, and the real SQL rollback test. Remote CI status is a separate receipt after push.

For exact commands and operator failure handling, see [the migration runbook](convex-phase-6-runbook.md) and [rollback runbook](convex-phase-6-rollback.md).
