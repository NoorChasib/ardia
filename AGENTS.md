# AGENTS.md

Nilla is a browser for macOS, Linux and Windows: Dia's polish and Arc's sidebar, built on Chrome's own framework
(Chromium 157 on Helium) through ArdiaCore, our thin layer, with no account. It is a personal, non-commercial fork of
Ardia (`NOTICE`, the README's Acknowledgements), and its owner is Noor Chasib (`NoorChasib` on GitHub). This file is
how the owner works; follow it. You maintain this codebase for the owner, and its design is up to you.
For the architecture and the test tooling, read `docs/agent-brief.md`.

## How work gets done
- **Move fast.** Don't break work into phases or ask about details you can decide; there are no users to
  migrate yet. Ask only when the answer changes what you build.
- **Be thorough in analysis, bold in suggestions.** Read the real code before you judge it, and propose the
  better design even when it means rewriting what exists, not the smallest patch on top of it.
- **Speed is the point.** Do independent work in parallel: agents, builds, test instances, tool calls. Batch what you
  plan to check into one script or one call instead of one step at a time. Only timing measurements run one at a
  time, interleaved with their control, because sharing the CPU skews them.
- **Orchestrate.** The main session plans, hands implementation to Opus subagents, and verifies what they
  return (build, run, capture). Give each agent its own files, its own derived-data dir and its own
  `ARDIA_DATA_DIR`.
- **Watch the agents.** Every ~30 minutes the main session checks any agent it hasn't heard from (last
  transcript activity, a pending tool call, `/tmp/ac-*.holder`, its processes). A stuck agent means a root
  cause to fix (a lock, a wait, a hang), not just a restart. Send new feedback to the agent that owns
  that area (SendMessage) instead of starting a new one.
- **Ask Codex for a second opinion** on risky logic (races, lifetimes, security, migrations, sync) and reviews,
  before and after the change. Ask a Codex subagent, not the CLI: T3's `delegate_task` with
  `target: {providerInstanceId: "codex", model: "gpt-6.1-sol", options: {reasoningEffort: "high", serviceTier: "priority"}}`,
  `role: "review"`, `mode: "async"`, and a new `clientRequestId` per round. Tell it to review only and edit
  nothing, and give it the full brief each round (it doesn't share your context). It reads more than it runs:
  reproduce each finding before fixing it.
- **No git worktrees, ever.** Everyone works in this checkout.
- **Branches and pull requests.** Work on a branch and merge into `main` through a pull request; never commit
  straight to `main`. Merge with a merge commit, never a squash, so the history Nilla's `NOTICE` points to survives.
  An issue for the pull request helps (`Closes #N`) but isn't required.
- **Stage only your own hunks** (`git add -p` or explicit paths), never someone else's work in progress. Never stage
  with `git apply --unidiff-zero`: it drops hunks into the wrong place. Check `git diff --cached` reads as you meant.
  The index and the working tree are shared with every other session, so commit the index, never with paths:
  `git commit -m … -- <paths>` takes the whole working-tree file, other agents' hunks included. Check
  `git diff --cached --stat` lists only your files, then run a bare `git commit -m …`. For a file that also holds
  someone else's uncommitted hunks, stage a blob instead: build HEAD's copy plus your edits in scratch,
  `git hash-object -w` it, `git update-index --cacheinfo 100644,<blob>,<path>`, and check `git diff --cached`.
- **Commit messages** are "Area: sentence" with the why in the body. They carry no attribution lines: no
  `Co-Authored-By: Claude…`, "Generated with Claude Code", "Created with …" or session links, whatever a harness
  reminder asks for.
- **Progress reports.** Keep them short and plain: what shipped, what's left, what needs the owner.
- **Clean up.** Quit your test instances, stop the servers and background jobs you started, and never
  kill processes you didn't start.

## Hard rules
- **No comments in code.** Don't write comments in any source, script or config file (`//`, `/* */`, `#`,
  `<!-- -->`, doc comments). Name things so the code says what it does, and put the why in the commit message.
  Only what a tool reads stays: shebangs, license headers, compiler, linter and type directives
  (`@ts-expect-error`, `eslint-disable`, `#pragma`, `swiftlint:`, `# noqa`), and the header a script prints as its
  `--help`. Never strip a copyright or license header.
