# Missing holding P&L: issue 60

## Behavior

A holding with invested amount `100`, current value `125`, and no source
`pnlAmount` previously produced overview gain `25` / `25%`, but asset-class
gain `0` / `0%`.

`nativeTotals` now derives each absent P&L as exact decimal current value minus
invested amount, then sums by native currency. Reported P&L takes precedence,
including `"0"`. Immutable facts and holding rows retain the original optional
field. Derivation does not invent a reported value in source snapshots.

Overview and asset-class totals reconcile when reported P&L agrees with the
source invested/current amounts. An inconsistent explicit report still takes
precedence in asset-class P&L. For example, reported zero with invested `100`
and current `125` stays zero in the asset-class view, while overview retains
its existing value-difference gain of `25`.

## Existing Convex publications

Changing the writer alone does not fix active publications already stored in
Convex. Asset-class detail now recomputes native totals from its selected current
holding rows before currency conversion. Those rows are already loaded through
the authenticated household's active version. This adds no database queries,
changes no source selection, and writes no data.

This read path also covers publications created before the fix. No republish or
migration is required for corrected public asset-class summaries once this code
is released through the normal deployment process. Stored historical documents,
version digests, receipts, and cached totals remain unchanged. A subsequent
ordinary publication uses the corrected writer. Consumers inspecting old stored
native totals directly will still see the old values; this read correction is
for public valuation, not a storage backfill.

No deployment, production run, schema change, or binding regeneration was
performed. Recovery and migration tools remain in place. Cross-account selection
and realized-sale ingestion are outside this change.

## Regression coverage

- Gains, losses, zero, mixed reported/absent values, and explicit zero.
- Decimal subtraction beyond Float64 precision, with fractional positive and
  negative contributions.
- Per-currency native totals and supported INR/USD conversion.
- Publication reconciliation and snapshot timeline native totals.
- Public Convex queries after a real synthetic publication, then again after
  replacing only cached P&L totals with the pre-fix values. Independent overview,
  asset-class, and positions queries run together with `Promise.all`.
- Public reads preserve source P&L values, holding snapshots, positions, the
  active version, version metadata, and stored summaries.

## Validation

All data used here is generated. SQL checks use a dedicated loopback PostgreSQL
17.11 cluster under `/tmp/issue60-postgres` on port `55460`, because this user
cannot access Docker's socket. CI uses PostgreSQL 16. No other checkout or test
cluster was changed.

The command receipts below distinguish focused green tests from incomplete broad
runs. The fourteen added regressions passed. No browser or native-device testing
was performed.

| Command                                                                                                                                    | Exit | Result                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                                                                           | 0    | Lockfile unchanged.                                                                                                                                          |
| `pnpm --filter @investment-sync/portfolio-domain test -- src/sourceSnapshots.test.ts src/publication.test.ts` before the fix               | 1    | 7 failed, 50 passed, 0 skipped. The gain reproduction expected `25` / `25%` but received `0` / `0%`. The script's `--` caused all three domain files to run. |
| `pnpm --filter @investment-sync/portfolio-domain test` after the writer fix                                                                | 0    | 57 passed, 0 skipped.                                                                                                                                        |
| `pnpm --filter @investment-sync/backend exec vitest run convex/portfolio.test.ts -t 'serves corrected'` before the read correction         | 1    | 3 failed, 2 passed, 16 filtered out. Only stale gain/loss/mixed summaries failed.                                                                            |
| `pnpm --filter @investment-sync/backend exec vitest run convex/portfolio.test.ts -t 'serves corrected' --silent` after the read correction | 0    | 5 passed, 16 filtered out.                                                                                                                                   |
| `pnpm lint`                                                                                                                                | 0    | 8 successful tasks, 6 cached. One existing web `<img>` warning; zero errors.                                                                                 |
| `pnpm typecheck`                                                                                                                           | 0    | 8 successful tasks using `tsc-rs`, 6 cached.                                                                                                                 |
| `pnpm format:check`                                                                                                                        | 0    | Repository formatting passed.                                                                                                                                |
| `git diff --check`                                                                                                                         | 0    | No whitespace errors.                                                                                                                                        |

SQL preparation, exit 0:

```sh
DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test pnpm --filter @investment-sync/db migrate
```

The ordinary parallel workspace command below exited 1 on the existing SQL NPS
migration test's five-second timeout. Turbo interrupted the remaining suites.

```sh
DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test TEST_DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test pnpm test
```

A serial workspace retry used longer CLI timeouts without editing repository
configuration. It exited 1 on the publication-capacity test's explicit
30-second timeout. Backend finished with 149 passed, 1 timed out, 0 skipped.
The fourteen new regressions passed in this run. Web passed 67, domain 57,
analytics 21, importers 73, and SQL migration 1, with zero skipped tests in
those packages. Mobile has no test files. Turbo stopped before completing API.

```sh
DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test TEST_DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test pnpm exec turbo test --concurrency=1 -- --testTimeout=30000 --hookTimeout=30000
```

Migration-tool validation used only the dedicated local cluster. The initial
`pnpm test:migration-tools` invocation used a passwordless test URL. Its guarded
rollback CLI correctly rejected that URL, giving 67 passed / 3 failed / 0 skipped.
After supplying an arbitrary fake password, the serial run below passed 68 of
70 tests, including real SQL reverse replay, divergence rejection and concurrent
writer fencing. Two unchanged fixture-generator tests hit their fixed
10-second subprocess limit, exiting with status 143 instead of the expected
validation status 1. The suite exited 1 with no skips. An isolated retry of
`node --test scripts/convex-migration/generate-rehearsal-fixture.test.cjs` also
exited 1 with both tests timing out. These remain validation limitations; no
timeout or guard was weakened.

