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

## Detail-route loading regression

The first verification missed a separate production-only loading screen. Returning immediately to US Stocks, NPS, or an individual holding passed under `next dev`, but failed under `next build` / `next start`. A DOM observer caught `PageLoading` while the matching Convex subscription was still retained with zero consumers. Next's dynamic route payload was pending, so its unconditional route fallback hid the available data.

The two detail-route fallbacks now render the same authenticated query views as their pages. They read the retained Convex result while the route payload arrives, and retain the normal query skeleton on a cold visit. The asset-class fallback validates the route parameter before querying. Query retention remains 120 seconds after the last consumer leaves, configured by the existing environment variable. This change adds no separate route-cache timer or experimental Next configuration.

The production browser regression exercises real links, observes even short-lived skeleton insertions, and checks the returned heading. Run it in an authenticated development-account browser session on the production build's `/dashboard`, with US stock and NPS positions available:

```sh
pnpm dlx agent-browser --session cache-production eval --stdin < apps/web/scripts/verify-detail-navigation.browser.js
```

The original build failed all three return visits with `loadingSeen: true`. The fixed build passed all three with `loadingSeen: false` and the correct heading, including at a 390 × 844 phone viewport. Build receipt: `/tmp/detail-cache-build.log`.

The 121,000 ms dwell check also passed. Delaying the US Stocks route response by two seconds left the correct cached detail view visible while that response was still pending. Signing out the production browser's own Clerk session released all five retained subscriptions, cleared the idle cache, and removed its holding links. The final web typecheck, lint, and production build passed; lint still reports the existing instrument-image warning.

To test a visit longer than the retention period without holding a browser command open, start the optional dwell check after loading the script, then read its result after approximately 130 seconds:

```sh
pnpm dlx agent-browser --session cache-production eval 'window.detailDwellCheck = {status:"running"}; window.verifyDetailNavigation({dwellMs:121000}).then(receipts => window.detailDwellCheck = {status:"passed",receipts}, error => window.detailDwellCheck = {status:"failed",error:error.message}); "started"'
pnpm dlx agent-browser --session cache-production eval 'window.detailDwellCheck'
```

Independent Codex review approved the final fallback changes with no actionable findings. The review confirmed that both views preserve the existing Clerk session gate, query error boundaries, and query-argument validation.

The requested Claude Code Opus 5 review was retried for this fix and again returned the session limit, resetting at 02:40 Asia/Kolkata. Receipt: `/tmp/detail-cache-opus-review.txt`. Opus approval remains pending under the existing authorization to proceed with verified changes.
