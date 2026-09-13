# Phases 3–5 implementation and verification

The owner authorized development through Phase 5, periodic commits, and useful independent sub-agent work. Production configuration, data and deployment remain outside this authorization. Branch: `feat/convex-phases-2-through-5`, based on migration integration branch `feat/convex-native-backend`.

Phase 2 was committed as `a59b0b2` after passing the recorded checks and independent reviews. The owner's additional fresh Claude Code review used `claude-opus-5`, session `1a4a011c-d90c-417e-b9f3-b2986800e799`, and approved with four low-priority findings. These concern test-package imports, adapter placement, recording null-instrument backfill handling, and tests using the public entry point. No blocking finding remained.

The current ignored backend configuration selects personal cloud development deployment `hardy-barracuda-115`, not the anonymous localhost backend from the earlier troubleshooting. Real development Clerk sign-in was already verified in the Phase 1 cloud record; the owner has confirmed dashboard setup. Remaining Phase 1 external gates are retained in that record.

| Phase | Objective                                              | Owner                                 | State          | Completion evidence                                               |
| ----- | ------------------------------------------------------ | ------------------------------------- | -------------- | ----------------------------------------------------------------- |
| 2     | Exact import contract and pure portfolio publication   | Root                                  | Committed      | `a59b0b2`; Phase 2 verification record                            |
| 3     | Upload, parsing, preview, retries and source retention | `phase3_backend` and root web work    | Committed      | `ad6b170`; final checks, live transport and both reviews approved |
| 4     | Atomic publication, queries and FX refresh             | Backend and isolated read workstreams | Verified | Codex approved; checks and live parity passed; owner permits deferred Opus         |
| 5     | Convex web conversion and browser parity               | Pending                               | Planned        | Authenticated synthetic-data browser checks pending               |

Unrelated untracked installed agent instructions, skills and the original handoff remain excluded from implementation commits.

## Phase 3 receipts

Review base: `a59b0b2`; Phase 3 reviewed as the complete uncommitted change, excluding unrelated installed agent files and the original handoff.

- `pnpm exec turbo run lint typecheck test --force --concurrency=2`: exit 0, 24 tasks passed. Backend has 36 passing tests, including 13 new lifecycle cases. Existing Postgres integration suites skip in this run without TEST_DATABASE_URL; their Phase 2 real-database receipts remain recorded separately.
- `pnpm exec turbo run build --force --concurrency=2`: exit 0, eight builds passed. Existing native-image lint warning remains.
- `pnpm --filter @investment-sync/backend exec convex dev --once`: exit 0, functions ready on personal development `hardy-barracuda-115`; final push took 4.08 seconds.
- `pnpm exec tsx scripts/convex-development/verify-imports.mjs`: exit 0, all five supported parser goldens uploaded to real Convex Storage and parsed by the scheduled Node action. Count, parser version, preview, warnings and source availability matched the exact parser. Anonymous access was rejected.
- The independent upload-transport fixture had 27,146 source bytes, 320 rows and 219,521 normalized bytes, exceeding the required 23,776 source-byte floor. Repeating with `--transport-only` passed against the final deployment.
- Cloud log metrics for that run: four chunk writes of 65,550 / 65,550 / 65,550 / 24,390 database bytes. Finalization read 221,664 database bytes and six documents, wrote 3,273 database bytes and one document, and used 37.59 ms user code / 47.57 ms execution. Its in-function metrics recorded 16 database queries. The Node parser action took 4.57 seconds. These are staging-path measurements; Phase 4 publication capacity remains unmeasured.
- The Phase 3 web path is selected only with `NEXT_PUBLIC_CONVEX_IMPORTS_ENABLED=true` in development. Source transfer is direct to Convex, and parsing state and paginated history use subscriptions. Applying an import is deliberately absent until Phase 4. With this development flag enabled, provisioning gates the app shell before import queries depend on a user; Phase 5 makes that gate appropriate for all converted pages.
- Browser landing and unauthenticated redirect checks passed using agent-browser. Authenticated browser verification is pending the test-account choice: the Google-only development Clerk instance rejects an identifier-free generated user, including when using Agent Tasks. No Clerk settings were changed.

Phase 3 uses provisional engineering ceilings of 64 distinct accounts and 512 instruments per batch in addition to the recorded row/byte limits. They cover the twice-largest identity counts. Phase 4 must measure accumulated Household capacity and detect overflow explicitly before publication.

