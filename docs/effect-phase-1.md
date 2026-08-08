# Phase 1 — Finish the import interior

Companion to `effect-migration-sequence.md`. Read that first for why this phase goes first.

**Status: done.** Branch `refactor/effect-import-lifecycle`, on top of the safety net in
`test/import-coverage-pre-effect`. `import-lifecycle.ts` is native Effect; 154 workspace
tests, `typecheck`, `lint` and a full `build` all pass. No adapter changed — the Next
routes and tRPC router call the same exported names, which is the parity result that
matters.

Outcome notes, where reality differed from the plan below:

- PRs landed 1.3 → 1.2 → 1.1; they are independent, and the order does not matter.
- `markImportFailed` and `removeStoredFile` gained `never` error channels. That is what
  makes `failBatch` safe rather than just tidy: recording a failure can no longer replace
  the failure being recorded.
- One real edge case fixed rather than preserved: if the storage delete call itself
  rejected, the old code propagated _that_ error instead of the original and never
  recorded the failure at all. `removeStoredFile` now reports `false`.
- `writeParsedRowsInTransaction` stays Promise-shaped alongside `commitImportPromise`, for
  the same reason. Both convert in Phase 2 behind a Database service.

### Carried into Phase 2

A Codex review of the migration diff found one real bug (fixed in `0fc7515`: the
compensation path could orphan an uploaded file forever) and one deferred item worth
recording rather than acting on now.

**Use `Effect.acquireUseRelease` for the uploaded file.** The explicit compensation used
here is behaviorally identical today, but there is an interruption window between the
upload succeeding and `catchAll` registering; `acquireUseRelease` closes it and runs its
release uninterruptibly. It is deferred because nothing in this codebase can interrupt a
fiber today — no `timeout`, no `race`, one `runPromise` per request. Phase 2 introduces
`ManagedRuntime` and is the first point where that stops being true, so the change belongs
in the same diff as the interruption source.

Related, for the same phase: the zero-argument `Effect.tryPromise` wrappers do not cancel
Drizzle or Supabase work, so an interrupted fiber leaves the underlying Promise running.
The upload-through-persist section should be explicitly uninterruptible, or the drivers
must honour an `AbortSignal`, before any interruption source is added.

## PR 1.0 — Safety net (done)

The suite that has to stay green through every PR below.

| Suite                                           | Tests | Covers                                                                                           |
| ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| `import-errors.test.ts` (new, pure)             | 18    | status mapping, `isImportError`, `toImportError` cause recursion, `runImportEffect` reject shape |
| `import-lifecycle.integration.test.ts` (new)    | 17    | upload happy path, all five rejection paths, both compensation branches, cleanup, `listImports`  |
| `import-service.integration.test.ts` (extended) | 26    | commit — was 15, added 11 for isolation, rollback, transactions, valuations, bookkeeping         |

`packages/api` went from 45 tests (one failing) to **91 passing**; the workspace runs 154.

Run it:

```bash
export TEST_DATABASE_URL='postgresql://investment_sync:investment_sync@localhost:54329/investment_sync_test'
pnpm test
```

Two fixes were needed to make the suite mean anything:

- **Isolation.** `instruments` and `users` are not Household-scoped, so the old
  `afterEach` (delete Households) leaked them. 109 orphaned users and 17 instruments had
  accumulated. A stale instrument from 2026-07-01 named `ABC` **followed by one trailing
  space** was winning identity resolution over the real `ABC`, and failing a test on `main`
  that has nothing to do with whitespace — the kind of difference rendered Markdown and a
  terminal both hide. `resetDatabase` now truncates. Suites are serialized with
  `--no-file-parallelism` because they share one database.
- **A dedicated `investment_sync_test` database.** `cleanupExpiredImportFiles` has no
  Household filter by design; pointing it at the dev database would null real storage paths.

### What is now pinned that was not before

