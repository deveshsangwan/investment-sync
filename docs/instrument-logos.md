# Instrument logos

The web app resolves logos automatically from imported security identifiers. New holdings use the same component on the overview, holdings list, position detail, and asset-class detail pages. No logo downloads or per-company registry edits are needed.

## Configuration

Set `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY=pk_...` in `apps/web/.env.local`, then restart development or rebuild production. Obtain the publishable key from the [Logo.dev dashboard](https://www.logo.dev/dashboard). Never put a secret `sk_` key in a public environment variable. Without a configured publishable key, the website makes no logo requests and shows initials or asset icons.

The public footer displays attribution when the key is configured. Keep this link for the Community plan; [Logo.dev requires a publicly accessible attribution link](https://www.logo.dev/docs/platform/attribution), including for apps behind authentication.

## Resolution and rendering

For Indian and US equities, the component tries a valid ISIN first, followed by a supported ticker. NSE and BSE tickers use `.NS` and `.BO`; US tickers use the provider's default US market.

When an Indian holding has a symbol but no ISIN or exchange, a bundled NSE equity/ETF directory resolves exact symbols to their ISIN and NSE ticker. This reference data is separate from the portfolio database. The resolver does not write identifiers back, modify records, change asset classes, or affect calculations. Explicit existing identifiers take precedence. Unknown symbols and conflicting or unsupported exchange information keep the fallback instead of being searched on a US exchange.

The reference snapshot in `apps/web/src/lib/logo-data/nse.json` includes its retrieval date and official source URLs. Refresh it with `python3 scripts/refresh-logo-directory.py`, then review and commit the changed snapshot. This downloads identifiers, not images. It validates the source files before replacing the snapshot. New holdings for securities already in the directory resolve automatically; new listings require a directory refresh. Historical/delisted symbols are not guessed or reassigned to successor companies.

Images come directly from Logo.dev's CDN in PNG format with `fallback=404` and an explicit `theme=light` or `theme=dark`. Requests wait until the active theme is known, and switching themes selects a separate image URL. The image has no forced white background. The fallback stays visible during loading/failure and becomes hidden after a successful load so it cannot show through a transparent logo. Existing container shapes, padding, and contain sizing are preserved; backgrounds baked into source images are not removed or cropped. A missing ISIN image can fall back to the qualified ticker. Failed URLs are suppressed across component mounts for five minutes in a bounded browser-session cache, and can retry on a later render or visit. Successful responses use the browser and provider's HTTP caching. There is no interval polling, database image storage, or image proxy. The image box stays fixed while an image loads or fails, and an unavailable image leaves the initials visible.

Mutual fund names use bounded issuer prefixes to select verified AMC domains. Supported issuers are [Axis](https://www.axismf.com), [HDFC](https://www.hdfcfund.com), [ICICI Prudential](https://www.icicipruamc.com), [Motilal Oswal](https://www.motilaloswalmf.com), [Nippon India](https://mf.nipponindiaim.com), [PPFAS / Parag Parikh](https://amc.ppfas.com), [Quant](https://quantmutual.com), [SBI](https://www.sbimf.com), and [Tata](https://www.tatamutualfund.com). One issuer mapping supports multiple funds; there are no per-fund image files. Prefixes require a word boundary and only run for mutual funds.

Known HDFC Life and Bajaj Life product names use their respective insurer domains, verified against [HDFC Click 2 Invest](https://www.hdfclife.com/ulip-plans/click-2-invest-plus) and [Bajaj Goal Assure](https://www.bajajlifeinsurance.com/ulip-plans/financial-life-goals-assure.html). The existing “Bajaj Alliance Goal Assure” spelling is recognized only for that product. Bitcoin and Solana names use the provider's crypto endpoint; REI Network uses its [official domain](https://www.rei.network) to avoid ticker ambiguity.

Generic NPS, unknown names, and summary rows keep category icons. Summary rows are not deleted, filtered from portfolios, or excluded from calculations by this feature. Public home-page sample holdings explicitly retain illustrative marks. Actual portfolios never use the hand-drawn sample marks.

Direct CDN delivery avoids copying provider assets into storage or an image optimization cache. [Self-hosting requires a suitable paid plan](https://www.logo.dev/docs/platform/self-hosting). Identifier support follows the provider's [ticker documentation](https://www.logo.dev/docs/logo-images/ticker) and [ISIN documentation](https://www.logo.dev/docs/logo-images/isin). Logo coverage is provider-dependent; there is always a fallback.

## Verification

`pnpm --filter @investment-sync/web test` covers identifier priority, exchange separation, unsupported or malformed symbols, key handling, and delayed retries. Live provider coverage must also be checked with a configured key on actual imported Indian and US positions. The Vite design preview is not the authenticated application and does not configure a real provider key.
