# Phase 2 implementation and verification

Review base: `54fee909b7b646d3dcfda465f26e1565a49fba34`. The starting tracked tree was clean. `convex-phase-2-handoff.md` remains an unrelated untracked file and is excluded from the implementation and review scope. The complete implementation is verified and remains uncommitted. Both independent reviewers approved the repository work.

Work branch: `feat/convex-phase-2-portfolio-domain`. Future PR base: `feat/convex-native-backend`. No production reads, writes, deployment, or cutover are part of this work.

## Workstreams

| Workstream                                | Owner             | State    | Completion criterion                                                                                |
| ----------------------------------------- | ----------------- | -------- | --------------------------------------------------------------------------------------------------- |
| Import contract                           | `import_contract` | Verified | Legacy golden outputs unchanged; exact source values, provenance, and metadata validated            |
| Publication and valuation                 | Root              | Verified | Public-interface tests and independent Postgres comparisons pass                                    |
| Postgres adapter and parity               | `postgres_parity` | Verified | Read persisted decimal facts and compare unchanged legacy queries under identical quote/time inputs |
| Full verification and independent reviews | Root              | Verified | Required checks and Opus approval recorded against the full diff                                    |

## Local database

Docker socket permissions prevent this user from starting the repository container. A temporary PostgreSQL 17.11 cluster runs on loopback port 54329 using extracted Debian binaries under `/tmp/investment-sync-postgres-portable`. Its `investment_sync_test` database contains only generated test data. This verifies real Postgres SQL but differs from the repository Docker image's PostgreSQL 16 version.

## PR 49 feedback triage

Read-only review on 2026-09-13 found CI, Vercel, and CodeRabbit checks green. CodeRabbit nevertheless reported 11 concrete findings on revision `54fee909`. Green status does not resolve those findings or authorize merge.

The following existing issues are confirmed and remain follow-ups outside the pure Phase 2 implementation:

- Capacity documentation and its generator assign the publication fixture to Phase 3 instead of Phase 4.
- Deployment class, region, and throughput need an explicit Phase 4 measurement gate. Verify the review's proposed throughput number against current Convex primary documentation before adopting it.
- Initial provisioning stores an empty email claim while repeat provisioning treats it as absent.
- The compressed capacity ceiling silently clips required headroom at the legacy 4 MiB maximum. The recorded 11,888-byte source is unaffected; future oversized evidence must fail readiness.
- The capacity-note generator always claims the largest batch's file is unavailable. The current recorded case is accurate, but the generator must handle an available matching file.
- Inventory projected-position keys lack the symbol/name discriminator, and SQL lacks blank-symbol fallback. Fix before approving new write-count evidence.
- Production Postgres inventory clients do not explicitly enforce verified TLS. Actual plaintext use was not established. Require verified transport before another production inventory run.
- Loopback validation misses other addresses in IPv4 127/8 and mapped loopback representations.
- Storage validation accepts HTTP. Require HTTPS before privileged inventory reuse.
- The StorageInventory type does not describe the runtime status-dependent fields or file records.
- The Apple container setup has no readiness poll between detecting a running container and invoking psql.

These findings do not block pure publication tests. No production inventory is run in Phase 2. They remain unresolved prerequisites for their respective inventory, environment, or runtime gates.

## Verification receipts

Initial focused checks:

- `pnpm --filter @investment-sync/importers test`: exit 0, 59 tests passed.
- Importer lint, typecheck, changed-file formatting, and whitespace checks: exit 0.
- `pnpm --filter @investment-sync/portfolio-domain test`: exit 0, initial 16 public-interface tests passed.
- Portfolio-domain lint and typecheck: exit 0.

Subsequent checks before the final review fixes passed workspace lint/typecheck, all eight build tasks, formatting, migration tooling's 14 tests, and the database migration test. The initial concurrent test run hit a currency-rate timeout also reproduced on the untouched base; running at concurrency two passed. No currency-rate implementation was changed.

Final expanded check: `TEST_DATABASE_URL=postgresql://investment_sync:investment_sync@127.0.0.1:54329/investment_sync_test pnpm exec turbo run lint typecheck test --force --concurrency=2` exited 0 with all 24 tasks successful. Counts: API 113 tests including 18 real Postgres parity tests; importers 73; portfolio domain 32; analytics 21; backend 23; web 34; database 1. No database tests were skipped. The existing web native-image lint warning remains.

`pnpm install --frozen-lockfile`, `pnpm format:check`, and `git diff --check` exited 0. `pnpm exec turbo run build --force --concurrency=2` exited 0 with all eight tasks successful. Phase 2 repository implementation is complete. Both required review approvals are recorded below; deployment and later-phase gates remain open.

