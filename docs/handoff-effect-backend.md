# Handoff — Effect backend rewrite planning

Generated: 2026-07-19 (Asia/Kolkata)

> **Archived.** Kept for the decision record in "Decisions already made" and "Risks to keep
> visible", both of which still hold. For current scope and sequencing, read
> `effect-migration-sequence.md` and `effect-phase-1.md` instead — they were written
> against the code as it actually stands, and they supersede the six-phase sequence
> referenced below.
>
> The `$HOME/.html-inbox/...` artifacts below are **machine-local to the session that
> produced this handoff**. They are not in the repository and cannot be opened from a fresh
> checkout or in CI. Everything load-bearing from them has been carried into the two
> documents named above; the paths are retained only as provenance.

## Objective

Continue the architecture-to-implementation discussion for rewriting the Investment Sync backend incrementally with Effect. The user has not yet selected a candidate or authorized implementation.

## Authoritative artifacts

- Canonical architecture plan: `$HOME/.html-inbox/documents/7b4e4f26-edf7-4ff3-9d9f-decc7697da24/index.html`
- Artifact metadata: `$HOME/.html-inbox/documents/7b4e4f26-edf7-4ff3-9d9f-decc7697da24/metadata.json`
- Effect documentation: <https://effect.website/docs>

The canonical plan contains the full evidence, files, before/after diagrams, candidate rankings, six-phase migration sequence, preservation list, and top recommendation. Do not recreate or restate it; open it first.

## Current repository state

- Workspace: current `intevestment-sync` workspace.
- Branch: `mobile-auth`
- HEAD: `3704709 Use Google OAuth in mobile app`
- Worktree was clean when this handoff was created.
- Effect is not installed in the workspace.
- No `CONTEXT.md` or `docs/adr/` records exist.
- Existing transport adapters are Next.js routes and tRPC; `AppRouter` types are consumed by web and mobile.
- Baseline: all six workspace test tasks pass; 39 tests pass and four Postgres import integration checks skip without `TEST_DATABASE_URL`.
- No repository files were changed during the architecture review or handoff.

## Decisions already made

- Use incremental vertical slices; no big-bang rewrite.
- Keep Next.js, tRPC, `AppRouter` output shapes, Drizzle schema/migrations/load-bearing SQL, import parsers, and analytics.
- Do not create repository-per-table modules or a speculative provider seam.
- Do not build a grand Effect runtime first. Let migrated slices reveal the minimum repeated composition.
- Use Currency Rates as the low-risk Effect tracer bullet; the Import lifecycle is the first major deepening target.
- Membership atomicity is an intentional behavior change and must remain an isolated phase.

## Highest-value findings

Use the canonical plan for detail. The short version needed for continuation:

- Import lifecycle has the highest leverage across upload, commit, and cleanup; validation, status transitions, storage recovery, database work, and error mapping currently leak across adapters.
- Portfolio reads are split across shallow modules; current/exited and aggregate SQL is load-bearing and needs database-backed output parity.
- Membership first-user provisioning is not transactional and has no direct tests.
- `ApiContext` exposes broad implementations and untyped cache state, but replacing it before a real slice would only trade one shallow module for another.
- Currency Rates is already reasonably deep; rewrite its implementation as the tracer bullet without widening its interface or adding a second provider adapter.

## Next session

1. Ask which architecture candidate the user wants to explore. If they delegate the choice, recommend Currency Rates as the tracer bullet followed by Import lifecycle.
2. Grill the chosen candidate before proposing its interface. Record domain terminology in `CONTEXT.md` only as decisions crystallize.
3. If implementation is authorized, preserve the current Promise-facing caller behavior while Effect stays inside `packages/api` for the first slice.
4. Add the smallest parity check that fails if behavior changes, then migrate one vertical path and delete its old implementation.
5. Run `pnpm test`; run the four Postgres import checks with a configured test database before changing persistent Import behavior.

## Acceptance gates

- Web and mobile continue to compile against the existing `AppRouter` types.
- Route status/error mapping and response payloads remain compatible unless the user explicitly approves a change.
- Persistent Import statuses, parser versions, storage paths, identity rules, and cleanup ordering remain compatible.
- Portfolio current/exited/aggregate outputs match against real Postgres data.
- Effect execution happens at existing external adapters; no Effect runtime leaks into React clients.
- Global caches are removed only after side-by-side paths no longer depend on them.

## Suggested skills

- `grilling` — required next when the user selects a candidate; stress-test constraints and migration behavior.
- `codebase-design` — keep the architecture vocabulary consistent and use design-it-twice only if alternative interfaces are requested.
- `domain-modeling` — update or create `CONTEXT.md` inline when stable domain terms emerge.
- `tdd` — use for the first Effect slice and database-backed parity checks.
- `ponytail:ponytail` at full — keep the migration vertical, reuse existing modules, and avoid speculative Effect abstractions.

## Risks to keep visible

- The skipped integration checks can make a green suite look safer than it is.
- Membership transactionality changes failure semantics; do not hide it inside a mechanical migration.
- The raw current/exited holdings SQL and duplicate aggregate policy exist in both SQL and TypeScript; do not rewrite them from memory.
- Module-global caches can mask differences during side-by-side migration.
- A tRPC rewrite would expand scope and break inferred clients; it is explicitly out of plan.

## Deferred to the next Effect phase

- PRs 1–2 must not introduce a general dependency graph or shared `ManagedRuntime`.
- Currency Rates may keep its Promise-facing caller API; Import operations return typed Effects that are executed by the existing Next.js and tRPC adapters.
- When the next domain migration repeats database, storage, logging, clock, or cache composition, extract only that repeated composition into shared Layers and place `ManagedRuntime` at the existing adapters.
- Keep Effect out of React clients and preserve `AppRouter` inference while moving runtime composition.
- In the Portfolio phase, consider an explicit partial-data UI for unavailable exchange rates; until then, USD-dependent reads fail rather than silently valuing USD holdings at zero.
