# Convex migration implementation plan

Status: implementation handoff

Decision: migrate the web application fully to a Convex-native backend on a separate branch, prove behavior against the current Postgres and Supabase production system, then perform a one-shot production cutover.

This plan supersedes the final recommendation in [`convex-architecture-migration-review.md`](convex-architecture-migration-review.md). That recommendation treated the code's 25,000-row import allowance and installed mobile clients as real product requirements. The owner later clarified that the limit was arbitrary, the application has no outside users, the family is not using the incomplete mobile app, local data is disposable test data, and the only important dataset is in production Postgres and Supabase.

The repository analysis and verified Convex constraints in [`research-convex-capabilities-and-limits.md`](research-convex-capabilities-and-limits.md) remain valid. The changed product facts make the simpler migration path the better choice.

## 1. Outcome

At completion:

- The Next.js web application reads and writes portfolio data through generated Convex functions.
- Clerk remains the identity provider.
- Convex owns application data, Source Files, scheduled cleanup, and USD/INR refresh.
- `packages/importers` remains the file parsing module.
- `packages/analytics` remains the financial analytics module.
- A new pure portfolio publication module owns source priority, current and exited positions, identity, and read-model construction.
- The current production behavior is preserved for every supported real import and every visible web page.
- Development, automated test, preview, and production data remain isolated.
- Production data moves directly from Postgres and Supabase Storage to Convex production. It never enters a development deployment or the Git repository.
- Postgres and Supabase remain unchanged through a rollback window.
- After the rollback window, Drizzle, tRPC, Supabase adapters, manual portfolio caches, Effect backend work, and the incomplete mobile application can be removed.

## 2. Scope and fixed decisions

### In scope

- Web authentication and first-use provisioning.
- Household membership and owner authorization.
- Accounts and instruments.
- CSV and XLSX upload, parsing, preview, warnings, Commit, import history, retry, and file expiry.
- Holdings, current and exited status, source precedence, details, asset-class views, summaries, timelines, valuations, transactions, performance, and XIRR.
- USD/INR refresh and stale fallback.
- Production data and available Source File migration.
- Production reconciliation and rollback.
- Removal of the old backend after validation.

### Out of scope

- Completing or migrating the mobile application.
- Supporting an invented 25,000-row portfolio limit.
- Dual-writing Postgres and Convex.
- Recreating Drizzle repositories, SQL joins, tRPC routers, or Effect Layers inside Convex.
- New portfolio features or visual redesign during parity work.
- Multi-tenant scale work beyond Household isolation and correct concurrent behavior.

The current mobile source should not force the old backend to remain. Preserve its last state through Git history or an archival tag, then remove `apps/mobile` during final cleanup. If mobile development resumes later, build it against the generated Convex interface.

## 3. Execution rules for a fresh agent

1. Work continues on `feat/convex-native-backend`, branched from base commit `aacb583`. Commit Phase 0 before starting Phase 1.
2. Read this plan, the two linked architecture notes, repository instructions, and the current schema and import integration tests before editing code.
3. Execute one phase at a time. Meet its completion criteria before starting the next phase.
4. Keep the current backend runnable until the production rollback window closes.
5. Treat current Postgres outputs as the behavioral reference, not as the target code structure.
6. Keep production credentials out of committed files and command output.
7. Run production migration tools in dry-run mode by default. Require an explicit production target and apply flag for writes.
8. Stop before the first production Convex write unless the user has authorized the production migration phase in that context.
9. Preserve unrelated working-tree changes.
10. Record any deliberate behavior difference in this document before implementing it.

## 4. Target dependency structure

```text
apps/web
    |
    | generated function references and Convex React hooks
    v
packages/backend
    |                    \
    |                     \ file parsing
    v                      v
packages/portfolio-domain  packages/importers
    |
    | financial calculations
    v
packages/analytics
```

Dependency rules:

- `apps/web` may import the generated Convex interface and public portfolio view types. It may not import backend implementation files.
- `packages/backend` may import the pure importer and portfolio-domain modules.
- `packages/portfolio-domain` may import `packages/analytics`.
- Pure packages may not import Convex, Clerk, Next.js, Drizzle, Supabase, or environment configuration.
- Public Convex function files are adapters. Domain rules belong in the portfolio-domain module. Database invariants and authorization belong inside the backend package.
- Do not introduce repository classes or ports around `ctx.db`. `convex-test` and a real development deployment already provide the second execution environment.

This puts the most difficult behavior behind one deep interface:

```ts
buildPortfolioPublication(input): PortfolioPublication
```

Callers provide validated existing facts, the parsed Import Batch, and the applicable currency-rate state. The module returns facts to persist, a complete versioned read model, exact reconciliation totals, and a digest. Source grouping, aggregate fallback, NPS priority, omission-as-exit, identity normalization, dedupe fingerprints, and analytics stay inside the implementation.

Tests use the same interface as the Convex Commit mutation. They should not reach through it to test private helper state.

## 5. Target file structure

