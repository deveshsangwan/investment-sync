# Local development data

On the Convex migration branch, the web application reads and writes portfolio data through Convex. Start with [Configure Convex](#configure-convex), then run `pnpm dev:web`. Import generated CSV/XLSX files through the app to populate your signed-in development Household. Production still uses the existing Postgres/Supabase deployment until a separately authorized cutover.

The local Postgres instructions below support legacy API comparisons and integration tests. Postgres seeds do not populate the Convex web application. Do not point local fake seeds at production.

## Clerk

Clerk user IDs are scoped to a Clerk application/environment. The same Google email can have different Clerk IDs in development and production.

For legacy Postgres comparisons, seed with the Clerk user ID used by your local Clerk app:

```text
--clerk-user-id "user_..."
```

## Start Local Postgres With Apple `container`

If you use Apple's `container` CLI:

```bash
pnpm db:container:up
```

This starts a Postgres container named `investment-sync-postgres` with a persistent volume and publishes it on port `54329`.

Local database URL:

```text
postgresql://investment_sync:investment_sync@localhost:54329/investment_sync_dev
```

Useful commands:

```bash
pnpm db:container:logs
pnpm db:container:down
```

## Start Local Postgres With Docker

If Docker is available:

```bash
docker compose up -d postgres
```

Local database URL:

```text
postgresql://investment_sync:investment_sync@localhost:54329/investment_sync_dev
```

If Docker is not available, create a local Postgres database with Postgres.app or another local Postgres install and use its connection URL instead.

## Configure `.env.local`

For legacy API and migration comparisons, use a local `DATABASE_URL`. These database and Supabase variables are not the data connection for the converted Convex pages.

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_dev_clerk_publishable_key
CLERK_SECRET_KEY=your_dev_clerk_secret_key

DATABASE_URL=postgresql://investment_sync:investment_sync@localhost:54329/investment_sync_dev

# Legacy API storage configuration; Convex uploads use Convex Storage.
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=local-dev-placeholder
SUPABASE_IMPORT_BUCKET=portfolio-imports
CRON_SECRET=replace-with-a-random-secret
```

Legacy upload routes need Supabase-compatible storage. Their cleanup endpoint fails closed when `CRON_SECRET` is absent. The converted web upload flow and scheduled cleanup use Convex.

## Configure Convex

The converted web pages require an explicit Convex deployment URL. Reuse the established personal development deployment and Clerk development instance, or initialize a new development backend:

```bash
pnpm dev:backend
```

On a new deployment, the first push is expected to fail until `CLERK_JWT_ISSUER_DOMAIN` is configured. Keep this development process open, set the deployment variables below from a second terminal, then let it retry (or restart `pnpm dev:backend`). The initial selection writes `CONVEX_DEPLOYMENT` before the application push; the environment commands must target that same development deployment.

Keep the generated `CONVEX_DEPLOYMENT` in `packages/backend/.env.local`. Add `NEXT_PUBLIC_CONVEX_URL` from `apps/web/.env.example` to your existing `apps/web/.env.local`, preserving its Clerk and database settings. Set it to the development URL printed by the CLI. An anonymous local backend normally uses `http://127.0.0.1:3210`; a personal cloud development deployment uses an `https://…convex.cloud` URL.

Portfolio pages and Settings retain unused Convex query subscriptions for 120 seconds after their last viewer unmounts. Returning within that window uses the live result without another loading skeleton. Updates continue arriving while the subscription is retained. First visits and visits after eviction may still need to load. At most 20 unused queries are retained; reaching the limit releases the oldest idle subscription. Paginated import history and the active upload workflow keep their existing query lifecycle.

Asset-class and holding route fallbacks use the same authenticated query views as their pages. A pending Next.js route payload can therefore display the retained Convex result. Check this behavior with a production build; `next dev` alone did not reproduce the original route-loading flash. See [the browser regression check](query-cache-verification.md#detail-route-loading-regression).

Returning from a holding to Holdings restores the list's filters, sort, and scroll position after its rows render, including when the query cache has expired. This view state stays in memory only for the current Holdings/detail navigation flow and authenticated session. See [the scroll-restoration checks](holdings-navigation-verification.md).

To change the retention window, set `NEXT_PUBLIC_QUERY_CACHE_RETENTION_SECONDS=120` in `apps/web/.env.local` and restart the web server. Use a nonnegative whole number of seconds; `0` disables retention. Missing or invalid values use 120 seconds. For a Vercel preview, set the variable in the branch's Preview environment and rebuild that preview. This is a build-time setting. Sign-out, account/session changes, and authentication failure clear the retained subscriptions immediately. Query results remain in Convex's in-memory client; this does not persist financial data in browser storage.

In the development Clerk application, activate the Convex integration and copy the application's Frontend API URL, following the [Convex Clerk setup guide](https://docs.convex.dev/auth/clerk). The token audience must be `convex`, matching `applicationID` in `convex/auth.config.ts`. Use that development application's issuer domain below. The provider uses `NEXT_PUBLIC_CONVEX_URL` in both development and production-mode preview builds. Set a preview build to its isolated preview backend; never reuse production credentials or a production backend for development testing. A missing URL shows a configuration error on protected pages.

In Clerk's development instance, open **Sessions → Customize session token → Claims** and add `"email": "{{user.primary_email_address}}"`, preserving the existing `aud` and any other claims. The integration can authenticate without this claim, but this app needs it to save the sign-in email. Sign out and sign back in after changing claims, then confirm the email is present in the development `users` document. See [Clerk's additional-claims instructions](https://clerk.com/docs/guides/development/integrations/databases/convex).

`CLERK_JWT_ISSUER_DOMAIN` and `APP_ENV` are Convex deployment environment variables, not shell-only variables. Set them on the personal development deployment:

```bash
pnpm --filter @investment-sync/backend exec convex env set CLERK_JWT_ISSUER_DOMAIN https://your-development-clerk.accounts.dev
pnpm --filter @investment-sync/backend exec convex env set APP_ENV development
```

The optional backend-only fixture can be created with:

```bash
pnpm --filter @investment-sync/backend exec convex run testing/seed:fakeDevelopmentData
```

Use `APP_ENV=test` only for isolated automated-test deployments. Never add production Clerk keys, production data, or production migration credentials to a development or preview deployment.

The seed is repeatable and creates a fake identity, not your signed-in Clerk identity. Signing in provisions your own separate Household. To see data in your browser, upload generated supported files through Imports using your development account. Verify real sign-in against the selected development backend before treating a new environment as ready.

When Convex function modules change, run `pnpm backend:codegen` against the explicitly selected local or personal development backend and commit the generated bindings. Ordinary lint, typecheck, and unit tests use those bindings without deployment credentials; successful unit tests do not prove cloud authentication works.

## Apply Schema

```bash
DATABASE_URL=postgresql://investment_sync:investment_sync@localhost:54329/investment_sync_dev \
  pnpm --filter @investment-sync/db migrate
```

## Seed Fake Data

Replace the Clerk ID with your local Clerk user ID:

```bash
pnpm db:seed:fake -- --clerk-user-id "user_your_local_dev_clerk_id" --email "you@example.com" --reset
```

Or set `SEED_CLERK_USER_ID` and `SEED_EMAIL` in `.env.local` and run `pnpm db:seed:fake -- --reset`.

The seed creates fake holdings where older snapshots come from `Manual Workbook` and latest snapshots come from broker/manual sources, which verifies grouped value history.

## Run Web

```bash
pnpm dev:web
```
