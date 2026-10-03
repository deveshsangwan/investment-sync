# Holdings return navigation

Returning from a holding should restore the list the user left, including its filters, sort order, and scroll position. The existing in-app Holdings link performed a new navigation and scrolled to the top. Browser Back worked while rows were cached, but could restore against the shorter loading skeleton after the query cache expired.

The web app now remembers one Holdings view in memory when a holding link is opened. Returning from a detail restores its filters and waits for positions to render before restoring scroll. The in-app link still targets `/holdings` directly. Browser history traversal uses the same restoration when returning from a holding.

This view state is separate from the 120-second live-query retention period. It contains filter settings and a scroll offset, not portfolio query results. Navigating outside Holdings and its detail pages discards it. Authentication loss and Clerk identity/session changes also discard it. A direct entry or page reload starts with the default list view.

## Browser checks

Checks used the authorized development account at a 390 × 844 viewport. No holdings or imports were changed.

| Scenario                                     | Before                  | After                                        |
| -------------------------------------------- | ----------------------- | -------------------------------------------- |
| In-app Holdings link                         | 1508 px → 0 px          | 1508 px → 1508 px                            |
| Browser Back at the bottom with cached rows  | Already passed          | 1995 px → 1995 px                            |
| Browser Back after releasing the query cache | 1633 px → 170 px        | 1633 px → 1633 px                            |
| Search and Name A-Z sort, in-app return      | Not previously verified | 1258 px → 1258 px, search and sort preserved |

The in-app return, bottom-of-list browser Back, and filtered/sorted return also passed in an isolated production build. An actual 122-second wait on the holding detail expired the unused query cache; browser Back then restored 1508 px → 1508 px with search and sort preserved. Signing out that browser's own Clerk session discarded the saved view, cleared the query cache, and removed all holding links.

Direct-entry detail → Holdings → browser Back → Holdings stayed inside the app. Direct entry and unrelated Overview → Holdings navigation started at the top with default filters.

Run the regression script in an authenticated browser session on `/holdings`, with enough development positions to scroll:

```sh
pnpm dlx agent-browser --session cache-production eval --stdin < apps/web/scripts/verify-holdings-scroll.browser.js
pnpm dlx agent-browser --session cache-production eval 'window.verifyHoldingsScroll({back:"browser",position:"end"})'
```

For actual cache expiry, schedule the long check and read its receipt after approximately 130 seconds:

```sh
pnpm dlx agent-browser --session cache-production eval 'window.scrollExpiryCheck={status:"running"}; window.verifyHoldingsScroll({back:"browser",dwellMs:122000}).then(receipt=>window.scrollExpiryCheck={status:"passed",receipt},error=>window.scrollExpiryCheck={status:"failed",error:error.message}); "started"'
pnpm dlx agent-browser --session cache-production eval 'window.scrollExpiryCheck'
```

## Code verification and review

Web typecheck, lint, all 60 existing web tests, and the production build passed. Lint retains the existing instrument-image warning. Build receipt: `/tmp/holdings-scroll-build.log`. The separate [holding-entry skeleton regression](query-cache-verification.md#holding-entry-from-another-main-page) also passed in the combined production candidate.

Independent Codex review approved the final implementation. The previously requested Opus 5 follow-up remains pending its quota reset at 02:40 Asia/Kolkata, under the existing authorization to proceed with verified changes.