## Phase 3 review follow-up

Independent Codex review approved the initial change with three low-priority findings. Opus 5 session `e5b68320-e45d-4528-82f2-d4cbc468e444` requested removal of unused bearer download URLs and boundary tests before committing. The fixes also address the related integrity and retention follow-ups:

- Public batch results contain file availability without download URLs or storage IDs.
- Boundary tests cover 1100/1101 rows, 524288 normalized bytes and one byte above, 100-row chunks, UTF-8 byte boundaries, 64/65 accounts and 512/513 instruments. The public staging path explicitly rejects 1348 rows; Phase 4 uses its separate guarded stress path for that fixture.
- Chunking serializes each row once. Source checksums retain Postgres-compatible hexadecimal SHA-256; attached Storage metadata, downloaded bytes and finalization must agree.
- Source deletion retries are tested, and an already-deleted object completes cleanup. An indexed failed-staging sweep removes at most 50 expired failed chunks per mutation. Parsed and committed rows remain intact. Lease expiry and late-worker rejection have regression coverage.
- The temporary web path reports missing configuration, memoizes and handles malformed previews, and only calls the extra Clerk hook within its active development provider. The runtime test requires an explicit UNAUTHENTICATED failure.

The interim `uploaded` status remains reserved in the validator: attachment schedules parsing and enters `parsing` atomically, so there is no separately observable uploaded state. A new reservation quota is deferred because it is outside the measured import contract. Per-chunk writes are internal and originate from the bounded parser; cumulative manifest limits are enforced before parsed status. Phase 4 replaces the committed-version placeholder and adds its required indexes. No parser version or accepted holding behavior changed.

The backend follow-up passed 54 tests, lint and typecheck. Root repeated the complete workspace checks with TEST_DATABASE_URL pointing only to the synthetic loopback database: exit 0, all 24 tasks passed including real Postgres integration tests. All eight builds also passed. After a fresh development push, all five parser goldens and the twice-largest upload transport fixture passed again with checksum verification enabled; anonymous access failed with UNAUTHENTICATED. Opus 5 follow-up session `b588ca5f-c234-460e-8063-3d28ea773a32` approved the final change and explicitly allowed the Phase 3 commit and Phase 4 work. Independent Codex follow-up also approved with no blocking findings.

Remaining low-priority review notes are carried into the next phases: Phase 4 adds the Household/status index and examines cumulative staging byte accounting; Phase 5 removes the temporary client, unifies limit copy, and completes provisioning/error behavior. An additional action-level oversized-file regression is desirable alongside the existing finalization boundaries. Missing internal metadata currently surfaces a generic public error. Parse-lease scans assume every parsing batch has a lease, as the only writer guarantees. The deletion-outage test proves handler behavior with an injected rejection; a real transactional storage failure may instead abort and leave the expired stored object eligible for the next cron. Metrics logging is retained for development capacity evidence and must be revisited before production cutover. None of these findings blocks Phase 3.

## Phase 4 capacity candidate

Review base is Phase 3 commit `ad6b170`. Phase 4 is not complete. The first candidate implements atomic Commit and compact versioned persistence; public queries, FX, version cleanup and broad parity verification follow the capacity decision.

A local CPU diagnostic with 2734 historical rows and 1348 incoming rows found repeated histories expanded the in-memory projection to about 11.5 MB. Canonical serialization and hashing dominated local publication time. The candidate stores each effective history fact once and references shared scopes. It also changes the internal publication digest format to `portfolio-input-v2`, hashing projector version, canonical immutable facts and reconciliation once. This is an internal digest change; financial views remain unchanged. Tests cover property-order invariance and digest sensitivity to metadata, values and provenance, alongside existing replay tests.

The candidate's pre-deployment checks passed 58 backend tests and 34 domain tests, plus both packages' lint and typecheck. Development codegen and a one-shot push to `hardy-barracuda-115` passed. The runtime script commits four generated historical batches totaling 2734 rows before the 1348-row stress batch. No production data is used.

A separate auth probe created a session for the identifier-free synthetic Clerk development user and sent its native session JWT to the real development backend. `users.ensureCurrent` and `users.current` succeeded with owner membership. The native token already has the `convex` audience, matching the owner's configured integration; no legacy JWT template is required and no Clerk settings changed. This proves native JWT backend authentication, not browser sign-in.

