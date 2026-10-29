# Mobile portfolio backend

Mobile uses the same public Convex API and Clerk instance as web. It reads
`portfolio.overview.summary` for Overview and `portfolio.positions.current` for
Holdings. Imports and manual policy edits are still made on web; subscriptions
receive the published results automatically, including changes made while the
app was disconnected. Exited positions are deliberately excluded from this
current holdings screen.

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and set:

- `EXPO_PUBLIC_CONVEX_URL` to the **exact active web deployment URL** (the value
  web receives as `NEXT_PUBLIC_CONVEX_URL`). A project's default production
  deployment may differ from its active cutover deployment; see
  [the cutover record](convex-phase-8-cutover.md).
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to the public key of the **same Clerk
  instance** used by web and the backend's `CLERK_JWT_ISSUER_DOMAIN`.

Expo inlines these public values into the app. Restart Metro after changing
local configuration; rebuild the release bundle when changing a shipped app.
The repo-root `.env.local` is not a substitute for the app-local file. Do not put
Clerk secret keys, Convex deploy keys, database URLs, or storage credentials in
`EXPO_PUBLIC_*` variables. `EXPO_PUBLIC_API_URL` is no longer used.

The existing backend Clerk configuration accepts the `convex` audience. Mobile
uses Convex's Clerk adapter, which requests that audience via the Clerk Convex
integration or the `convex` JWT template. Clerk sign-in alone does not unlock
portfolio queries: Convex must confirm authentication, then `users.ensureCurrent`
must succeed. Existing identities retain their Household; new users are
provisioned atomically by Convex. No SQL provisioning or dual writes are used.

Every Clerk user/session and retry creates a separate client. The old client is
closed, private screens are unmounted on auth loss, and late provisioning/auth
responses cannot unlock another session. Portfolio amounts retain the shared
server's decimal strings and INR display conversions; the native UI formats only
display values. Missing holding returns show “Unavailable”.

During connection loss, loaded values remain visible with a reconnect notice.
Convex retries its subscription connection automatically. Loading, auth,
provisioning, and query errors offer a manual retry that discards the failed
client. Foreground resume also retries failed authentication. Sign out remains
available while preparing the account or recovering from errors.

Focused configuration/session tests run with `pnpm --filter
@investment-sync/mobile test`. They use Vitest and a fake transport with the
real Convex Clerk adapter, not a live deployment or device session. Issue #23
owns the separate native UI/end-to-end harness; its Jest tests should use
`.native.test.{ts,tsx}` filenames, explicitly excluded by Vitest here. This
backend correction does not depend on #23. When combining the PRs, update #23’s
legacy tRPC screen helper to Convex and run both suites; query errors now belong
to the session boundary, and live subscriptions replace pull-to-refresh. Keep
both test commands in the mobile test script and regenerate the lockfile if
resolving dependency changes.

See [offline validation receipts and device-testing limits](mobile-convex-validation.md).
