# Phase 6: migration tooling and verification

The owner authorized syncing the migration branch with current Postgres behavior and implementing Phase 6 on 2026-10-03. Production continues to use Postgres. Production data loading and traffic cutover remain Phase 7 actions requiring separate authorization.

Review baseline: `dfffa66043bf8a93863ac4c197ae0b521de208c7`. The first commit merges current `main` (`068e18f`) without rewriting the legacy portfolio implementation. Initial unrelated untracked agent configuration remains outside the change.

Opus is unavailable by the owner's instruction. This work uses independent Codex reviews; it does not claim a new Opus approval.

| Milestone             | Objective                                                      | Assigned                 | Files                                         | Completion criterion                                                                                    | Task ID                                                      | Status   | Receipts                                                                                           | Findings                                                                                                    |
| --------------------- | -------------------------------------------------------------- | ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Sync                  | Merge current Postgres changes                                 | Lead                     | Existing Postgres services and tests          | Clean merge preserving independent oracle                                                               | root                                                         | Verified | `git merge --no-ff origin/main`; exit 0; `fe18039`                                                 | Workbook/Vested parity restored in `39bd77e`                                                                |
| Parity                | Match current source selection and display arithmetic          | Codex                    | Portfolio domain and independent parity tests | Domain tests and retained Postgres comparison pass                                                      | phase6_postgres_parity, phase6_display_parity                | Verified | `39bd77e`, `5cc11f8`; 38 domain tests, two real clean migrations and live rollback views pass      | Other overlapping source groups retain both legacy entries; exact stored decimals remain unchanged          |
| Load                  | Guarded, repeatable parent/fact/file loading and publication   | Codex                    | Backend migration functions, schema, tests    | Replay and conflict tests, actual target export, generated rehearsal                                    | phase6_backend_loader                                        | Verified | `702dbda`, `13ec59f`, `6e669ee`; real local deploy/codegen; 118 backend tests                      | Packed input is compared with authoritative rows; saved quotes expire reactively                            |
| Extract and reconcile | Consistent source snapshot and independent semantic comparison | Lead                     | Migration scripts and runbook                 | Exact structural checks; retained queries compared with actual native queries; complete coverage        | root                                                         | Verified | `19e6f46`, `dcb4c64`, `13ab7fb`, `2f42b0e`; 55 tool tests; 36 legacy links and all classes checked | Same quote and clock; missing coverage, rehashed pending corruption and orphan uploads block reconciliation |
| Rollback              | Reverse replay after new Convex commits                        | Codex                    | Reverse adapter and rollback tooling          | New identity, multiple commits, expired-file input, exact SQL, independent views and replay idempotency | phase6_rollback                                              | Verified | `8e806b4`, `7d8ccf4`, `2ffd122`; actual public APIs on `local:phase6-d`; zero semantic findings    | Unsupported legacy constraints stop replay; actual application redeployment remains an operator step        |
| Rehearsal and review  | Two clean migrations, rollback and independent reviews         | Lead and fresh reviewers | Complete change                               | Green repository, identical target outputs, final findings triaged                                      | phase6_independent_review_one, phase6_independent_review_two | Returned | Final clean runs and live rollback passed; final follow-up reviews pending                         | Real production reconciliation remains a Phase 7 gate                                                       |

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

The final snapshot includes every legacy holding detail, including older and suppressed UUIDs. Its input digest is `18b58c41df28bb7b8c2969eeac8e68598591a98e70286a1b182713ca3d6f81b3`. It uses the same SQL rows and file bytes as the earlier source; the checksum changed because semantic coverage expanded.

Both `local:phase6-d` and `local:phase6-e` reconciled with zero unexplained differences across 3 households, 36 holding details and 24 asset-class details. Both target semantic digests equal `8d1c850f6611f647d6136da66974a9ba8325c1c0fe3bb87e2f6547d4b3f0abd8`; both reconciliation report digests equal `4a794e50494df4fd0c02918491719c18842f5dd00af15ee3e0330c661df89298`. Reports also check native entities, relationships, exact persisted values, normalized chunks, files and all visible portfolio results. Source and target byte digests may differ for tolerated approximate analytics; the independently checked findings count is the parity gate.

Protected source, exports, file bytes and receipts are under `.migration/generated-source-complete/`, `.migration/rehearsal-complete-a/`, `.migration/rehearsal-complete-b/` and `.migration/rehearsal-complete/`. Earlier successful receipts under `.migration/rehearsal-final*/` and failed receipts are retained as historical evidence. No source contents or operator credentials are committed.

Replaying the same run against `local:phase6-e` left its complete exported packet unchanged, with digest `aa06a669c7257c2576aaec5465a626f73a5175720a21826d507856c7036a9591`. Load replay plus full reconciliation took 4.750 seconds. The receipt is `.migration/rehearsal-complete-b-replay/replay-receipt.json`. This small local duration does not estimate production downtime.