```text
apps/web/
  src/
    app/
      providers.tsx
      dashboard/**
      holdings/**
      uploads/**
      settings/**
    features/
      imports/
        use-import-workflow.ts
    lib/
      format.ts

packages/backend/
  package.json
  tsconfig.json
  convex.json
  src/
    api.ts
  convex/
    _generated/
    schema.ts
    auth.config.ts
    crons.ts
    users.ts
    accounts.ts
    imports.ts
    portfolio.ts
    actions/
      parseImport.ts
      refreshCurrencyRate.ts
    internal/
      imports.ts
      maintenance.ts
    model/
      auth.ts
      importWorkflow.ts
      portfolioStore.ts
      logicalKeys.ts
    lib/
      errors.ts
      validators.ts
    testing/
      seed.ts

packages/portfolio-domain/
  package.json
  tsconfig.json
  src/
    index.ts
    types.ts
    publication.ts
    numeric.ts
    identity.ts
    sourceSnapshots.ts
    publication.test.ts
    identity.test.ts

packages/importers/
  src/
    types.ts
    import-validation.ts
    nps.ts
    tickertape.ts
    xlsx.ts
    **/*.test.ts

packages/analytics/
  src/
    portfolio.ts
    performance.ts
    xirr.ts
    **/*.test.ts

scripts/convex-migration/
  README.md
  runtime.cjs
  inventory-postgres.cjs
  inventory-storage.cjs
  parser-worker.cjs
  capacity-evidence.cjs
  generate-capacity-note.cjs
  migration-tools.test.cjs
  export-postgres.ts
  export-storage.ts
  transform.ts
  load.ts
  reconcile.ts
  types.ts

.migration/
  <run-id>/
    manifest.json
    export/*.jsonl
    id-maps/*.json
    reconciliation.json
```

`.migration/` must be ignored by Git. It contains real financial data. Migration credentials must never be written into it.

Phase 0 tools are CommonJS and run under `node --test`. New extract, transform, load, and reconcile tools follow the same convention unless a phase records a move to `tsx` for all of them.

### Package interfaces

`@investment-sync/backend/api` exports only the generated `api` object and generated public types needed by the web client. It does not export database helpers.

`@investment-sync/portfolio-domain` exports:

- `buildPortfolioPublication`;
- its input and output contracts;
- public portfolio view types;
- numeric conversion functions that web formatting or migration reconciliation genuinely shares.

Keep identity and source-snapshot helpers private unless a second real caller appears.

`@investment-sync/importers` continues to export file detection, parsing, validation, Normalized Row types, warnings, and NPS detail types. It gains explicit source and identity metadata but no persistence knowledge.

## 6. Environment and data isolation

| Runtime               | Backend                                  | Data                        | Allowed operations      |
| --------------------- | ---------------------------------------- | --------------------------- | ----------------------- |
| Automated tests       | `convex-test` or local Convex backend    | Generated fixtures only     | Full reset and seed     |
| Local web development | Personal Convex development deployment   | Generated test data only    | Full development writes |
| Vercel preview        | Convex preview deployment                | Generated preview data only | Preview validation      |
| Production web        | Convex production deployment             | Migrated real data          | Real application use    |
| Migration source      | Production Postgres and Supabase Storage | Existing real data          | Read-only until cutover |

Required safeguards:

- `packages/backend/.env.local` contains the development `CONVEX_DEPLOYMENT`. It is ignored by Git.
- `apps/web/.env.local` contains the matching development `NEXT_PUBLIC_CONVEX_URL` and Clerk development keys.
- Vercel production holds the production Convex URL and Clerk production configuration.
- Each Convex deployment sets an explicit `APP_ENV` value. Development seed functions fail unless `APP_ENV === "development"` or `APP_ENV === "test"`.
- Preview deployments never receive production database or Supabase credentials.
- Production migration credentials exist only in the operator environment or an approved secret store.
- Migration tools print the source fingerprint and Convex deployment name before applying writes.
- `load.ts` defaults to dry run. Production writes require both `--apply` and `--target production`.
- Generated fixtures use obviously fake names, account numbers, amounts, and Source Files.
- Production exports, logs containing portfolio values, and reconciliation artifacts stay outside Git.

Use a seven-day rollback window, bounded by verified backup retention. Before creating the external project relationship in Phase 1, record the selected Convex tier and verify that it supports the required preview deployments, backups, and concurrency class.

Clerk development and production keys remain separate. Convex authentication configuration uses the issuer for its deployment. A development Clerk subject may never resolve to a production user document unless the same human signs into production through the production Clerk instance.

## 7. Convex data model

The exact validators belong in `packages/backend/convex/schema.ts`. Use these concepts and indexes.

