# Bundling: what builds each target, and why it isn't Bun's bundler

Bun is the entry point for every build: `bun run <script>`, `bun run --cwd <dir> <script>` or
`bun x --no-install <bin>`. Bun's own bundler (`Bun.build`) builds none of them. Each target keeps the tool it had,
because that tool does something `Bun.build` can't, or because switching would change shipped bytes that only a Mac
or a Windows run can check. When `bun run` starts a tool whose bin begins `#!/usr/bin/env node`, the tool runs on Node
24 (`.nvmrc`). The scripts don't pass `--bun`: Vite on Bun's runtime changes the output (below).

`bun x --no-install` runs the copy in `node_modules` and stops when it's missing. A plain `bun x` would download the
latest release of the package into a global cache and run that, unpinned.

| Target | Tool | Entry point | Output compared with the build from before Bun |
|---|---|---|---|
| `apps/linux` (the Linux UI) | Vite 7 | `bun run --cwd apps/linux build`, `dev`, `preview` | `dist` byte-identical (72 files) |
| `packages/demo` (the site's demo) | Vite 7 | `bun run --cwd packages/demo build`, `dev` | `dist` byte-identical (71 files) |
| `packages/shaders` meadow | esbuild (JS API) | `bun run --cwd packages/shaders meadow`, `test`, `meadow --check` | `--check` passes under Node and Bun |
| `apps/site` | Astro | `bun run --cwd apps/site build`, `dev`, `check`; `infra/site/deploy.sh build` | `astro check` 0 errors |
| `apps/dashboard` | Vite 8 + TanStack Start | `bun run --cwd apps/dashboard build`, `dev`; its Docker image installs and builds with Bun | image serves `GET /` |
| macOS app JS (`apps/browser`) | Metro + Hermes | `bun run dev` (Metro), `bun x --no-install react-native bundle …`; Xcode's bundle phase | bundle byte-identical |
| Windows app JS | Metro + Hermes | `bun run --cwd apps/browser bundle:windows`; `bun x --no-install react-native run-windows …` | bundle byte-identical |
| Phone (Expo) | Metro | `bun run --cwd apps/phone dev`; the bundle export installs with `bun install --offline` | same modules, name@version for name@version |
| `apps/videos` | Remotion (webpack) | `bun run --cwd apps/videos render <id>`, `studio`; `deliver.sh` | `check` 0 errors |
| `ardia` userscripts | an esbuild binary `apps/cli/scripts/build.sh` pins | the `ardia` command, on the user's machine | userscript tests pass |
| `apps/cli/bench` fixtures | `bun x esbuild@<pinned>` | `node apps/cli/bench/tasks/build.mjs` | n/a |

## Vite 7 for `apps/linux` and `packages/demo`

Vite gives the Linux UI and the demo four things `Bun.build`'s plugin API (`onResolve` and `onLoad`) has no equivalent
for:

- **Re-resolving per importer.** A `resolveId` hook resolves again with `this.resolve(…, { skipSelf: true })` and
  swaps the result by importer (`importerReplacements`, `resolveInputAdapter` in `apps/linux/vite.shared.ts`). This is
  how a shared module gets its Linux adapter while the adapter still imports the original.
- **Chained transforms of shared sources.** `transform` hooks rewrite already-loaded shared modules on every load
  (`linuxShortcutText` and the wording plugins), after the other plugins have run.
- **Virtual modules.** The `\0ardia-lazy:` modules.
- **Resolution rules.** `resolve.dedupe`, and the extension order `.linux` before `.web`.

`apps/linux`'s `test:graph` also calls Vite's `build()` and reads Rollup's module info.

Vite stays at 7. Nothing in the move to Bun needed Vite 8: Vite 7 runs through Bun and type-checks under TypeScript 7.
Vite 8 (Rolldown, `transformWithEsbuild` deprecated, new CommonJS interop) would change the Linux UI bundle. Move to
it in its own change, with Linux acceptance runs. The dashboard is already on Vite 8 through TanStack Start.

Running Vite on Bun's runtime (`bun --bun x vite build`) is not byte-identical either. For `packages/demo` it changes
14 of 71 files: Vite turns its module-preload helper into a string at runtime, and JavaScriptCore prints a function's
source differently from V8. One minified name changes, and the chunk hashes follow. That is why no script passes
`--bun`.

## esbuild for the meadow (`packages/shaders/scripts/meadow.mjs`)

`Bun.build` was tried in place of esbuild for the meadow bundles: `target: browser|node` for esbuild's `platform`, a
`banner` for the injected glob shim, and the same `define`, `format` and `minify`.

- The posters and `posters.json` came out byte-identical.
- The two script bundles grew: `ios/Meadow/index.html` from 110397 to 111907 bytes, `windows/meadow/page.ts` from
  927846 to 929418. Re-minified by esbuild, Bun's script is 109108 bytes against esbuild's 109026, so the difference is
  the minifier, not the code.

esbuild stays, for three reasons:

1. `Bun.build` has no engine target. The meadow builds for `safari17` (the intro's WKWebView) and `chrome120` (the
   Windows shim), and esbuild lowers newer syntax for them. With `Bun.build`, newer syntax in the site's meadow sources
   would reach the intro un-lowered, with no warning.
2. Switching rewrites two committed generated files, which need a Mac intro snapshot and a Windows run to verify.
3. The output is larger.

`meadow.mjs --check` passes under Node and under Bun, so the esbuild JS API works on either runtime.

## Metro for macOS, Windows and the phone

`Bun.build` has none of what these apps need: React Native's platform resolver (the `macos` and `windows` redirects in
`metro.config.js`), the asset registry and its `__packages/…` layout, babel-preset-expo's transforms, Fast Refresh,
Hermes bytecode, and the bundle phases of Xcode (`react-native-xcode.sh`) and MSBuild. Metro runs on Node, started by
`bun run` or `bun x --no-install`.

