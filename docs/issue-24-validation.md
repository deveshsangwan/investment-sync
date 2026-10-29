# Issue 24 validation

Validated in the issue worktree against base `73930483798f2cfd7fe68b8069810ffcf99ee3f8`. All data used by tests is synthetic. No deployment, production operation, browser session, native session, external email, or credential copy was performed.

## Final receipts

| Command                                                                                                                                         | Exit | Result                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                | 0    | Workspace installation; no lockfile resolution changes                                        |
| `pnpm --filter @investment-sync/backend exec convex codegen --system-udfs --typecheck disable`                                                  | 0    | Bundled offline API generator; no deployment contacted                                        |
| `pnpm --filter @investment-sync/backend exec vitest run --pool=threads --maxWorkers=1 --minWorkers=1 --testTimeout=120000`                      | 0    | 155 tests, 14 files, no skips                                                                 |
| `pnpm --filter @investment-sync/web exec vitest run --pool=threads --maxWorkers=1 --minWorkers=1 --testTimeout=120000`                          | 0    | 73 tests, 11 files, no skips                                                                  |
| `pnpm --filter @investment-sync/portfolio-domain test`                                                                                          | 0    | 50 tests, 3 files, no skips                                                                   |
| `pnpm test:migration-tools`                                                                                                                     | 0    | 69 passed, 1 skipped, 70 total                                                                |
| `pnpm --filter @investment-sync/backend lint`                                                                                                   | 0    | No findings                                                                                   |
| `pnpm --filter @investment-sync/web lint`                                                                                                       | 0    | One existing `instrument-mark.tsx` image warning; no errors                                   |
| `pnpm --filter @investment-sync/portfolio-domain lint`                                                                                          | 0    | No findings                                                                                   |
| `pnpm --filter @investment-sync/backend typecheck`                                                                                              | 0    | Rust TypeScript checker                                                                       |
| `pnpm --filter @investment-sync/web typecheck`                                                                                                  | 0    | Rust TypeScript checker                                                                       |
| `pnpm --filter @investment-sync/portfolio-domain typecheck`                                                                                     | 0    | Rust TypeScript checker                                                                       |
| `NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk pnpm --filter @investment-sync/web build` | 0    | Offline Next build with a fake Clerk hostname, 14 static pages; no live authentication tested |
| `pnpm format:check`                                                                                                                             | 0    | Repository formatting                                                                         |
| `git diff 7393048 --check`                                                                                                                      | 0    | No whitespace errors                                                                          |
| `pnpm test:db:integration`                                                                                                                      | 1    | Failed in Docker setup; no SQL integration tests executed                                     |
| `docker info --format '{{.ServerVersion}}'`                                                                                                     | 1    | Permission denied connecting to `/var/run/docker.sock`                                        |

The migration skip is `old Postgres schema replays expired rows and new identities atomically, reconciles exact facts, and refuses divergence`, gated by `ROLLBACK_TEST_DATABASE_URL`. No local SQL test URL was available. The repository's unchanged CI provisions PostgreSQL and runs these retained paths; this receipt does not claim the PR's CI result.

The ordinary `convex codegen --typecheck disable` attempt exited 1 because no deployment was selected. An attempt using the explicit loopback URL `http://127.0.0.1:1` and the dummy key `offline-placeholder` also exited 1 because no backend was listening. The offline command above regenerated API bindings; existing platform environment declarations were retained. No cloud credentials or local backend were needed.

## Regression coverage

- Verified-email-bound, hashed, single-use invitations; incorrect identity, unverified email, signed-out access, expiry boundary, replacement, revocation, replay, and migration freeze.
- Already-provisioned invitee preserves their original household and account data and can switch back. Acceptance updates the recorded email from the verified identity.
- Server owner/viewer/foreign-household guards; safe removal and fallback household; pending-link revocation on removal; deliberate ownership transfer; transfer rejected during publication; audit records.
- Independent concurrent redemption calls, acceptance versus revocation, and two competing ownership transfers. These run actual Convex functions through separate authenticated clients in `convex-test`; they do not establish live cloud concurrency behavior.
- Rename preserves import identity and later imports; archive immediately changes account lists, holdings, dashboard, class views, and holding details; immutable source/history rows remain unchanged; unarchive restores totals and display names.
- Archival preserves selected source overlap rules, decimal native totals, duplicate transaction occurrences across reimports, and the latest visible valuation date. Publication capacity/read-budget regressions are covered by the full backend suite.
- DOM interaction tests cover link creation/revocation, explicit acceptance and retry, viewer controls, typed transfer confirmation, confirmed removal, rename/archive/unarchive. No browser or Clerk sign-in flow was exercised.

Initial runs on the shared host encountered five-second test timeouts and worker RPC timeouts while load exceeded 90 and swap usage reached about 14 GB. Full reruns above passed with one worker. The broader suite also caught and drove fixes for redundant snapshot-order bytes exceeding the publication budget and stale mock/React rendering assumptions. Only the final receipts above are counted as passing.

## Release constraints

See [household-sharing.md](./household-sharing.md) for the signed `email` / `email_verified` Clerk claim prerequisite, capacities, existing-member behavior, and account visibility rules. Live Clerk configuration has not been inspected or changed. A fake development identity must confirm those claims before invitation redemption is enabled in a deployment. Archived reads decode the bounded active projection and cost more than ordinary indexed reads. Unscoped reported portfolio valuations are replaced with visible holding history while any account is archived.
