# Instrument logos

The web app resolves logos automatically from imported security identifiers. New holdings use the same component on the overview, holdings list, position detail, and asset-class detail pages. No logo downloads or per-company registry edits are needed.

## Configuration

Set `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY=pk_...` in `apps/web/.env.local`, then restart development or rebuild production. Obtain the publishable key from the [Logo.dev dashboard](https://www.logo.dev/dashboard). Never put a secret `sk_` key in a public environment variable. Without a configured publishable key, the website makes no logo requests and shows initials or asset icons.

The public footer displays attribution when the key is configured. Keep this link for the Community plan; [Logo.dev requires a publicly accessible attribution link](https://www.logo.dev/docs/platform/attribution), including for apps behind authentication.

## Resolution and rendering

For Indian and US equities, the component tries a valid ISIN first, followed by a supported ticker. NSE and BSE tickers use `.NS` and `.BO`; US tickers use the provider's default US market. An Indian ticker with no exchange or existing suffix stays as initials rather than being searched on a US exchange. No issuer is guessed from a company name. Existing ISIN and exchange columns flow through the portfolio API; no schema migration is required.

Images come directly from Logo.dev's CDN in PNG format with `fallback=404`. A missing ISIN image can fall back to the qualified ticker. Failed URLs are suppressed across component mounts for five minutes in a bounded browser-session cache, and can retry on a later render or visit. Successful responses use the browser and provider's HTTP caching. There is no interval polling, database image storage, or image proxy. The image box stays fixed while an image loads or fails, and an unavailable image leaves the initials visible.

Mutual funds, NPS, and other unsupported assets keep their category icons. Fund issuer lookup needs reliable issuer metadata; the app does not guess an AMC from fund-name text. Public home-page sample holdings explicitly retain illustrative marks. Actual portfolios never use the hand-drawn sample marks.

Direct CDN delivery avoids copying provider assets into storage or an image optimization cache. [Self-hosting requires a suitable paid plan](https://www.logo.dev/docs/platform/self-hosting). Identifier support follows the provider's [ticker documentation](https://www.logo.dev/docs/logo-images/ticker) and [ISIN documentation](https://www.logo.dev/docs/logo-images/isin). Logo coverage is provider-dependent; there is always a fallback.

## Verification

`pnpm --filter @investment-sync/web test` covers identifier priority, exchange separation, unsupported or malformed symbols, key handling, and delayed retries. Live provider coverage must also be checked with a configured key on actual imported Indian and US positions. The Vite design preview is not the authenticated application and does not configure a real provider key.
