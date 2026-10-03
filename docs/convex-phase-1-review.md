# Convex plan and Phase 1 review

Date: 2026-09-05

Scope: the revised migration plan and all Phase 1 changes against `8285ef6ea61fc07afdbe285856ba515e6ebe52c3`. This is a repository-foundation review, not approval to migrate production or a claim that cloud authentication has been verified.

## Assessment

The Convex-native direction is reasonable for the stated product size. The original implementation plan needed corrections to data isolation, capacity, valuation freshness, and rollback. Those are correctness issues, not stylistic preferences.

The Phase 1 code has an appropriate structure: thin public functions, shared database invariants and authorization, and a small development-only client adapter. It does not need repository classes, generic service layers, or an authorization framework. This review hardens that structure without adding them. Later publication and parsing code has not been implemented or approved by this review.

## Plan corrections

- Rehearse with synthetic production-shaped data. Loading real production data into Convex remains part of the explicitly authorized production phase, never a development rehearsal.
- Keep publication projections in native currency. Apply current FX and persisted freshness transitions to bounded valuation inputs, so exchange-rate changes do not require another import to update the portfolio.
- Measure cumulative Household history, incoming batches, projection documents, reads, writes, and execution limits. Define overflow behavior and bounded cleanup; do not infer capacity from one upload alone.
- Freeze every source writer at cutover, including provisioning, lazy FX persistence, cleanup, and in-flight work. Retain the exact old application and configuration for rollback.
- Prove rollback after Convex-only writes, including new identities and Commit of an expired-file batch. Preserve normalized inputs and parser semantics instead of relying only on Source Files.
- Specify decimal conversion, rounding, and approximation boundaries. Converting an old Float64 JSON number into a string cannot recover digits already lost.
- Retain independent legacy SQL as the parity oracle until retirement. Comparing the new projector with an adapter that also uses that projector would not establish parity.
- Define upload attachment ownership, idempotency, claim conflicts, parse-attempt fencing, and abandoned-object cleanup.
- Separate verified repository work from external project, Clerk, and trusted codegen checks. The owner can finish setup in parallel with pure-domain work without falsely closing Phase 1.

## Code corrections

- Both normal provisioning and development seeding use `ensureUserProvisioned`; rerunning the seed no longer creates duplicate identities and Households.
- Existing users with inconsistent identity or membership records fail closed before profile changes. Silent repair was deliberately rejected: creating another Household can hide the original portfolio. Repair requires an explicit, separately verified operation.
- Authorization checks the referenced Household and verifies that an owner membership matches its owner ID. Shared bounded lookups detect duplicate subjects and memberships consistently.
- Existing viewers remain viewers. The owner-authorization helper rejects them in direct helper tests; Phase 3 must apply that helper to deployed upload writes and test those endpoints. There is no owner-only public write yet in Phase 1.
- Removed the deployed test-only authorization wrapper. Tests exercise the helper through an authenticated test context instead.
- Added regressions for duplicate subjects, missing and multiple memberships, missing Households, mismatched owners, email changes and omitted claims, unprovisioned reads, seed environments, and repeated seeding. Failed operations are checked for unintended writes.
- Preserved the legacy behavior for saved emails: an absent or empty claim does not erase one. Household names remain required data, new Households use `My Portfolio`, and `users.current` exposes the stored name. Tests cover the default and preservation of an existing name.
- Added executed auth-configuration tests for missing/empty issuers and the configured issuer/audience pair. These do not replace real token verification.
- Updated setup instructions to preserve existing environment settings, describe Clerk's current integration setup, and distinguish fake seed identities from real sign-in provisioning.

## Verification

- Workspace lint, typecheck, tests, and build passed. Unchanged packages reused Turbo results; changed backend and web tasks ran during verification.
- Backend suite: 23 tests passed after the Opus findings were addressed. Backend lint, typecheck, and local codegen also passed after those code changes.
- Default workspace tests skip 45 database integration tests. The separate isolated local Postgres run passed all of them: 44 import/lifecycle tests and one database migration test. Its complete API suite passed 92 tests.
- Migration-tool suite: 11 tests passed.
- Repository formatting and whitespace checks passed.
- Convex codegen succeeded against the explicitly selected anonymous local backend, not a cloud or production deployment. The removed test endpoint is absent from the generated bindings.
- A fresh temporary source snapshot, excluding ignored local configuration and dependencies, installed the frozen lockfile and passed workspace-wide typecheck and tests with no Turbo cache hits. After the final fixes, a forced rerun passed all 14 workspace tasks, including all 23 backend tests from the checked-in-style generated bindings. Its database integration tests were skipped as expected; those passed in the separate local database run above. The installer reported a nonfatal optional Sharp native-build warning; this check did not claim to verify a fresh web build.

The mock backend proves application rules, not production transaction budgets, actual concurrent retry behavior, or Clerk token issuance. Those need the later real-backend and authentication gates.

## Review record and remaining gates

The primary review and separate read-only plan and structure audits produced the initial corrections above. Claude Code confirmed `claude-opus-5` for its complete read-only review against the baseline commit. It approved the direction but rejected closing the repository milestone with five blocking findings:

- B1, missing codegen CI: ordinary CI already includes backend tasks through Turbo. The plan now explicitly assigns the trusted codegen integration job to the still-open external gate, rather than pretending it exists. Local codegen and generated bindings were verified separately.
- B2, omitted email claim deletes saved data: corrected to preserve the legacy saved email, with absent/empty-claim regressions.
- B3, missing Household name: restored the schema field, provisioning default, query field, migration requirement, and preservation tests.
- B4, overstated viewer-write enforcement: narrowed the Phase 1 gate and this report to the authorization helper actually tested. Deployed endpoint enforcement remains mandatory in Phase 3.
- B5, first-run auth configuration ordering: documented the expected first-push failure, setting deployment variables in a second terminal, and retrying the development process.

Optional feedback added auth-configuration tests, scheduled concurrent provisioning verification, corrected the file tree, and made the Phase 5 provider-gate/error-display work explicit. A viewer role on a Household whose owner ID still points at that user remains denied owner access; no automatic role repair is introduced. Owner denial continues to use `NOT_FOUND`, consistently with the current authorization contract. The fake seed is an operational guarded internal function, not a deployed test-only authorization adapter.

The targeted read-only follow-up, again confirmed as `claude-opus-5`, approved the repository milestone with no blocking findings. It verified all five dispositions and independently ran the 23 backend tests successfully. The reviewed scope is the complete Phase 1 working tree against `8285ef6`, followed by the corrective changes recorded above; only this verification record, milestone status, and a file-tree entry were finalized after approval.

Phase 1 external gates remain open: owner-selected tier/region and project relationship, real Clerk sign-in against personal development, and trusted cloud integration/codegen verification. No production writes, cloud provisioning, deployment switch, or Phase 2 implementation was performed during this review.

## Platform references

- [Convex with Clerk](https://docs.convex.dev/auth/clerk): issuer configuration, audience, integration activation, and waiting for Convex authentication.
- [Convex CLI](https://docs.convex.dev/cli/overview) and [generated-code recommendations](https://docs.convex.dev/understanding/best-practices/other-recommendations): generated bindings and deployment-dependent codegen are separate from ordinary typechecking.
- [Convex testing](https://docs.convex.dev/testing/convex-test) and [real-backend testing](https://docs.convex.dev/testing/convex-backend): mock-test scope and runtime-limit verification.
- [Convex best practices](https://docs.convex.dev/understanding/best-practices): reactive queries do not rerun merely because wall-clock time advances, which informs the explicit FX freshness transition requirement.
