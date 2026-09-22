# Convex architecture and migration review

Review date: 2026-08-29

## Executive recommendation

Stay on Postgres/Supabase, but redesign the read side around explicit source snapshots and compute-on-write portfolio views. Do not partially adopt Convex.

This recommendation is based on long-term architecture quality, not only migration cost. The hardest and most important operation in this repository is a large, exact, source-sensitive Commit. Postgres already gives it decimal storage, uniqueness constraints, row and advisory locking, repairable SQL, and one transaction that can update facts and visible read models together. Convex would replace that with a durable multi-transaction publication engine because the application accepts 25,000 normalized rows while a Convex mutation can write at most 16,000 documents and 16 MiB. That engine is technically sound, but it is more machinery around the application's central write path.

The best Convex benefits are real but smaller here. It would remove the split Next/tRPC/Postgres/Supabase path, the invalid cache hierarchy, and much of the Effect roadmap. It would give web and mobile one reactive data interface. This is a manual-import, read-mostly private application, however. It can obtain the main performance and correctness win by materializing current positions, summaries, allocation, and timeline data in the existing Commit transaction, then deleting the raw current/exited CTE and process cache.

A full Convex-native migration remains viable if Convex is a strategic platform choice. The rest of this report defines the only design I would approve: explicit source snapshots, bounded idempotent staging, versioned read models, and one atomic Household pointer change. Do not port the Drizzle tables or SQL literally.

Partial adoption is the weakest option. A Postgres write model plus Convex read replica would introduce cross-database synchronization and two definitions of publication. Convex Storage alone does not justify a migration. Convex queries in front of the existing SQL backend would preserve most of the current complexity.

Do not continue the broad Effect roadmap while this backend decision is open. Under the recommended Postgres direction, retain Effect only where it already clarifies external I/O and compensation. Do not migrate pure analytics, membership, or portfolio projection code merely for consistency.

## Scope and evidence

This review is based on the repository at commit `c520014` on `feat/tanstack-charts`. I traced the schema and migrations, every production SQL expression, upload and Commit paths, portfolio reads, web and mobile calls, authorization, caches, scheduled work, Effect code and plans, and the relevant test suites.

The workspace test command passes, but 43 API integration tests and one database migration test are skipped because the configured test database is unavailable. Mobile has no tests. Production row and file counts could not be measured because the configured database refused connections. The repository proves a 4 MB source-file limit, a 25,000 normalized-row limit per batch, and unbounded historical accumulation. It does not prove production scale.

Current Convex constraints were checked against official documentation. The supporting note is [research-convex-capabilities-and-limits.md](research-convex-capabilities-and-limits.md).

### Repository evidence index

- Database model and constraints: [`packages/db/src/schema.ts`](../packages/db/src/schema.ts) and [`packages/db/drizzle`](../packages/db/drizzle)
- Upload, storage, parsing, and cleanup: [`packages/api/src/services/import-lifecycle.ts`](../packages/api/src/services/import-lifecycle.ts)
- Commit transaction and dedupe: [`packages/api/src/services/import-service.ts`](../packages/api/src/services/import-service.ts)
- Current/exited SQL projection: [`packages/api/src/services/portfolio/latest-holdings.ts`](../packages/api/src/services/portfolio/latest-holdings.ts)
- Portfolio composition and request reads: [`packages/api/src/services/portfolio/overview.ts`](../packages/api/src/services/portfolio/overview.ts) and [`packages/api/src/services/portfolio/data.ts`](../packages/api/src/services/portfolio/data.ts)
- Process and request caches: [`packages/api/src/services/portfolio-cache.ts`](../packages/api/src/services/portfolio-cache.ts), [`packages/api/src/services/portfolio/cache.ts`](../packages/api/src/services/portfolio/cache.ts), and [`packages/api/src/context.ts`](../packages/api/src/context.ts)
- Membership and authorization: [`packages/api/src/services/membership.ts`](../packages/api/src/services/membership.ts) and [`packages/api/src/trpc.ts`](../packages/api/src/trpc.ts)
- Web upload and scheduled cleanup adapters: [`apps/web/src/app/api/imports/upload/route.ts`](../apps/web/src/app/api/imports/upload/route.ts) and [`apps/web/src/app/api/cron/cleanup-imports/route.ts`](../apps/web/src/app/api/cron/cleanup-imports/route.ts)
- Current Effect implementation and intent: [`packages/api/src/services/currency-rates.ts`](../packages/api/src/services/currency-rates.ts), [`docs/effect-phase-1.md`](effect-phase-1.md), and [`docs/effect-migration-sequence.md`](effect-migration-sequence.md)
- Load-bearing integration specifications: [`packages/api/src/services/import-lifecycle.integration.test.ts`](../packages/api/src/services/import-lifecycle.integration.test.ts) and [`packages/api/src/services/import-service.integration.test.ts`](../packages/api/src/services/import-service.integration.test.ts)

## 1. Current architecture

### Runtime map

```text
Web browser                         Expo app
     |                                 |
     | Clerk cookie                    | Clerk bearer token
     +---------------+-----------------+
                     |
               Next.js on Vercel
          /api/trpc  /api/imports/upload  /api/cron/cleanup-imports
                     |
              packages/api
       auth membership import portfolio FX
              |                    |
        Drizzle/Postgres      Supabase Storage
              |
     packages/analytics and packages/importers
```

The web app does not prefetch portfolio data on the server. Its pages render client modules that call tRPC hooks. The Expo app calls the same tRPC interface and is read-only. `AppRouter` inference is the main value tRPC supplies.

Clerk establishes identity. The first protected request transactionally creates a user, one Household, an owner membership, and six default accounts. Every later protected request loads the oldest membership for the Clerk user. That creates an unresolved domain ambiguity: the schema allows several memberships, but there is no active-Household selector. Viewer support is incomplete because `auth.me` joins through Household ownership rather than the selected membership.

Every API context eagerly creates both a Postgres and Supabase client, even for portfolio reads that never touch storage. It also carries an untyped request-level promise cache. Postgres uses a process-cached client with one connection and prepared statements disabled.

### Database and Drizzle

`packages/db/src/schema.ts` defines eleven tables:

| Area               | Tables                                                      | Current role                                                                           |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Identity           | `users`, `households`, `household_members`                  | Clerk mapping, ownership, roles                                                        |
| Portfolio identity | `accounts`, `instruments`                                   | Import-time identity resolution. Instruments are global, accounts are Household-scoped |
| Import staging     | `import_batches`, `import_rows`                             | Workflow state, source metadata, normalized JSON, Commit bookkeeping                   |
| Portfolio facts    | `holding_snapshots`, `transactions`, `portfolio_valuations` | Historical holdings, cash flows, explicit valuation points                             |
| Supporting data    | `currency_rates`, `prices`                                  | One persisted USD/INR quote; `prices` has no production reader or writer               |

Money uses Postgres `numeric(28,4)`. Quantities, prices, and rates use `numeric(28,10)`. Percentages use `numeric(12,6)`. Precision is not end to end, however. Importers parse into JavaScript numbers, normalized JSON holds numbers, Commit converts them to strings, and analytics converts database strings back to numbers.

Drizzle handles ordinary reads and writes. The load-bearing Postgres features are:

- a constant `pg_advisory_xact_lock` that serializes every Household's Commit;
- `SELECT ... FOR UPDATE` on the selected Import Batch;
- unique indexes for membership, snapshots, transactions, valuations, rates, and committed-content dedupe;
- `ON CONFLICT DO UPDATE` for holdings, transactions, and valuations;
- a partial unique index for committed `(household, fileHash, parserVersion)`;
- a large raw SQL CTE for current and exited positions.

The migrations are part of the domain record, not disposable history. They show repeated identity and projection corrections:

- 0001 removes duplicate snapshots and transactions before adding unique indexes.
- 0002 deletes aggregate-looking snapshots and semantic duplicates.
- 0003 removes cross-source stock duplicates based on matching values.
- 0006 repairs crypto currency in committed facts, accounts, and pending normalized JSON.
- 0007 adds committed-content partial uniqueness.
- 0009 merges historical NPS account identities and rewrites pending rows.
- 0011 restores workbook EPF snapshots that the earlier aggregate cleanup removed.

The last item is the clearest warning in the repository. Destructive dedupe erased provenance that later had to be recovered from committed normalized rows.

### Import Batch, Source File, Normalized Row, and Commit

The repository's domain language is accurate even though the schema blurs two concepts. Source File metadata and Import Batch state share `import_batches`, but cleanup can remove the object without changing the batch. Source-file availability is therefore independent in behavior.

Upload currently does this in one Next request:

1. Validate extension, MIME type, and the 4 MB limit.
2. Hash the file with SHA-256 and create a `created` Import Batch.
3. Parse the entire CSV/XLSX synchronously and validate every Normalized Row.
4. Reject a Duplicate Import if the same Household already committed the same content with the same parser version.
5. Check or create the private Supabase bucket and upload the Source File.
6. Mark the batch `uploaded`.
7. Insert all normalized rows and transition `uploaded -> parsed` in one Postgres transaction.
8. Return three preview rows for review.

Commit is a second, owner-only operation. One Postgres transaction locks globally, locks the batch, rechecks its status and duplicate key, loads and revalidates every row, resolves identities, upserts facts, marks every row committed, and marks the batch committed. Retrying the same committed batch returns success. A throw rolls everything back. Cache invalidation happens after the transaction.

Important visible guarantees are:

- a failed Commit never changes the visible portfolio;
- retrying the same Commit is idempotent;
- a distinct batch with the same content and parser version conflicts after one commits;
- cross-Household batch IDs appear not found;
- missing, extra, or invalid staged rows cannot publish;
- an expired Source File does not remove parsed data or committed portfolio state;
- parsed data can Commit after the Source File expires;
- an NPS portal CSV beats a same-date workbook NPS row, independent of Commit order;
- a partial source import does not remove unrelated older positions, such as workbook-only EPF;
- identity races do not create duplicate accounts or instruments.

### Portfolio reads and analytics

The genuine holding model is hidden inside `packages/api/src/services/portfolio/latest-holdings.ts`. The raw CTE reconstructs these concepts on every uncached read:

1. A source group keyed by account, provider, asset class, currency, and source sheet.
2. A dated snapshot of the source group.
3. Aggregate fallback rows that count only when detailed rows do not exist for the same group and date.
4. The newest snapshot for each source group.
5. A cross-source canonical position keyed by asset class, currency, and normalized symbol or name.
6. One winning current row for that canonical position.
7. An exit when a position existed in an older group snapshot but is absent from the newest complete snapshot.

Aggregate detection is duplicated in SQL and TypeScript and relies on `sourcePayload.isAggregate`, a source-sheet name, or an instrument name ending in `" Summary"`.

Overview then loads current holdings, explicit valuations, and cash flows, fetches USD/INR if needed, computes summary/allocation/XIRR, and builds a timeline. Asset-class and holding detail paths load broad history sets and group them in memory. No history path is paginated.

`packages/analytics` is mostly sound, pure domain math. It chooses exact cash-flow XIRR when transactions exist, then source XIRR, then sufficiently long valuation history. It should survive either backend choice.

### Caching and freshness

There are three cache layers:

- React Query caches web and mobile results for 60 seconds and disables focus refetch.
- Each request memoizes membership and portfolio promises in `ApiContext.cache`.
- A module-global Household portfolio cache holds results for 30 seconds.

Commit clears only the module instance that handled it. Other Vercel instances can serve stale data until TTL. The upload UI manually invalidates five query keys but omits holding detail, asset-class detail, and accounts. Other browser sessions and installed mobile clients receive no invalidation.

The cache hierarchy exists because current portfolio reads are broad and expensive. The freshness problem is stack-caused. The source grouping, current/exited rules, and calculations are not.

### Storage, cron, and currency rates

Source files live in a private Supabase bucket for 30 days. No download path exists. Clients only see `sourceFileAvailable`. A daily Vercel cron calls a public route protected by `CRON_SECRET`. Cleanup scans at most 100 expired paths across all Households, deletes objects first, and clears paths only after successful deletion.

