# Manual policy timeline performance

Issue [#61](https://github.com/deveshsangwan/investment-sync/issues/61) reproduced on base `73930483798f2cfd7fe68b8069810ffcf99ee3f8`.

A policy update previously rebuilt the selection map, sorted all current holdings, and recalculated every exact native-currency contribution on every timeline date. The timeline now indexes retained candidates by position and source selection group. A changed or removed group candidate marks that position for reselection after all rows for the date have arrived. Only a changed winner adjusts the currency totals. Complete snapshots still invalidate their own group's omitted candidates and reveal older alternatives from other groups. Currency counts preserve selected zero totals. Output sorts currencies and dates as before.

The optimization is confined to `timelineWithManualPolicies` and its private helpers. `selectPositions`, current/exited publication ordering, source eligibility, immutable source facts, household authorization, limits, and migration/recovery tooling retain their existing behavior. Explicit reported valuations still carry forward and add only selected policy holdings. Each added/removed contribution uses `nativeTotals`, so #60 can correct missing P&L in that shared function without duplicating its rules here. #15 can change canonical identity at its source; no account-identity rule is embedded in the new index. This branch is based directly on main and has no stacked dependency. Re-run selector parity and this benchmark after integrating either issue. A #60 correctness change can intentionally change the benchmark fingerprint if its fixture is changed to omit P&L.

## Reproduction

The benchmark uses fake data only: 1,000 unchanged stock positions and one policy with 1,499 snapshots, with 2,498 existing facts and one incoming row. Each process independently builds the publication, validates `projectionRecords`, then runs the manual timeline once in isolation. `--workers 2` starts two real concurrent Node processes, rather than repeating calls sequentially or using promises around synchronous work. The driver permits only one or two workers on the shared host.

The original `/tmp/investment-timeline-admitted-benchmark.ts` was adapted into the checked-in driver with work counters, full output fingerprints, admission assertions, and process CPU measurements. It does not contact a backend or read environment configuration. The isolated phase instruments unchanged stock key and amount getters; the builder phase uses ordinary, uninstrumented facts. Output hashing and projection admission validation occur outside the measured builder interval. CPU milliseconds sum the current process's user and system CPU usage, including runtime overhead, rather than measuring cloud execution CPU.

To compare base sources with this implementation without changing either checkout, from this worktree's root:

```sh
mkdir -p .migration/issue-61-baseline
git archive 73930483798f2cfd7fe68b8069810ffcf99ee3f8 packages/portfolio-domain/src | tar -x -C .migration/issue-61-baseline
ln -s "$PWD/packages/portfolio-domain/node_modules" .migration/issue-61-baseline/packages/portfolio-domain/node_modules
node scripts/benchmarks/manual-policy-timeline.cjs --workers 2 --domain-source .migration/issue-61-baseline/packages/portfolio-domain/src --output /tmp/issue-61-before-cpu.json
node scripts/benchmarks/manual-policy-timeline.cjs --workers 2 --compare /tmp/issue-61-before-cpu.json --output /tmp/issue-61-after-cpu.json
```

The archive is an ignored source artifact inside this worktree. Its dependency link resolves the unchanged workspace dependencies. It is not a separate Git checkout. In the recorded run, the baseline command additionally used `--compare /tmp/issue-61-before.json` to check against the first baseline receipt described below. Both successful CPU benchmark commands exited 0. An initial archived-source invocation exited 1 because the archive lacked the package dependency link; adding the link above corrected the setup.

## Measurements

Recorded on 2026-10-30 using Node `v24.19.0`, pnpm `11.5.2`, four visible CPUs, and two benchmark processes on a shared Linux host with other implementation threads active. Worker labels identify output array slots, not pinned CPUs. Before and after phases ran sequentially on that same host. No limits or timeouts changed.

| Measurement per process             | Base worker 1 | Base worker 2 | Optimized worker 1 | Optimized worker 2 |
| ----------------------------------- | ------------: | ------------: | -----------------: | -----------------: |
| Publication builder process CPU, ms |      4312.441 |      4326.594 |            628.805 |            592.637 |
| Publication builder elapsed, ms     |         45317 |         39093 |               3154 |               2005 |
| Isolated timeline process CPU, ms   |      4600.563 |      4813.458 |            105.080 |             96.711 |
| Isolated timeline elapsed, ms       |         32193 |         44880 |                447 |                443 |
| Unchanged position-key reads        |       1501000 |       1501000 |               2000 |               2000 |
| Unchanged invested-amount reads     |       1499000 |       1499000 |               1000 |               1000 |

Mean builder process CPU fell about 86%; mean isolated timeline process CPU fell about 98%. Absolute elapsed times are load-sensitive. These numbers demonstrate local domain computation improvement, not production latency, a cloud transaction-capacity certificate, or a guarantee that every admitted workload fits a hosted execution budget. Full publication work outside this timeline remains measurable.

Every process, before and after, passed these projection record counts:

| Record stage                        | Count |
| ----------------------------------- | ----: |
| history                             |  2499 |
| positions                           |  1001 |
| scopes                              |  2030 |
| summary                             |     1 |
| assets                              |     2 |
| timeline, global plus asset classes |  3000 |

The full publication SHA-256 was identical in every process: `52c94ce97c529977f10a9b9817626b7b3b025b270b5c74b24b0888a6afc18263`. The isolated timeline SHA-256 was `1e9703fd992317798b99d45eed12e350f2d1f99e832333116454fef531c13c7f`. The driver also asserts deep equality of the isolated timeline and publication timeline. All fixture rows supply P&L; this benchmark does not change or fix #60.

Before CPU instrumentation was added, these commands also exited 0 with identical counts and fingerprints:

```sh
node scripts/benchmarks/manual-policy-timeline.cjs --workers 2 --output /tmp/issue-61-before.json
node scripts/benchmarks/manual-policy-timeline.cjs --workers 2 --compare /tmp/issue-61-before.json --output /tmp/issue-61-after.json
```

Those first elapsed builder readings were 35241/28418 ms before and 7201/5778 ms after; isolated readings were 43534/38104 ms before and 753/506 ms after. Their work counters matched the CPU benchmark. The later CPU readings are the basis for the CPU improvement claim.

## Validation receipts

All commands ran in this bound worktree with synthetic fixtures and offline tests.

| Command                                                                                                                                            | Exit | Result                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ----------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                   |    0 | Lockfile unchanged; 1,219 packages installed                                  |
| `pnpm --filter @investment-sync/portfolio-domain exec vitest run src/sourceSnapshots.test.ts --maxWorkers=2 --minWorkers=1`, before implementation |    1 | 7 passed, 1 failed; unchanged stock key reads 832 exceeded the bound of 128   |
| Same focused command, after implementation                                                                                                         |    0 | 8 passed, 0 skipped                                                           |
| `pnpm --filter @investment-sync/portfolio-domain exec vitest run --maxWorkers=2 --minWorkers=1`, after strengthened decimal coverage               |    0 | 3 files, 50 passed, 0 skipped                                                 |
| `pnpm --filter @investment-sync/portfolio-domain typecheck`                                                                                        |    0 | Direct Rust compiler check                                                    |
| `pnpm --filter @investment-sync/portfolio-domain lint`                                                                                             |    0 | Direct ESLint check                                                           |
| `pnpm exec turbo lint typecheck --concurrency=2`                                                                                                   |    0 | 16 tasks successful, 14 cache hits; existing web image warning in cached logs |
| `pnpm --filter @investment-sync/backend exec vitest run --maxWorkers=2 --minWorkers=1`                                                             |    1 | 13 files; 137 passed, 8 timed out, 0 skipped                                  |

The initial test-authoring run also caught an incorrect expectation that a selected zero-valued USD row should disappear. The corrected test preserves that currency and separately checks removal of a reported valuation currency. Initial implementation typechecking caught use of the cloned decimal constructor as a type; `InstanceType` corrected it. Initial benchmark lint caught a redeclared global `performance`; the redundant import was removed.

Backend timeout follow-ups used the existing timeout values and did not edit test configuration:

```sh
pnpm --filter @investment-sync/backend exec vitest run convex/imports.test.ts convex/manualPolicies.test.ts convex/migration.test.ts convex/publication.test.ts convex/publicationReadBudget.test.ts --maxWorkers=1 --minWorkers=1 -t 'rejects an oversized parsed file|accepts 1100 normalized rows|checks downloaded bytes|publishes exact values to all portfolio views|keeps same-name policies distinct|rejects changed pending normalized rows|publishes atomically, preserves immutable facts|rejects accumulated large metadata'
pnpm --filter @investment-sync/backend exec vitest run convex/publication.test.ts --maxWorkers=1 --minWorkers=1 -t 'publishes atomically, preserves immutable facts and replays the original result'
```

The eight-test retry exited 1: 7 passed, 1 timed out, 63 skipped by the explicit name filter. Only the publication-capacity test still exceeded its existing 30-second timeout. Running that test alone, after this thread's benchmarks finished, also exited 1: 1 timed out, 18 skipped by the filter. Its builder completed in 766 ms; the complete staged-publication test exceeded its timeout. This remains a local validation limitation, not a passing backend suite. There was no assertion mismatch in these runs. CI must verify the complete backend suite on its runner.

Final direct checks all exited 0:

```sh
pnpm --filter @investment-sync/portfolio-domain typecheck
pnpm --filter @investment-sync/backend typecheck
pnpm exec eslint packages/portfolio-domain/src/sourceSnapshots.ts packages/portfolio-domain/src/sourceSnapshots.test.ts scripts/benchmarks/manual-policy-timeline.cjs
pnpm exec prettier --check packages/portfolio-domain/src/sourceSnapshots.ts packages/portfolio-domain/src/sourceSnapshots.test.ts scripts/benchmarks/manual-policy-timeline.cjs docs/performance/manual-policy-timeline.md
git diff --check
```

A read-only review found no correctness defect and requested the stronger nonempty-accumulator decimal cancellation test and process CPU measurements, both incorporated above. The final diff includes only the domain implementation, domain regressions, benchmark driver, and this evidence note.

PostgreSQL integration suites were not run locally because this agent cannot access the Docker socket and sudo requires a password. No SQL success is claimed; main CI provides a PostgreSQL service. No browser/native test, deployment, production operation, or real financial fixture was used. The two concurrent benchmark processes certify independent local computations, not database transaction concurrency.
