# Issue #58 validation

Validation used synthetic fixtures in this thread's worktree, based on
`73930483798f2cfd7fe68b8069810ffcf99ee3f8`. No production access, deployment,
credentials, real financial fixtures, schema change, or codegen was needed.

## Focused checks

| Command                                                                                                                                                             | Exit | Result                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                    | 0    | Lockfile reproducible after dependency changes |
| `pnpm --filter @investment-sync/mobile test`                                                                                                                        | 0    | 25 tests, 3 files, no skips                    |
| `pnpm --filter @investment-sync/mobile typecheck`                                                                                                                   | 0    | Includes provider and test types               |
| `pnpm --filter @investment-sync/mobile lint`                                                                                                                        | 0    | Entire mobile workspace                        |
| `pnpm --filter @investment-sync/backend typecheck`                                                                                                                  | 0    | Includes new backend regression                |
| `pnpm exec eslint packages/backend/convex/portfolio.test.ts`                                                                                                        | 0    | Backend test lint                              |
| `pnpm --filter @investment-sync/backend test convex/portfolio.test.ts convex/users.test.ts convex/manualPolicies.test.ts --testTimeout=30000 --no-file-parallelism` | 0    | 51 tests, 3 files, no skips                    |
| `pnpm --filter @investment-sync/backend test convex/portfolio.test.ts -t 'serves post-cutover' --testTimeout=30000`                                                 | 0    | New regression: 1 passed, 16 filtered/skipped  |
| `node_modules/.bin/prettier --check apps/mobile README.md docs/mobile-convex.md packages/backend/convex/portfolio.test.ts`                                          | 0    | Formatting                                     |
| `git diff --check`                                                                                                                                                  | 0    | No whitespace errors                           |

Session tests mount the actual mobile provider and Convex Clerk adapter with a
fake transport. They check the explicit endpoint, JWT audience and forced
refresh, authentication before provisioning, provisioning before private
content, user/session changes, stale responses, sign-out disposal, auth loss,
Strict Mode effect replay, foreground recovery, reconnect text, and retry after
auth/provisioning/query failures. Screen contract tests check overview summary,
current-only holdings, server INR conversion, account-specific IDs, unavailable
returns, and loading versus empty data.

The backend regression stages normalized synthetic import rows through Convex
import functions, publishes them, and creates/updates a manual policy. It reads the same public
queries used by mobile, provisions an existing and a new identity concurrently
with `Promise.all`, and reads both households independently. It checks exact
decimal strings, unchanged imported snapshots, updated policy values, empty
new-household views, and anonymous rejection with source SQL writes paused.

## Retained SQL checks

Only this thread's disposable database was used:
`postgresql://investment_sync@127.0.0.1:55418/issue58_audit_test`. The server is
PostgreSQL 17.11 with local trust authentication and synthetic test fixtures.
The server/data-directory lifecycle is left to the parent thread.

| Command                                                                                                                                                                                                                             | Exit | Result                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------- |
| `DATABASE_URL=postgresql://investment_sync@127.0.0.1:55418/issue58_audit_test pnpm --filter @investment-sync/db migrate`                                                                                                            | 0    | Migrations applied                                       |
| `TEST_DATABASE_URL=postgresql://investment_sync@127.0.0.1:55418/issue58_audit_test pnpm --filter @investment-sync/api test --testTimeout=30000`                                                                                     | 1    | 168 passed, 2 timed out, 170 tests in 13 files, no skips |
| `TEST_DATABASE_URL=postgresql://investment_sync@127.0.0.1:55418/issue58_audit_test pnpm --filter @investment-sync/db test --testTimeout=30000`                                                                                      | 0    | 1 passed, no skips                                       |
| `TEST_DATABASE_URL=postgresql://investment_sync@127.0.0.1:55418/issue58_audit_test pnpm --filter @investment-sync/api test src/services/currency-rates.test.ts src/services/import-service.integration.test.ts --testTimeout=30000` | 0    | Both affected files: 35 passed, no skips                 |

The API timeouts were the normalized-row-limit test and the first persisted-FX
quote test. Both passed on the targeted rerun without code/assertion changes.
The 30-second CLI override was used for the contended audit host, not committed
to test configuration. One early DB run was stopped before results because the
API suite was still active; the successful DB and API retry runs were serial.