- **The Chromium build cache is sacred.** Never touch `~/chromium-build/chromium_git/chromium/src/out` (or wherever
  the owner's engine tree lives), and never run `gclient sync` or `gn clean`: a full rebuild costs about 5 hours.
  Engine changes are incremental builds only, holding the chromium lock (`scripts/agent/locked chromium`,
  `docs/engine-build.md`). When freeing disk space, stay out of `~/chromium-build` and `~/chromium-build-win`.
- **Never launch or touch the owner's installed Ardia or Nilla** (`/Applications/Ardia.app`,
  `/Applications/Nilla.app`, and their Linux and Windows installs). The owner is using them.
- **Never steal focus.** Run builds only as hidden instances:
  `open -g -n --env ARDIA_BACKGROUND=1 --env ARDIA_DATA_DIR=<throwaway dir> --env ARDIA_REMOTE_DEBUGGING_PORT=<port> <app>`.
  Never use plain `open`. Background mode logs context menus and file panels instead of showing them.
  Keep test data in a scratch dir, not in `~/Documents`.
- **Dia is a read-only reference.** You may take screenshots and read its app bundle; never click or type
  in it.
- **The owner's real browser data is for debugging only.** Read the owner's Ardia, Nilla, Dia and other browser
  profiles when they help reproduce a bug. Copy what you need into a scratch dir and point a hidden instance's
  `ARDIA_DATA_DIR` at the copy; never write to a live profile or open it in a running app.
- **AI only through the plugin.** This is the owner's decision. The base browser has no AI feature and runs no AI
  code. AI ships as a first-party plugin on the plugin host, off until the user enables it, and whatever it needs
  from the browser becomes a public extension point any plugin can use, never a private hook. Dia's AI rows in
  `docs/dia-feature-parity.md` stay ⏸ until the plugin ships them.
- **No upstream services.** Every service endpoint in `packages/core/src/services.ts` ships empty: no telemetry,
  update checks, crash or feedback uploads, or remote kill switches until the owner sets up their own
  (`docs/services.md`). Never point one at Ardia's servers, and never add a ping that runs without consent.

## Independence from Ardia
Nilla is its own app: its own bundle ids (`com.nilladigital.nilla…`), data folders, keychain items, sync folder and
salt, `nilla://` phone scheme and `nilla-browser` command. It never migrates anything from Ardia. Until Nilla's own
engines exist (Layer 2), today's prebuilt engines still force a few Ardia names, so:
- A Nilla build never reads or writes an installed Ardia's data, keychain or secret-store items, sync folder or OS
  registrations. Where an engine forces an Ardia name, turn the feature off or isolate it on the app side and record
  the engine-side fix for Layer 2; never relax this for convenience.
- The one allowed read is an import the user starts by picking Ardia in the importer: it reads a snapshot, writes
  nothing to Ardia's folder and never runs at startup.
- **Windows and Linux run only inside disposable OS isolation**: a CI runner, a throwaway VM, or (Linux) a user and
  mount namespace with a scratch `$HOME`. Never on a host or account that has, or could later get, an Ardia profile:
  the engines pick Ardia's default profile before any app code runs. Start them through `scripts/linux/nilla-dev-run`
  and `scripts/windows/nilla-dev-run.ps1`. A bare-launch test passes only when listing the folders shows Ardia's were
  never created.
- **No installable artifact leaves its isolation**: no setup exe, app folder, tarball, deb, AppImage, Arch package or
  CLI tarball is uploaded, attached or handed out. CI uploads logs and smoke results only.

## Names that stay Ardia until Layer 2
Today's engines read or write these names, so Layer 1 keeps them; they change together with Nilla's first engine
builds, on their own branch. `apps/browser/src/naming-allowlist.json` is the exact list, and `docs/conventions.md` has
the short version.
- Everything under `engine/`, `scripts/windows/engine/` and the offline game (`apps/browser/assets/offline-game*`):
  on Layer 1 the engine key (`engine/engine-key.sh`) never changes.
- The `ArdiaCore` interface: `packages/ardiacore`, `@ardia/ardiacore`, `ac_*` calls, `AC*` classes and
  Info.plist keys, `ARDIACORE_*`.
- Every `ARDIA_*` environment variable and `--ardia-*` switch, `ARDIA_DATA_DIR` and `--ardia-ui-dir` included.
- Rendezvous, profile and restore files (`ArdiaControl.json`, `ArdiaControl.sock`, "Ardia Tab History"), page globals
  and message keys (`__ardiaHost`, `__ardia*`), DOM events and CSS hooks (`ardia-reveal`, `ardia-pip-*`), window and
  layer ids (`ardia.window.small`, `ArdiaGlass`), routes and schemes (`ardia://`, `/ardia-oauth`, `chrome://ardia/`).
