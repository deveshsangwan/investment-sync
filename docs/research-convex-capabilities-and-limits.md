# Convex capabilities and limits relevant to an investment-sync migration

Research date: 2026-08-29

This note is deliberately narrower than the repository architecture review. It records the current Convex behavior that constrains a redesign of this project. Product documentation and source owned by Convex are the only external sources used.

## Bottom line

Convex can express the user-visible atomic publication this project needs, but it cannot safely express every allowed Import Batch as one mutation. The repository accepts as many as 25,000 normalized rows per batch in [`import-lifecycle.ts`](../packages/api/src/services/import-lifecycle.ts), while one Convex query or mutation may scan at most 32,000 documents, write at most 16,000 documents, read or write at most 16 MiB, and execute at most one second of user code. A commit also creates or updates accounts, instruments, transactions, snapshots, valuations, and bookkeeping rows, so its real document count is higher than the normalized-row count. [Convex limits](https://docs.convex.dev/production/state/limits)

The native design is a staged, versioned import. A Node action parses the stored file and calls bounded, idempotent mutations to write a candidate portfolio version. A final small mutation verifies the candidate's completion markers and atomically changes the household's active version pointer. Until that pointer changes, queries only expose the old version. This retains atomic visibility without asking one transaction to materialize the whole portfolio.

Convex is a worse fit for the current SQL-heavy compute-on-read paths. It has no database query language for joins, `GROUP BY`, or general aggregates. JavaScript queries can perform those operations only after bounded indexed reads. Convex's own guidance points large counts and sums toward denormalized counters or the Aggregate component. For this repository, most dashboard summaries, current holdings, allocation totals, and time-series summary points should be computed when a portfolio version is built, then read as small indexed documents. [Reading data](https://docs.convex.dev/database/reading-data/) [Aggregate component source](https://github.com/get-convex/aggregate)

The largest data-model gap is decimal arithmetic. The current Postgres schema uses `numeric(28,10)`, `numeric(28,4)`, and `numeric(12,6)` throughout [`schema.ts`](../packages/db/src/schema.ts). Convex has IEEE-754 Float64 and signed Int64, but no arbitrary-precision decimal type. Exact amounts and quantities need canonical decimal strings or explicitly scaled Int64 values after a range audit. Float64 is suitable for display-only ratios and approximate analytics, not the stored financial source of truth. [Convex data types](https://docs.convex.dev/database/types)

## Transactions, atomicity, and retries

Every query and mutation is a serializable transaction. A mutation queues its writes and commits them together. Convex uses optimistic concurrency control, detects conflicting reads and writes, and automatically retries deterministic mutations. Other transactions never observe a partial mutation. [OCC and atomicity](https://docs.convex.dev/database/advanced/occ) [Convex overview](https://docs.convex.dev/understanding/overview)

Automatic retry is not infinite. Under sustained contention, Convex can exhaust its internal conflict retries and return a write-conflict system error. A single household publication pointer is reasonable for this private app because concurrent commits should be rare, but it remains a hot document if the product later permits many parallel writers to one household. [Write conflict errors](https://docs.convex.dev/error)

The React client retries a mutation call until the server confirms it and the backend ensures that one client mutation call executes once despite transport retries. This protects a mutation response lost during a network interruption. It does not replace a domain idempotency key across distinct client calls, a restarted action, a migration rerun, or two users submitting the same file independently. Those cases still need stored keys and mutation logic. [Convex React retries](https://docs.convex.dev/client/react/overview)

Scheduled mutations have a stronger explicit guarantee. Once scheduled, a mutation executes exactly once and Convex retries internal errors. A scheduled action executes at most once and is not automatically retried. Scheduling from a mutation commits atomically with that mutation, while scheduling from an action remains in place even if the action later fails. Authentication is not propagated to the scheduled function. [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions) [Scheduler API](https://docs.convex.dev/api/interfaces/server.Scheduler)

These guarantees support an import state machine:

1. An authenticated mutation records the Import Batch and atomically schedules parsing.
2. The parsing action performs external I/O and CPU-heavy parsing. It records results only through internal mutations.
3. Each staging mutation uses a stable key such as `(batchId, rowNumber, parserVersion)` and treats an already-applied chunk as success.
4. A final mutation checks expected row and chunk counts, marks the candidate complete, and changes the active version pointer in the same transaction.
5. A failed or lost action leaves a visible, non-active candidate. A retry mutation can schedule a fresh action, which resumes from completion markers. A cron can detect abandoned work, but it should not infer success from elapsed time.

An action is intentionally not a transaction. It cannot access `ctx.db` directly and uses `ctx.runQuery` and `ctx.runMutation`, each of which is a separate transaction. Actions can call third-party APIs and perform non-deterministic work, but Convex does not automatically retry them because their side effects may already have happened. Convex recommends capturing client intent in a mutation and scheduling the action instead of calling an action directly from the client. [Functions overview](https://docs.convex.dev/functions/overview) [Actions](https://docs.convex.dev/functions/actions)

## Hard limits that affect this project

The current central limits page gives these per-function and per-transaction ceilings. The design should leave headroom instead of filling a transaction to its documented maximum. [Convex limits](https://docs.convex.dev/production/state/limits)

| Limit                            |                                         Current value | Consequence here                                                                                        |
| -------------------------------- | ----------------------------------------------------: | ------------------------------------------------------------------------------------------------------- |
| Query or mutation user-code time |                1 second, database operations excluded | Do not parse workbooks or run portfolio-wide analytics in a mutation.                                   |
| Data read per query or mutation  |                                                16 MiB | Bound every version read and staging mutation.                                                          |
| Data written per mutation        |                                                16 MiB | Chunk normalized and materialized rows.                                                                 |
| Documents scanned                |                                                32,000 | A 25,000-row batch leaves too little room for dedupe and related reads.                                 |
| Index ranges read                |                                                 4,096 | Avoid per-row lookup loops for thousands of instruments or accounts.                                    |
| Documents written                |                                                16,000 | One 25,000-row commit is impossible even before derived writes.                                         |
| Function arguments and return    |                                                16 MiB | Pass storage IDs and chunk references, not whole workbooks. Node action arguments are limited to 5 MiB. |
| Convex runtime action            |                                30 minutes, 64 MiB RAM | Suitable for network orchestration, not memory-heavy workbook parsing.                                  |
| Node runtime action              |                               10 minutes, 512 MiB RAM | The likely home for the existing XLSX and PDF parser dependencies.                                      |
| Concurrent I/O operations        |                                                 1,000 | Do not fan out one query or mutation per imported row.                                                  |
| Document size                    |                                                 1 MiB | Store one normalized row or bounded summary per document, not an entire batch array.                    |
| Array elements                   |                                                 8,192 | A batch cannot be one document even if its byte size happened to fit.                                   |
| Indexes per table                |                                                    32 | Compound indexes need to follow actual query shapes.                                                    |
| Fields per index                 | 16, including the automatic creation-time tie-breaker | Composite identities fit, but should stay intentional.                                                  |
| Full-text results scanned        |                                                 1,024 | Not material to portfolio analytics; full-text search is not an analytics engine.                       |

Convex provides `getConvexSize`, per-transaction metrics, pagination byte and row limits, and nested transaction budgets. Its documented batching pattern processes as much as fits, schedules another mutation, and continues in a fresh transaction. [Writing data](https://docs.convex.dev/database/writing-data) [Pagination](https://docs.convex.dev/database/pagination)

Deployment class also affects concurrency. Free and Starter use S16, which permits 16 concurrent queries, 16 concurrent mutations, 64 Convex actions or HTTP actions, 64 Node actions, and 8 scheduled jobs. Professional uses S256 with materially higher limits. The private scale of this repository probably does not require S256 for user traffic, but several simultaneous large import pipelines can saturate S16's scheduled-job concurrency. The staging worker should therefore have deliberate parallelism rather than scheduling one job per row. [Convex limits](https://docs.convex.dev/production/state/limits)

The scheduled-functions page says one function may schedule 1,000 functions with 8 MB of total arguments, while the central limits page currently says 16 MiB total and 4 MiB per scheduled function. This documentation is inconsistent. It does not affect the proposed design because scheduled arguments should contain IDs and cursors only. [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions) [Convex limits](https://docs.convex.dev/production/state/limits)

## Query model, indexes, search, and pagination

Convex document queries support ID reads, ordered index ranges, filters, bounded collection, and cursor pagination. A `.filter()` does not narrow the database scan. It examines documents already selected by the index range, and filtered-out documents still count against scan and bandwidth limits. Equality fields in a compound index must be constrained in index order before an optional range. [Indexes](https://docs.convex.dev/database/reading-data/indexes/) [Index performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf)

Indexes are not uniqueness constraints. The schema API defines ordered, non-unique indexes and Convex appends `_creationTime` as a tie-breaker. `.unique()` is a read assertion that returns zero or one document and throws if duplicates already exist. This is materially different from the current Postgres unique and partial-unique indexes. [Indexes](https://docs.convex.dev/database/reading-data/indexes/) [Query `unique()` API](https://docs.convex.dev/api/interfaces/server.QueryInitializer)

Uniqueness can still be enforced through one mutation path. The mutation reads the exact compound-key range, then inserts or updates. Serializable OCC makes concurrent callers conflict on that range, so the retried caller sees the first result. All writers, including migration tools and maintenance functions, must use the same invariant-preserving helper. `.unique()` should remain in reads so corruption fails loudly. This application-level rule needs explicit tests because the database schema will no longer reject an out-of-band duplicate.

For this repository, likely compound keys include Clerk subject, household membership, normalized account identity, canonical instrument identity, import file hash plus parser version, source transaction identity, snapshot identity, and portfolio version plus row identity. Partial uniqueness such as "only committed batches are unique" should become an explicit dedupe-key document or an exact lookup over a status-aware key inside the publication mutation. Convex does not have a Postgres-style partial unique index.

There is no native SQL join, `GROUP BY`, or general aggregate query. Small bounded joins can load related documents by ID in parallel. Small bounded aggregates can use JavaScript. Larger or repeatedly-read results need compute-on-write documents or a component. [Reading data](https://docs.convex.dev/database/reading-data/)

The official Aggregate component maintains counts and numeric sums in a separate component data structure with logarithmic reads. Source-table writes and aggregate updates can be atomic when invoked from the same mutation. It must be updated on every source write or it can drift, and its own documentation describes contention and overly broad reactive invalidation when many values share internal nodes. For household-scoped portfolio totals, straightforward versioned summary documents are easier to audit and reconcile than a generic aggregate tree. [Aggregate component](https://github.com/get-convex/aggregate)

Cursor pagination is reactive. Pages may grow or shrink after inserts and deletes, and Convex's React hook keeps pages adjacent. `maximumRowsRead` and `maximumBytesRead` can force page splitting before a query consumes its full transaction budget. This is a fit for transaction history and import-row inspection, but not a substitute for a precomputed dashboard summary. [Paginated queries](https://docs.convex.dev/database/pagination) [Pagination options](https://docs.convex.dev/api/interfaces/server.PaginationOptions)

Full-text search supports one string search field, up to 16 filter fields, reactive cursor pagination, at most 16 search terms and 8 query filters, and at most 1,024 results from the search index. Search order is relevance only. Nothing in the current portfolio domain appears to justify moving financial lookup or analytics to full-text search. Exact compound indexes are the right tool for instruments, accounts, dates, and identities. [Full-text search](https://docs.convex.dev/search/text-search)

## Realtime data and caching

Convex caches deterministic query results by function and arguments. It tracks database dependencies, invalidates affected results on writes, reruns subscribed queries, and pushes new results to clients. Cached reads do not incur database bandwidth. Client subscriptions are presented at a consistent logical database snapshot. [Realtime](https://docs.convex.dev/realtime) [Query functions](https://docs.convex.dev/functions/query-functions)

The React client maintains a WebSocket, reconnects after a dropped connection, and restores subscriptions. The same client library supports React Native and Expo. Convex documents connection-state changes, but the cited documentation does not promise a durable, application-restart offline query store. The mobile redesign should treat live reconnection as supported and durable offline portfolio viewing as a separate feature requiring explicit local persistence. [Convex React](https://docs.convex.dev/client/react/overview) [React Native quickstart](https://docs.convex.dev/quickstart/react-native) [React API](https://docs.convex.dev/api/modules/react)

This removes most manual cache invalidation from the repository. It does not make an expensive query cheap. If a dashboard query reads thousands of holdings and snapshots, every relevant write can rerun that work and consume a function call for every active subscription update. The central limits page explicitly counts subscription updates as function calls. Versioned summary and current-holding read models keep subscriptions narrow and make an active-version publication a cheap invalidation. [Convex limits](https://docs.convex.dev/production/state/limits)

Time-dependent queries need care. A query does not rerun merely because wall-clock time advances, and frequent `Date.now()` use hurts cache reuse. Convex recommends storing a coarse state changed by a scheduled function or passing a rounded time argument. Expiry and 30-day Source File retention should therefore be handled by indexed scheduled cleanup, not by expecting subscribed queries to expire records on their own. [Convex best practices](https://docs.convex.dev/understanding/best-practices)

## Numeric precision and dates

Convex's numeric values are Float64 and signed Int64. Float64 includes the usual IEEE-754 behavior, so decimal fractions such as 0.1 are not exact. Int64 is represented as JavaScript `bigint` and ranges from `-2^63` through `2^63 - 1`. Convex has no decimal value type. [Convex data types](https://docs.convex.dev/database/types)

The migration must define fixed-point contracts by field, rather than converting every Postgres `numeric` to `number`:

- Currency amounts can use an Int64 minor unit with an explicit scale, such as 4 decimal places if that matches the import contract. The production range must be audited before choosing the scale.
- Prices and quantities currently allow 10 decimal places. An Int64 scaled by `10^10` may be safe for actual data but does not cover the full theoretical range of `numeric(28,10)`. If the full range matters, store canonical decimal strings and use a tested decimal library in Node actions and pure domain helpers.
- Percentages and XIRR outputs can be stored as a documented scaled integer or as Float64 if they are explicitly approximate display analytics. Do not silently mix the two meanings.
- Precomputed summary documents should carry exact source totals and any approximate display value separately when calculation requires division.

Convex's JSON representation serializes Int64 as a base-10 string. Its direct HTTP Functions API currently uses a simplified JSON format that does not support every Convex type unambiguously. External migration and reconciliation scripts should use the official TypeScript client where possible, or explicitly encode fixed-point strings at the boundary. [Convex data types](https://docs.convex.dev/database/types) [Convex HTTP API](https://docs.convex.dev/http-api/)

Convex has no separate date or timestamp type in its supported value list. Store civil financial dates such as `tradeDate`, `snapshotDate`, and `valuationDate` as validated `YYYY-MM-DD` strings. They sort correctly in indexes and avoid timezone shifts. Store instants as epoch milliseconds in Float64, which exactly represents contemporary millisecond timestamps, or Int64 if one uniform fixed-point time representation is preferred. This is an inference from the documented value types, not a Convex-prescribed schema.

## File storage and import processing

The native upload flow has three steps. An authenticated mutation generates a short-lived upload URL, the client posts the file directly and receives a `_storage` ID, then another mutation records that ID in the application's data model. Upload URLs expire after one hour. File size is not capped by a byte limit, but the upload POST has a two-minute timeout. [Uploading files](https://docs.convex.dev/file-storage/upload-files)

This maps well to the repository's upload-first workflow. The Source File should remain a first-class document with its storage ID, checksum, content type, original name, uploader, retention deadline, and batch link. The stored file should be passed to the parser by ID. Passing file bytes as mutation or Node action arguments would hit argument limits and waste serialization.

Actions and HTTP actions can store a `Blob` and receive a storage ID. Storage metadata lives in the `_storage` system table. A parser action can fetch the stored Blob, parse it, and call bounded internal mutations for normalized rows. [Storing generated files](https://docs.convex.dev/file-storage/store-files) [Storage action API](https://docs.convex.dev/api/interfaces/server.StorageActionWriter)

`storage.getUrl()` returns a bearer URL. Anyone with it can read the file, it has no application-level authorization check on reuse, and the only way to revoke it is to delete the file. If access can change, an HTTP action can authorize each request and proxy the bytes, but HTTP action responses are capped at 20 MiB. Original financial exports are sensitive, so the application should avoid handing long-lived storage URLs to clients unless bearer access is explicitly acceptable. [File storage security](https://docs.convex.dev/file-storage/overview)

Cleanup needs two coordinated operations: delete the Source File metadata according to the domain lifecycle and delete the `_storage` object. `storage.delete()` is available inside a mutation, so the normal cleanup path need not use an action. The cleanup handler should still be idempotent and deliberate about whether a missing metadata document or storage object means success, because operators and migration scripts can change either one out of band. [Deleting files](https://docs.convex.dev/file-storage/delete-files)

## Authentication, authorization, and API boundaries

The existing Clerk choice can remain. Convex has a first-party Clerk integration for Next.js and its provider accepts `@clerk/clerk-expo` for React Native. Convex validates the Clerk token, refreshes it through the client provider, and exposes the identity through `ctx.auth.getUserIdentity()`. [Convex with Clerk](https://docs.convex.dev/auth/clerk) [React Clerk API](https://docs.convex.dev/api/modules/react_clerk)

Convex authentication does not supply row-level security or an authorization framework. Public functions are callable by clients and must check authentication and household membership in code. Convex recommends making non-client operations internal functions and performing access checks in every public entry point. This keeps the current household authorization domain but moves enforcement into shared Convex helpers instead of tRPC middleware plus SQL predicates. [Authentication overview](https://docs.convex.dev/auth/overview) [Auth in functions](https://docs.convex.dev/auth/functions-auth) [Internal functions](https://docs.convex.dev/functions/internal-functions)

The guaranteed identity fields are `tokenIdentifier`, `subject`, and `issuer`. The Clerk subject can remain the stable external user key, with a Convex user document for household relations. If users are synchronized by webhook, the HTTP action must verify the provider signature before calling internal upsert/delete mutations. [Storing users](https://docs.convex.dev/auth/database-auth)

For web and mobile, generated Convex queries, mutations, and actions replace the application's tRPC transport and React Query invalidation layer. Public functions already form a type-generated API. Server-side or non-reactive consumers can use `ConvexHttpClient` or the Functions HTTP API. Custom HTTP actions on the `.convex.site` domain cover webhooks and special endpoints. [Functions overview](https://docs.convex.dev/functions/overview) [HTTP API](https://docs.convex.dev/http-api/) [HTTP actions](https://docs.convex.dev/functions/http-actions)

HTTP actions support standard routed HTTP methods and built-in user identity when called with a bearer JWT. The limits page states that HTTP action requests have no specific size limit and responses are capped at 20 MiB. Direct storage upload URLs remain the better file-ingestion path because they avoid tying a parser or API response to an uploaded file's transfer. [HTTP actions](https://docs.convex.dev/functions/http-actions) [Convex limits](https://docs.convex.dev/production/state/limits)

## Scheduled and background work

Recurring jobs live in `convex/crons.ts` and can invoke mutations or actions by interval, cron expression, or hourly, daily, weekly, and monthly helpers. Times are UTC. At most one run of a given cron executes at once; if the prior run is still running, Convex may skip a later run rather than build an ever-growing backlog. [Cron jobs](https://docs.convex.dev/scheduling/cron-jobs)

That behavior fits periodic currency-rate refresh, expired Source File cleanup, and abandoned-import detection only if each job scans by a bounded index and schedules continuations. A cron is not a catch-up queue. Import completion should be driven by persisted state plus scheduled work, with the cron as repair, not as the main orchestrator.

Scheduled functions are durable database records and can run months in the future. Results remain visible for seven days. Because auth is not carried into them, scheduling mutations should persist the authorized household and actor IDs, and the internal worker should re-read current authorization or apply a documented "authorized at submission" rule. [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)

## Import, export, migration, and rollback facilities

The CLI can import CSV, JSON, or JSON Lines into one table and restore a Convex backup ZIP. Single-table imports fail on non-empty tables by default, with explicit append and replace modes. JSON arrays have an 8 MiB limit, so JSON Lines is the practical bulk format. Production import requires `--prod`. Data import is currently documented as beta. [Data import](https://docs.convex.dev/database/import-export/import)

Create and replace imports are atomic and do not expose intermediate table states. Append is the exception and is not atomic. ZIP restore preserves Convex `_id` and `_creationTime` values and can include file storage. Existing Postgres UUIDs are not valid Convex document IDs, and the docs require imported `_id` fields to use Convex's ID format. A Postgres migration therefore needs a legacy-ID field and an explicit old-ID to new-ID map. Manually fabricating or editing a Convex backup ZIP is undocumented and should not be the migration plan. [Data import](https://docs.convex.dev/database/import-export/import)

Convex also documents streaming import from an existing database through an Airbyte destination connector, and continuous export through Fivetran. The whole import/export area is labeled beta. For this small private application, a repeatable, checksummed migration program is easier to reason about than introducing a streaming connector solely for cutover. [Data import and export](https://docs.convex.dev/database/import-export/)

The migration component supports resumable online data changes and dry runs within Convex. It is useful after initial loading for backfilling new read models or converting optional fields. It does not solve cross-system ID mapping or provide an atomic transaction spanning Supabase and Convex. [Writing data migrations](https://docs.convex.dev/database/writing-data) [Migrations component source](https://github.com/get-convex/migrations)

Backups are consistent table snapshots and can optionally include file storage. Manual backups are retained for seven days. Scheduled daily or weekly backups require Pro. Backup data does not include code, environment variables, or scheduled-function configuration. Restoring is destructive for database data, and files already present but absent from the backup are not deleted. Rollback procedures must therefore version code and configuration separately and audit storage after restore. [Backup and restore](https://docs.convex.dev/database/backup-restore)

## Deployment and cutover

A Convex project has a shared production deployment and separate development deployments. A separate project can serve as permanent staging, and supported hosting flows can create per-branch preview deployments. `npx convex deploy` typechecks, regenerates API types, bundles functions, then pushes functions, indexes, and schema. New functions become available when the deployment succeeds. [Production deployment](https://docs.convex.dev/production/overview) [Deploy CLI](https://docs.convex.dev/cli/reference/deploy)

Convex rejects a schema deployment when existing data does not match. Safe changes use expand, migrate, contract sequencing: add optional or union-compatible fields, backfill, then tighten the schema. Large indexes can be staged and backfilled before they are enabled. [Production deployment safety](https://docs.convex.dev/production/overview) [Staged indexes](https://docs.convex.dev/database/reading-data/indexes/)

The application client selects a deployment through its Convex URL, including `NEXT_PUBLIC_CONVEX_URL` on Next.js and `EXPO_PUBLIC_CONVEX_URL` in Expo. This makes cutover an application configuration and deployment event. Keep the Postgres system unchanged or read-only through a reconciliation window, switch web and mobile reads together where release mechanics permit, and retain the ability to point the web app back. Mobile releases cannot be assumed to update instantly, so old API compatibility or a forced minimum version may be needed during the window. [Deployment URLs](https://docs.convex.dev/client/react/deployment-urls) [React Native quickstart](https://docs.convex.dev/quickstart/react-native)

Convex CLI `--replace` can atomically load tables into a deployment, but a foreign migration still has conversion and reference work. A safer practical sequence is:

1. Deploy the final Convex schema and backend to a staging or production deployment with no user traffic.
2. Export a repeatable Postgres snapshot plus a Supabase Storage manifest and checksums.
3. Transform all values, create legacy-ID maps, upload files, and load candidate version documents.
4. Reconcile counts, exact fixed-point totals, identity uniqueness, hashes, and sampled user-visible queries against Postgres.
5. Stop writes briefly, apply the final delta or rerun the idempotent snapshot, reconcile again, and publish the active versions.
6. Switch clients. Preserve Postgres and Supabase Storage without new writes until the rollback window closes.

A short write freeze plus one-shot, idempotent migration is a better fit than dual-write for this repository. Dual-write would have to reconcile different transaction boundaries, file stores, uniqueness behavior, and computed read models. It adds the hardest part of a distributed system during a one-time private-app cutover. Streaming import remains available if production scale turns out to be much larger than the repository suggests, but its beta status and lack of cross-system publication atomicity make it a second choice.

## Testing consequences

`convex-test` provides a fast JavaScript mock for query, mutation, action, auth, scheduled-function, and storage logic. It does not enforce size or time limits, does not reproduce production ID formats, simplifies search, and does not run cron jobs. Tests that pass there can still fail on a 25,000-row import or a production runtime boundary. [convex-test](https://docs.convex.dev/testing/convex-test)

The open-source local backend runs the actual Convex backend and enforces argument, data, and query-size limits. It can load a large dataset and test clients with the backend. It offers less control over time and dependencies, cannot mock fetch, and runs scheduled work and crons unless the test setup disables them. [Testing local backend](https://docs.convex.dev/testing/convex-backend)

The migration test strategy should use both:

- `convex-test` for domain invariants, auth boundaries, idempotent chunk application, publication-pointer atomicity, exact-key dedupe, and expected failure states.
- A real local or preview deployment for maximum-size imports, document byte sizing, action runtime and memory, file upload and parsing, scheduler continuation, concurrent commits, OCC conflicts, query scan limits, and end-to-end web/mobile subscriptions.
- Golden reconciliation fixtures shared with the existing Postgres integration tests for exact numeric conversion, source identity, transaction dedupe, current holdings, valuations, and portfolio summaries.

## Claims that should not be assumed

- Automatic query caching is not a license to preserve unbounded compute-on-read analytics.
- Mutation transport deduplication is not domain deduplication across separate calls or actions.
- An index plus `.unique()` is not a database unique constraint.
- Realtime reconnection is not documented durable offline storage.
- File storage IDs are safe identifiers, while URLs returned by `getUrl()` are bearer credentials.
- A cron can skip a run when the previous run overlaps, so it is not a durable backlog processor.
- A backup does not restore code, environment variables, or scheduled configuration.
- Convex Float64 does not preserve Postgres `numeric` semantics.
- CLI data import atomicity does not make a user-driven 25,000-row mutation possible.
