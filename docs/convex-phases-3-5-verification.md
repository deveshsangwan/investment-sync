# Phases 3–5 implementation and verification

The owner authorized development through Phase 5, periodic commits, and useful independent sub-agent work. Production configuration, data and deployment remain outside this authorization. Branch: `feat/convex-phases-2-through-5`, based on migration integration branch `feat/convex-native-backend`.

Phase 2 was committed as `a59b0b2` after passing the recorded checks and independent reviews. The owner's additional fresh Claude Code review used `claude-opus-5`, session `1a4a011c-d90c-417e-b9f3-b2986800e799`, and approved with four low-priority findings. These concern test-package imports, adapter placement, recording null-instrument backfill handling, and tests using the public entry point. No blocking finding remained.

The current ignored backend configuration selects personal cloud development deployment `hardy-barracuda-115`, not the anonymous localhost backend from the earlier troubleshooting. Real development Clerk sign-in was already verified in the Phase 1 cloud record; the owner has confirmed dashboard setup. Remaining Phase 1 external gates are retained in that record.

| Phase | Objective                                              | Owner                              | State     | Completion evidence                                      |
| ----- | ------------------------------------------------------ | ---------------------------------- | --------- | -------------------------------------------------------- |
| 2     | Exact import contract and pure portfolio publication   | Root                               | Committed | `a59b0b2`; Phase 2 verification record                   |
| 3     | Upload, parsing, preview, retries and source retention | `phase3_backend` and root web work | Verified  | Final checks, live transport and both reviews approved   |
| 4     | Atomic publication, queries and FX refresh             | Pending                            | Planned   | Capacity and atomicity gates must pass before completion |
| 5     | Convex web conversion and browser parity               | Pending                            | Planned   | Authenticated synthetic-data browser checks pending      |

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
