# iOS sign-in investigation

Status: callback-address-dependent HTTP 403 reproduced; awaiting confirmation that the phone uses the local Wi-Fi callback.

## Observed failure

The app uses Expo SDK 57 and runs in Expo Go on iOS. Tapping Continue with Google fails before the browser opens.

The installed Clerk Expo SDK initially reported a missing external verification redirect URL. Its sign-in resource remained empty. Enabling `experimental.rethrowOfflineNetworkErrors` exposed a JSON parsing failure because the response begins with HTML.

Development-only instrumentation captured this response from the sign-in endpoint:

- Host: `concrete-toucan-9.clerk.accounts.dev`
- HTTP status: `403`
- Content type: `text/html; charset=UTF-8`
- Server header: `cloudflare`
- Request and response hosts match.
- No recognized challenge, not-found, or proxy-page markers were detected.

The server header identifies the response's delivery path. It does not identify the blocking rule or prove whether Cloudflare or the upstream application generated the denial.

## Checks already completed

- Google OAuth is enabled and authenticatable in the configured development instance.
- A direct native-mode API request from the development environment returns HTTP 200 with an OAuth redirect URL.
- The installed Clerk JavaScript SDK also receives that redirect when run from the development environment, including with the mobile headers used by Clerk Expo.
- The development-key warning appears in successful probes too. It is not the sign-in failure.
- Switching the phone app from Expo's fetch implementation to React Native's implementation did not change the failure. That experiment has been reverted.
- A simulated failed POST reproduces Clerk's empty-resource behavior when offline request errors are suppressed. Request-error reporting remains enabled.

## Callback comparison

Two native-mode Google sign-in requests from the same development environment differed only in their callback URL:

| Callback                                   | Result                                 |
| ------------------------------------------ | -------------------------------------- |
| `exp://192.168.1.8:8081/--/sso-callback`   | HTTP 200, JSON, OAuth redirect present |
| `exp://100.114.44.33:8081/--/sso-callback` | HTTP 403, HTML, no OAuth redirect      |

The second address is this computer's Tailscale IP. This reproduces the reported failure without relying on a change of internet connection. It does not establish which server rule rejected the callback or that all Tailscale addresses are rejected.

The running Metro server returns `192.168.1.8:8081` as its manifest `hostUri` when requested through that address. The phone should open that local project on the same Wi-Fi and report `exp:` with host `192.168.1.8:8081` in the temporary callback diagnostic. Opening a recent Tailscale project may use a different manifest.

## Next evidence

The phone timed out opening the local Wi-Fi project. This is a separate Metro reachability failure; it does not show that server Tailscale must be disabled.

Started Expo's supported tunnel on port 8082 while preserving server Tailscale. The tunnel manifest is reachable over HTTPS. A native-mode Clerk request using `exp://r28c6nw-deveshsangwan-8082.exp.direct/--/sso-callback` returned HTTP 200 JSON with an OAuth redirect. Configured the ignored local mobile environment to reach the API through the server's Tailscale address, independently of Metro.

Next, confirm the actual tunnel callback host on the phone and complete interactive Google sign-in with phone Tailscale enabled. If the denial persists, use the `cf-ray` response header and response date from `[DEBUG-clerk-http]` when contacting Clerk support. The app's temporary diagnostic captures these fields without recording tokens, cookies, query parameters, or raw HTML.

Suggested support request:

> Our Expo SDK 57 app using Clerk Expo 2.19.31 receives HTTP 403 with an HTML response from the development Frontend API when starting Google SSO on a physical iPhone. Google is enabled, and the same native-mode API request succeeds from our development environment. The failure occurs before the OAuth browser opens and persists with both Expo fetch and React Native fetch. We reproduced a callback-dependent difference from the same computer: the local Wi-Fi callback returns JSON with an OAuth redirect, while the Tailscale callback listed above returns HTML 403. Please inspect the request identified by the attached Cloudflare Ray ID and response date and explain this denial.

Do not send session tokens or secret API keys with the report. No support message has been sent automatically.