USD/INR is fetched lazily from Frankfurter. The module retries one transient failure, uses a six-hour fresh window, falls back to persisted or process-cached data for seven days, then fails. Effect implements the retry, timeout, tagged errors, and process lock.

### Stack-shaped complexity versus domain complexity

| Mostly caused by the current stack                                  | Genuine domain behavior                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Drizzle schema plumbing and SQL migrations                          | Household isolation and owner-only imports                           |
| Global advisory lock and batch row lock                             | One published portfolio state visible atomically                     |
| Partial unique index plus duplicate query plus SQL error inspection | Duplicate Import definition                                          |
| tRPC root/routers, `/api/trpc`, SuperJSON                           | Typed web and mobile data interface                                  |
| Multipart Next route and Supabase admin/bucket handling             | Private Source File, parser version, preview, retention              |
| Vercel cron route, secret, and sweep plumbing                       | Expiry independent from parsed and committed data                    |
| Request cache, process cache, React Query invalidation              | Fresh state after publication                                        |
| Raw current/exited CTE and duplicated aggregate heuristics          | Source groups, full snapshots, omission-as-exit, source priority     |
| Postgres global instrument identity                                 | Stable account and canonical position identities                     |
| Effect bridges and planned runtime/Layers                           | Retry policy for external rate fetches and import work               |
| `expired`, `rowErrors`, per-row `isCommitted`, unused `prices`      | Historical source facts, cash flows, valuation history, XIRR quality |

## 2. Convex-native target architecture

### Target runtime

```text
Next web client                         Expo client
       | Clerk                              | Clerk
       +----------------+--------------------+
                        |
               Convex generated interface
        queries  mutations  actions  internal functions
              |          |          |
          indexed DB   Storage   scheduler and crons
              |
       versioned portfolio read models

Next remains the web host. Clerk remains the identity provider.
packages/importers and packages/analytics remain pure TypeScript modules.
```

Web and mobile should use Convex hooks directly. tRPC, React Query, SuperJSON, the Next tRPC route, and manual invalidation disappear. Installed mobile builds require a temporary read-only compatibility route for `portfolio.summary` and `portfolio.holdings` until the supported upgrade window closes.

Every public Convex function authenticates the Clerk identity and resolves Household membership through one shared helper. Convex supplies authentication, not row-level authorization. Internal workers receive persisted actor and Household IDs and are never public. Final publication rechecks that the initiating actor still has owner authority, so a role change during a long build cannot publish stale authorization.

Keep Household as the ownership concept. Add an explicit active Household selection if multiple memberships are real. If sharing is not a real roadmap item, simplify to one Household per user instead of carrying the current half-implemented member model. Do not keep "oldest membership wins." Create accounts from published source data, not six eager defaults. Sync email by Clerk webhook or only when it changes.

### Make source snapshots explicit

Importers should emit explicit projection metadata rather than leaving reads to infer it:

- `sourceGroupKey`: normalized account/provider/asset-class/currency/source-stream identity;
- `snapshotDate`: civil `YYYY-MM-DD` date;
- `completeness`: whether omission means exit for this source group;
- `granularity`: detailed position, aggregate fallback, transaction, or valuation;
- `sourcePriority`: explicit precedence such as NPS portal over workbook;
- `positionKey`: Household-local canonical identity derived from asset class, currency, and normalized symbol or name;
- `rowFingerprint` or provider transaction ID for dedupe.

This is the central redesign. Current and exited positions become a deterministic projection of explicit source snapshots. They stop being a clever interpretation of loosely related holding rows.

### Versioned portfolio publication

Each Household has `activePortfolioVersionId` and at most one publishing batch. A portfolio version records its base version, Import Batch, parser version, projector version, build attempt, expected counts, bounded final manifest, reconciliation digest, and status. Pinning both code contracts prevents a deployment during a long build from silently mixing semantics.

An Import Batch does not mutate active read models. It builds version-scoped candidate documents:

- complete current and exited position rows for the candidate version;
- Household totals by native currency;
- asset-class totals by native currency;
- summary and XIRR-quality data;
- timeline chunks;
- source-group latest-snapshot pointers;
- immutable position detail/history documents, reusing an older detail version when a position did not change.

The current position list is copied or rebuilt completely for each version because it is small and must be selected by one exact `versionId`. Large history should use structural sharing. A candidate position can point to an older immutable detail document when its history and transactions are unchanged. Changed histories are rebuilt into bounded chunks. Client routes use a stable Household-local position key or legacy alias, never a version-scoped document ID.

Queries first read the Household's active version and then read only documents indexed by that exact version. A Convex query runs against one consistent snapshot, so a pointer change cannot produce a mixture of old and new rows. The final publication mutation is small: validate completion markers and hashes, claim the dedupe key, mark the Import Batch committed, clear the Household publishing slot, and switch `activePortfolioVersionId`.

Compute current/exited/summary/timeline on write. Keep only small, bounded work on read:

- apply the latest persisted FX quote to totals grouped by native currency;
- format or sort a bounded current-position set;
- paginate history and import lists;
- compute display-only ratios from exact stored totals.

Do not rebuild all INR read models when the rate changes. Store exact totals by source currency and combine them with the current rate document. Record the rate version used for any metric whose historical meaning must remain fixed.

### What disappears, remains, and changes

Disappears:

- `packages/db`, Drizzle, postgres.js, schema migrations, and Supabase client code;
- `ApiContext`, tRPC root and routers, `/api/trpc`, SuperJSON, React Query providers;
- request and process portfolio caches plus manual invalidation;
- Next upload proxy, bucket provisioning, Vercel cleanup route, `CRON_SECRET`, `vercel.json` cron;
- the latest-holdings CTE and SQL aggregate helpers;
- `expired` Import Batch status, `rowErrors`, per-row `isCommitted`, and `prices`;
- most planned Effect Layers, runtimes, caches, and transport error mapping.

Remains:

- Next UI, Expo UI, Clerk, Household authorization;
- import file detection and source-specific parsers;
- preview/review/publish experience;
- source content hash and parser-version dedupe;
- identity normalization, source precedence, history, transactions, valuations;
- analytics and XIRR policy;
- Source File retention and availability metadata;
- tests that describe user-visible behavior.

