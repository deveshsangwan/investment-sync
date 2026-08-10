# Effect migration — phase sequence

Successor to `handoff-effect-backend.md`, written against the code as it stands after
PRs #32 (currency rates) and #33 (import lifecycle).

Ordering rule: **dependency-ascending** (runtime → membership → portfolio → adapters),
**risk-descending on existing test coverage** (the best-covered code migrates first; the
worst-covered code gets its tests built before it migrates).

## Where you actually are

| Area                              | State                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `services/currency-rates.ts`      | Effect inside, Promise facade out. Module-global `SynchronizedRef` cache.                                                                                    |
| `services/import-errors.ts`       | `Data.TaggedError` hierarchy + `runImportEffect` + `importEffect`. Done.                                                                                     |
| `services/import-service.ts`      | **Shell only.** Four entry points return Effects; `commitImportPromise` (270 lines) is still Promise/throw.                                                  |
| `services/import-lifecycle.ts`    | Not migrated. 393 lines of Promise/throw.                                                                                                                    |
| `services/membership.ts`          | Atomicity fixed (transaction + race recovery), still plain Promise.                                                                                          |
| `services/portfolio/*` (10 files) | Not migrated. No typed errors, two hand-rolled caches.                                                                                                       |
| Runtime                           | **None.** No Layers, no services, no `ManagedRuntime`. `db`/`supabase` travel as function arguments; three separate `Effect.runPromise` calls sit at leaves. |

The handoff said to defer the runtime until a second domain proved the repeated
composition. That threshold is reached at the end of Phase 1, not before.

---

## Phase 1 — Finish the import interior

**Files:** `services/import-lifecycle.ts`. `commitImportPromise` in
`services/import-service.ts` gets its throws typed at the boundary, but its transaction
interior stays Promise-shaped until Phase 2 — see `effect-phase-1.md` for why, and treat
that document as authoritative on Phase 1 scope.

Go first because this is the only code in the repo where Effect replaces something
genuinely ugly, and it is the best-tested code you own — `import-service.integration.test.ts`
is 834 lines with four Postgres checks.

`uploadAndProcessImportPromise` hand-writes a compensation ladder: four separate
`try/catch` blocks, each calling `markImportFailed`, one also calling `removeStoredFile`
and branching the metadata on whether the delete succeeded. That is
`Effect.onError` / `acquireRelease` / `ensuring` written out longhand.

It also matters that this lands before anything else: right now the import slice teaches
the pattern "wrap a Promise and hope the right tagged error gets thrown." Every later phase
will copy whatever pattern is in place when it starts.

- Keep `ImportDependencies` as a plain argument. **No Layers yet.**
- Delete each `*Promise` function as its Effect version lands. No side-by-side. This
  applies to the functions Phase 1 migrates; the ones wrapping a Drizzle transaction stay
  and are named for what they are, not left as migration leftovers.
- Gate: run the integration suite with `TEST_DATABASE_URL` set, before and after.
  Import statuses, parser versions, storage paths and cleanup ordering must be identical.

## Phase 2 — Extract the runtime those two slices proved you need

Two domains now thread the same four things: database, Supabase storage, clock, logger.
That is the evidence the handoff asked for. Build only what is repeated:

- `Database` and `Storage` services + Layers.
- Drop `logger.ts` for Effect's `Logger`; drop the manual `Clock.currentTimeMillis` plumbing.
- One `ManagedRuntime` per adapter: `api/trpc/[trpc]/route.ts`, `api/imports/upload/route.ts`,
  `api/cron/cleanup-imports/route.ts`.
- Delete `runImportEffect`. Adapters run effects directly and map the error channel once.
- Fold currency rates in: drop its internal `Effect.runPromise` and the module-global
  `SynchronizedRef`, return an Effect. Its Promise facade was explicitly temporary.

Functionally a no-op — that is the point. Gate: full suite, all HTTP status and payload
assertions unchanged.

**Skip here:** `Effect.Config` for env, telemetry, metrics. `config.ts` is zod, tested, and
read in two places. Optional rider at most, never its own phase.

