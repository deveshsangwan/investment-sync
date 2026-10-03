# Phase 7 production verification

The owner authorized preparing an inactive production Convex target and loading and comparing real source data on 2026-10-03. The initial comparison passed with zero unexplained differences. The owner separately approved enabling the production Clerk Convex integration, and actual authenticated native queries passed. The live website continues to use Postgres. Source writers have not been paused, traffic cutover is not authorized, and native application writes remain disabled.

The starting revision is `2af61e9f7015e09b7426aa72ba9de2040e82049a`. Tracked files were clean; existing untracked agent configuration and handoff files are unrelated. Opus is unavailable. New backend changes require two independent Codex reviews before deployment.

| Workstream                | Objective                                                                                                           | Assigned                                   | Files                                         | Completion criterion                                                                                   | Task ID                                                        | Status   | Receipts                                                                   | Findings                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Target setup              | Create an explicit inactive production deployment with the production issuer and migration freeze                   | Lead                                       | Protected operator artifacts                  | Production type, project, region and credentials verified; no live website changes                     | root                                                           | Verified | `.migration/phase7-production-setup/deployment-receipt.json`               | Production Vercel variables marked sensitive cannot be exported; issuer verified from the live public key and OIDC discovery |
| Backend readiness         | Complete recorded publication safety requirements and allow read-only provisioning for existing migrated users      | Codex workstream and independent reviewers | Backend functions and regression tests        | Required tests and checks pass; two independent reviews approve the complete change                    | phase7_backend_readiness, phase7_review_one, phase7_review_two | Verified | Reviewed revision `348920f`; 136 backend tests; workspace checks pass      | One nonblocking capacity-message suggestion remains before enabling imports                                                  |
| Initial source comparison | Copy a consistent real snapshot into the inactive production target and independently compare all records and views | Lead                                       | Protected snapshot, file and report artifacts | No unexplained differences; approved source anomalies recorded exactly                                 | root                                                           | Verified | `production-initial-20261003-report/reconciliation.json`; 734 native views | Zero unexplained differences; this is an initial comparison, not a final cutover certificate                                 |
| Production authentication | Enable the separately approved Clerk Convex integration and verify the owner's real session against native queries  | Lead                                       | Protected authentication receipt              | Correct issuer and audience; existing household resolves; public reads succeed; anonymous access fails | root                                                           | Verified | `.migration/phase7-production-setup/production-auth-receipt.json`          | Uses the normal Clerk session token; full native web-page smoke tests remain open                                            |

## Deployment boundary

The target is `prod:accurate-frog-976`, reference `migration-validation`, in project `dev-sangwan2001/investment-sync`, region `aws-us-east-1`, class `s16`. It is not the project's default production deployment. The existing personal development deployment `hardy-barracuda-115` remains selected locally. The live website is `portfolio.deveshsangwan.com`, serving Postgres revision `068e18f2fe4cad80abe19a1ddc5c94458d1664f2`.

All credentials, real records and comparison details remain in ignored `.migration` artifacts with restricted filesystem permissions. No real records enter development, preview or Git.

## Backend review and checks

Both independent reviewers approved the complete `2af61e9..348920f` tracked change. Review one reported no findings. Review two reported one nonblocking suggestion: separate combined household fact-capacity exhaustion from corrupted-manifest errors so a permanent capacity rejection does not suggest retrying. Data integrity is preserved and imports are disabled on this target; this presentation follow-up remains before enabling production imports. Neither review claims to certify the real-data comparison or authorize cutover.

The backend now has an indexed, bounded recurring publication-lease sweep with a missed-one-shot regression; actionable stale-lease and derived-size errors; sanitized publication failure messages; development-only metrics; retained active/base cleanup guards; and frozen provisioning that validates existing membership without profile writes. Unknown users and invalid memberships remain rejected. All 136 backend tests pass, as do workspace lint, typecheck, tests and all eight builds. Dedicated synthetic Postgres checks pass 136 API tests and the DB migration test. All 62 migration-tool tests pass with real local Postgres integration and no skips. The first integration attempt used a missing local test database; a fresh dedicated synthetic database was created and migrated before the successful run.

Production deploy and codegen passed using an explicitly scoped production deploy key. The first attempt rejected a temporary admin credential before making deployment changes; the successful receipt is `.migration/phase7-production-setup/deployment-receipt.json`. The personal development selection and generated bindings remain unchanged.

An initial read-only public-schema backup is saved at `.migration/phase7-initial-source-backup/public.dump`, with digest `1bac40e7272f2901467da4d9c9d4cabc80d48a45f0d5a57d1b05c2f4b82d4cf0`. Dump and archive-list commands exited 0; the archive contains 99 catalog entries. This archive has not undergone a restore drill and is separate from the final frozen migration backup.

## Actual source comparison

The repeatable-read export captured the live source at `2026-10-03T09:49:58.962Z`. It loaded directly into the inactive production target. Export and comparison performed only read operations against Postgres and Supabase. All 2,292 records across the 12 source tables passed exact source-archive comparison and the independent native mapping, ownership, metadata, provenance and identity audit.

