# Import commit lifecycle

Issue [#18](https://github.com/deveshsangwan/investment-sync/issues/18) predates the Convex web cutover. Both backends now authorize and validate the target Import Batch before applying portfolio data. Retrying the same batch deliberately returns idempotent success. It must never apply the rows a second time.

## Convex web backend

`packages/backend/convex/imports.ts` requires current Household owner membership and loads the batch inside the commit mutation. Foreign and missing batches both return `NOT_FOUND`.

`model/publication.ts` permits a new publication only for a `parsed` batch with a content hash, parser version, and positive row count. Other states return `CONFLICT`. A retry of a live `publishing` batch returns its existing version; a retry of a `committed` batch returns its original receipt. A committed status without a committed version does not qualify for replay.

The commit mutation reserves the Household's publishing slot and changes the batch to `publishing` atomically. Another batch cannot reserve that slot until publication finishes or recovery releases it. An expired publishing lease returns `PUBLICATION_EXPIRED` until recovery restores the batch to `parsed`.

The publication action reads chunks for the current parse attempt, verifies their manifest, count, bytes and digests, and validates the normalized payloads. Empty normalized input is rejected independently of the initial commit check. This closes a stored-data edge case: a consistent empty manifest could previously publish a zero-fact version even though the parser rejects empty files.

Publication workers fence writes by version, attempt, live lease, batch state, Household publishing slot, and unchanged active base version. Finalization also checks current owner authority and complete matching receipts. It persists immutable facts, updates the active version and sequence, and marks the batch `committed` in one mutation. Failed or expired attempts leave the active portfolio intact and permit a new publication attempt; late workers cannot alter that attempt.

## Retained PostgreSQL backend

`packages/api/src/services/import-service.ts` commits inside a transaction. It takes the import advisory lock and selects the Household-scoped batch with `FOR UPDATE` before checking status or reading rows. The held row lock makes the `parsed` to `committed` transition atomic through the final update.

The service requires nonempty rows matching the declared count and validates every payload before portfolio writes. `created`, `uploaded`, `failed`, and `expired` batches return `ImportConflictError`; missing and foreign batches return `ImportNotFoundError`. Already committed batches return their stored row count without rewriting facts, row flags or `committedAt`.

## Source File retention

Source File expiration is independent of batch eligibility. Deleting an expired source preserves validated normalized rows and provenance. A retained `parsed` batch can still commit after its original file is deleted. Do not reject a parsed batch solely because its Source File retention deadline has passed. PostgreSQL's explicit `expired` batch status remains a rejected lifecycle state.

## Regression coverage

- `packages/backend/convex/importCommit.test.ts` runs a fake CSV through upload, attachment and the actual parser action. It covers rejected states and missing metadata without writes, empty parsed batches, foreign and deleted batch IDs, same-batch request replay, stable committed receipts and timestamps, Source File expiration, and worker rejection of missing, stale, malformed, count-mismatched and empty staging.
- `packages/backend/convex/publication.test.ts` covers live publication conflicts, incomplete or corrupted receipts, revoked ownership, changed base versions, expired leases, recovery and late-worker fencing.
- `packages/api/src/services/import-service.integration.test.ts` covers rejected states with unchanged stored data, missing/foreign/empty/invalid/incomplete batches, rollback, replay and Source File expiration. Its same-batch concurrency test uses independent PostgreSQL connections, verifies distinct backend PIDs, holds the production advisory lock until both transactions are waiting, then verifies one application and unchanged data on replay.

The Convex tests use `convex-test`. Concurrent request calls exercise handler and replay behavior in its fake database; they do not measure production optimistic concurrency control. The PostgreSQL test exercises real concurrent transactions. All fixtures are generated fake data. Content uniqueness between different batches is tracked separately in #19.

For focused checks after installing with `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @investment-sync/backend test convex/importCommit.test.ts convex/imports.test.ts convex/publication.test.ts --no-file-parallelism --testTimeout=30000
TEST_DATABASE_URL=postgresql://investment_sync@127.0.0.1:55418/investment_sync_test pnpm --filter @investment-sync/api test src/services/import-service.integration.test.ts --testTimeout=30000
```

Use a disposable migrated database for the SQL tests; their reset helper truncates test tables. The local URL above was used for this audit, not for production. Convex bindings and registered function signatures are unchanged, so no code generation or deployment is required.