| Table                 | Purpose                                                                     | Required logical indexes                                              |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `users`               | Clerk subject and profile metadata                                          | Clerk subject                                                         |
| `households`          | Owner, active portfolio version, publication sequence                       | Owner                                                                 |
| `householdMembers`    | Role and Household membership                                               | User and Household, Household and user                                |
| `accounts`            | Household-scoped normalized account identity                                | Household and identity key                                            |
| `instruments`         | Household-scoped canonical instrument identity                              | Household and identity key, optional ISIN                             |
| `sourceFiles`         | Convex storage ID, hash, type, uploader, expiry, availability               | Batch, storage ID, expiry                                             |
| `importBatches`       | Parser version, state, counts, preview, warnings, error, committed version  | Household and date, Household and status                              |
| `importRowChunks`     | Immutable bounded arrays of validated Normalized Rows                       | Batch and chunk index, batch and parse attempt                        |
| `importDedupeKeys`    | One committed content hash and parser version per Household                 | Household and dedupe key                                              |
| `holdingSnapshots`    | Historical source facts with explicit source semantics and batch provenance | Household and position key, source group and date, batch              |
| `transactions`        | Cash-flow facts with source-aware occurrence identity                       | Household and transaction key, position key and date, batch           |
| `portfolioValuations` | Explicit valuation facts with source and batch provenance                   | Household and date, batch                                             |
| `portfolioVersions`   | Immutable published version, sequence, batch, digest, counts                | Household and sequence, batch                                         |
| `portfolioPositions`  | Complete current and exited read model for one version                      | Version and status, version and asset class, version and position key |
| `portfolioSummaries`  | One summary read model per version                                          | Version                                                               |
| `assetClassSummaries` | One read model per version and asset class                                  | Version and asset class                                               |
| `portfolioTimeline`   | Versioned dated summary points                                              | Version and date                                                      |
| `currencyRates`       | Current provider quote and freshness state                                  | Currency pair and provider                                            |

Production inventory found no `prices` records. Do not migrate the table. Phase 8 removes it after confirming no consumer exists.

### Logical uniqueness

Convex indexes are not uniqueness constraints. All writes use shared model functions that:

1. Query the exact logical-key index range.
2. Return the existing document when the operation is idempotent.
3. Fail on conflicting content.
4. Insert only when no match exists.

Serializable mutation retries handle concurrent callers when every writer follows this path. Migration functions must call the same model functions rather than inserting around them.

Required logical keys include:

- Clerk subject;
- Household membership;
- Household-local account identity;
- Household-local instrument identity;
- Import content hash plus parser version;
- holding source identity;
- source-aware transaction occurrence;
- portfolio version plus position key.

### Numeric and date representation

Do not pass production Postgres numerics through an untracked `Number` conversion.

- Raw and persisted financial source values use validated canonical decimal strings.
- The portfolio-domain module uses one decimal library for addition, multiplication, comparison, and rounding.
- Existing UI view models may continue to expose Float64 display values where current analytics already use JavaScript numbers.
- XIRR, ratios, and percentages remain documented approximate Float64 analytics.
- Trade, snapshot, and valuation dates remain `YYYY-MM-DD` strings.
- Instants use epoch milliseconds.

This preserves source values without forcing BigInt serialization through the web UI.

## 8. Import and publication workflow

### State model

Source File state is separate from Import Batch state.

```text
Source File: reserved -> stored -> deleted
                           -> delete_failed -> deleted

Import Batch: awaiting_upload -> uploaded -> parsing -> parsed -> committed
                                      |          |
                                      +----------+-> failed
```

Deleting an expired Source File does not change a parsed or committed batch. A parsed batch can Commit after its file expires because Normalized Rows remain stored.

### Upload and parsing

1. `imports.createUpload` authenticates an owner, creates the batch and Source File reservation, and returns a short-lived Convex upload URL.
2. The browser uploads directly to Convex Storage.
3. `imports.attachUpload` validates the storage metadata, records the storage ID and expiry, and schedules `actions/parseImport`.
4. The Node action reads the blob, enforces the measured file and row limits, computes SHA-256, selects the parser, and calls the existing importer module.
5. Internal mutations store immutable Normalized Rows in bounded chunks. Use both a row-count and serialized-byte ceiling per chunk.
6. Chunk writes use batch ID, parse attempt, chunk index, count, and digest. Replaying an identical chunk succeeds. Conflicting content fails.
7. A final internal mutation verifies chunk manifests, saves the preview and warnings, checks committed-content dedupe, and marks the batch parsed.

An action failure leaves the batch failed or parsing with persisted receipts. `imports.retryParse` starts a new attempt or resumes safe chunks. No portfolio query reads staging data.

### Realistic capacity gate

The code's current 25,000-row allowance is not a product requirement. Phase 0 measures every available production Source File and records:

- compressed file bytes;
- normalized row count;
- normalized serialized bytes;
- distinct accounts and instruments;
- projected fact writes;
- projected read-model writes.

Set the row, normalized-byte, account, and instrument ceilings from the largest persisted batch with documented headroom. Its Source File is past retention, so its compressed size cannot be measured. Set the compressed-file ceiling independently from the largest available Source File with documented headroom, bounded by the current application limit, and record it as an engineering limit rather than a coherent production measurement.

Phase 0 specifies two twice-largest fixtures: a normalized publication fixture based on the largest persisted batch and an upload-transport fixture based on the largest available Source File. Phase 3 runs upload and parsing on a real development deployment. Phase 4 begins with the default single-mutation Commit and runs the publication fixture through it. If Commit reads, writes, bytes, or user-code time exceed half of the documented limit, stop and implement the staged builder. This is the capacity go/no-go point; do not build the fallback speculatively.

### Default Commit design

For the expected family-scale dataset, `imports.commit` is one owner-authorized mutation:

1. Resolve the batch through Household scope so foreign IDs appear not found.
2. Return the original result if the same batch already committed.
3. Verify parsed state, exact chunk manifest, and committed-content dedupe.
4. Load the Household's committed facts and current active version through bounded indexes.
5. Call `buildPortfolioPublication` with the existing facts and the batch.
6. Resolve or create Household-local accounts and instruments through logical-key helpers.
7. Write the new facts, full versioned current and exited positions, summary, asset-class summaries, and timeline.
8. Insert the committed dedupe key.
9. Mark the batch committed and update `households.activePortfolioVersionId` in the same mutation.

User-code time is the likely binding limit because publication performs source grouping and iterative XIRR inside the mutation. Phase 4 records user-code milliseconds explicitly.

If any validation or write fails, Convex commits nothing. Concurrent Commit mutations conflict on the Household document and retry against the new active state. Reactive web queries see either the complete old version or the complete new version.

### Capacity fallback

If measured real data cannot fit the default mutation with headroom:

- Create an invisible candidate `portfolioVersion` from a recorded base version.
- Build its facts and read models through bounded idempotent internal mutations.
- Reduce chunk receipts into one bounded root manifest.
- Run one final mutation that verifies the root manifest, dedupe key, owner authority, and unchanged base version.
- Publish only by changing `activePortfolioVersionId` in that final mutation.

The web behavior remains the same, but Commit becomes an asynchronous publishing state. This fallback is already designed in the architecture review.

If Phase 4 selects this fallback, add `publicationReceipts` indexed by version, stage, and chunk, plus a publishing-slot field on `households`. Add them only through Convex expand-migrate-contract sequencing.

## 9. Public Convex interface

Keep the public interface small. Match current web view models where that avoids unnecessary UI changes.

```text
users.ensureCurrent
users.current

accounts.list

imports.createUpload
imports.attachUpload
imports.get
imports.list
imports.retryParse
imports.commit

portfolio.overview
portfolio.positions
portfolio.holdingDetail
portfolio.assetClassDetail
```

Every public function authenticates through one shared module and resolves Household membership before reading user data. Upload and Commit require the owner role. Read functions accept stable Household-local position keys, not version-scoped document IDs.

The current `portfolio.holdings` and `portfolio.summary` procedures have no Convex successor because their only caller is the mobile app removed in Phase 8. A migrated Household keeps an indexed legacy alias from every old holding-snapshot UUID to its Household-local position key. `portfolio.holdingDetail` accepts either form until the rollback window closes and the owner confirms the aliases can be removed.

Public queries read the Household's active version, then use indexes scoped to that exact version. They do no source grouping or portfolio-wide history reconstruction. The Commit publication module performs that work once.

The web app should call generated functions directly with `useQuery`, `useMutation`, and `useAction`. Do not create wrappers that only rename those hooks. The import workflow merits one web module because it coordinates upload URL creation, direct file transfer, attach, parse status, preview, Commit, and retry.

## 10. Behavior parity contract

The migration is complete only when these behaviors match the production application or a recorded correction approved by the owner.

| Area                   | Required parity                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication         | Signed-out behavior, first-use user and Household creation, owner access. `users.current` resolves through membership; correcting the current ownership join is not a parity failure |
| Isolation              | Cross-Household batch and position IDs disclose no data                                                                                                                              |
| Upload                 | Supported extensions and MIME types, checksum, preview, warnings, error messages, file availability                                                                                  |
| Duplicate Import       | Same Household, content hash, and parser version conflicts only after one batch commits                                                                                              |
| Commit                 | Failed Commit changes no visible portfolio; retrying the same batch returns success                                                                                                  |
| Source precedence      | Same-date NPS portal CSV beats workbook NPS regardless of Commit order                                                                                                               |
| Partial imports        | New partial source data does not remove positions belonging to other source groups                                                                                                   |
| Aggregate fallback     | Aggregate rows count only when detailed rows for the same source snapshot are absent                                                                                                 |
| Exited positions       | Omission means exit only for a complete newer snapshot of the same source group                                                                                                      |
| Identity               | Accounts, instruments, and positions do not duplicate under concurrent or repeated imports                                                                                           |
| Transaction occurrence | Two identical same-day occurrences remain distinct. This deliberately corrects the current fingerprint behavior. Reconciliation check `identical_same_day_transaction_occurrences`   |
| Holdings               | Current and exited membership, ordering, names, quantities, prices, values, gains, and currencies                                                                                    |
| Details                | Historical snapshots, transactions, valuations, and NPS details                                                                                                                      |
| Summary                | Invested value, current value, gain, allocation, performance source, and data-quality labels                                                                                         |
| Timeline               | Dates, values, cash flows, valuation precedence, and currency conversion                                                                                                             |
| XIRR                   | Cash-flow XIRR, source XIRR fallback, valuation-history fallback, and quality selection                                                                                              |
| Currency rate          | Six-hour freshness, seven-day stale fallback, provider failure behavior                                                                                                              |
| File retention         | Thirty-day expiry, retry on failed deletion, parsed and committed data survives deletion                                                                                             |
| Import history         | Status, row counts, warnings, errors, timestamps, committed result                                                                                                                   |