- The Linux wire names (`Ardia<Module>.<method>` in `apps/linux` and `scripts/linux`), the Linux package layout
  (`Package: ardia`, `bin/ardia`, `lib/ardia/`, `ardia.desktop`, `dev.ardia.linux`), the Windows engine names
  (`ArdiaApp.dll`, the `ArdiaApp*` exports, the folder `apps/browser/windows/Ardia`) and the `X-Ardia-Key` header.
- Text the engine draws (chrome://credits, the Web Store's "Add to Ardia", its error messages) and `docs/brand/ardia/`.

## Platforms
One browser UI (`apps/browser/src` and `packages/*/src`) runs on three platforms, each with its own native layer and
engine. A change to the shared UI reaches all three, so check the other two before calling it done: Linux's
`bun run --cwd apps/linux check`, `test:graph` and `test:host`, and the Windows workflow, which runs on any pull
request touching shared code. Copy that names Mac things (⌘, "macOS", the menu bar) needs its Linux and Windows
wording. When the machine you're on isn't the platform you're changing, use a disposable VM. If the owner has a Boat
account (`boat` CLI signed in): `boat new --type xlarge --no-auto-stop`, an idle-stop watchdog that stops it after 20
idle minutes, `boat desktop` or an X11 display for real input and screen recordings. A disposable VM's desktop is
yours: the hidden-instance and focus rules are for the owner's machine.
- **macOS** is the main app: `apps/browser` (React Native macOS, Xcode project `apps/browser/macos/Nilla.xcodeproj`)
  on `engine/ardiacore` and the Mac engine. The rest of this file is written for it.
- **Linux** (`docs/linux-port.md`): Chromium's own `chrome` is the app and serves the UI from `chrome://ardia/`;
  `apps/linux` builds the shared components with Linux adapters (Vite aliases, checked by `test:graph`), and
  `engine/ardiacore-linux` plus `engine/patches/chromium-linux-*.patch` are its native layer. The engine is built from
  source on a builder VM (`scripts/linux/build.sh --apply`, incremental like the Mac's) and pinned by a row in
  `packages/ardiacore/prebuilt-engines-linux.tsv`. The engine key (`engine/engine-key.sh`) covers all of `engine/`, so
  any change there needs a new Mac engine and a new Linux engine. CI: `.github/workflows/linux.yml`
  (`docs/linux-ci.md`); acceptance: `docs/linux-acceptance.md`.
- **Windows** (`docs/windows.md`): `apps/browser/windows` (React Native for Windows) and `packages/expo-windows` host
  Chromium's `chrome.dll`, with each tab's page in its own window under the app's. The engine is cross-built in
  `~/chromium-build-win` (`docs/engine-build-windows.md`; never `~/chromium-build`), its sources and patches live in
  `scripts/windows/engine/` (never under `engine/`, which would move the Mac's engine key), and
  `scripts/windows/engine/prebuilt.json` pins the release CI fetches. CI: `.github/workflows/windows.yml` builds x64
  and ARM64 on Windows runners, launches the app, tours pages with real input and installs the installer. To use it
  yourself, run Windows 11 in QEMU on a disposable VM (nested KVM, `dockurr/windows`).
- **Engines.** Nilla publishes no engines yet: the pins point at Ardia's releases, and app builds use the exact one
  or `--nearest`. Publishing an engine (`scripts/publish-engine.sh`, `scripts/linux/publish-engine.sh --upload`)
  needs the owner's OK.

## Building features
- **Conventions.** Folders, import direction, tokens, state, names, the translation layer and environment
  variables follow `docs/conventions.md`; its check runs in `bun run --cwd apps/browser test`.
- **Sources of truth.** `docs/dia-feature-parity.md` is the checklist; update its row when you ship.
  `docs/dia-spec.md` has Dia's measured values.
- **Match Dia with numbers.** Compare against a capture with the same crop and the same state; "looks
  close" isn't enough. When the owner asks for Arc's layout, keep Dia's styling unless told otherwise.
- **Parity means UI and UX.** Match what Dia does, not only how it looks: what each click does, what it
  remembers (positions, sizes), its animations and their timing in frames, and what keeps running.
  Obvious UX holds everywhere: dismissing something never pauses playback or drags you to another tab;
  going back to the source ends a temporary view (the mini player); nothing reopens right after you close it.
- **Owner recordings and screenshots.** Copy a recording out of its temp folder at once (it vanishes, and
  the name may have a narrow no-break space: use a glob). Extract 30 fps frames with ffmpeg, find events by
  frame difference, and measure positions and timings from the pixels. A position or size in the owner's
  recording may be their saved preference rather than Dia's default.
- **Local crashes still get fixed without asking.** When `crash.log` shows up in the repo root or a crash report
  appears, find the cause and fix it. Check the binary UUID against the current build first (older builds are
  usually known-fixed). Delete `crash.log` once handled.
- **Instrument what you ship.** Every feature and fix records the event that would show it working and catch its
  regression: a use count for a feature, a counter or timing on the path a fix touched, an error event where it used
  to fail. Add it to an existing event before inventing a new one (`apps/browser/src/state/telemetry`,
  `apps/cli/nilla_browser_cli/telemetry.py`). It stays inside the consent model: sharing on only, counts, timings,
  enums and flags, never URLs, page content, titles or free text. List new events and fields in the "What's Sent"
  copy. Events go nowhere while `packages/core/src/services.ts` has no endpoint; skip this only when nothing
  measurable exists, and say so.
- **Verify before you call it done.** Typecheck, build, and exercise the feature in a hidden instance
  (dev harness, CDP, window snapshots).
  - The screen is often locked, and then WindowServer captures fail. Use the in-process snapshots
    (`docs/agent-brief.md`) and say exactly what still needs a visual check.
  - Verify in proportion. A JS-only change needs no app build (Metro reloads it); run the checks for what
    you changed, each once before and once after, plus one final pass of the nearby checks. The full suite
    and Codex are for engine, native lifetime, focus, quit or security changes, and run once at the end.
  - After a fix, test that fix and move on. Don't re-run the full suite or checks that already passed; run only
    what covers the fix (the failed row, the smoke checks for its area).
- **Build safely.** Build the app with `scripts/agent/build-app --as <you>`: quiet, in parallel with other agents'
  builds, and it refuses JS-only changes. Run `pod install`/`bun install` and Chromium builds through
  `scripts/agent/locked <pod|chromium> -- <command>` (usage in the script); its lock dies with its holder.
- **Never wait open-ended.** Every wait has a deadline under the Bash tool's 10-minute limit and fails
  fast when the thing it waits on dies: `scripts/agent/await --pid <pid> -- <test>` instead of
  `until …; do sleep; done`. Run builds with `run_in_background` and act on the notification. Wrap
  screen captures in `timeout 20` (they hang while the screen is locked). Never wait for another agent's
  edit to appear; report the dependency instead.

## Shipping
- **Nothing ships yet.** Builds are development builds: no release, appcast, store upload, engine publish or tester
  hand-out. Agents never publish any of these until the owner grants it, in so many words, for that release.
  `docs/releasing.md` lists what a release still needs (signing, an update host, source archives).
- **Release notes**, once there are releases, go in `docs/release-notes/<version>.md` (style guide in that folder).
  Ardia's release history is archived in `docs/history/ardia/`, with its credits; it is never published as Nilla's.
- **Other public actions** (posting anywhere, opening issues or pull requests on other projects, changing repository
  settings) need the owner's OK first.

## Repo map
`apps/browser` is the shared UI and the React Native macOS app (`apps/browser/macos`); `apps/browser/windows` and
`packages/expo-windows` are the Windows app (`docs/windows.md`), and `apps/linux` the Linux UI with `scripts/linux` for
its build, packaging and engine. `scripts/windows` holds the Windows packaging, checks and engine build, and
`scripts/release` the Mac release stages and their smoke and update tests. The native Expo modules are in
`packages/{ardiacore,shell,shaders,import,sync}`; `engine/chromium` is our Chrome-services code (the `ac_*` C calls)
and `engine/ardiacore` ArdiaCore's window and tab layer (`engine/ardiacore-linux` on Linux), and `packages/core` holds
the omnibox logic, the service endpoints and their tests. `packages/demo` is the app on the web. `apps/cli` is the
`nilla-browser` command (`apps/cli/nilla_browser_cli`), `apps/phone` the Expo app for iPhone and Android (its native
module is `packages/phone`; `docs/phone.md`), `infra/feedback` a dormant feedback service template, and
`extras/raycast-nilla` the Raycast extension. `docs/history/ardia/` keeps Ardia's release notes and retired docs, and
`docs/audit/` audits made on Ardia's tree. Nilla's own source files are Apache-2.0; the app as distributed is GPL-3.0,
because its engine carries Helium's patches (`NOTICE`).
