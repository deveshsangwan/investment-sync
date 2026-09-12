# Phase 1 cloud development verification

Date: 2026-09-12

Status: backend connected and deployed; real browser sign-in verified, but its email claim and the remaining external gates are pending. This does not close Phase 1 or authorize production migration.

Review base: `d838924`, with a clean tracked working tree before this setup. The repository changes are this record, the additional-claims setup instructions, and `.github/workflows/convex-development.yml`.

## Connected environment

- Team: `dev-sangwan2001`.
- Project: `investment-sync`.
- Development deployment: `hardy-barracuda-115`.
- Client URL: `https://hardy-barracuda-115.convex.cloud`.
- Region: US East, North Virginia, as shown in the owner's dashboard screenshot. The billing tier and production deployment relationship have not been independently confirmed. Ordering deviation: the owner had already created the project before its tier capabilities were recorded, contrary to the plan's intended order. This setup connected that existing project; it did not resolve or waive the capability gate.
- `APP_ENV=development`; the configured Clerk issuer matches the local development publishable key. Both local Clerk keys are development keys, and the local web database URL points to localhost.

CLI login saved account credentials successfully, then exited nonzero because it could not interactively ask whether to link the old anonymous deployment. A separate `convex login status` confirmed login. The old anonymous deployment was not linked or migrated. Explicit selection of `dev-sangwan2001:investment-sync:dev` resolved to the cloud development deployment above.

Only ignored local configuration changed: `packages/backend/.env.local` now selects cloud development, and `apps/web/.env.local` gained its public Convex URL. Existing Clerk and Postgres settings were preserved. No production configuration was changed.

## Verification receipts

- `pnpm --filter @investment-sync/backend exec convex dev --once`: exit 0, explicitly identified the development deployment above, installed the schema indexes, and reported functions ready.
- Separate targeted `convex env get` commands confirmed `APP_ENV` and the Clerk issuer. No secret values were logged.
- The development database contained no users, Households, or memberships before the test.
- An isolated browser loaded the local landing page and Clerk sign-in page. The sign-in page showed Google sign-in and no captured browser errors. An initial screenshot preceded client initialization and was blank; the subsequent rendered page was verified. The server logged an initial Clerk handshake warning, so the unauthenticated page check is not being treated as proof of authenticated sign-in.
- A one-off Node check used twelve concurrent `ConvexHttpClient.mutation` calls with `skipQueue: true` and one fresh fake identity. All returned the same user ID. An indexed read-only query confirmed exactly one user, one owned Household, and one membership. `users.current` returned owner role and the expected Household name.
- This concurrency test used development admin impersonation, not a real Clerk JWT. It exercises cloud mutation concurrency but does not establish that a conflict/retry occurred or prove browser authentication. The three obviously fake fixture documents remain in development, identified by subject `user_fake_phase1_concurrency_1789214775810`. Real sign-in verification excludes this fixed baseline.
- Cloud `pnpm --filter @investment-sync/backend codegen` passed using a dedicated development deploy key. Formatting generated files and checking both tracked diffs and untracked generated files reported no drift.
- Backend test, lint, and typecheck passed. The test suite has 23 passing tests.
- Public cloud `users.current` and `users.ensureCurrent` calls without authentication both rejected with `UNAUTHENTICATED`.
- The owner confirmed successful real browser sign-in. The local server recorded successful dashboard and Postgres API responses. A read-only cloud check found exactly one non-fixture user, one owned Household, and one correctly linked owner membership. The Household name is present, but the email is missing. The owner has been asked to add the email shortcode to the development Clerk session claims and sign in again. No user email or token was copied into this record.

## Trusted codegen workflow

The reviewed workflow runs only for `main`, on push or manual dispatch, and has no pull-request trigger. Credential confinement is enforced separately by the GitHub environment `convex-development`: its custom deployment policy permits only the branch `main`, with no tag rules. The job declares this environment, so an edited workflow on another ref cannot obtain its secret merely by removing the in-file condition. Environment configuration and its sole `main` branch rule were read back through the GitHub API. Checkout does not retain Git credentials, workflow permissions are read-only, and the deploy key is exposed only to the final codegen step, after dependency installation. All three actions are pinned to the commit IDs resolved from their v6 tags.

That step rejects any key not scoped to `dev:hardy-barracuda-115`, generates bindings without deploying application code, formats them, and checks tracked changes and newly generated files. It cannot select a production target through this credential.

A dedicated deploy key named `github-development-codegen-main` was created for this development deployment and stored as environment secret `CONVEX_DEV_DEPLOY_KEY` inside `convex-development`. Its value was passed directly in memory to GitHub, not printed or written to a repository file. The initial repository-scoped secret was removed and its earlier development key revoked after the protected replacement passed cloud codegen. Read-back checks confirmed the environment secret exists and there are no repository-scoped secrets. This is an administrative credential for development, not a read-only credential; keep it limited to trusted code and revoke it when the workflow is retired.

The equivalent codegen and drift checks passed locally. The GitHub workflow itself has not run: it is not yet published on `main`. No push or merge was performed.

The workflow's shell block passed `bash -n`. Executing its actual key guard with dummy inputs accepted the expected development prefix and rejected production, another development deployment, and an unset key. New untracked bindings are reported by filename before the check fails.

## Independent review

Claude Code confirmed model `claude-opus-5` and approved committing the initial setup files with Phase 1 open, conditional on fixing credential confinement before publication. The follow-up changes address that concern with a server-enforced environment policy, corrected security claims, clearer tier and profile gates, explicit fake-fixture baseline, diagnostic output, and SHA-pinned actions. The targeted follow-up, again confirmed as `claude-opus-5`, approved the three setup files with no blocking findings. Its optional recommendation to let pnpm/action-setup read the root `packageManager` field was applied, avoiding a second potentially conflicting version input. Final documentation and that version-input simplification were applied after approval.

## Remaining gates

- Complete the email-claim setup, confirm the actual profile claim shape and displayed email/name, and verify repeat real sign-in saves the email without adding duplicate users or Households.
- Owner-selected billing tier, required preview-deployment support, backup retention sufficient for the seven-day rollback window, concurrency class, and the existing production deployment relationship, all verified without production writes.
- Actual trusted GitHub workflow execution after the reviewed workflow reaches `main`.

The application still reads portfolio data through the existing Postgres backend. No production code or data was written, no production imports were run, and Phase 2 implementation has not started in this setup step.
