# Investment Sync

Private portfolio tracker for Indian and US investments. The repo is a pnpm/Turborepo monorepo with a Vercel-hosted Next.js app, a view-only Expo app, tRPC APIs, Clerk auth, Supabase Postgres/Storage, and upload-first portfolio importers.

## Apps

- `apps/web`: Next.js App Router web app and server API routes.
- `apps/mobile`: Expo Router app for read-only portfolio views.

## Packages

- `packages/api`: tRPC routers, auth scoping, import orchestration.
- `packages/db`: Drizzle schema and database client.
- `packages/importers`: Tickertape, Vested/DriveWealth, and spreadsheet import contracts.
- `packages/analytics`: portfolio summary, allocation, and XIRR helpers.

## Local Setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and fill Clerk, Supabase, and database credentials.
3. Create a private Supabase Storage bucket named `portfolio-imports`.
4. Run `pnpm db:generate` and apply migrations with `pnpm db:migrate`.
5. Start the web app with `pnpm dev:web`.
6. Start the Expo app with `pnpm dev:mobile`.

Original uploaded files are retained for 30 days by default. Normalized portfolio data remains until deleted from the app.

For fake local portfolio data without production records, see `docs/local-development.md`.