## 11. Test strategy

### Baseline tests

These Postgres integration suites already run in CI. They skip locally when `TEST_DATABASE_URL` is unset. Phase 0 makes them reproducible locally against a dedicated test database and confirms they pass before Convex work. They are the executable specification for upload, cleanup, Commit, duplicate handling, partial imports, NPS priority, and concurrency.

Add synthetic golden fixtures for:

- every supported parser;
- same-date competing sources;
- complete and partial snapshots;
- aggregate and detail rows;
- identical same-day transaction occurrences;
- exited and later re-entered positions;
- INR, USD, and mixed-currency portfolios;
- FX fresh, stale, and unavailable states;
- holding details and NPS details;
- XIRR source selection.

Never commit production financial data as a test fixture.

### Convex tests

Use `convex-test` for:

- schema and validator behavior;
- authentication and role checks;
- first-use provisioning;
- logical uniqueness;
- chunk idempotency;
- failed and retried parsing;
- Commit rollback and idempotency;
- active-version atomicity;
- query outputs from golden fixtures;
- cleanup and scheduled-function state.

Use a real Convex development or preview deployment for:

- direct file upload and Node parsing;
- realistic and twice-largest capacity fixtures;
- transaction metrics and limit headroom;
- scheduler and cron behavior;
- concurrent Commit calls;
- reactive update behavior in the browser;
- Clerk authentication;
- production-like migration rehearsal.

### Cross-backend reconciliation

The reconciliation tool runs the current Postgres portfolio implementation and the Convex queries for the same Household. Compare semantic values, not generated IDs or incidental JSON ordering.

It must compare:

- record counts and references;
- exact decimal source totals;
- file hashes and sizes;
- accounts, instruments, and logical keys;
- current and exited positions;
- summaries and asset classes;
- timeline points;
- details, transactions, and valuations;
- XIRR value, source, and quality;
- import status and dedupe keys.

Store only the checksummed reconciliation report in the protected migration run directory. The committed test suite uses synthetic equivalents.

### Repository checks