## Owner decision and compatibility

On 2026-09-13 the owner directed: "Preserve both legacy entries". Current and Exited are selected independently when source groups overlap. Source-specific stable position keys keep both links and histories distinct. Partial sales remain Current at the remaining quantity; source histories and sale transactions remain available. No suppression bug fix is approved.

Stored instruments distinguish symbol-based and name-based identities. Canonical read ranking intentionally preserves the legacy symbol-or-name grouping, including collisions. Decimal strings compare exactly after canonicalization; approximate numeric output uses the plan's absolute 1e-8 tolerance.

## Review findings and disposition

The first independent Codex review found persisted derived identity fields could break replay and oversized source text could fall back to Float64. Both are corrected, including the follow-up case of overflowing optional quantity fields. Regression tests cover these cases. The focused Codex follow-up approved the Phase 2 repository work with no remaining blockers, conditional on the checks passing; the expanded 24-task run satisfies that condition.

Claude Code's first full read-only review used `claude-opus-5`, session `504cf8a2-4968-4352-a236-aefb18130363`, and requested changes. Accepted findings:

- F1: the Postgres adapter now left-joins transaction instruments and rejects missing instruments explicitly. Backfill must resolve such data before publication; silently dropping cash flows is prohibited.
- F2: preserve legacy symbol-or-name ranking separately from stored identity, with a dedicated parity case.
- F3: compare approximate numbers with absolute 1e-8 tolerance and exercise non-binary-exact USD values.
- F4: use code-unit comparison for digest keys, dates, names and stable tie-breaks. The local database uses libc `C.UTF-8` collation. Production collation and representative non-ASCII ordering remain a pre-cutover reconciliation gate; no production database was accessed.
- F5: enforce effective Postgres numeric precision after rounding, including carry overflow. Money uses numeric(28,4), quantity/price numeric(28,10), percentages numeric(12,6).
- F6: add typed per-view valuation selection so missing FX only fails views requiring that currency.
- F7: preserve the owner-selected overlap behavior and make its parity test pass. The suggestion to skip or mark the failing test expected was rejected; no known divergence is hidden.
- F8: replace per-position full-history scans and persistence membership scans with maps and sets. Runtime throughput measurement remains a Phase 4 gate.
- F9: add exact workbook coverage for Mutual Funds, NPS, ULIPS, Crypto and US Stocks.

Low-priority suggestions were evaluated. Keep the private synchronous WeakMap to preserve legacy JSON output. Error context and a more uniform validation error type can improve later without changing financial semantics. Keep household authorization at the backend boundary and household-filtered adapter; adding a speculative tenant contract to the pure projector is outside this phase. Test helpers follow existing service-test placement; no additional public golden-fixture export is needed. Provenance keys remain extensible. Canonical decimal formatting and stable IDs are deliberate migration contracts, not numeric differences.

Legacy snapshot UUID aliases, including superseded or suppressed snapshots, still require backend implementation and reconciliation in Phases 4 and 6. Pure position views do not establish that runtime addressability gate. Phase 1 authentication, codegen and deployment gates remain pending.

## Final review approval

Claude Code follow-up used actual model `claude-opus-5`, session `d56cb15a-085a-4ac4-9c10-574a4d6a9b5d`, reviewing the complete uncommitted Phase 2 change against `54fee909`. Verdict: **Approved**, all F1–F9 resolved, no regressions or blockers. It independently read the successful 24-task verification log. Codex also approved the focused follow-up. Subsequent edits only recorded verification and review receipts in this document.

The Opus follow-up identified five non-blocking residuals:

- A standalone `holdings` selection is absent. The migration plan has no Convex successor for the mobile-only endpoint, so no new selection is added here. Any reuse for that endpoint before its Phase 8 removal must preserve its current-only FX requirement.
- Production reconciliation must compare Unicode case folding as well as collation ordering. JavaScript `toUpperCase()` and Postgres `upper()` may differ for non-ASCII names.
- Convex-native account/instrument display-name updates must be checked against legacy live dimension rows during Phase 4. The persisted-fact adapter already joins those current names.
- The default all-views helper recomputes summaries per position. It is for tests and comparisons; backend callers should select their endpoint view. Include actual view construction in Phase 4 capacity checks.
- Financial validation errors can gain batch, row and field context in the upload integration. This does not block the pure numeric contract.

No production data or deployment was changed. No commit, push, merge, or PR update was performed. Phase 3 has not started.
