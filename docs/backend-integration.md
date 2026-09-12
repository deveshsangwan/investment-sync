# Backend integration

The hybrid website uses the existing Next.js app, Clerk sessions, tRPC routers, Drizzle/Postgres records, and Supabase Storage. No database migration or replacement backend was introduced for the redesign. The Vite design preview substitutes authentication and query results and cannot verify a real import or user session.

## Run the actual application

Configure `apps/web/.env.local` using `.env.example`, then run from the repository root:

```sh
pnpm install
pnpm --filter @investment-sync/web dev --hostname 0.0.0.0 --port 3108
```

The integration session uses port 3108 for Next.js and keeps the sample preview on 3107. The original design worktrees are separate.

Clerk sign-in and sign-up routes are explicitly configured on the provider. Public pages render while Clerk initializes. Protected pages require a session; API procedures enforce membership and household scoping. The connected development Clerk instance currently offers Google sign-in. Actual signup and sign-in require completing that flow in the browser.

## Connect Postgres later

The current local configuration expects Postgres on port 54329. The database is not running, and the current system user cannot start Docker. Database-dependent operations remain unverified until this is resolved.

When Docker access is available:

```sh
docker compose up -d postgres
pnpm --filter @investment-sync/db migrate
```

Check that `DATABASE_URL` points to the intended local database before migrating. No sample records need to be seeded: a real first sign-in provisions the household and default accounts, then imported statements populate the portfolio. Keep `TEST_DATABASE_URL` pointed at a separate disposable database; the integration test helpers clear their test tables.

## Stock logos

See [instrument-logos.md](instrument-logos.md). Set the publishable Logo.dev key and restart or rebuild. Missing configuration or unavailable logos produce initials or category icons. No images are downloaded manually, and no private provider secret is needed in the browser.

## Checks completed without a database

- Real home, sign-in, and sign-up pages load at mobile and desktop sizes, with no horizontal overflow or browser exceptions.
- Clerk renders its real Google sign-in control instead of the preview placeholder.
- Anonymous dashboard navigation redirects to the local sign-in route. Anonymous portfolio and upload API requests are rejected.
- The existing Clerk development credential and configured Supabase import bucket respond successfully to read-only checks.
- Unit tests cover portfolio calculations and instrument lookup identifiers/failure caching. Database integration tests require the separate test database.

## Checks still required with a database

1. Complete Google sign-in, then confirm household provisioning and the empty portfolio state.
2. Import a real supported statement, review normalized rows, and commit it. Confirm overview, holdings, asset details, position details, and account balances refresh together.
3. Confirm duplicate imports, rejected files, and retry behavior; verify an unauthorized household member cannot upload or commit.
4. Verify that one household cannot read another household's data and that shared members see their active household profile.
5. Configure the logo key and check coverage against imported Indian and US instruments, including an unknown symbol.
6. Sign out and confirm protected data is no longer accessible.

Database connectivity, persisted import results, full Google authentication, and live logo-provider coverage have not been claimed as verified by the design preview.