Every phase ends with the relevant subset and the final phase ends with all of:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:migration-tools
pnpm test:db:integration
pnpm build
pnpm format:check
```

Convex code generation must be current and committed. A clean checkout must typecheck without connecting to production.

## 12. Production data migration

### Strategy

Use one rehearsed migration and a short write freeze. Do not dual-write.

The current application remains the production system until the Convex web build and migration rehearsal both pass. The production Convex deployment may contain an inactive imported dataset before cutover, but the production web application continues to point to Postgres until final reconciliation.

### Extract

Run a consistent, read-only Postgres export in dependency order:

1. users, Households, and members;
2. accounts and instruments;
3. Import Batches and Normalized Rows;
4. holding snapshots, transactions, and valuations;
5. currency rates and any discovered prices;
6. Supabase Storage object manifest.

Export UUIDs and numerics as text, civil dates as `YYYY-MM-DD`, timestamps in UTC, enums as text, and JSON without lossy conversion. Record table counts, per-Household counts, source hashes, and an input-manifest checksum.

### Transform and load

- Preserve old UUIDs as `legacyId` during the rollback window.
- Maintain checksummed old-ID to Convex-ID maps.
- Load parents before children.
- Map legacy Import Batch statuses explicitly. `created` becomes `awaiting_upload`; `uploaded`, `parsed`, `committed`, and `failed` retain their meaning. A legacy `expired` batch retains `legacyStatus: "expired"` and unavailable Source File metadata, but `expired` is not a target workflow state. An expired batch with normalized rows becomes `parsed`; one with no rows and no available Source File becomes `failed` with typed reason `source_expired_no_rows`.
- Convert Normalized Rows into bounded import chunks without changing their meaning.
- Add explicit source-group, completeness, granularity, priority, position-key, and transaction-occurrence metadata through the tested target rules.
- Report logical-key collisions. Never silently choose a winner.
- Split each global instrument into one Household-scoped instrument per referencing Household. Map every snapshot, transaction, and valuation to its Household's instrument and record the one-to-many legacy mapping. A canonical-key collision within one Household stops the run.
- Build one initial active portfolio version from all committed facts.
- Preserve parsed but uncommitted batches so they can still Commit after cutover.
- Copy every currently available Source File from Supabase Storage to Convex Storage, verify SHA-256 and byte size, and preserve its original expiry time.
- Leave expired or already missing Source Files unavailable while preserving batch metadata.

Each migration write uses a deterministic migration key or `legacyId`. Rerunning the same input must produce the same digest. Divergent content stops the run.

### Reconcile

Run structural and semantic reconciliation before activating the web deployment. The report must show zero unexplained differences. Differences caused by an intentional bug fix require the owner's written approval in the plan and a regression test.

The source-aware transaction occurrence key intentionally preserves identical same-day occurrences that the current fingerprint collapses. Treat `identical_same_day_transaction_occurrences` as a named permitted difference with a regression test.

### Cutover

1. Confirm a fresh Supabase backup and Convex backup or export.
2. Enable maintenance mode for upload and Commit in the current web deployment.
3. Run the final repeatable export, transform, and load.
4. Reconcile production Postgres against production Convex.
5. Smoke-test the Convex production web build with the production Clerk account.
6. Change the Vercel production environment to the Convex deployment and deploy.
7. Keep imports disabled for a short read-only validation period.
8. Verify every web page and a representative holding detail.
9. Enable Convex upload and Commit.
10. Keep Postgres and Supabase unchanged and read-only through the rollback window.

The first new import committed only in Convex is the point of no return for an instant rollback. Before that event, rollback means restoring the old Vercel configuration. After it, preserve the new Source File and re-import it into the old application before switching back.

## 13. PR-sized implementation phases

### Phase 0: baseline and production inventory

Goal: turn actual behavior and actual data size into measured requirements.

Major areas:

- Existing Postgres integration-test setup.
- New synthetic golden fixtures.
- Read-only inventory scripts under `scripts/convex-migration/`.
- A short generated capacity note containing counts but no financial values.

Work:

- Run all current integration tests against local Postgres.
- Inventory production row counts, statuses, file sizes, normalized counts, currencies, and identity collisions.
- Measure the largest real import.
- Capture current semantic outputs for synthetic golden fixtures.
- Record the realistic supported import limit and the twice-largest capacity fixture.
- Record that production contains no `prices` records and apply the approved pending-batch dispositions below.

Behavior unchanged: the current application remains untouched.

Completion criteria:

- All current database integration tests run rather than skip.
- Every behavior in the parity matrix has a test or a named production reconciliation check.
- The supported normalized-row, normalized-byte, account, and instrument limits are evidence-based. The compressed-file ceiling is derived independently from available Source Files because the largest persisted batch's file is past retention.
- No production data or secrets enter Git.

Old code deleted: none.

#### Approved production inventory decisions

The owner approved these decisions on 2026-08-30:

- One expired Tickertape mutual-fund batch declares seven rows, while Postgres contains six normalized rows. Treat the six persisted rows as authoritative during transformation. Preserve the original declared count as legacy metadata for reconciliation, but do not invent a seventh row.
- Four expired batches have no normalized rows and no available Source File. Preserve their history as unavailable with `legacyStatus: "expired"`; map them to the target failure reason `source_expired_no_rows`. Do not create rows or portfolio facts for them. This supersedes the capacity note's earlier instruction to investigate them.
- One Supabase Storage object has no matching Import Batch. Leave it unchanged in Supabase through the rollback window and exclude it from migration unless a later protected audit links it to a batch. Do not copy or delete it during the normal migration.

These are source-state dispositions, not production corrections. Phase 0 and migration tooling may record them in protected manifests. No Phase 0 command may update Postgres or Supabase.

### Phase 1: backend package and environment isolation

Goal: establish a typed Convex package with isolated development data and Clerk authorization.

Major areas:

- New `packages/backend` workspace.
- Convex project configuration, schema skeleton, generated code, test setup, and root scripts.
- Web Convex provider behind development-only configuration.
- Environment documentation and seed guard.

Work:

- Create the Convex development and production project relationship.
- Configure the package-local `convex/` directory and generated interface export.
- Add `ConvexProviderWithClerk` to the web provider tree without switching data reads.
- Provision one Household and an owner membership per user. Shared Households and multiple memberships are not part of the current product scope; enforce the one-Household rule instead of preserving "oldest membership wins." Do not create six eager default accounts. Create accounts from published source data, while migrating every existing account unchanged. These are recorded behavior corrections.
- Implement `users.ensureCurrent`, `users.current`, membership resolution, and owner authorization.
- Create generated fake-data seeds that cannot run in production.
- Add Convex code generation and backend package tests to `.github/workflows/ci.yml`; confirm the web build succeeds without a live Convex connection.

Behavior unchanged: all production reads and writes still use Postgres.

Completion criteria:

- A clean checkout can run codegen, typecheck, and test the backend package.
- Local sign-in creates only development documents.
- Unauthenticated and cross-Household tests pass.
- Production seed execution fails before writing.

Old code deleted: none.

### Phase 2: explicit import and portfolio domain

Goal: replace hidden SQL inference with one pure publication module while preserving results.

Major areas:

- New `packages/portfolio-domain`.
- `packages/importers/src/types.ts` and parser implementations.
- Existing analytics only where a real contract correction is required.
- Golden parity tests.

Work:

- Add canonical decimal strings and explicit source metadata to Normalized Rows.
- Decide and record the parser-version policy before changing the Normalized Row contract. Preserve migrated historical parser versions; bump affected current parsers only when parsed meaning changes.
- Implement stable account, instrument, source-group, position, and transaction-occurrence keys.
- Implement `buildPortfolioPublication`.
- Port current and exited rules, source priority, aggregate fallback, histories, valuations, and summary construction into the module.
- Use existing analytics for allocation, performance, and XIRR.
- Add a temporary adapter that runs Postgres committed facts through `buildPortfolioPublication`, making the existing integration suite the executable publication oracle. Delete it in Phase 8.

Behavior unchanged: parser support, previews, warnings, portfolio output, and import dedupe semantics.

Completion criteria:

- All parser and analytics tests pass.
- Golden publication outputs match the current Postgres implementation.
- Source rules exist in one implementation, not duplicated SQL and TypeScript.
- The module's tests use its public interface.

Old code deleted: duplicated pure source and aggregate helpers only after the old path no longer needs them.

### Phase 3: Convex upload, parsing, and import history

Goal: implement the Source File and parsed Import Batch lifecycle without publishing portfolio data.

Major areas:

- Convex Source File, Import Batch, chunk, and dedupe tables.
- `imports.ts`, parse action, internal import mutations, cleanup cron.
- Web import workflow behind a branch-local switch.

Work:

- Implement direct upload URL creation and attach.
- Parse actual supported CSV and XLSX files in a Node action.
- Store immutable chunks with attempt IDs and digests.
- Implement preview, warnings, retry, import list, and file availability.
- Implement 30-day file deletion with retry state.
- Enforce the measured application limits.

Behavior unchanged: accepted files, preview meanings, warnings, error categories, privacy, and retention.

Completion criteria:

- Every real parser fixture uploads and parses through a development deployment.
- Identical chunk replay is a no-op and conflicting replay fails.
- A parsing failure cannot alter portfolio data.
- Expired-file cleanup preserves parsed rows and import history.
- The twice-largest upload-transport fixture passes with recorded staging-path metrics.

Old code deleted: none. The current upload route remains the production path.

### Phase 4: atomic Commit and read models

Goal: publish a complete Convex portfolio atomically using the simple mutation or the measured fallback.

Major areas:

- Convex facts, versions, positions, summaries, asset-class summaries, timeline, and logical-key model functions.
- `imports.commit`.
- Public portfolio and account queries.

Work:

- Implement the default single-mutation Commit first and run the twice-largest publication fixture through it on a real development deployment. Record reads, writes, bytes, duration, and user-code milliseconds. Select the staged fallback only when a measured limit exceeds 50 percent.
- Implement fact persistence with batch provenance.
- Implement logical uniqueness for accounts, instruments, facts, and dedupe keys.
- Call `buildPortfolioPublication` from Commit.
- Publish by changing the Household active-version pointer in the same mutation.
- Implement bounded queries for every current web read.
- Implement the capacity fallback only if the Phase 4 Commit measurement requires it.
- Implement `actions/refreshCurrencyRate` and its cron, preserving the six-hour fresh window, seven-day stale fallback, and provider-failure behavior. Moving from lazy read-triggered fetch to scheduled refresh is a recorded behavior difference; before the first successful refresh, reads behave like the current unavailable case.

Behavior unchanged: every Commit and portfolio invariant in the parity matrix.

Completion criteria:

- Golden imports produce identical current, exited, detail, summary, timeline, and XIRR results.
- Forced Commit failure changes no visible data.
- Same-batch retry succeeds.
- Duplicate and concurrent commits behave correctly.
- Queries read only active-version documents and indexed history.
- The chosen capacity path has at least 50 percent limit headroom at twice the largest real import.
- Fresh, stale, and unavailable FX states pass against the mixed-currency publication fixture.

Old code deleted: none until the web cutover.

### Phase 5: web conversion and end-to-end parity

Goal: run the complete web application against Convex in development and preview.

Major areas:

- Web page clients and providers.
- Import workflow module.
- Loading, empty, error, and publishing states.
- Browser tests.

Work:

- Replace tRPC and React Query calls with direct Convex hooks.
- Preserve current view-model shapes where possible.
- Replace manual query invalidation with subscriptions.
- Switch upload from the Next proxy to direct Convex Storage.
- Exercise dashboard, holdings, holding detail, asset class, uploads, and settings.

Behavior unchanged: visible web behavior and URLs, with old holding-detail UUIDs served through the legacy alias. A realistic asynchronous status is allowed only if the measured fallback requires it.

Completion criteria:

- Every page passes browser verification against generated data.
- Publishing updates open pages without refresh.
- Sign-out, token refresh, reconnect, empty, and error states work.
- The complete parity matrix passes in development.
- No page, layout, or client component outside `apps/web/src/app/api/**`, and nothing under `apps/web/src/features` or `apps/web/src/lib`, imports `@investment-sync/api` or `@investment-sync/db`. Retained legacy API routes are exempt until Phase 8.

Old code deleted: web-only tRPC provider code may be deleted on the branch. Keep old backend packages and production routes for migration comparison and rollback.

### Phase 6: migration tooling and rehearsal

Goal: prove a repeatable production-shaped migration without changing production traffic.

Major areas:

- All `scripts/convex-migration/*` tools.
- Protected run artifacts.
- Reconciliation report and operator runbook.

Work:

- Implement consistent extraction, ID mapping, transforms, file copying, load, and reconciliation.
- Rehearse against a non-production Convex deployment using an authorized production snapshot or an equivalent protected copy.
- Run the migration twice from the same input.
- Rehearse rollback before any Convex-only Commit.

Behavior unchanged: Postgres remains production.

Completion criteria:

- Two clean runs produce identical manifests and semantic outputs.
- All references, hashes, counts, exact totals, and web outputs reconcile.
- The runbook includes commands, expected output, duration, backup locations, and rollback steps.
- No migration artifact appears in Git status.

Old code deleted: none.

### Phase 7: production cutover

Goal: migrate the real dataset and switch the production web application.

Major areas:

- Production Convex deployment.
- Vercel production configuration.
- Clerk production configuration.
- Maintenance mode.

Work:

- Land maintenance mode for upload and Commit on the current Postgres stack and deploy it before any cutover write. Record the exact last Postgres-serving production commit as a verified redeployable rollback target.
- Follow the cutover sequence in section 12.
- Complete read-only production validation before enabling new imports.
- Record the final reconciliation digest and cutover commit.

Behavior unchanged: every visible production behavior in the parity contract.

Completion criteria:

- Production reconciliation has zero unexplained differences.
- Every production web page passes an authenticated smoke test.
- A controlled real import parses, previews, commits, and updates the portfolio correctly.
- Supabase remains available for rollback.

Old code deleted: none during the rollback window.

### Phase 8: remove the old stack

Goal: delete code that no longer earns its maintenance cost after the rollback window.

Major areas:

- `packages/api`, `packages/db`, old Next API routes, root scripts and dependencies.
- `apps/mobile`.
- Effect implementation and planning documents that describe the retired backend.
- Docker and Supabase configuration.

Work:

- Confirm no production logs call tRPC, Postgres, or Supabase.
- Archive the final Postgres export, schema, migration manifest, and rollback decision outside the repository as appropriate.
- Remove the incomplete mobile app after preserving it in Git history.
- Remove old packages, adapters, routes, caches, cron configuration, database scripts, environment variables, and dependencies.
- Remove the Postgres service, database environment variables, and Drizzle migration step from `.github/workflows/ci.yml`.
- Delete all remaining Supabase Storage objects, including the recorded unreferenced object, then decommission the bucket and credentials. Record deletion in the archived migration record; this completes the retention obligation suspended during rollback.
- Update repository documentation to describe Convex development, testing, deployment, backup, and data restore.

Behavior unchanged: the production web application remains fully functional through Convex.

Completion criteria:

- No runtime or package dependency references Drizzle, postgres.js, Supabase, tRPC, React Query, SuperJSON, or Effect.
- The root lint, typecheck, test, build, and format checks pass from a clean checkout.
- Development seed data and production data remain isolated.
- A Convex export and restore drill succeeds.

Old code deleted:

- `packages/api`;
- `packages/db` and Drizzle migrations;
- `apps/web/src/app/api/trpc`;
- `apps/web/src/app/api/imports/upload`;
- `apps/web/src/app/api/cron/cleanup-imports`;
- request and process portfolio caches;
- Supabase storage helpers;
- Postgres Docker and migration scripts;
- obsolete Effect wrappers and plans;
- `apps/mobile` after archival.

## 14. Effect decision

Do not continue the planned backend-wide Effect migration.

Convex mutations own transactionality. Stored import state and scheduled functions own workflow recovery. Convex subscriptions replace portfolio cache invalidation. The remaining external work is small enough for ordinary typed functions.

Port the current currency-rate behavior to a Node action with explicit timeout, retry, freshness, and stale fallback. Keep `packages/importers`, `packages/analytics`, and `packages/portfolio-domain` as plain TypeScript. Remove Effect when the old backend is deleted.

## 15. Risks and required responses

| Risk                                                      | Response                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Production data accidentally enters development           | Separate deployments and credentials, guarded seed functions, ignored migration directory         |
| Actual import exceeds a mutation budget                   | Measure first, test twice-largest data, use versioned builder only when required                  |
| Numeric drift                                             | Canonical decimal source strings, one decimal implementation, exact reconciliation before cutover |
| Duplicate logical records                                 | Indexed read and insert through shared mutation helpers, concurrency tests                        |
| Current and exited behavior changes                       | Explicit source contracts and golden comparison with current SQL results                          |
| Parser action fails after partial staging                 | Attempt IDs, chunk digests, idempotent retry, no active read access to staging                    |
| Production cutover reveals a mismatch                     | Read-only validation period and environment rollback before first Convex-only Commit              |
| Rollback after a new Convex import                        | Preserve its Source File and re-import it into the old application before switching back          |
| Old architecture survives as a hidden compatibility layer | Delete it after the rollback window and remove mobile rather than keeping tRPC for unused code    |
| A future projection change corrupts history               | Immutable normalized source chunks, batch provenance, versioned read models, rebuild tests        |

## 16. Definition of done

The migration is done when all of the following are true:

- The production web application uses only Convex for application data and Source Files.
- Every parity-matrix item passes synthetic tests and production reconciliation.
- The actual production dataset exists only in authorized production systems and protected migration backups.
- Local and preview deployments contain generated data only.
- Import, Commit, retry, duplicate detection, cleanup, currency rates, and reactive reads work in production.
- The first controlled Convex import matches its expected portfolio publication.
- The rollback window closes with a recorded decision.
- Old backend packages and unused mobile code are removed.
- Repository lint, typecheck, tests, build, and format checks pass from a clean checkout.
- Convex backup and restore procedures have been tested.

The implementation should optimize for this result, not for preserving the current internal architecture.