| Source table         | Records |
| -------------------- | ------: |
| users                |       3 |
| households           |       3 |
| household_members    |       3 |
| accounts             |      25 |
| instruments          |      95 |
| import_batches       |      21 |
| import_rows          |   1,423 |
| holding_snapshots    |     704 |
| transactions         |       0 |
| portfolio_valuations |      14 |
| currency_rates       |       1 |
| prices               |       0 |

Native table counts differ because Convex chunks import rows and scopes instruments to households. The 1,423 normalized rows occupy 30 chunks. All 89 referenced instruments have native records; six unreferenced instruments remain preserved in the exact source archive. The audit checks these mappings instead of requiring identical physical table counts.

All 704 persisted holding quantities, invested amounts, current values and profit/loss amounts agree exactly after decimal canonicalization. The comparison also covers three household Overviews, three Current/Exited listings, all 704 legacy holding-detail links, including historical and suppressed UUIDs, and all 24 household asset-class views. These 734 actual native views were compared with the retained independent Postgres readers using the same evaluation time and saved exchange-rate quote. Five available files, totaling 41,549 bytes, passed independent download hash, size and retention checks. Sixteen unavailable historical files retain their existing state.

The one expired Tickertape mutual-fund batch with seven declared rows and six persisted rows exactly matches the owner's recorded 2026-08-30 disposition. The six persisted rows are authoritative, the declared metadata remains seven, and no seventh row was invented. The protected approval is bound to this snapshot's input digest. No other unexplained discrepancy was accepted.

The source and target semantic hashes differ. Inspection of every saved native view reproduced both hashes and found only 455 calculated INR display differences: 192 profit/loss values, 222 current values and 41 invested values. The largest absolute difference is `1.4551915228366852e-11`, within the existing `1e-8` approximate-number tolerance. There are no nonnumeric semantic differences after the planned incidental-ID normalization. Persisted money and quantities use exact decimal comparison; the comparator and tolerance were not changed.

Protected evidence is in `.migration/production-initial-20261003-report/`: `data-comparison-summary.md`, `exact-holding-comparison.csv`, `source-file-comparison.csv`, `derived-numeric-differences.json`, `reconciliation.json`, `target.json` and `actual-native-views.json`. The readable report and CSVs contain financial data and remain outside Git.

- Input digest: `17de30d763d3c70ea4aa0529f3bc9f48d9b42eb4340493373406ac212c945875`.
- Reconciliation report digest: `da34fd0ce165903d71e670714217fc52cd0c40324cc4c1110e452b539469adb6`.
- Source semantic digest: `368d9bfd4ed527184e06061f2160e817aa32863de0e2e07de9b9253ff1b8a79d`.
- Target semantic digest: `1a7ffb4bf1dacd01d8b27fb61803845cb5b492b73051baf82ffd29a83558f29c`.

## Production Clerk authentication

The owner signed into the current production Postgres app in the collaborative browser. The first token-template check returned `No JWT template exists with name: convex`. The owner then explicitly approved enabling the Convex integration in the live production Clerk instance and signed into its dashboard. The application and verified primary domain were confirmed before enabling it.

Clerk's current integration sets audience `convex` on the normal session token, rather than creating a named JWT template. The installed Convex 1.45.0 provider selects this method when `sessionClaims.aud === "convex"`. This matches the [current Clerk integration documentation](https://clerk.com/docs/guides/development/integrations/databases/convex) and [Convex provider guidance](https://docs.convex.dev/auth/clerk). The earlier template-only check was therefore superseded by a real normal-session-token check.

The actual token had issuer `https://clerk.portfolio.deveshsangwan.com`, audience `convex`, a subject matching the signed-in user and a valid expiry. `users:current` returned HTTP 200 with query status `success` and resolved the existing migrated membership. Authenticated Overview, Current/Exited positions, account listing, paginated import listing, a holding detail and an asset-class detail all succeeded. An unauthenticated membership query returned query status `error` and no membership. The initial import-list test omitted its required pagination arguments; the corrected query succeeded. No JWT or Clerk secret key was exposed or saved.

The integration remained enabled after reloading its dashboard page. The live Postgres dashboard also loaded after refresh, displayed portfolio amounts and had no loading skeletons or application error. A fresh Vercel metadata check confirmed the production deployment still serves `068e18f` and has no production `NEXT_PUBLIC_CONVEX_URL`. No Google provider, Supabase integration, Vercel production setting or traffic was changed. These are actual native query checks from a production session. They do not certify the complete Convex web build against production.

## Why the final write pause is still needed

The read-only SQL export uses a repeatable-read transaction. Every SQL table and legacy query result therefore comes from the same snapshot. An import committed later is absent from that snapshot. Supabase file cleanup can also race with the file copy because Storage is outside the SQL transaction. An initial comparison can proceed while the live application remains available, but the final migration needs a coordinated pause of provisioning, import commits, lazy currency refresh and retention before taking the authoritative snapshot.

This populated initial target cannot receive a changed snapshot under a different run. The final load requires a fresh empty explicitly approved production target or a separately reviewed and authorized reset of this inactive target. Do not silently overwrite or append a new source snapshot.

The source write pause, verified recovery backups, full native production web smoke tests and final traffic switch remain open. The data-copy and Clerk integration approvals do not authorize them automatically.