Redesigned:

- Source File becomes its own document;
- Normalized Rows become bounded immutable chunks;
- Commit becomes asynchronous version publication;
- accounts and instruments become Household-scoped identities with explicit keys;
- holding snapshots become explicit source snapshots plus versioned read models;
- transaction dedupe uses source identity or occurrence-aware fingerprints;
- currency rates become scheduled persisted data rather than a request cache;
- migrations become repeatable data transforms and read-model rebuilds.

## 3. Benefits and costs

### Specific gains

The client path becomes much smaller. Roughly 400 production lines around tRPC setup, four thin routers, two client providers, the tRPC route, and cache glue can disappear along with `@trpc/*`, React Query, and SuperJSON. This is a gross deletion, not a claim that all domain logic vanishes.

The data-stack deletion is larger. The Drizzle schema, database client, and SQL migrations total about 1,100 lines. The upload and cleanup adapters, Supabase bucket code, cache modules, and Postgres-specific error translation also disappear. Most of `packages/api` is replaced by Convex functions rather than preserved as a second backend tier.

More important than line count:

- all clients observe a published version through one reactive interface;
- cross-instance cache invalidation ceases to be a problem;
- the web browser uploads directly to private backend storage instead of proxying bytes through Next;
- scheduled work is stored with backend state and needs no public cron route or secret;
- per-Household publication replaces the global advisory lock;
- current/exited and aggregate rules live in one projector rather than SQL plus TypeScript plus cleanup migrations;
- immutable normalized source data remains available for repair and projection rebuilds;
- first-use provisioning fits one mutation without unique-violation recovery;
- a failed candidate build leaves the active version untouched and can be inspected or retried.

The expected net line reduction is modest, not dramatic. A correct chunked publisher, read-model builder, and migration/rebuild tooling will replace much of the deleted import and portfolio code. The quality gain comes from explicit domain state and one freshness model, not fewer lines by itself.

### Where Convex is worse

Convex makes Commit harder. The current Postgres transaction is a strong fit for the existing synchronous contract. The versioned publisher adds a durable state machine, chunk receipts, cleanup, rebase checks, and progress UI.

Convex removes database-enforced uniqueness, foreign keys, partial indexes, and checks. Every writer must use invariant-preserving mutation helpers. Maintenance and migration code can corrupt logical uniqueness if it bypasses them.

Postgres `numeric` is a better authoritative financial type. Convex offers Float64 and signed Int64 only. Exact values need scaled integers or canonical decimal strings plus explicit arithmetic code.

Postgres is better for one-off audit, repair, joins, grouping, and ad hoc analytics. The history migrations in this repository would be harder to express under Convex limits. Every future projection policy change needs a tested, resumable read-model rebuild.

Reactive queries do not make broad computation free. A port of the current CTE into JavaScript would be slower, limited, and rerun for subscribers. The target only works with bounded indexed queries and materialized views.

Convex adds vendor lock-in across storage, functions, scheduler, database, client subscriptions, and generated types. Backups do not include code, environment variables, or scheduled configuration.

Installed mobile versions cannot switch atomically with the backend. A compatibility window is mandatory unless the app enforces a minimum version.

## 4. Import and Commit redesign

### State model

Separate Source File state from Import Batch workflow state.

Source File states:

```text
reserved -> stored -> deleted
               \-> delete_failed -> deleted
```

Import Batch states:

```text
awaiting_upload -> uploaded -> parsing -> parsed -> publishing -> committed
                       |          |          |
                       +----------+----------+-> failed
```

`expired` is not an Import Batch state. A committed or parsed batch can have a deleted Source File.

### Upload and parse

1. An owner-only mutation creates the Import Batch and Source File reservation and returns a short-lived upload URL.
2. The browser posts the file directly and receives a storage ID.
3. A second owner-only mutation validates file metadata, attaches the storage ID, sets the 30-day deletion time, and atomically schedules an internal parse action.
4. A Node action loads the blob, validates the actual byte size and type, hashes it, selects the parser, and produces canonical rows. The current `xlsx` dependency belongs here.
5. The action sends bounded chunks to internal mutations. Each chunk has `batchId`, `attemptId`, `chunkIndex`, `rowCount`, and a digest.
6. A chunk mutation checks the active attempt and exact chunk key. The same digest is a no-op. A different digest is corruption and fails loudly. It updates stored counts only on first insert.
7. A finishing mutation verifies a bounded root manifest assembled from hierarchical chunk manifests, stores the preview and warnings, checks committed-content dedupe, and moves the batch to `parsed`.

Actions are not transactional and are not automatically retried. A client retry mutation or repair cron schedules a new attempt. The new action resumes from persisted chunk receipts. Parsing never infers completion from time alone.

### Publish

1. `beginPublication(batchId)` authenticates an owner, hides cross-Household IDs as not found, confirms `parsed`, and returns success immediately if the same batch already committed.
2. In one mutation it rechecks Duplicate Import, claims the Household publishing slot, records `baseVersionId`, creates a candidate version, and schedules the first internal build step.
3. Internal mutations process bounded batches. They build explicit source snapshots, resolve account and position identity keys, apply source priority, update version-scoped position drafts, and write idempotent chunk receipts.
4. Reducer steps produce exact totals by currency, current and exited positions, timeline chunks, asset-class summaries, detail/history references, and reconciliation digests. They reduce per-chunk receipts into a bounded root manifest so final publication never scans an unbounded receipt set.
5. The final mutation validates the root manifest, rechecks that the initiating actor is still an owner, and requires `household.activePortfolioVersionId === candidate.baseVersionId`. If the base changed, it marks the candidate stale and reschedules a rebuild or reports conflict.
6. The same final mutation inserts the committed dedupe key, switches the active pointer, marks the batch committed, and releases the publishing slot.
7. Reactive queries update together from the new version. Old versions remain for a bounded rollback period and are later garbage-collected in chunks.

### Failure, retry, idempotency, and concurrency

