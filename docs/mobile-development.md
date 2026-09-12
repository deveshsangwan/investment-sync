# Mobile development

The Expo app has native portfolio and holdings tabs. Its palette, Public Sans typography, Quiet mark, amount visibility, and instrument identities follow the web app. The device appearance setting controls light and dark mode. Imports and account administration remain on the web.

## Run on an iPhone with Expo Go

1. Install workspace dependencies with `pnpm install`.
2. Copy `apps/mobile/.env.example` to `apps/mobile/.env.local`. Set the Clerk publishable key for the same Clerk application used by the web API.
3. Start the web API with `pnpm dev:web`.
4. Connect the phone and development computer to the same network. Start Metro with `pnpm --filter @investment-sync/mobile exec expo start --clear --lan` and scan its QR code in Expo Go.

The app uses Expo SDK 57 to match Expo Go for SDK 57. If Expo Go reports that the project uses SDK 54, stop the old Metro process, run `pnpm install`, and restart Metro with `--clear` from this checkout. Scan the new QR code instead of reopening a recent project. SDK upgrades must update React Native and the Expo modules together; see the [Expo upgrade guide](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).

For local development, `EXPO_PUBLIC_API_URL=http://localhost:3000` resolves to the computer address advertised by Metro. The port and any path prefix are preserved. The web server must accept network connections, and the computer's firewall must allow its port. `localhost` on an iPhone refers to the phone, not the computer.

If the computer has both Wi-Fi and Tailscale interfaces, make the local address explicit when starting Metro:

```sh
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.8 pnpm --filter @investment-sync/mobile exec expo start --clear --lan
```

Replace the example IP with the computer's current Wi-Fi IP, connect the phone to the same Wi-Fi, and scan the new QR code. A Tailscale callback produced an HTML 403 from Clerk in the recorded sign-in investigation; the local Wi-Fi callback succeeded. See [the investigation](mobile-sso-investigation.md) for the exact comparison.

### Keep Tailscale enabled and use an Expo tunnel

If the phone cannot reach the computer over Wi-Fi, keep Tailscale enabled on both devices and use Expo's tunnel for Metro:

```sh
pnpm --filter @investment-sync/mobile dev:tunnel --clear --port 8082
```

Open the tunnel URL printed by Expo or scan its new QR code. Avoid reopening the old project from Expo Go history. The tunnel gives SSO a public hostname for its callback. The tunnel callback returned HTTP 200 with an OAuth redirect in the recorded investigation.

An Expo tunnel only exposes Metro. Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env.local` to the web API's reachable address, such as `http://<computer-tailscale-ip>:3000` for a private development API, or an HTTPS deployed API. Start the web API with `pnpm dev:web`; it must listen on the chosen interface. With a Tailscale API address, the phone must remain connected to the tailnet. Do not leave the API URL as `localhost` when using a Metro tunnel, since that would incorrectly resolve to the tunnel host on port 3000. Restart Metro after changing environment variables.

Google sign-in uses Clerk's SSO flow. Google must be enabled for the Clerk application. If the browser returns successfully but Clerk still requires account setup, the app asks the user to finish that setup on the web. A cancelled browser session leaves the user on sign-in.

## Design behavior

Amounts remain masked until the saved device preference loads. The eye control applies across both tabs and masks monetary values in screen-reader labels as well. Percentages and allocation proportions remain visible, matching the web.

Holdings supports search, current and exited positions, asset and account filters, and sorting by value or name. Filter choices open native sheets. Pull down on either tab to reload data.

Instrument logos use the same display-only resolver and NSE reference directory as the web. Set the optional publishable Logo.dev key to enable them. Unavailable logos fall back to initials or category icons. See [instrument logos](instrument-logos.md).

## Checks

- `pnpm --filter @investment-sync/mobile typecheck`
- `pnpm --filter @investment-sync/mobile lint`
- `pnpm --filter @investment-sync/mobile test`
- Run `pnpm dlx expo-doctor` from `apps/mobile`.
- `pnpm --filter @investment-sync/mobile exec expo export --platform ios --platform android --output-dir /tmp/investment-sync-native`

Bundle exports verify JavaScript and asset compilation. They do not verify an iPhone's installed Expo Go version, network access, or interactive Google sign-in.
