# Application UI tests

Required CI coverage has two parts. The existing `verify` job runs the native screen suite alongside the workspace tests and mandatory SQL integration tests. `browser-product-flow` runs Chromium against production React components and a fresh, real local Convex backend. Neither job needs application secrets or skips tests when credentials are missing.

## Native screen baseline

```sh
pnpm install --frozen-lockfile
pnpm --filter @investment-sync/mobile test
```

Jest uses the Expo preset and React Native Testing Library. Tests render the actual Overview and Holdings screens inside the production `MobilePortfolioProvider`, with the real Clerk adapter and Convex query/mutation hooks. Only the client transport and Clerk identity are fake. Coverage includes loading, empty results, query failures handled by the provider boundary, retry recovery, navigation, and the same instrument in two accounts. Shared portfolio-domain builders generate the query views. Native platform modules, safe areas, and icons use test doubles. These are native component integration tests, not simulator or device tests, and do not verify backend authentication.

This branch includes [the #58 mobile migration, PR #71](https://github.com/deveshsangwan/investment-sync/pull/71) at `ccfb17cfc011458b42c648b44250d14fe45f9db3` as a dependency. Merge #71 first. The screen helper has been adapted to Convex; it does not retain tRPC hooks, providers, or fixtures. `native-tests/render-screen.tsx` owns provider setup and `native-tests/transport.ts` implements controlled subscriptions. The Jest files live outside `src`, so #71's Vitest pattern does not collect them. `test` runs both the existing Vitest suite and `test:native`; neither accepts an empty suite. This PR adds tests to #71's runtime rather than independently implementing the migration.

## Browser product flow with real local Convex

The runner currently pins the Linux x64 standalone backend. Install Node 24, pnpm 11.5.2, and Chromium's platform dependencies. Download the backend once, then tests run without cloud credentials or a cloud backend:

```sh
curl --fail --location --output /tmp/convex-e2e.zip https://github.com/get-convex/convex-backend/releases/download/precompiled-2026-09-11-157eb19/convex-local-backend-x86_64-unknown-linux-gnu.zip
mkdir -p /tmp/convex-e2e
unzip /tmp/convex-e2e.zip -d /tmp/convex-e2e
echo '36c41a7fc2deb8aff06ee6701493767f441c9fe4ec0fc27be59229c6af29027f  /tmp/convex-e2e/convex-local-backend' | sha256sum --check
chmod +x /tmp/convex-e2e/convex-local-backend
pnpm --filter @investment-sync/web exec playwright install --with-deps chromium
E2E_CONVEX_BINARY=/tmp/convex-e2e/convex-local-backend pnpm --filter @investment-sync/web test:e2e
```

The runner fails if the binary is missing or its checksum differs. Ports 3218, 3219, 3220, and 4173 must be free. It creates temporary SQLite, file storage, function-source copies, and fresh signing/admin keys. It loads application functions with `convex dev --once` using an explicit loopback URL and the generated local admin key. It never reads an existing backend selection or `.env.local`. The child environment allows only the process path and temporary home; it does not forward credentials. No cloud deployment, production operation, or account login is involved. Cleanup stops the child processes and deletes temporary state.

The fixture uses the actual `ConvexAppProvider`, `UploadsRoute`, `DashboardClient`, import workflow, parser actions, publication workers, and portfolio queries. A fixture-only Vite alias replaces Clerk's hook with a local test identity selector. An ephemeral issuer signs RSA JWTs; the unchanged Convex auth config verifies their audience and signature through OIDC discovery/JWKS. Production Next config, middleware, and Clerk auth are unchanged. Backend fixtures are copied into the temporary function directory only. They are not part of the shipped Convex API, are internal, and also reject execution unless `APP_ENV=test`.

The browser suite covers sign-in gating, upload to real Convex Storage, real parsing, preview, apply/publication, exact decimal dashboard totals, multiple accounts, source dates, sign-out and household isolation, duplicate uploads from independent browser sessions, invalid parser input and retained-source retry, viewer rejection in both UI and backend, and recovery from an injected storage HTTP failure. Only the explicit transport-failure case intercepts a request. There is no mocked Convex implementation or precomputed portfolio response.

This is a local browser-to-backend product-flow test, not coverage of Clerk's hosted sign-in UI, Next middleware, server rendering, or cloud operation. Those external integrations still require a separate isolated Clerk development application and Convex test backend. Never substitute production keys/data. A future credentialed suite must fail clearly when its required configuration is absent; it must not report skipped coverage as a passing required check.

Playwright reports and traces contain generated fake data only and are ignored by Git. CI uploads them on failure. PostgreSQL service provisioning, migration checks, and legacy recovery tooling remain intact.