The source deliberately retains one historical count discrepancy, seven declared rows versus six actual rows. Both counts remain available. Production reports require explicit owner-approved dispositions bound to the source digest; no anomaly is silently accepted for production.

The final live rollback on `local:phase6-d` uses actual public APIs to commit an expired parsed batch and a newly uploaded import under a generated new identity. The downloaded new file matches its checksum and size. All 12 SQL tables match replay digest `e1dd307b48075e2916a94d3598b7ffb87655931c6ad712a22ffb47a7be284a59`, and the second replay reports `alreadyApplied: true`. Independent retained SQL and actual native views have zero unexplained differences across 4 households, 38 holding UUIDs and 32 asset-class details. Before-write rollback correctly refuses the changed target. Receipts are under `.migration/live-rollback-complete-a/`; see [the rollback runbook](convex-phase-6-rollback.md).

## Verification findings resolved

The first actual comparison found NVDA gain contribution at 16.19% in the detail query against 16.18% in Postgres. Detail hydration moved the selected holding to the end of the current positions array, changing Float64 summation order for large and small values. The asset-class reader used the same reorder. Both now preserve publication order. A regression test fails against the previous implementation with 100% versus 50% contribution, and passes against the fix. The original failed report remains protected under `.migration/rehearsal-a/`. The comparison tolerance was not relaxed.

The audit also blocks unclaimed storage objects left by interrupted uploads and unexpected native entities without source mappings. Regression tests prove these failures and recovery after removing the unclaimed object.

The actual post-write comparison then exposed a two-INR chart difference above JavaScript's safe integer range. The native chart had summed exact decimals before conversion, while Postgres converts each row before summing. `5cc11f8` retains compact ordered display inputs and restores per-row conversion and accumulation. Exact stored facts and native totals remain unchanged. Two tests call the retained legacy chart helper directly, including mixed INR/USD conversion. The final clean runs and live rollback pass without relaxing `1e-8`. The unchanged publication capacity gate measures 8,234,626 bytes against its 8,388,608-byte cap.

## Independent review findings

The first two full reviews used baseline `dfffa66043bf8a93863ac4c197ae0b521de208c7` through `1ae68ca`. They agreed that no structural blocker or unjustified new file over 1,000 lines was present. Verified findings and fixes:

- Packed pending input could pass a consistent rehash despite differing from archived SQL rows. Backend audit and the independent CLI now compare full ordered content with the canonical adapter applied directly to SQL input. Corruption regression passes.
- A resealed source could omit household views, classes or historical holding links. Coverage validation now requires every source household, all eight classes and every old holding UUID before reading the target. Omission and duplicate tests pass.
- A migrated fresh currency quote lacked expiry transitions. Imported quotes now schedule the ordinary revision-bound stale/unavailable callbacks. Expiry can run during the migration freeze, refresh remains disabled, and tests cover thawing, failed refresh and delayed callbacks.
- Reverse replay could accept missing stage receipts. It now verifies the root manifest, complete stage cardinality and ordered facts, checksums, byte counts and publication attempt. Truncated, empty and conflicting exports fail closed.
- New same-date, same-name cross-account ties could select a different winner under new SQL UUID ordering. Reverse replay stops with `holding_selection_tie_not_reversible`; it cannot silently approve a changed result.

A conditional concern that older or suppressed aliases might return null was checked against all 36 real generated links and was not reproduced. Expanded independent coverage rejects that finding for the checked source. Opus was not run for Phase 6. The final Codex follow-up revision and results will be recorded after both reviews return.

## Workspace checks

Root verification of the final code completed with exit zero. Logs are retained at `/tmp/phase6-final-{lint,typecheck,test,build}.log` and `/tmp/phase6-final-tools-{lint,types,tests}.log`:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` across all eight workspaces. Lint retains the existing instrument-image warning.
- `pnpm lint:migration-tools`, `pnpm typecheck:migration-tools`, and `pnpm test:migration-tools`.
- Actual retained-schema rollback integration on a dedicated local Postgres database. It verifies exact tables, three commits, an expired batch, a new identity, forced SQL failure, replay idempotency and divergence rejection.
- Full API integration suite on `investment_sync_migration_integration`: 136 tests passed. DB migration integration: one test passed. The Linux service uses a standalone local Postgres 17 backend because Docker socket access and the Apple container CLI are unavailable. Equivalent explicit database commands were run; `test:db:integration` itself was not claimed as executed.
- Final full backend suite: 118 passed; portfolio domain: 38 passed. Migration tools: 55 passed with the actual local SQL test enabled and no skips.
- The precision-sensitive detail-order regression was checked against both old and fixed implementations. Changed-file formatting and `git diff --check` passed.

CI now includes migration script lint/type checks, tool tests, and the real SQL rollback test. Remote CI status is a separate receipt after push.

For exact commands and operator failure handling, see [the migration runbook](convex-phase-6-runbook.md) and [rollback runbook](convex-phase-6-rollback.md).
