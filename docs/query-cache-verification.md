# Navigation query cache verification

The Convex web migration released page subscriptions when navigating away. A real browser check of Overview → Holdings → Overview observed the portfolio loading skeleton again. The updated portfolio and Settings queries retain native Convex subscriptions for 120 seconds after their final consumer leaves. Results stay owned by Convex and continue receiving server updates.

`NEXT_PUBLIC_QUERY_CACHE_RETENTION_SECONDS` changes the retention period at build time. Missing or invalid values default to 120 seconds; zero disables retention. At most 20 idle subscriptions remain. The existing Clerk identity/session boundary owns the cache; loss of authentication also clears it. Failed queries are released so the error boundary can retry. Paginated import history and the active upload workflow retain their existing lifecycle.

The `convex-helpers` cache provider was evaluated, but its current implementation has no immediate provider disposal operation. This implementation uses the native `watchQuery` subscription API with explicit cleanup, without storing a second copy of query values or persisting portfolio data in browser storage.

## Checks

- Original browser reproduction reported `loadingSeen: true`; the same navigation check after the change reported `loadingSeen: false`.
- The local production build also passed repeated Overview/Holdings/Settings navigation with no return-visit portfolio skeleton.
- A real FX provider refresh on personal development `hardy-barracuda-115` updated the cached Overview result while Holdings was open. No import or holding was changed for this check.
- A browser timer check found Overview's result still retained at 118 seconds after leaving the page and released at 122 seconds, confirming the configured two-minute lifetime against the real Convex client.
- Signing out the production-build automation session immediately reduced its five retained subscriptions to zero and cleared all idle timers.
- Web typecheck and lint passed, with one existing image optimization warning. All 60 web tests passed, including 18 cache/configuration tests covering expiry, shared consumers, argument separation, capacity, failure cleanup, session cleanup, disabled retention, and configuration validation.
- The isolated web production build passed. Build receipt: `/tmp/query-cache-build.log`.

## Review

Independent Codex review `query_cache_review` approved the implementation with no actionable findings, including React StrictMode cleanup, identity isolation, native subscription behavior, and retries. The snapshot was reviewed against `1a421b2` in `/tmp/investment-sync-cache-review`.

Claude Code review with `claude-opus-5` was attempted but blocked by the session quota, which reported a reset at 02:40 Asia/Kolkata. Receipt: `/tmp/query-cache-opus-review.txt`. Its review remains pending under the owner's existing instruction to proceed with verified work and run Opus when available. This document does not claim Opus approval for this follow-up.