| Case                                        | Required behavior                                                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload never attached                       | Reservation expires; a bounded scheduled scan of reservations deletes known uploads, with a separate operator reconciliation for storage objects that never received an attach mutation |
| Parse action fails                          | Batch records a typed failure; Source File remains until retention; retry creates a new attempt                                                                                         |
| Parse action times out after writing chunks | Retry sees matching chunk digests and resumes                                                                                                                                           |
| Build step fails                            | Candidate remains invisible; retry resumes from receipts                                                                                                                                |
| Final validation fails                      | Active pointer remains unchanged; candidate is failed for inspection                                                                                                                    |
| Same batch published twice                  | Return the original committed row count and version                                                                                                                                     |
| Different batch, same content/parser        | Committed dedupe document causes conflict                                                                                                                                               |
| Two owners publish concurrently             | Household publishing slot serializes them. The loser conflicts or waits                                                                                                                 |
| Base version changes unexpectedly           | Candidate cannot publish. Rebuild against the new base                                                                                                                                  |
| Worker abandoned                            | Bounded cron finds stale nonterminal work and schedules a continuation                                                                                                                  |
| Cleanup fails                               | Keep storage ID and `deleteFailedAt`; retry later                                                                                                                                       |

Convex has no unique constraint. Dedupe and identity uniqueness use exact indexed reads followed by insert in the same serializable mutation. All writers, including migrations, must use the same helpers. Dedicated dedupe documents are clearer than recreating partial uniqueness with a status field.

The existing transaction dedupe key can collapse two legitimate identical purchases on the same day. The redesign should use a provider transaction ID when available. Otherwise, importers should emit an occurrence-aware fingerprint scoped to source and statement, not a tuple that omits occurrence.

## 5. Database redesign

### Numeric and date contract

Do not migrate Postgres numerics through JavaScript numbers.

- Raw imported facts use canonical decimal strings. This preserves the declared Postgres range and makes the initial migration safe before production ranges are known.
- After a range audit, read models may use scaled Int64 values: scale 4 for money, scale 10 for quantity/price/rates, and scale 6 for percentages. Keep the scale in the type and field name. Reject overflow.
- If any actual value cannot fit signed Int64 at its required scale, retain canonical strings and use a decimal library inside Node actions and pure projector code.
- XIRR and other iterative ratios may remain Float64 because they are approximate analytics. Store their data-quality classification and inputs separately from exact money.
- Store trade, snapshot, and valuation dates as validated `YYYY-MM-DD` strings. Store instants as epoch milliseconds.

Future parsers should preserve decimal text at the parsing boundary rather than turning it into `number` first.

### Proposed tables and indexes

| Table                     | Purpose                                                                                    | Primary indexes                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `users`                   | Clerk subject and profile metadata                                                         | `by_clerk_subject`                                                       |
| `households`              | Ownership, active version, publishing slot                                                 | `by_owner`; direct ID reads                                              |
| `householdMembers`        | Household role and optional active selection                                               | `by_user_household`, `by_household_user`                                 |
| `accounts`                | Household-scoped normalized account identity                                               | `by_household_identity`                                                  |
| `instruments`             | Household-scoped canonical instrument identity                                             | `by_household_identity`, optional ISIN lookup                            |
| `sourceFiles`             | Storage ID, hash, metadata, uploader, retention                                            | `by_batch`, `by_delete_at`, `by_storage_id`                              |
| `importBatches`           | Parse and publication state, preview, counts, attempt IDs                                  | `by_household_uploaded_at`, `by_household_status`                        |
| `importRowChunks`         | Immutable bounded normalized payloads and digests                                          | `by_batch_chunk`, `by_batch_attempt`                                     |
| `importDedupeKeys`        | One committed content/parser claim per Household                                           | `by_household_key`                                                       |
| `sourceSnapshots`         | Explicit source group/date/completeness/priority for a candidate version                   | `by_version_group_date`, `by_batch`                                      |
| `portfolioVersions`       | Base version, batch, build state, counts, digest                                           | `by_household_created_at`, `by_household_status`                         |
| `publicationReceipts`     | Idempotency and progress per build step/chunk                                              | `by_version_stage_chunk`                                                 |
| `portfolioPositions`      | Complete current/exited list for one version, denormalized labels and exact native amounts | `by_version_status`, `by_version_asset_class`, `by_version_position_key` |
| `positionDetails`         | Immutable detail version and structural-sharing metadata                                   | `by_household_position_created_at`                                       |
| `positionHistoryChunks`   | Bounded dated history and cash-flow pages                                                  | `by_detail_chunk`, optional `by_detail_date`                             |
| `portfolioSummaries`      | One exact totals/read-model document per version                                           | `by_version`                                                             |
| `assetClassSummaries`     | Exact totals and analytics per version/class                                               | `by_version_asset_class`                                                 |
| `portfolioTimelineChunks` | Bounded totals-by-date and currency                                                        | `by_version_chunk`                                                       |
| `currencyRates`           | Current provider quote and freshness state                                                 | `by_pair_provider`                                                       |

Every client-facing position document should contain the labels needed to render it. Convex has no joins, and account or instrument renames should occur through a rebuild or an intentional denormalized update.

### Current-table mapping

