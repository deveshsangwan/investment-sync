# Local Development Data

Use a local Postgres database for fake portfolio data. Do not point local fake seeds at the production Supabase database.

## Clerk

Clerk user IDs are scoped to a Clerk application/environment. The same Google email can have different Clerk IDs in development and production.

For seeded data to appear after login, seed with the Clerk user ID used by your local Clerk app:

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

For local dashboard/history testing, use a local `DATABASE_URL`.

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_dev_clerk_publishable_key
CLERK_SECRET_KEY=your_dev_clerk_secret_key

DATABASE_URL=postgresql://investment_sync:investment_sync@localhost:54329/investment_sync_dev

# Required by app configuration. Dashboard browsing does not call storage.
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=local-dev-placeholder
SUPABASE_IMPORT_BUCKET=portfolio-imports
CRON_SECRET=replace-with-a-random-secret
```

Uploads need real Supabase-compatible storage. Dashboard/history testing only needs Postgres.
The Source File cleanup endpoint fails closed when `CRON_SECRET` is absent.

## Configure Convex

Phase 1 keeps application reads on Postgres, but the optional development provider can connect to a personal Convex development deployment. Initialize it from the backend package:

```bash
pnpm dev:backend
```

On a new deployment, the first push is expected to fail until `CLERK_JWT_ISSUER_DOMAIN` is configured. Keep this development process open, set the deployment variables below from a second terminal, then let it retry (or restart `pnpm dev:backend`). The initial selection writes `CONVEX_DEPLOYMENT` before the application push; the environment commands must target that same development deployment.

Keep the generated `CONVEX_DEPLOYMENT` in `packages/backend/.env.local`. Add `NEXT_PUBLIC_CONVEX_URL` from `apps/web/.env.example` to your existing `apps/web/.env.local`, preserving its Clerk and database settings. Set it to the development URL printed by the CLI. An anonymous local backend normally uses `http://127.0.0.1:3210`; a personal cloud development deployment uses an `https://…convex.cloud` URL.

In the development Clerk application, activate the Convex integration and copy the application's Frontend API URL, following the [Convex Clerk setup guide](https://docs.convex.dev/auth/clerk). The token audience must be `convex`, matching `applicationID` in `convex/auth.config.ts`. Use that development application's issuer domain below. The provider is enabled only in development; this step does not switch application reads away from Postgres.

In Clerk's development instance, open **Sessions → Customize session token → Claims** and add `"email": "{{user.primary_email_address}}"`, preserving the existing `aud` and any other claims. The integration can authenticate without this claim, but this app needs it to save the sign-in email. Sign out and sign back in after changing claims, then confirm the email is present in the development `users` document. See [Clerk's additional-claims instructions](https://clerk.com/docs/guides/development/integrations/databases/convex).

`CLERK_JWT_ISSUER_DOMAIN` and `APP_ENV` are Convex deployment environment variables, not shell-only variables. Set them on the personal development deployment:

```bash
pnpm --filter @investment-sync/backend exec convex env set CLERK_JWT_ISSUER_DOMAIN https://your-development-clerk.accounts.dev
pnpm --filter @investment-sync/backend exec convex env set APP_ENV development
```

After the backend is running, create the obviously fake development fixture with:

```bash
pnpm --filter @investment-sync/backend exec convex run testing/seed:fakeDevelopmentData
```

Use `APP_ENV=test` only for isolated automated-test deployments. Never add production Clerk keys, production data, or production migration credentials to a development or preview deployment.

The seed is repeatable and creates a fake identity, not your signed-in Clerk identity. Signing in provisions your own separate Household. Verify real sign-in against the selected development backend before treating the external Phase 1 gate as complete.

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