Upload: storage path shape (`clerkUserId/batchId/sanitized-name`), filename sanitization,
30-day expiry, file hash, `created → uploaded → parsed` transitions, preview truncation.
Rejections: invalid file leaves **no** batch row; parse failure, Duplicate Import (with
parse metadata retained), bucket unavailable, `already exists` tolerated, upload failure.
**Both compensation branches**: file deleted → `storagePath: null`; file delete failed →
path kept and `expiresAt` pulled to now so the cron retries. Mid-parse status race.
Cleanup: 100-batch limit, remove-failure keeps the path, cross-Household sweep.
Commit: cross-Household hidden behind not-found, row-count mismatch, invalid payload,
**full rollback on partial failure**, `isCommitted`/`committedAt`, transaction and
valuation rows (previously zero coverage), derived pnl, cache invalidation.

## Scope correction

The sequence doc put `commitImportPromise` in this phase. After reading it closely, most
of it should **not** move yet.

Its body is one `db.transaction(async tx => …)` callback. Drizzle rolls back on throw —
that is load-bearing. Making the interior Effect-native means either running a nested
runtime inside the callback (bad) or having a `Database` service that exposes transactions
as scoped Effects — which is **Phase 2**. Converting it now buys typed errors it already
throws and costs a fake seam.

So: **Phase 1 is `import-lifecycle.ts`.** Commit gets its throws typed (PR 1.3) and its
interior waits for the Database service.

## PR 1.1 — `uploadAndProcessImport`

The whole function is one repeated shape: _do a step; if it fails, mark the batch failed
with some metadata; propagate_. Four hand-written `try/catch` blocks say it four times.

One combinator replaces them:

```ts
const failBatch =
  (metadata: FailedImportMetadata = {}) =>
  <A, E extends ImportError>(effect: Effect.Effect<A, E>) =>
    Effect.tapError(effect, (error) =>
      markImportFailed(deps, membership, batchId, error.message, now, metadata),
    );
```

Then each step is `parseFile(input).pipe(failBatch())`, the duplicate check is
`failBatch({ sourceType, parserVersion, rowCount, warnings })`, and so on.

**Do not reach for `Effect.acquireRelease` on the uploaded file.** The failure record
depends on whether the release _succeeded_ (`storagePath: null` vs `expiresAt: now`), and
`acquireRelease` deliberately hides the release outcome from the caller. Use an explicit
compensation effect on the persistence step — the branch is real domain behavior, not
boilerplate to abstract away.

`markImportFailed` swallows its own errors today (logs and continues). Keep that: it is a
best-effort record, and letting it fail would mask the original error. In Effect that is
`Effect.catchAll(logAndContinue)` on the marking effect, not a silent `try/catch`.

Delete `uploadAndProcessImportPromise`, the four `try/catch` blocks, and the
`toImportError` re-throw dance in the middle of the happy path.

## PR 1.2 — `cleanupExpiredImportFiles` and `listImports`

Small and mechanical. `listImports` is a query and a map — it only needs its
`importEffect` wrapper removed once the body returns an Effect. Cleanup has one real
branch (storage remove fails → fail without nulling paths); keep the ordering exactly as
it is, the test pins it.

Delete `cleanupExpiredImportFilesPromise` and `listImportsPromise`.

## PR 1.3 — Type commit's failures

Leave the transaction callback alone. Replace bare `throw new Error(...)` in
`requiredMapValue` with a typed `ImportPersistenceError` so nothing escapes the declared
error channel, and keep the single `importEffect` wrapper at the boundary.

## Do not touch

The tests will catch these, but they are the expensive mistakes:

- the `pg_advisory_xact_lock` call and its constant key
- the `setWhere` clause giving `nps_csv` priority over workbook rows on the same date
- `sanitizeFileName`, the storage path shape, `IMPORT_TTL_MS`, `CLEANUP_BATCH_SIZE`,
  `MAX_IMPORT_ROWS`
- `clearHouseholdPortfolioCache` after commit — the cache is Phase 4's problem

## Gate for every PR

`pnpm test` with `TEST_DATABASE_URL` set, plus `pnpm typecheck` and `pnpm lint`. No test
may be edited to accommodate a change unless the behavior change is deliberate and called
out in the PR description — the whole point of PR 1.0 is that the suite is the spec now.