## Phase 3 — Membership, the auth boundary, and dissolving `ApiContext`

Small, and it gates Phase 4: every portfolio function takes
`PortfolioContext = ApiContext & { membership }`.

- `ensureMembership`'s `ctx.cache.get("membership")` hack is `Effect.cached` in a
  request `Scope`.
- `throw new Error("Missing Clerk user id")` becomes a typed error, so the tRPC
  middleware's `UNAUTHORIZED` mapping stops being ad hoc.
- `ApiContext.cache: Map<string, Promise<unknown>>` — the untyped state the handoff
  flagged — disappears here, and only here.

`routers/imports.test.ts` breaks: it builds an `ApiContext` literal with a pre-seeded
cache Map to skip the database. Rewrite it to provide a stub membership Layer. That is a
strictly better test than the one it replaces.

Gate: owner-only commit/upload guards unchanged; first-login provisioning race still recovers.

## Phase 4 — Portfolio reads

Ten files, zero database-backed tests, two hand-rolled caches, and one real gap:
`getUsdInrRate` throws `CurrencyRateUnavailableError` through seven call sites and **nobody
catches it**. A Frankfurter outage past the seven-day stale window turns every portfolio
query into a 500 today.

### 4.0 — Tests first, before any Effect code

Write Postgres-backed parity tests for current / exited / aggregate outputs.

`overview.test.ts` mocks `./cache`, `./data`, `./latest-holdings` and `./utils` — precisely
the four seams Phase 4 rewrites. Those tests will break mechanically and catch nothing.
This is the handoff's stated acceptance gate and it is still unmet.

### 4a — `data.ts`, `latest-holdings.ts`

Wrap the queries. Keep the raw SQL and the duplicate-aggregate policy byte-identical —
copy, never retype.

### 4b — `cache.ts` + `portfolio-cache.ts` → Effect `Cache`

The largest deletion in the migration. The module-global map, the TTL bookkeeping, the
delete-on-failure race guard and `clearHouseholdPortfolioCache` all collapse into
`Cache` / `cachedInvalidateWithTTL`. Also clears the "global caches mask side-by-side
differences" risk before Phase 5 touches the adapters.

### 4c — Leave `utils.ts`, `from-snapshot.ts`, `aggregates.ts` alone

Pure functions. Effect adds nothing. Change signatures only where a caller forces it.

### 4d — `overview` / `summary` / `holdings` / `detail`

Compose; `Promise.all` → `Effect.all({ concurrency })`. Then decide the currency-rate
policy **explicitly**: typed failure, or a partial-data flag on the response. It is a
product decision — make it visible rather than leaving it as an accidental 500.

## Phase 5 — Last routers and a single error boundary

`routers/accounts.ts` and `routers/auth.ts` are 15–30 line direct queries; an afternoon
once services exist. Then collapse `toImportTrpcError` and the duplicated `isImportError`
blocks in both Next route handlers into one typed-error → transport mapping. `isImportError`
and `importErrorHttpStatus` go away.

Gate: `AppRouter` inference unchanged; web and mobile typecheck.

## Phase 6 — What not to migrate

- **`packages/analytics`** — pure math (xirr, performance). No effects to model. Diff for
  diff's sake.
- **`packages/importers`** — pure parsing + zod. zod → Effect Schema is a large diff with no
  behavior change, and `normalizedImportRowSchema` is shared with the commit path's payload
  validation. Only worth it if you decide you want one schema language repo-wide — and then
  as its own project, not inside this migration.
- **`packages/db`** — becomes a Layer in Phase 2. Drizzle calls stay Promise-based inside
  `Effect.tryPromise`. Wrapping Drizzle deeper buys nothing.

---

## Point of no return

Phases 1 and 2 revert cleanly. From Phase 3 onward `ApiContext` is gone and the tests that
construct it are rewritten; backing out gets expensive. If confidence in the approach is
going to be re-examined, do it at the Phase 2/3 boundary.
