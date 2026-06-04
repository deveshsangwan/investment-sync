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
```

Uploads need real Supabase-compatible storage. Dashboard/history testing only needs Postgres.

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