Capacity thresholds use the current [Convex limits](https://docs.convex.dev/production/state/limits): 16 MiB read and written, 32000 documents scanned, 4096 index ranges, 16000 documents written, 1 MiB per document and one second of user-code time. The gate requires at least 50 percent headroom.

### Single-mutation result: fallback required

`node --experimental-strip-types scripts/convex-development/verify-publication-capacity.mjs` exited 1 against personal development. The four historical commits published 684, 684, 684 and 682 rows, totaling 2734. Their cloud user-code times were 235.78, 387.45, 549.30 and 670.68 ms. The final 1348-row candidate hit the one-second limit at 1000.139 ms, reading 4,770,391 database bytes and 2950 documents. Cloud logs reported zero committed write bytes/documents for the failed attempt.

A guarded post-failure query confirmed the same active version and sequence 4, 2734 published facts, zero facts and zero versions for the failed batch, and its status still parsed. Atomic rollback held. The single-mutation path fails the 50 percent user-code headroom requirement and the staged fallback in section 8 of the plan is now selected. No threshold or fixture was reduced.

The fallback workstream owns publication stages, receipts, final validation and lifecycle cleanup. A separate isolated checkout handles public read queries and FX against the versioned read-model contracts, allowing those independent parts of Phase 4 to proceed while the staged builder is measured. No additional branch or PR is being proposed for integration; completed changes return to the same broadened feature branch for review.

The owner subsequently authorized using their existing development account for generated browser-test imports. A short-lived Clerk sign-in ticket successfully authenticated that account in the local automated browser. The earlier synthetic-account blocker is resolved; full authenticated Phase 5 browser verification remains pending the web conversion. No Clerk settings or production environment changed.

Authenticated browser follow-up passed on the committed Phase 3 upload UI: `browser-test-fake-stock-holdings.csv` uploaded directly to development Convex Storage, reached parsed status, and displayed the FAKECO preview and history entry without a page refresh. This generated batch remains parsed for the Phase 5 history/apply regression. Screenshot: `/tmp/phase4-authenticated-import-preview.png`.

### Staged publication runtime result

The staged runtime candidate passed `node --experimental-strip-types scripts/convex-development/verify-publication-capacity.mjs`, exit 0, on personal development `hardy-barracuda-115`. It published the same four historical batches totaling 2734 rows, then 1348 incoming rows and 844615 normalized bytes, ending at sequence 5 with 4082 immutable facts. The public 1100-row/512-KiB import ceilings were unchanged; the guarded generated fixture uses the separate stress path.

Across all five publications, finalization used at most 208.044 ms user-code time, 2179591 database read bytes, 2701911 database write bytes including indexes, 398 documents read, 1352 documents written and 26 measured database queries. In-function finalization counters reported 2137892 logical bytes read and 1767992 logical bytes written. Staging mutations used at most 33.936 ms user-code time and 153 database queries; their maxima were 205475 database read bytes and 128554 database write bytes including indexes. These transaction metrics pass the 50 percent headroom gate.

The final Node action took 37.221 seconds end to end, including bounded paginated reads and chunk writes. Its pure publication builder took 3377.922 ms; input reads took 2265.288 ms. The resulting persisted row/provenance JSON totaled 3239391 bytes. The builder enforces a 6000-fact and 6-MiB accumulated immutable-fact ceiling before sealing a candidate. It does not repeat the whole-history computation inside finalization. Platform action logs reported the 512-MB Node allocation, which is not evidence of peak heap usage.

Runtime receipts: `/tmp/phase4-staged-capacity-run.log`, `/tmp/phase4-staged-capacity-receipts.json`, `/tmp/phase4-staged-cloud.jsonl` and `/tmp/phase4-staged-metrics-summary.json`. Run ID `fake-capacity-1789308591579`. Maximum stored-document size and final public-query capacity measurements remain to be recorded before Phase 4 closes.

### Combined public-query checks

After merging the isolated read/FX workstream, the backend passed 84 tests plus typecheck. The complete workspace run with the synthetic loopback Postgres database passed all 24 lint/typecheck/test tasks; all eight builds also passed. Logs: `/tmp/phase4-full-checks.log` and `/tmp/phase4-full-build.log`.

The final capacity fixture's stored documents passed the serialized size check through bounded 100-document/512-KiB indexed pages. The largest was a publication receipt at 79489 UTF-8 JSON bytes, below the 524288-byte headroom gate. The version root was 25746 bytes; maximum position, history-fact, scope and immutable-holding documents were 1763, 1396, 3115 and 1499 bytes. These are serialized JSON sizes, not direct storage-engine byte measurements. Receipts: `/tmp/phase4-document-size-receipts.json`.

The first combined live query measurement found exact output parity but an asset-class query at 506.945 ms user-code time, narrowly above the 500-ms target. It read 5894517 database bytes and 4208 documents with 30 measured database queries. The read workstream is removing repeated decoding of shared facts before a new measurement. Phase 4 remains open until this read path passes the same gate and both independent reviews approve.

The live read-parity run subsequently passed the accumulated 4082-fact fixture and all five generated parser goldens through real Storage upload, scheduled parsing, staged Commit and every public portfolio view. The large fixture produced 64 Current and 118 Exited entries. It checked two representative holding details and both asset classes; each parser golden checked every resulting holding detail and asset class, plus overview and positions. Fresh/stale/unavailable FX transitions passed without another Commit, including the legacy global FX dependency in asset-class weights. The test restored the real Frankfurter development quote successfully afterward. Receipts: `/tmp/phase4-live-read-parity.log` and `/tmp/phase4-live-read-parity-receipts.json`. This establishes output parity; the asset-query runtime optimization remains a separate open gate.

### Final pre-review verification

The optimized asset-class query used 225.313 ms for the large Indian-stock view and 53.296 ms for the US-stock view. The larger view retained the same 5894511 database read bytes, 4208 documents and 30 database queries. It hydrated 46 current positions and decoded 1142 shared facts, preserving exited headers and global portfolio weights. Per-query payload validation is cached, and histories unnecessary for the selected view are no longer decoded. The 500-ms read-path gate now passes.

After those two model-file changes, all 13 portfolio tests, backend typecheck and backend lint passed. The entire live parity run passed again for the 4082-fact portfolio and all five parser goldens, including FX transitions without Commit. The actual development Frankfurter quote was restored successfully. Logs: `/tmp/phase4-optimized-query-tests.log`, `/tmp/phase4-optimized-typecheck.log`, `/tmp/phase4-optimized-lint.log`, `/tmp/phase4-optimized-live-parity.log`, `/tmp/phase4-optimized-query-cloud.jsonl` and `/tmp/phase4-optimized-query-metrics.json`.

The ordinary `pnpm dev:backend` command also reached "Convex functions ready" against personal development without either the missing issuer error or the file-watcher error. A 30-second timeout bounded this startup check; it was stopped deliberately afterward. The web environment still needs its explicit personal-development Convex URL wired during Phase 5.

The initial Phase 4 candidate passed its recorded implementation and measured backend checks. The complete uncommitted change against `ad6b170` went to independent Codex and Claude Opus 5 reviews. No Phase 4 commit or dependent Phase 5 implementation has started yet.


### Phase 4 review and fixes

Independent Codex reviewer `phase4_review`, GPT-5.6 Sol, requested changes with five findings. All five were verified and accepted:

- High: small valid imports with large metadata could accumulate into an unreadable asset-class view. Stage receipts now measure logical model bytes written. Before any final identities, facts or active pointer are written, finalization applies an 8-MiB aggregate public-read budget, weighting position documents twice and reserving 256 bytes per weighted document plus 256 KiB per request. Physical deployment read bytes remain a separate measurement. The regression rejects the overflowing candidate and preserves the previous pointer, facts and accounts.
- Medium: fixed five-row scope chunks could exceed the 512-receipt manifest limit for 6000 compact facts and 6184 scope rows. Packing now observes 100 rows, 64 KiB and 500 history references per chunk. Writer and readers share an explicit 8192 total-scope-row ceiling. Sparse and dense scope regressions pass.
- Medium: `imports.latestCommitted` ordered by upload creation time. The Postgres dashboard explicitly sorts by `committedAt`, so the Convex query now uses an index ending in that field. An out-of-order timestamp regression passes.
- Medium: identity and fact persistence lacked the plan's exact-key idempotent and conflict-detecting helpers. Shared exact-index helpers now return identical existing records and reject conflicting identity fields, changed immutable content and duplicate stored keys. They preserve first-seen account metadata and instrument display names. Six regressions cover replay, corruption and concurrent calls; the repeat capacity measurement passed.
- Medium: `accounts.list` mapped stored `indian_stock` to `broker` and `ulip` to `insurance`. The legacy import service stores the asset class and the accounts query returns it unchanged. Convex now does the same; imported stock, ULIP and default broker account regressions pass.

The first two fixes passed all 89 backend tests, lint and typecheck in the isolated fix checkout. The combined account and commit-time fixes passed 15 portfolio tests. The final combined checks and live remeasurement passed as recorded below.

Claude Code actually selected `claude-opus-5`, session `3e1930a9-6644-41f9-b3df-c3f8cf65e2a7`, but exited 1 before producing a review verdict because the account reached its usage limit. It reported reset at 2026-09-13 21:40 Asia/Kolkata. This is a tooling quota, not an approval or a code finding. The complete Opus review and any necessary follow-up approval remain pending under implementation-plan rule 11. Phase 4 is uncommitted and dependent Phase 5 implementation has not begun.


### Final Phase 4 follow-up receipts

All five accepted Codex findings are fixed. The independent GPT-5.6 Sol reviewer approved the focused follow-up with no remaining code findings. Phase 4 remains uncommitted while the separate Opus gate is pending.

- `TEST_DATABASE_URL=postgresql://investment_sync:investment_sync@127.0.0.1:54329/investment_sync_test pnpm exec turbo run lint typecheck test --force --concurrency=2`: exit 0, all 24 tasks passed, including 97 backend tests and real synthetic Postgres integration tests. Log `/tmp/phase4-final-fixes-checks.log`.
- `pnpm exec turbo run build --force --concurrency=2`: exit 0, all eight builds passed. Log `/tmp/phase4-final-fixes-build.log`.
- `CONVEX_DEPLOYMENT=dev:hardy-barracuda-115 pnpm --filter @investment-sync/backend exec convex dev --once`: exit 0, functions ready, including the new commit-time index. Log `/tmp/phase4-final-fixes-deploy.log`.
- `CONVEX_DEPLOYMENT=dev:hardy-barracuda-115 node --experimental-strip-types scripts/convex-development/verify-publication-capacity.mjs`: exit 0. Run `fake-capacity-1789312028004` committed 1348 incoming rows after 2734 historical rows, yielding 4082 facts and sequence 5. A first attempt stopped before fixture creation because DNS resolution failed with `EAI_AGAIN`; resolution recovered and the retry passed. Log `/tmp/phase4-final-fixes-capacity-retry.log`.
- Finalization maxima: 373.650 ms user code, 2212539 physical database read bytes, 2694939 write bytes including indexes, 543 documents read, 1352 written and 1376 database queries. Stage maxima: 87.919 ms, 616469 physical read bytes, 128581 write bytes including indexes, 428 read documents, 101 written and 287 queries. All retain the required 50 percent headroom. Final aggregate public-read budget: 5785379 weighted logical model bytes plus 1527808 reserve, totaling 7313187 below 8388608. Metrics `/tmp/phase4-final-fixes-metrics.json`; cloud receipts `/tmp/phase4-final-fixes-cloud-retry.jsonl`.
- `CONVEX_DEPLOYMENT=dev:hardy-barracuda-115 pnpm exec tsx /tmp/phase4-verify-read-parity.mjs`: exit 0. The large fixture and all five parser goldens passed public-view parity, plus fresh/stale/unavailable FX without another Commit. The actual development Frankfurter quote was restored successfully. Log `/tmp/phase4-final-fixes-live-parity.log`.
- The final large asset query used 221.410 ms, 5887415 physical database read bytes, 4208 documents and 30 queries. Overview, positions and holding-detail maxima were 43.151, 40.932 and 29.823 ms.
- `CONVEX_DEPLOYMENT=dev:hardy-barracuda-115 node /tmp/phase4-document-size-check.mjs`: exit 0. Largest stored UTF-8 JSON document was 79490 bytes, below 524288. The final candidate used 139 receipts, down from 192 before scope packing. Log `/tmp/phase4-final-fixes-documents.log` and receipts `/tmp/phase4-document-size-receipts.json`.

The owner explicitly answered "Proceed now; run Opus when available." Phase 4 may be committed and Phase 5 may begin while the deferred Opus review awaits its quota reset. That review remains required, and any findings will be addressed before closing Phase 5.
