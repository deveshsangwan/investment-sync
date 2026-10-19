# Typechecking

Repository-owned compiler commands use [tsc-rs](https://github.com/pingdotgg/ts-rust) directly, pinned to [0.7.0](https://github.com/pingdotgg/ts-rust/releases/tag/v0.7.0). Run them from the pnpm workspace:

- `pnpm typecheck` runs `tsc-rs --noEmit` in all eight workspaces through Turbo.
- `pnpm typecheck:migration-tools` checks `scripts/convex-migration/tsconfig.json` with `tsc-rs`.
- Each non-web workspace's `build` runs `tsc-rs --noEmit`. `apps/web` still runs `next build` and produces `.next` artifacts.
- CI runs both typechecks and checks that the native executable starts. No command enables `--fast` or experimental compiler environment flags.

The compiler dependency lives at the repository root. pnpm makes its executable available to workspace scripts. All packages are private and consume TypeScript source. There are no compiler emit, declaration bundling, packaging/prepack, project reference, or compiler watch paths. Development watch commands still belong to Next.js, Expo, and Convex.

## JavaScript TypeScript remains installed

The existing `typescript: ^5.7.3` declarations and locked 5.9.3 release remain unchanged. `tsc-rs` is a separate package, not a `typescript` alias or a replacement for its JavaScript API.

- The root typed ESLint configuration enables `projectService`, which loads TypeScript's JavaScript language service for every workspace and the migration tools. Existing workspace TypeScript dependencies preserve that tool resolution.
- Next.js uses the JavaScript compiler API for its internal build typecheck, config handling, and editor plugin. `next build` and `next dev` keep this behavior; the separate web `typecheck` uses Rust.
- Expo's CLI uses TypeScript to parse tsconfig and resolve Metro aliases, and checks that TypeScript is installed. Mobile retains that dependency for `expo start`.
- Convex 1.45's CLI only selects `tsc` or `tsgo` and resolves `typescript/bin/tsc` internally. `dev:backend`, `backend:codegen`, and the development-bindings workflow retain this JavaScript compiler check. The backend workspace's separate `build` and `typecheck` use Rust and include its Convex sources and committed bindings.

Vitest's optional compiler typechecker is not enabled here. Tests, migration export scripts, and Drizzle Kit continue using their existing Vite/esbuild/tsx transforms. No framework-internal compilation is claimed to have migrated.

## Installation and compatibility

Use the repository's pinned pnpm version and `pnpm install --frozen-lockfile`. Keep optional dependencies enabled: the compiler requires a matching native `@tsc-rs/*` package. CI uses Ubuntu x64 with Node 24 and `@tsc-rs/linux-x64@0.7.0`. The lockfile also includes the release's Linux arm64, macOS x64/arm64, and Windows x64/arm64 packages; those platforms are not exercised by this repository's CI. A Rust toolchain is unnecessary.

`allowBuilds` explicitly sets `tsc-rs: false`. Its postinstall only optimizes startup; the shipped Node launcher runs the native binary without it. Recording this decision prevents pnpm 11's `ERR_PNPM_IGNORED_BUILDS` in CI while granting no additional build-script permission.

Verify the npm release with `pnpm list tsc-rs --depth 0`. `pnpm exec tsc-rs --version` reports the underlying TypeScript `7.1.0-dev` revision instead of the npm package version. Editor TypeScript selection stays unchanged.

This is an early compiler release. Its [known problems](https://github.com/pingdotgg/ts-rust/blob/v0.7.0/npm/tsc-rs-readme.md#known-problems) include failures after edits with `-b --watch`. [Issue 86](https://github.com/pingdotgg/ts-rust/issues/86) concerns hidden declaration diagnostics with `declaration: true` and `noEmit: true`. Neither mode is used here. Validate real declaration output and consumer compatibility if a package later starts publishing declarations.

The migration keeps the existing module resolution, strictness, aliases, and framework configs. Native side-effect import checking requires the web app's empty CSS module declaration. The rehearsal fixture now imports Drizzle and Postgres by package name, with root development dependencies at the already locked versions, to avoid duplicate type identities from direct imports through another workspace's `node_modules`.

To roll back, revert this PR's commits in reverse order with `git revert`, or revert the single squash commit if it was squashed. Then run `pnpm install --frozen-lockfile`. This restores the previous scripts, configuration, build-script policy, and lockfile together.
