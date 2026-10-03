# Convex production cutover

The live website at [portfolio.deveshsangwan.com](https://portfolio.deveshsangwan.com) now uses Convex. Native application writes are enabled. Cutover completion was recorded at `2026-10-03T20:40:56.299Z`, or 02:10 IST on 2026-10-04.

The owner authorized merging the migration PRs and replacing the live Postgres website. [PR #49](https://github.com/deveshsangwan/investment-sync/pull/49) and [PR #50](https://github.com/deveshsangwan/investment-sync/pull/50) are merged. [Main CI](https://github.com/deveshsangwan/investment-sync/actions/runs/37144851456) passed for `9ec8532098c6489da5ac4bc76f62411e85c67782`, the validated web-build source.

Source upload and commit requests were verified paused. All application aliases served the paused Postgres build during the drain. The maximum request interval elapsed, and no active application SQL statements remained before the final backup. Retained legacy routes remain guarded by `SOURCE_WRITES_PAUSED=true`.

The live backend is the nondefault production deployment `useful-spaniel-964`, reference `production-cutover`, in `dev-sangwan2001/investment-sync`. Its URL is `https://useful-spaniel-964.convex.cloud`. All application tables and storage were empty before loading the final source. Its production Clerk issuer is unchanged, and `MIGRATION_MODE` was removed after the recovery checks and traffic switch.

## Final comparison

The frozen source snapshot was evaluated at `2026-10-03T19:04:23.252Z`. Its full retained SQL dataset matches the consistent Postgres backup. The final load sealed all 2,292 source records and finalized 21 import batches before publishing the three household views.

Independent reconciliation compared persisted records, mappings, normalized rows, available file bytes, and 734 portfolio views. It passed with zero unexplained differences. The previously approved expired-import declared-row-count discrepancy was retained unchanged. The USD/INR comparison used the same captured quote in both implementations.

## Deployment configuration

The launch web build is `dpl_8pW61KQpMSuhGR6iFe9mr5t3qhWW`. It built the merged source and successfully deployed the backend to the exact named production target before building Next.js. The main domain, validation hostname, default project alias, and main-branch alias were all verified against this build after promotion.

Vercel production builds run `convex deploy` with a production-only deploy key scoped to `useful-spaniel-964`, then build the web application with the returned Convex URL. Preview builds run only the web build. Automatic domain assignment and normal builds are restored. The native USD/INR refresh completed with `outcome: saved` and one provider attempt after writes were enabled.

For production operations, select `production-cutover` or `useful-spaniel-964` explicitly. The project's default production deployment is separate from this target.

## Recovery evidence

The final Postgres backup uses run `production-final-20261004`. It was captured from the frozen source in a read-only repeatable-read transaction, with the same exported snapshot used for `pg_dump` and the comparison tables. Restoration into `investment_sync_recovery_oct04` passed exact comparison of all 2,292 rows, indexes, and constraints.

All 10 source storage objects were copied into the private `portfolio-recovery-oct04` bucket and verified by size and SHA-256. The original bucket remains intact.

The final Convex export includes file storage. Its restoration into the isolated production recovery deployment `dynamic-elk-287` passed exact native-table comparison for all 7,425 documents, all five stored source files, and another independent comparison of all 734 portfolio views with zero unexplained differences.

The retained Postgres revision is `068e18f2fe4cad80abe19a1ddc5c94458d1664f2`. The exact source, actual matching production configuration, and portable compiled build are archived in protected operator artifacts. The compiled build was redeployed as `dpl_BxV3eD6FcEDXoRBfdATzbd7iDPjp`, and authenticated Overview and Accounts reads passed. The original immutable deployment is also retained.

The read-only production recovery certificate passed before native writes were enabled. It binds the retained source, unchanged native baseline, exact archived application commit, actual configuration, compiled build, operator environment, and verified database CA. Application redeployment is proven by the separate build drill above.

The certificate exposed two operator-tool defects, corrected in [PR #53](https://github.com/deveshsangwan/investment-sync/pull/53) and [PR #54](https://github.com/deveshsangwan/investment-sync/pull/54). Expired imports can retain committed normalized rows, so rollback preserves their historical flags until an actual new commit changes them. Production disables Postgres type discovery, so schema and write-behavior guards now bind table names as JSON text. Both fixes are merged. All 70 migration-tool tests pass with SQL integration enabled and no skips; lint, typecheck, formatting, and [CI](https://github.com/deveshsangwan/investment-sync/actions/runs/37150847490) pass.

Keep the source database, source objects, recovery copies, application archives, and credentials through at least `2026-10-10T20:40:56.299Z`, or 02:10 IST on 2026-10-11. Vercel production deployment retention is 30 days with 10 deployments kept.

## Website verification and limits

Before promotion, the owner's existing normal Clerk session passed authenticated queries on the exact launch build; anonymous queries were rejected. Overview and its drawn history chart, Holdings, Accounts with all 13 rows, Imports with 20-plus-1 pagination, the US-stock chart, and empty Cash states passed. The loaded JavaScript uses the exact production Convex URL.

The shared browser disconnected before the final main-domain check. Post-promotion checks verified all live alias identities, the compiled Convex endpoint and production Clerk key, a successful public page, and the expected production sign-in redirects for anonymous document navigation. A new signed-in main-domain browser check was therefore not performed.

The native currency refresh proves that application writes are enabled. A genuinely new owner report was not imported during cutover, so a live upload/parse/commit of a new report remains unverified. Existing real records and source files passed the comparisons and recovery checks above.

Detailed data, file bytes, credentials, comparisons, and recovery receipts remain under protected `.migration/` directories outside Git. Final source and native packets use `production-final-20261004`; the production certificate uses `production-final-before-write-recovery`; launch evidence is in `phase8-cutover-20261003`. Follow the [production rollback procedure](convex-phase-6-rollback.md) for recovery after any Convex-only write. An after-write rollback requires freezing and draining writers and reviewing the current replay plan before applying it.