## Astro, TanStack Start and Remotion

Each is its own build system on Vite or webpack (server and SPA output, content collections, Remotion's webpack config
with `require.context`). Each is started through `bun run` and runs on Node.

- `apps/site`'s `astro check` uses the TypeScript 6 API: `@astrojs/check` needs it, so the site aliases `typescript` to
  `@typescript/typescript6`.
- `apps/dashboard`'s `check` first runs `scripts/route-tree.mjs`, which calls `vite.resolveConfig` so TanStack's router
  generator writes the gitignored `routeTree.gen.ts`. Its Docker image installs, builds and prunes with Bun
  (`bun prune --production`) and serves on Node.

## The CLI's userscript bundler

`ardia` bundles user scripts on the user's machine, which has no Bun, with the esbuild binary it ships
(`apps/cli/scripts/build.sh`). It stays esbuild.

## What still isn't Bun

- **Direct `node` calls.** Scripts documented as `node <script>` stay on Node: the `usage: node` scripts in
  `apps/browser/scripts` (`peek-edge-test.mjs` among them), `scripts/linux/smoke.mjs`,
  `apps/linux/scripts/page-operations.mjs` and `apps/cli/bench`.
- **Tests that need Node.** The files in `apps/browser/node-tests.json` and `apps/linux/host-node-tests.json`, which
  `scripts/lib/bun-tests.mjs` runs with `node --test` and the test loader (`docs/testing.md`), and the engine's own
  tests.
- **Xcode's bundle phase.** It runs `react-native-xcode.sh` with `NODE_BINARY` (`apps/browser/macos/.xcode.env`).
- **The Windows Release build's bundle step.** `run-windows --release` runs MSBuild, and react-native-windows'
  `Bundle.props` defaults `BundleCliCommand` to `npx @react-native-community/cli bundle`. The app doesn't override it,
  so that one step goes through npm's `npx`. Setting
  `<BundleCliCommand>bun x --no-install @react-native-community/cli bundle</BundleCliCommand>` in
  `apps/browser/windows/Ardia/Ardia.vcxproj` waits for a Windows run that can prove it.
- **corex's Bun.** `apps/phone/scripts/corex-bun` installs the pinned Bun with `npm install bun@<version>` into the
  build folder on corex.
- **The tools' bins.** Vite, Metro, Astro, Remotion and jest have Node shebangs and run on Node under `bun run`.
- **TypeScript 6 and 5 where an API needs them.** The test loader, `page-operations.mjs` and three browser tests use
  the TypeScript 6 API (`@typescript/typescript6`), because TypeScript 7 has no JavaScript API. The site's
  `astro check` uses it too. The Raycast extension (`extras/raycast-ardia`) stays on TypeScript 5 with Raycast's
  `ray` tooling. `scripts/typescript-version.test.mjs` checks that the root's `tsc` and the phone's, the dashboard's and
  the videos' are TypeScript 7.
