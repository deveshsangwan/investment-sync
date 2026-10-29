# Duplicate import identity audit

Issue [#19](https://github.com/deveshsangwan/investment-sync/issues/19) was audited against `73930483798f2cfd7fe68b8069810ffcf99ee3f8`. The runtime protections are already implemented. This change adds missing regression coverage and clarifies the glossary; it does not change import behavior.

## Identity and reprocessing

The key is `(household, SHA-256(original source bytes), parser version)`. Renaming a file or changing its uploader does not change the key. A new parser version permits reprocessing the same bytes. Another household has an independent key.

Multiple uncommitted batches may share a key. Only a successful commit consumes it. Failure leaves the key available for either the original batch or another batch. Repeating commit on the committed batch returns its original result. A different batch with the consumed key receives a duplicate conflict.

## Existing protections

- PostgreSQL migration `0007_committed_import_dedupe.sql` creates the partial unique index `import_batches_committed_file_parser_idx` for committed batches. Its migration guard refuses preexisting committed duplicates. `commitImport` also takes a transaction advisory lock before checking identity and writing portfolio records. The preflight lookup filters household, hash, version, and committed status before `limit(1)`; it has no ten-row history dependency. The exact unique violation maps to `ImportConflictError("Duplicate Import")`.
- The active Convex web backend checks `importDedupeKeys` through its household/key index during parse finalization, commit admission, and publication finalization. The household publishing slot prevents different batches from publishing simultaneously. Finalization writes the dedupe key, immutable source facts, committed status, and active version in one mutation. Failure rolls those writes back before releasing the slot.

Generic batch transitions remain outside this audit and belong to #18. The SQL/mobile path and migration/recovery tooling are retained unchanged.

## Regression coverage

`packages/api/src/services/import-dedupe.integration.test.ts` uses a separate real PostgreSQL connection for each competing operation and verifies distinct `pg_backend_pid()` values. It covers concurrent uploads of identical bytes with different names, concurrent commits after twelve historical attempts, stable winner/loser retries, a direct concurrent unique-index race without the service lock, parser-version reprocessing, household isolation, and failure followed by a competing batch's successful commit. Storage is fake; parsing and database operations are real.

`packages/backend/convex/importDedupe.test.ts` exercises actual upload reservation, attachment, parser actions, and publication actions against convex-test. It covers overlapping different batches, duplicate conflicts after publication, twelve earlier batches, parse retries, parser-version and household boundaries, retained source facts and decimal strings, and rollback after finalization has attempted to write the dedupe key. Both the original batch and a competing batch can retry after that failure.

Convex-test serializes mutations. Its overlapping calls verify protocol behavior, not production OCC contention/retries. No deployment, production access, browser test, or native test was performed. No credentials or real financial fixtures were copied.

## Validation

All SQL runs use an isolated, user-owned PostgreSQL 16 server with fake data under `/tmp/issue-19-postgres`, not Docker or production.

The PostgreSQL server reports `postgres (PostgreSQL) 16.14`. Test URLs contain no secrets: `postgres://issue19@127.0.0.1:55439/issue19_test` for the full API run and `postgres://issue19@127.0.0.1:55439/issue19_focused` for isolated SQL rechecks. Both databases were freshly created and migrated with `DATABASE_URL=<test URL> pnpm --filter @investment-sync/db migrate`, exit 0.

| Command                                                                                                                                                                                                | Exit | Result                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                                                       | 0    | Lockfile unchanged                       |
| `pnpm --filter @investment-sync/backend exec vitest run convex/importDedupe.test.ts --maxWorkers=2 --minWorkers=1`                                                                                     | 0    | 5 passed, 0 skipped                      |
| `TEST_DATABASE_URL=postgres://issue19@127.0.0.1:55439/issue19_focused pnpm --filter @investment-sync/api exec vitest run src/services/import-dedupe.integration.test.ts --maxWorkers=2 --minWorkers=1` | 0    | 4 passed, 0 skipped                      |
| `TEST_DATABASE_URL=postgres://issue19@127.0.0.1:55439/issue19_focused pnpm --filter @investment-sync/db exec vitest run --maxWorkers=1 --minWorkers=1`                                                 | 0    | 1 passed, 0 skipped                      |
| `pnpm --filter @investment-sync/api typecheck`                                                                                                                                                         | 0    | `tsc-rs --noEmit`                        |
| `pnpm --filter @investment-sync/backend typecheck`                                                                                                                                                     | 0    | `tsc-rs --noEmit`                        |
| `pnpm --filter @investment-sync/backend exec vitest run --maxWorkers=2 --minWorkers=1`                                                                                                                 | 1    | 149 passed, 1 timeout, 0 skipped         |
| `TEST_DATABASE_URL=postgres://issue19@127.0.0.1:55439/issue19_test pnpm --filter @investment-sync/api exec vitest run --no-file-parallelism --maxWorkers=2 --minWorkers=1`                             | 1    | 169 passed, 5 timeouts, 0 skipped        |
| `pnpm --filter @investment-sync/backend exec vitest run convex/publication.test.ts -t 'publishes atomically, preserves immutable facts and replays the original result' --maxWorkers=1 --minWorkers=1` | 1    | 1 timeout, 18 excluded by test selection |

The unchanged publication capacity test timed out at its explicit 30-second limit in both the broad and isolated runs. The API timeouts were the unchanged large normalized-row rejection test and four unchanged FX tests. These runs occurred under heavy shared-host contention, with load average above 70 and about 8 GiB of swap in use. They are recorded as failures, not passes.

Exploratory checks also exposed fixture and lint mistakes in the new tests, corrected before final verification. Convex-test storage omits MIME metadata, so the fixture now uses the supported upload request without a MIME constraint. SQL PID results have an explicit database-result type; provenance assertions no longer assign an untyped Vitest matcher. The initial backend command `pnpm --filter @investment-sync/backend test -- convex/importDedupe.test.ts` unexpectedly ran the full suite, exit 1 with 144 passes and 6 failures, including five fixture failures and the unchanged capacity timeout. The initial focused command failed all five tests before that fixture correction. Initial API and backend lint each exited 1 with one test-only type-safety error.

A redundant focused SQL run was terminated before it reported any tests because it overlapped the full API database run. The successful four-test recheck used a separate freshly migrated database. Redundant lint runs were also terminated, and workspace checks were restarted with one task at a time to reduce resource use.

The longer API recheck also failed under worse contention: `TEST_DATABASE_URL=postgres://issue19@127.0.0.1:55439/issue19_focused pnpm --filter @investment-sync/api exec vitest run src/services/import-service.integration.test.ts src/services/currency-rates.test.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1 --testTimeout=60000`, exit 1. It reported 7 passes, 1 timeout, 0 skips, plus a suite collection failure while Vitest fetched the unchanged `packages/importers/src/nps.ts` module. The host then had load average above 120 and about 15 GiB of swap in use. No passing broad-suite claim is made.

`pnpm exec turbo lint --concurrency=1` was stopped with exit 143 after 16 minutes under that contention. It reported 6 successful cached tasks out of 8; the changed API/backend lint tasks did not finish. The cached web lint output contains the existing `@next/next/no-img-element` warning. Subsequent checks use a bounded Node heap for the changed files.

Final workspace typecheck: `pnpm exec turbo typecheck --concurrency=1`, exit 0, 8/8 tasks successful with 6 cached. Final formatting: `pnpm exec prettier --check CONTEXT.md docs/issue-19-duplicate-import-audit.md packages/api/src/services/import-dedupe.integration.test.ts packages/backend/convex/importDedupe.test.ts`, exit 0, all four files passed. `git diff --check` passed. The temporary PostgreSQL server was stopped after the SQL checks.

Final changed-file lint: `NODE_OPTIONS=--max-old-space-size=768 pnpm exec eslint packages/backend/convex/importDedupe.test.ts packages/api/src/services/import-dedupe.integration.test.ts`, exit 0, no warnings or errors.