```sh
ROLLBACK_TEST_DATABASE_URL=postgresql://issue60:fake-test-only@127.0.0.1:55460/investment_sync_rollback_issue60 node --test --test-concurrency=1 scripts/convex-migration/*.test.cjs
```

An independent read-only review found no substantive issues in the final code
and tests.

The capacity test also timed out when retried alone with one worker, exit 1,
1 timed out and 18 filtered out. The fixture's holding rows report their P&L
explicitly, so they do not execute the new subtraction fallback. The machine's
observed load average exceeded 70 during these runs. This is not a green
capacity receipt and should be rerun in CI.

```sh
pnpm --filter @investment-sync/backend exec vitest run convex/publication.test.ts -t 'publishes atomically, preserves immutable facts and replays the original result' --maxWorkers=1 --minWorkers=1 --silent
```

The standalone API run below exited 1 with 149 passed / 21 failed / 0 skipped.
All failures were the old parity oracle requiring legacy zero P&L. The other
12 API files passed all 141 tests, including real concurrent SQL imports and
Household authorization.

```sh
DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test TEST_DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test pnpm --filter @investment-sync/api exec vitest run --no-file-parallelism --testTimeout=30000 --hookTimeout=30000
```

The parity oracle now adjusts only summary P&L amount and percentage when SQL's
selected rows omit P&L. It derives the expected result independently with decimal
arithmetic; every other field still compares to SQL. Complete reported P&L
retains the original full-parity assertion. A new regression explicitly checks
legacy gain zero versus corrected gain `25` / `25%`, with the optional source
field still null. SQL runtime and mobile behavior are unchanged.

After that test update, the focused SQL parity command below exited 0 with
30 passed / 0 skipped. Together with the 141 unchanged tests above, all 171 API
tests have passing receipts. There was no single green full-workspace run.

```sh
DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test TEST_DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test pnpm --filter @investment-sync/api exec vitest run src/services/portfolio/publication-parity.integration.test.ts --no-file-parallelism --testTimeout=30000 --hookTimeout=30000
```

`pnpm --filter @investment-sync/api typecheck` and
`pnpm exec eslint packages/api/src/services/portfolio/publication-parity.integration.test.ts`
both exited 0 after the oracle update. The independent follow-up review found no
issues with the explicit parity correction. There are fifteen new regression
cases in total.

Final `pnpm typecheck` exited 0 with 8 successful tasks, 7 cached. The dedicated
issue-60 PostgreSQL cluster was stopped successfully after SQL checks. Final
tracked/untracked diff review found only this issue's source, tests, and record.

## Main integration on 2026-10-31

Merged `origin/main` at `03591e2503c985d41a4f5a9d0e7c2b31eaf2b414`
with an ordinary merge commit. The sole textual conflict appended tests to
`convex/portfolio.test.ts`; both complete test blocks and existing helpers were
retained. All changes from PRs 62 through 67 remain in the merge ancestry.

The incremental currency updater already calls `nativeTotals` for each added or
removed contribution. It therefore uses the same exact missing-P&L fallback.
No additional runtime change was needed. New tests check gain-to-loss updates,
complete omission and re-entry in one account while an independent account with
the same instrument retains reported zero, USD policy losses becoming gains,
and reported valuation mode. They compare six explicit decimal checkpoints and
full-history reference selection in forward and reverse input order. A public
Convex case also checks independent same-instrument accounts, INR/USD conversion,
and a contradictory explicit zero, before and after replacing cached summaries
with old totals.

The first new test draft assumed a policy changing currency kept the same
instrument identity. The domain deliberately includes currency in that identity;
the fixture was corrected to update a policy within USD. No selection behavior
or test guard was changed to accommodate that mistaken assumption.

These latest receipts supersede the earlier timeouts for the suites below.
There are seventeen new regression cases in this PR, including the two
integration cases. SQL used only the same disposable fake-data local cluster.

| Command                                                                                                                                                                                                                                                                     | Exit | Result                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `pnpm --filter @investment-sync/portfolio-domain test`                                                                                                                                                                                                                      | 0    | 66 passed, 0 skipped.                                                                           |
| `pnpm --filter @investment-sync/backend test`                                                                                                                                                                                                                               | 0    | 174 passed, 0 skipped, including the existing publication-capacity test.                        |
| `DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test TEST_DATABASE_URL=postgresql://issue60@127.0.0.1:55460/issue60_test pnpm --filter @investment-sync/api exec vitest run src/services/portfolio/publication-parity.integration.test.ts --no-file-parallelism` | 0    | 33 passed, 0 skipped, including concurrent independent account updates.                         |
| `ROLLBACK_TEST_DATABASE_URL=postgresql://issue60:fake-test-only@127.0.0.1:55460/investment_sync_rollback_issue60 node --test --test-concurrency=1 scripts/convex-migration/*.test.cjs`                                                                                      | 0    | 70 passed, 0 skipped, including both previously timed-out fixture guards and real SQL recovery. |
| `pnpm lint`                                                                                                                                                                                                                                                                 | 0    | 8 successful tasks, 5 cached; one existing web image warning, no errors.                        |
| `pnpm typecheck`                                                                                                                                                                                                                                                            | 0    | 8 successful tasks, 5 cached.                                                                   |
| `pnpm format:check`                                                                                                                                                                                                                                                         | 0    | Whole repository passed.                                                                        |
| `git diff --check`                                                                                                                                                                                                                                                          | 0    | No whitespace errors.                                                                           |

Final integrated-head GitHub CI and review evidence are recorded in PR 68 and
the merge-queue completion message, rather than predeclared here.
