# Phase 7 production verification

The owner authorized preparing an inactive production Convex target and loading and comparing real source data on 2026-10-03. The live website continues to use Postgres. Source writers have not been paused, traffic cutover is not authorized, and native application writes remain disabled.

The starting revision is `2af61e9f7015e09b7426aa72ba9de2040e82049a`. Tracked files were clean; existing untracked agent configuration and handoff files are unrelated. Opus is unavailable. New backend changes require two independent Codex reviews before deployment.

| Workstream                | Objective                                                                                                           | Assigned         | Files                                         | Completion criterion                                                                | Task ID                  | Status      | Receipts                                         | Findings                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------ | ----------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Target setup              | Create an explicit inactive production deployment with the production issuer and migration freeze                   | Lead             | Protected operator artifacts                  | Production type, project, region and credentials verified; no live website changes  | root                     | In progress | `.migration/phase7-production-setup/target.json` | Production Vercel variables marked sensitive cannot be exported; issuer verified from the live public key and OIDC discovery |
| Backend readiness         | Complete recorded publication safety requirements and allow read-only provisioning for existing migrated users      | Codex workstream | Backend functions and regression tests        | Required tests and checks pass; two independent reviews approve the complete change | phase7_backend_readiness | Dispatched  | Isolated worktree at the starting revision       | Unknown users must remain blocked while the target is frozen                                                                 |
| Initial source comparison | Copy a consistent real snapshot into the inactive production target and independently compare all records and views | Lead             | Protected snapshot, file and report artifacts | No unexplained differences; approved source anomalies recorded exactly              | root                     | Planned     | None yet                                         | This is an initial comparison, not a final cutover certificate                                                               |

## Deployment boundary

The target is `prod:accurate-frog-976`, reference `migration-validation`, in project `dev-sangwan2001/investment-sync`, region `aws-us-east-1`, class `s16`. It is not the project's default production deployment. The existing personal development deployment `hardy-barracuda-115` remains selected locally. The live website is `portfolio.deveshsangwan.com`, serving Postgres revision `068e18f2fe4cad80abe19a1ddc5c94458d1664f2`.

All credentials, real records and comparison details remain in ignored `.migration` artifacts with restricted filesystem permissions. No real records enter development, preview or Git.

## Why the final write pause is still needed

The read-only SQL export uses a repeatable-read transaction. Every SQL table and legacy query result therefore comes from the same snapshot. An import committed later is absent from that snapshot. Supabase file cleanup can also race with the file copy because Storage is outside the SQL transaction. An initial comparison can proceed while the live application remains available, but the final migration needs a coordinated pause of provisioning, import commits, lazy currency refresh and retention before taking the authoritative snapshot.

The source write pause, verified recovery backups, production browser smoke tests and final traffic switch remain open. Preparation does not authorize any of them automatically.