## Android packaging and limits

The following command exited 0 and emitted one 3.96 MB Hermes Android bundle and
metadata outside the repository:

```sh
CI=1 EXPO_PUBLIC_CONVEX_URL=https://fake-deployment.convex.cloud EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk pnpm --filter @investment-sync/mobile exec expo export --platform android --output-dir /tmp/issue58-android-export-final --max-workers 2
```

Those values are fake public build configuration. This checks native bundle
resolution, not a running device or live Clerk/Convex session. No simulator,
Android emulator, browser session, or production import was exercised. A release
must be built with the exact active Convex URL and matching Clerk instance.
See [configuration and #23 integration notes](mobile-convex.md).

## Broad Convex runs under contention

The final single-worker run passed all 146 tests in 13 files with no skips:
`pnpm --filter @investment-sync/backend test --testTimeout=30000 --maxWorkers=1 --minWorkers=1`
(exit 0, 138.47 seconds). The publication-capacity test passed unchanged.

Earlier runs are retained here to distinguish timeouts from successful checks.

| Command                                                                                                                                                                          | Exit | Result                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------- |
| `pnpm --filter @investment-sync/backend test --testTimeout=30000`                                                                                                                | 1    | 145 passed, 1 timed out, no skips (13 files, 146 tests) |
| `pnpm --filter @investment-sync/backend test convex/publication.test.ts --testTimeout=30000 --no-file-parallelism`                                                               | 1    | 18 passed, 1 timed out, no skips                        |
| `pnpm --filter @investment-sync/backend test convex/publication.test.ts -t 'publishes atomically, preserves immutable facts' --testTimeout=180000 --maxWorkers=1 --minWorkers=1` | 1    | 1 timed out, 18 filtered/skipped                        |

Each timeout above was the unchanged publication-capacity test. It declares its
own hardcoded 30-second limit, so the larger CLI timeout did not override it.
Assertions, capacity, and source timeouts were left unchanged. Host load exceeded
100 and substantial swapping occurred during the audit; these timed-out runs
are not reported as passes.

## Sequential merge integration, 2026-10-31

Merged `origin/main` at `f650d38536f78d0b7e665a22e82a2b13c2cd18a4` using an
ordinary merge, commit `6e1196d`. The only textual conflict was in
`packages/backend/convex/portfolio.test.ts`. The resolution keeps the complete
upstream suite byte-for-byte, adds the native-session regression and its env
teardown, and retains every upstream import/helper. This preserves #66's
account-aware tests and #68's new and persisted missing-P&L tests. All reviewed
mobile runtime files are unchanged from `ccfb17c`.

The session test helper now settles provisioning promises inside async `act`,
including checking the exact fake rejection message. This removes the observed
unwrapped-update warnings without changing any session behavior or assertion.
The renderer deprecation notice remains. No warnings were suppressed.

| Command                                                                                                                                                                                           | Exit | Result                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                                                  | 0    | Supply-chain policy verification passed for 1406 entries; lockfile unchanged      |
| `pnpm --filter @investment-sync/mobile test`                                                                                                                                                      | 0    | 25 passed in 3 files, no skips; no unwrapped-update warnings after the helper fix |
| `pnpm --filter @investment-sync/backend test convex/portfolio.test.ts convex/users.test.ts convex/manualPolicies.test.ts convex/errors.test.ts --testTimeout=30000 --maxWorkers=1 --minWorkers=1` | 0    | 62 passed in 4 files, no skips                                                    |
| `pnpm --filter @investment-sync/mobile --filter @investment-sync/backend typecheck`                                                                                                               | 0    | Both workspaces pass                                                              |
| `pnpm --filter @investment-sync/mobile lint && pnpm exec eslint packages/backend/convex/portfolio.test.ts`                                                                                        | 0    | Affected workspaces/files pass                                                    |

These checks include the retained account/P&L suites and current safe-error
contracts. Final-head CI is required before the merge and is recorded on PR #71.
No local SQL resources, production configuration, deployment or live/device
session was used for this integration. The original testing limits still apply.

PR #73 contains the old #71 head. Its owner must merge updated main before
verification, preserve both mobile test commands and native Convex transport,
and retain the async `act` corrections when reconciling the session test file.
