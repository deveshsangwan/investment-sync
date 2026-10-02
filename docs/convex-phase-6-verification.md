# Phase 6: migration tooling and verification

The owner authorized syncing the migration branch with current Postgres behavior and implementing Phase 6 on 2026-10-03. Production continues to use Postgres. Production data loading and traffic cutover remain Phase 7 actions requiring separate authorization.

Review baseline: `dfffa66043bf8a93863ac4c197ae0b521de208c7`. The first commit merges current `main` (`068e18f`) without rewriting the legacy portfolio implementation. Initial unrelated untracked agent configuration remains outside the change.

Opus is unavailable by the owner's instruction. This work uses independent Codex reviews; it does not claim a new Opus approval.

| Milestone             | Objective                                                      | Assigned                 | Files                                      | Completion criterion                                                                           | Task ID                | Status     | Receipts                                           | Findings                                                   |
| --------------------- | -------------------------------------------------------------- | ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------- | ---------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Sync                  | Merge current Postgres changes                                 | Lead                     | Existing Postgres services and tests       | Clean merge preserving independent oracle                                                      | root                   | Verified   | `git merge --no-ff origin/main`; exit 0; `fe18039` | New workbook/Vested selection rule needs Convex parity     |
| Parity                | Match the latest source overlap correction                     | Codex                    | Portfolio domain and parity tests          | Domain tests and independent Postgres comparison pass                                          | phase6_postgres_parity | Dispatched | Pending                                            | Other overlapping source groups retain both legacy entries |
| Load                  | Guarded, repeatable parent/fact/file loading and publication   | Codex                    | Backend migration functions, schema, tests | Replay and conflict tests; actual target export; generated rehearsal                           | phase6_backend_loader  | Dispatched | Pending                                            | Operator functions remain internal and disabled by default |
| Extract and reconcile | Consistent source snapshot and independent semantic comparison | Lead                     | Migration scripts and runbook              | Tamper detection; exact structural reconciliation; legacy queries compared with target queries | root                   | Dispatched | Pending                                            | Same quote and evaluation time; protected artifacts only   |
| Rollback              | Reverse replay after new Convex commits                        | Codex                    | Reverse adapter and rollback tooling       | New identity, multiple commits, expired-file input, replay idempotency                         | phase6_rollback        | Dispatched | Pending                                            | Unsupported legacy constraints must stop replay            |
| Rehearsal and review  | Two clean generated migrations, rollback, independent reviews  | Lead and fresh reviewers | Complete change                            | Required checks pass; identical semantic digests; findings triaged                             | Pending                | Planned    | Pending                                            | Real production reconciliation is a separate Phase 7 gate  |

## Comparison contract

The source is one read-only, repeatable-read Postgres snapshot. UUIDs and numerics are text; civil dates and UTC timestamps retain their source representation. Every exported table and referenced available source file has a count or digest. Global instruments are mapped separately for each referencing household. Full source records remain available for the rollback window.

Structural comparison covers actual target records and their relationships, normalized rows, historical metadata, import states, dedupe keys, file bytes, and exact persisted financial values. Reading an archived source record alone cannot prove that its target document is correct.

Semantic comparison executes the retained Postgres portfolio implementation independently and reads the Convex portfolio query models. It compares overview, Current and Exited positions, each asset class, each holding detail and history, timeline, transactions, XIRR and quality labels. Both use the same persisted exchange-rate quote and evaluation time. Decimal strings compare exactly after canonicalization; approximate analytics allow the plan's absolute tolerance of `1e-8`.

Only explicit, tested dispositions may explain differences. An unexplained discrepancy, missing comparison, failed integrity check, or unsupported source record blocks cutover. Matching a portfolio total is insufficient.

## Latest production parity

Current `main` groups the specific Manual Workbook and Vested/DriveWealth US Stocks reports together for position selection. At the same date, Vested wins. This restores the behavior approved and shipped in PR #51. Physical source histories remain separate. The earlier owner decision to preserve both Current and Exited entries for other overlapping source groups still applies.

## Production verification gate

Phase 6 uses generated data in disposable local databases. It cannot establish that the real production dataset migrated correctly. In Phase 7, after explicit authorization, freeze all Postgres writers, capture restorable database/file backups and the exact previous web build/configuration, export the real snapshot, load the inactive production Convex target, and run this same comparison. Production traffic switches only after zero unexplained differences and authenticated read-only smoke tests. Imports remain disabled until the read-only validation passes.