| Current Postgres table | Target treatment                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`                | Retain, keyed by Clerk subject with `legacyId` during migration                                                                                  |
| `households`           | Retain; add active-version and publishing state                                                                                                  |
| `household_members`    | Retain only if sharing is real; otherwise merge into user/Household ownership                                                                    |
| `accounts`             | Retain, Household-scope identity explicitly, remove eager defaults                                                                               |
| `instruments`          | Retain concept, make Household-scoped, add canonical identity key                                                                                |
| `import_batches`       | Retain workflow concept but split out Source File and publishing state                                                                           |
| `import_rows`          | Replace with immutable chunk documents; remove row errors and per-row commit flag                                                                |
| `holding_snapshots`    | Replace as client source with explicit source snapshots plus position history/read models. Preserve raw provenance through migrated facts/chunks |
| `transactions`         | Retain as cash-flow/history facts with improved source dedupe identity                                                                           |
| `portfolio_valuations` | Retain as valuation facts, then materialize timeline documents. Add source/batch provenance                                                      |
| `currency_rates`       | Retain as a scheduled current-quote document with freshness metadata                                                                             |
| `prices`               | Remove after a production inventory confirms it is unused                                                                                        |

New concepts are `sourceFiles`, `sourceSnapshots`, `portfolioVersions`, publication receipts, version-scoped positions, summaries, timeline chunks, and immutable detail versions.

## 6. Data migration

### Recommended strategy

Use rehearsed one-shot migration with offline shadow comparison, then a short production write freeze and final repeatable load. Do not dual-write.

Dual-write would need to reconcile Postgres transaction semantics, Convex version publication, two file stores, different identity rules, and different uniqueness guarantees. That creates the riskiest architecture only for the duration of a migration. The current app is a private, import-driven system with no continuous transaction stream, so a short freeze is a better trade.

Run a production inventory before estimating the window. At minimum count every table by Household and status, count normalized rows and facts by batch/source/date, measure JSON and file bytes, list the maximum rows in one Household and Import Batch, and identify orphaned references or duplicate logical keys.

### Extraction and transformation

Take a consistent Postgres snapshot and export in dependency order:

1. users, Households, members;
2. accounts and instruments;
3. Import Batches and normalized rows;
4. holding snapshots, transactions, valuations;
5. currency rates and any nonempty prices;
6. a Supabase Storage manifest.

Export UUIDs as strings, numerics with `column::text`, civil dates as `YYYY-MM-DD`, timestamps in UTC, enums as text, and JSON as lossless JSON. Do not use a generic CSV path that turns decimals into floating point or flattens nested NPS details.

Existing Postgres UUIDs are not valid Convex IDs. Store `legacyId` on migrated documents and maintain a checksummed mapping manifest for every reference. Load parents before children. Holding detail URLs embed snapshot UUIDs, so keep an indexed legacy lookup or a redirect mapping until old bookmarks age out.

The migration transformer should recompute canonical account, instrument, source-group, position, and transaction keys using the target rules. It must report collisions instead of silently choosing a winner. Legacy aggregate rows should become explicit aggregate/valuation facts rather than fake instruments. Preserve every committed Normalized Row as recovery provenance even if the new projector suppresses it.

### Supabase files

Two safe choices exist:

- Copy only currently available files. Download each private object, verify size and SHA-256 against `fileHash`, upload it to Convex, record the storage-ID mapping, and preserve the original `expiresAt`. Do not restart the 30-day clock.
- Leave the short-lived objects in Supabase for their remaining lifetime while legacy cleanup continues, and migrate only availability metadata. This is lower risk because the application has no download or reparse path today.

I prefer leaving existing files in Supabase until they expire unless shutting Supabase down immediately is an explicit goal. New Convex uploads use Convex Storage. This avoids moving sensitive objects that provide no current user-facing capability. If future reparse/download is planned, copy and verify them instead.

### Repeatability and reconciliation

Migration programs need a `migrationRunId`, dry-run mode, immutable input manifest, per-table checkpoints, and idempotent upsert by `legacyId` or deterministic migration key. A rerun must either produce the same target document/digest or stop on divergence.

Reconcile:

- counts by table, Household, Import Batch, row kind, status, source group, date, and currency;
- every parent/reference and legacy-ID mapping;
- exact decimal totals before any Float64 conversion;
- source hashes and retained file bytes;
- committed-content, account, instrument, snapshot, and transaction key uniqueness;
- current and exited positions;
- Household and asset-class totals, allocation, timeline, performance, XIRR source/quality, and representative detail histories;
- cross-Household non-disclosure and owner-only publishing.

Use golden fixtures to run the old Postgres projector and the new Convex projector from the same normalized inputs. Compare semantic outputs, not generated IDs or incidental order.

### Cutover and rollback

1. Rehearse the whole load into a staging Convex project until it is repeatable and reconciliation is clean.
2. Deploy the production Convex schema/functions with no user traffic.
3. Perform a near-final snapshot and shadow comparison.
4. Enable maintenance mode for all writes, including first-login provisioning, uploads, Commit, and rate writes. Old portfolio reads may remain available.
5. Rerun the final idempotent export/load, build active versions, and reconcile.
6. Switch web reads to Convex. Keep Convex imports disabled for a short read-only validation window.
7. Serve old installed mobile versions through a tiny Convex-backed compatibility tRPC route for summary and holdings.
8. Enable Convex uploads and publication only after read parity and subscriptions are proven.
9. Keep Postgres and Supabase read-only through the rollback window.

Before the first Convex-only publication, rollback means switching clients back to Postgres. After it, rollback requires replaying new Convex batches into Postgres or losing post-cutover imports. That first Convex-only Commit is the operational point of no return.

## 7. PR-sized migration sequence

This sequence applies only if Convex is chosen as a strategic platform move despite the recommendation to stay on Postgres. It deliberately proves the risky publication model before moving production data or deleting the current backend.

### PR 0: freeze the executable specification

Goal: close gaps before changing architecture.

Major areas: `packages/api/src/services/import-*.integration.test.ts`, new Postgres-backed portfolio parity fixtures, membership tests, web upload/Commit flow tests, mobile read contract tests.

Behavior unchanged: all production behavior.

Verification: run every current integration test against a real Postgres database. Add golden outputs for current/exited positions, source priority, partial imports, aggregate fallback, all details/timelines, FX failure/staleness, XIRR quality, ordering, and cross-Household hiding.

Delete after PR: nothing.

### PR 1: Convex foundation and authorization

Goal: add Convex deployment, schema skeleton, Clerk configuration, user/Household functions, and invariant helpers without routing production traffic.

Major areas: new `convex/schema.ts`, `convex/auth.config.ts`, `convex/lib/auth.ts`, `convex/users.ts`, `convex/households.ts`; root and app package configuration.

Behavior unchanged: current clients and backend remain authoritative.

Verification: Convex tests for unauthenticated access, first-use atomicity, concurrent provisioning, roles, Household selection, non-disclosure, and logical uniqueness. Decide shared-Household scope and default-account removal here.

Delete after PR: nothing.

### PR 2: canonical source and numeric contracts

Goal: make source group, completeness, granularity, priority, position identity, transaction fingerprint, civil dates, and exact decimals explicit in pure code.

Major areas: `packages/importers/src/types.ts`, parser implementations and tests, new projector/domain helpers shared by migration and Convex. Keep an adapter for the old Commit while it remains live.

Behavior unchanged: existing supported files, warnings, parser versions or deliberately versioned successors, preview meanings, NPS precedence, portfolio outputs.

Verification: all parser fixtures, decimal edge and overflow tests, identity collision tests, old-versus-new normalized semantic parity. Parser contract changes require new parser versions so Duplicate Import semantics remain honest.

Delete after PR: obsolete inferred aggregate/source-group helpers only after both backends use explicit metadata.

### PR 3: Source File upload and parse staging

Goal: implement owner-authorized direct upload, Source File retention, Node parsing action, immutable chunks, progress, retry, and cleanup behind a disabled feature flag.

Major areas: `convex/sourceFiles.ts`, `convex/imports.ts`, `convex/actions/parseImport.ts`, `convex/crons.ts`, test-only upload harness; future web upload adapter behind the flag.

Behavior unchanged: 4 MB application limit, accepted MIME/extensions, SHA-256, three-row preview, warnings, committed-content duplicate definition, privacy, 30-day retention, no portfolio change before publication.

Verification: storage/action tests plus real preview deployment tests for max-size XLSX/CSV, 25,000 rows, action timeout/restart, matching and conflicting chunk replay, cleanup retry, orphan upload, and Household isolation.

Delete after PR: nothing in the production path.

### PR 4: portfolio projector and version publisher

Goal: implement staged candidate versions, explicit source snapshots, current/exited projection, read models, structural-sharing detail history, and the atomic pointer flip.

Major areas: `convex/portfolioVersions.ts`, `convex/internal/publication/*`, `convex/lib/projector/*`, read-model tables and rebuild tooling.

Behavior unchanged: every Commit invariant, partial source carry-forward, same-date source priority, aggregate fallback, transaction/valuation semantics, immediate coherent visibility.

Verification: run golden fixtures through Postgres and the pure projector; Convex tests for idempotent chunks, failed builds, stale base, concurrent publishers, dedupe claims, pointer atomicity, cleanup; real backend tests at documented limits.

Delete after PR: nothing in the production path.

### PR 5: Convex read functions and inactive clients

Goal: expose bounded Convex queries and prepare web/mobile hooks behind one backend switch.

Major areas: `convex/portfolio.ts`, `convex/accounts.ts`, `convex/imports.ts`; web provider and client hooks; Expo provider and hooks; shared display contracts if needed.

Behavior unchanged: page states, output meanings, ordering, old holding bookmarks, pull-to-refresh semantics where retained, owner permissions.

Verification: component/e2e tests for overview, holdings, details, asset class, settings, import list, live publication update, auth reconnect, and mobile. Query metrics must stay bounded by version/read-model indexes.

Delete after PR: no old interface yet. Both paths exist only behind one switch, not as dual-write systems.

### PR 6: repeatable migration and rehearsal

Goal: build extraction, transformation, load, file policy, active-version rebuild, and reconciliation tools.

Major areas: new `scripts/migrate-to-convex/*`, manifests and runbook in `docs/`; no production handler changes.

Behavior unchanged: production continues on Postgres.

Verification: two consecutive staging reruns produce identical digests; full count/reference/decimal/hash reconciliation; sampled and golden user outputs match; rollback rehearsal succeeds. Record measured production scale and cutover estimate.

Delete after PR: nothing.

### PR 7: read-only cutover

Goal: freeze writes, run final migration, publish migrated versions, and switch current web and mobile releases to Convex reads while leaving imports disabled.

Major areas: deployment configuration, backend switch, small compatibility tRPC facade for installed mobile summary/holdings, maintenance UI.

Behavior unchanged: read outputs, Household access, old bookmarks, existing installed mobile reads.

Verification: final reconciliation, production smoke tests per Household, subscription coherence, auth and mobile compatibility, ability to switch web back to Postgres.

Delete after PR: nothing needed for rollback. Old write code remains dormant.

### PR 8: enable Convex publication

Goal: turn on direct upload, parse, review, asynchronous publication, FX schedule, and Source File cleanup.

Major areas: upload UI and status copy, feature configuration, Convex actions/schedules, operational dashboards and alerts.

Behavior unchanged: review before publication, atomic visible state, Duplicate Import, source priority, retention, permissions. The UI may show durable publishing progress instead of one synchronous request.

Verification: a controlled production canary import, forced action failure and resume, duplicate and concurrent publish tests, cross-device update, post-publish reconciliation, storage expiry. Confirm reverse-replay procedure before the first write.

Delete after PR: nothing until the rollback window closes. This is the operational point of no return.

### PR 9: remove the old backend

Goal: delete dormant Postgres/Supabase/tRPC infrastructure after the rollback and installed-mobile windows.

Major areas: `packages/db`, most of `packages/api`, Next API routes, web/mobile tRPC providers, root dependencies, environment variables, Docker/local Postgres scripts, old Effect plans and implementation docs.

Behavior unchanged: all current product behavior through Convex. Keep the compatibility route until the minimum supported mobile version no longer calls it.

Verification: full web/mobile/e2e suite, dependency and secret audit, Convex backup/export restore drill, no calls to Postgres/Supabase in logs, archived final reconciliation and rollback decision.

Delete after PR: Drizzle/Postgres/Supabase clients and migrations, tRPC/React Query/SuperJSON, old routes, caches, Vercel cron, `DATABASE_URL`, Supabase service role and bucket variables, `CRON_SECRET`, obsolete Effect wrappers and plans.

### PR 10: contract the Convex schema

Goal: remove temporary legacy IDs, migration-only indexes, optional compatibility fields, failed candidate versions, and the mobile facade when safe.

Major areas: Convex schema through expand/migrate/contract steps, garbage-collection jobs, compatibility route.

Behavior unchanged: public client behavior and audit history promised by retention policy.

Verification: dry-run migrations, backup, no legacy clients, no unmatched references, bounded GC, restore test.

Delete after PR: migration-only schema and compatibility code.

## 8. Effect

The actual Effect migration is early:

- currency rates genuinely use Effect for typed errors, timeout, retry, fallback, and concurrent fetch dedupe;
- import errors use tagged errors and a Promise bridge;
- four import entry points are Effect shells around Promise implementations;
- the 392-line upload lifecycle and 574-line Commit module remain Promise/Drizzle code;
- no Layer, Context service, Scope, or ManagedRuntime exists.

The current Effect sequence plans database and storage Layers, ManagedRuntime instances at Next adapters, Effect cache, membership migration, and router error consolidation. A Convex backend deletes those seams. Continuing now would increase merge conflicts and sunk cost.

In the target:

- Convex mutations own transactionality and OCC retry.
- Scheduled functions and persisted receipts own background workflow state.
- Convex subscriptions replace portfolio caches.
- Clerk identity plus membership helpers replace `ApiContext`.
- Public functions return ordinary validated results and deliberate `ConvexError` payloads.
- Pure parsers, identity functions, projectors, and analytics stay plain TypeScript.

Effect may still earn a small local role inside the Frankfurter Node action if its retry/timeout/fallback program remains clearer than direct code. It may also help a migration CLI with resource safety and typed failures. It should not cross Convex function interfaces, wrap mutations, or become a general runtime. Given the current rate policy's size, plain code plus persisted state is probably simpler, so removing Effect entirely is a reasonable target.

Under the recommended Postgres direction, keep Effect only where it already makes an external I/O policy clearer, currently the currency-rate retry, timeout, and stale fallback. Complete the import lifecycle conversion only if it demonstrably simplifies compensation and error mapping around Supabase and Postgres. Do not add a general Layer graph, ManagedRuntime, Effect Cache, or Effect wrappers around membership, portfolio projections, Drizzle calls, or pure analytics. The current roadmap should be narrowed even though some migration work has already landed.

## 9. Final decision

### Long-term architecture quality

Stay on Postgres/Supabase and redesign the projection boundary. This is the best long-term architecture for the application visible in this repository, even before migration cost is counted.

The reason is fit. The system has one central, exact, batch-oriented write with strong rollback, dedupe, locking, and repair requirements. Postgres handles that operation naturally. The current architecture's worst problem is not its database. It is that Commit writes low-level facts while every read reconstructs the actual domain model, then several unreliable caches hide the cost. Move that projection into Commit instead of moving databases.

The recommended Postgres target is:

1. Make source group, completeness, granularity, source priority, position identity, and transaction identity explicit in the importer contract.
2. Preserve immutable normalized input and source provenance. Stop destructive dedupe of historical facts.
3. Add versioned or transactionally replaced `current_positions`, `portfolio_summaries`, `asset_class_summaries`, and timeline/detail read models. Build them in the existing Commit transaction, then publish with a Household active-version pointer if a full replacement is easier to reason about than in-place updates.
4. Read those bounded models directly and delete the current/exited CTE, duplicated aggregate rules, process portfolio cache, and manual invalidation dependency. React Query may remain as client transport state, not correctness infrastructure.
5. Replace the global advisory lock with a Household-scoped lock after identity writes are Household-scoped or otherwise made concurrency-safe.
6. Fix active-Household selection, viewer authorization, eager default-account creation, and eager Supabase/context work independently of the database choice.
7. Narrow Effect to the external workflows where it pays for itself.

That design captures the main architectural gain attributed to Convex while retaining decimal storage, declarative constraints, transactional publication, SQL auditability, and straightforward repair tooling.

### Option comparison

| Choice                        | Migration cost | Long-term fit for this repository                                                                                                               | Decision                                       |
| ----------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Redesign on Postgres/Supabase | Low to medium  | Best fit for exact batch Commit and audit/repair; removes the main read and cache problems                                                      | **Recommend**                                  |
| Partial Convex adoption       | Medium to high | Worst fit; creates synchronization and two publication authorities                                                                              | **Reject**                                     |
| Full Convex-native migration  | Very high      | Cleaner reactive client/backend model, but central Commit becomes a durable publication engine and exact constraints move into application code | **Viable only as a strategic platform choice** |

### Migration cost

Full Convex migration cost is high relative to this repository's size. The difficult work is not tRPC replacement. It is specifying source snapshots, fixing exact-number handling, reproducing current/exited/detail behavior, building the chunked publisher, migrating historical quirks, preserving installed mobile clients, and proving parity while key integration suites are currently skipped.

If strategic reasons override the recommendation, do not approve implementation as one project-wide rewrite. Approve PR 0 first. Then make a second go/no-go decision after PR 4 demonstrates, on a real Convex backend, that a maximum-size Import Batch can build and publish within limits and that golden portfolio outputs match Postgres.

### Decision gates

Proceed to full migration only if Convex is strategically valuable beyond this repository and all are true:

- production inventory fits a practical one-shot cutover and read-model storage budget;
- exact decimal ranges have a documented representation;
- explicit source snapshots reproduce all current and exited behavior;
- max-size parsing and publication pass against a real Convex backend, not only `convex-test`;
- the final pointer mutation is the only visibility change;
- read queries stay bounded and do not scan history;
- mobile compatibility has a release-window plan;
- backup, export, reverse replay, and rollback have been rehearsed.

If any of those fail, stay on Postgres. Do not fall back to a partial Convex architecture.

## Primary Convex references

- [Transactions and mutation semantics](https://docs.convex.dev/functions/mutation-functions)
- [Current limits](https://docs.convex.dev/production/state/limits)
- [Write batching and transaction metrics](https://docs.convex.dev/database/writing-data)
- [Data types](https://docs.convex.dev/database/types)
- [Indexes and query behavior](https://docs.convex.dev/database/reading-data/indexes/)
- [Reactive queries and caching](https://docs.convex.dev/realtime)
- [Actions](https://docs.convex.dev/functions/actions)
- [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [Cron jobs](https://docs.convex.dev/scheduling/cron-jobs)
- [File uploads](https://docs.convex.dev/file-storage/upload-files)
- [Clerk integration](https://docs.convex.dev/auth/clerk)
- [Data import](https://docs.convex.dev/database/import-export/import)
- [Backup and restore](https://docs.convex.dev/database/backup-restore)
