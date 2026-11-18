# Contributing to Nilla

Nilla is a Chromium browser with Dia's polish and Arc's sidebar, for macOS, Linux and Windows, running on Chrome's own
framework (Chromium 157). It is a personal, non-commercial project of Noor Chasib, forked from Ardia, and much of it
is written with coding agents. Issues and pull requests are welcome. This page is what a good change looks like here,
written down so you don't have to learn it in review.

## What fits

Nilla copies Dia's look and behaviour on purpose, and uses Arc's layout for the sidebar. A change that makes it behave
more like Dia is almost always welcome. A change that restyles it to taste is not, unless the owner asked.
`docs/dia-feature-parity.md` is the checklist of what's done and what isn't; update its row in the same pull request.

Out of scope:

- **AI features in the base browser.** AI ships only as a first-party plugin on the plugin host, off until the user
  enables it. Dia's AI rows in `docs/dia-feature-parity.md` stay ⏸ until the plugin ships them.
- **Accounts or sign-in of our own.** Sync goes through a folder the user picks and nothing else.
- **Telemetry that carries browsing data.** Every service endpoint ships empty, so nothing is sent today
  (`docs/services.md`). Events count, time and flag; they never carry URLs, page content, titles or free text.

## Getting it running

The README's "Build and run" has the commands for each platform. On a Mac you need Apple Silicon on macOS 14 or later,
Xcode, CocoaPods, Node 24 (`.nvmrc`) and Bun 1.4.4, the version `package.json`'s `packageManager` pins.

You don't need to build Chromium. With no Chromium tree of your own, the app's build downloads the prebuilt engine
that matches your checkout's `engine/` folder (`packages/ardiacore/scripts/fetch-engine.sh`). Nilla has no engines of
its own yet, so those come from Ardia's releases, and `--nearest` picks the newest one when none matches exactly. If
you change the engine you need your own Chromium build: `docs/engine-build.md` has the whole thing, and a first build
takes about five hours.

Every build runs on its own data folder, so it never touches the browser you use, Ardia included. A Debug build
refuses to start without `ARDIA_DATA_DIR`, and every test instance gets a throwaway one. To run a build without it
popping up over your work:

```sh
open -g -n --env ARDIA_BACKGROUND=1 --env ARDIA_DATA_DIR="$(mktemp -d)" \
  --env ARDIA_REMOTE_DEBUGGING_PORT=9333 apps/browser/build/Build/Products/Debug/Nilla.app
```

Linux and Windows builds run only inside a disposable VM, a CI runner or (Linux) a namespace with a scratch `$HOME`,
because today's engines choose Ardia's default profile before any app code runs. `scripts/linux/nilla-dev-run` and
`scripts/windows/nilla-dev-run.ps1` start them on a scratch data folder.

A JS-only change doesn't need a rebuild. Metro reloads it, though relaunch the instance before you judge the result.

Where things live:

| Path | What |
| --- | --- |
| `apps/browser` | The shared UI, store and actions, and the macOS (`macos/`) and Windows (`windows/`) apps |
| `apps/linux` | The Linux desktop target: the shared UI with Linux adapters |
| `apps/phone`, `packages/phone` | The Expo app for iPhone and Android, and its native module |
| `apps/cli` | The `nilla-browser` command |
| `packages/ardiacore` | The engine's app side, ArdiaCore: Chrome's framework and the native modules the app calls |
| `packages/shell` | Menus, shortcuts, windows, native views |
| `packages/core` | Omnibox parsing and suggestions, pure TypeScript with tests |
| `packages/import`, `packages/sync`, `packages/shaders` | Importing from other browsers, folder sync, Metal views |
| `engine/` | Our patches to Chromium and our Chrome-side code |

`docs/agent-brief.md` explains the architecture in depth. It's written for agents and is just as useful to people.

## What a good change looks like

### It matches Dia, measured

"Looks close" isn't a match. Compare against a Dia capture of the same state with the same crop, and give the
numbers: sizes, spacing, colours, and for motion, timing in frames. Record both browsers and step through at 30 fps.
A bug fixed at 24 fps has come back more than once because the glitch lived between frames. `docs/dia-spec.md` holds
the values already measured from Dia.

Parity covers behaviour too. Most bugs are UX that any browser user expects without thinking:

- Dismissing something never pauses playback, opens a window, or drags you to another tab. Closing the mini player
  must not bring the browser forward.
- Going back to the source ends the temporary view. Open the tab whose video is in picture-in-picture and PiP stops.
- Clicking outside a popover or a focused field closes it.
- Nothing reopens right after you close it.
- Actions follow the active profile and the last active window. A link from another app opens in the profile you were
  just using, and ⌘⇧T reopens this profile's tab, not the other one's.
- Hover never moves anything.
- Motion animates. Sidebars slide, the toolbar eases away, the command bar grows out of the URL field. Nothing snaps
  into place or flickers, traffic lights included.
- Shortcuts match Chrome and Dia, in every focus. On a trackpad ⌘-scroll scrolls; with a mouse it zooms. That one
  has regressed twice.
- Check every layout you touched: address bar in the sidebar, address bar on top, horizontal tabs. Several bugs only
  showed up in one of them.

### It lets Chrome do the work

Nilla is real Chromium. Before writing our own version of something, check whether Chrome already does it and we're
getting in the way. "Shouldn't Chrome's default behaviour just work here?" is the first question to ask about a bug,
and the answer is often yes. When a fix needs a hook in Chrome's code, keep it the smallest hook that works.

### It's simple

A bug that happens sometimes usually means two pieces of code disagree about who owns the state. Pressing F to leave
full screen once put the video into PiP, flickered PiP, or worked, depending on timing. The fix there was deleting a
layer, not adding a guard. Prefer the change that removes code. Reject complexity out of proportion to the gain: a
900-line change to save 2 ms doesn't go in.

### It's fast, and stays fast

Performance is judged against the previous release: same or better, measured interleaved on a quiet machine
(`docs/perf/README.md`). Every cache, prefetch or cut request ships with a staleness test. Create something, reload,
and it's there. Delete it, and it's gone. Fewer requests isn't a goal by itself, and a metric that hasn't been shown
to follow real wall-clock time doesn't count as proof.

## Code style

- **No comments.** Not in source, scripts or config. Name things so the code says what it does, and put the why in
  the commit message. Tool directives (`@ts-expect-error`, `#pragma`, `swiftlint:`), shebangs, the header a script
  prints as its `--help`, and license headers stay. Never remove a copyright or license header.
- Read the surrounding code first and match its naming and idioms. New features go in new files where that makes
  sense.
- `docs/conventions.md` holds the folder, import, naming and environment-variable rules; its check runs in
  `bun run --cwd apps/browser test`. Read `docs/store-api.md` before you touch app state.
- Skills live only in the root `.claude/skills`. Deploy setups live only in `infra/<service>`.
- Patched npm dependencies live in `patches/`, listed in the root `package.json`'s `patchedDependencies`.
  `docs/agent-brief.md` explains how to change one.
- When JS starts needing native code older builds lack, bump `NATIVE_API_VERSION` in `apps/browser/src/platform/nativeApi.ts`
  and `apiVersion` in `packages/shell/ios/AppModule.swift` together.
- Some names keep their Ardia spelling because today's engines read them: the `ARDIA_*` environment variables, the
  `--ardia-*` switches, `ArdiaCore` and the `ac_*` calls, `ardia://` app URLs, and the names
  `apps/browser/src/naming-allowlist.json` lists. Leave them as they are; they change together with Nilla's own engines.

## Testing

Reproduce the bug before you fix it, ideally with a check that fails. Then fix it and watch the same check pass.
Tests run the real production code. A copy of the logic inside a test proves nothing about the app.

Run what covers your change, once before and once after, then the checks next to it. You don't need the full suite
for a small fix.

```sh
bun check                               # type checks every package in the root workspace
bun run test                            # every unit test, cached by Turbo
bun run test:portable                   # the ones that run without a Mac (Linux, CI)
python3 engine/patches/series.py check  # if you touched engine/patches
```

The end-to-end checks (shortcuts, tab dragging, profile swipes, windowing, sync, import, the engine acceptance run)
need a built app and run hidden instances. `docs/testing.md` lists each one with what it guards. When you fix a
regression, add its case to the matching check so it can't come back quietly.

Never read a real browser profile in a test. Build fixtures. Screenshots for the README or a pull request use neutral
pages, never someone's feed or personal data.

A shared UI change reaches all three desktop platforms, so check the other two before calling it done: Linux's
`bun run --cwd apps/linux check`, `test:graph` and `test:host`, and the Windows workflow, which runs on every pull
request that touches shared code.

## Engine changes

Chromium builds are incremental. Never run `gn clean` or `gclient sync` on a tree you care about, and don't delete
`out/`: a full rebuild costs about five hours. Patches go in `engine/patches/` in the order `engine/patches/series`
gives, and our Chrome-side code lives in `engine/chromium` and `engine/ardiacore` (`engine/ardiacore-linux` on Linux).
`docs/engine-build.md` covers both. A change under `engine/` has no prebuilt engine until Nilla publishes its own, so
whoever runs it builds the engine; say so in the pull request.

Security-sensitive code gets extra care. Passwords and card numbers stay on their native path and never go through
the generic JS-to-engine call. Anything that weakens a Chrome security UI (the full-screen exit notice, permission
prompts, re-auth) needs a strong reason in the pull request.

## Reporting a bug

Use the bug report form on [Nilla's tracker](https://github.com/NoorChasib/nilla/issues). The fastest bug to fix is
one with a screen recording. Include:

- the version (Settings › General),
- your platform, and your layout: sidebar or top address bar, sidebar or horizontal tabs,
- how many profiles and windows you have open,
- the steps, and how often it happens if it's only sometimes,
- the same steps recorded in Dia, if Dia behaves differently,
- the crash report, if it crashed. Crash reports stay on your machine (on a Mac, `~/Library/Logs/DiagnosticReports`);
  nothing is uploaded, so attach the file yourself.

## Pull requests

- **One problem per pull request.** Fix one problem and include everything that fix needs: code, tests, docs.
  Cleanup, refactors and a second fix go in their own pull requests. Describe the change the way a user would notice
  it ("dragging a tab onto another groups them"). Linking the issue it fixes (`Closes #<issue>`) helps.
- **Show that it works.** Under Verification, say how you reproduced the bug and what you saw after the fix, with
  screenshots, or a video when the change is about motion or timing, ideally next to Dia's. Upload them to the pull
  request; don't commit them. "Tests pass" is not evidence. A change with nothing to see still has something to show:
  the failing check before and the passing one after.
- **Keep it mergeable.** Rebase on `main` when it conflicts.
- Commit messages carry the why, since the code doesn't have comments. Look at `git log` for the style: a short
  "Area: sentence" subject saying what changed, then a plain paragraph.
- Sometimes your work lands in a different shape, or part of a pull request goes into another commit. You stay on it
  as a `Co-authored-by:` trailer.

Releases and anything posted publicly are the owner's job. Don't bump versions or touch update feeds in a pull
request.

## Writing

Copy in the app and in release notes is short, plain and a little funny. Corporate-cute lines aren't. Say what the
thing does with a number or a mechanism. Copy that names Mac things (⌘, "macOS", the menu bar) needs its Linux and
Windows wording too. Release notes follow `docs/release-notes/README.md`.

## Working with a coding agent

Using one is fine. Point it at `AGENTS.md` and `docs/agent-brief.md` first. Those files hold the standing rules
(hidden test instances, no focus stealing, isolated builds, the no-comments rule), and they're why a change goes in
without a long back-and-forth. For risky logic (races, object lifetimes, security, migrations, sync), get a second
model to review the change before and after, and reproduce each finding before acting on it. Check the agent's diff
yourself before you open the pull request. You're the one answering for it. End the description with the model and
harness that did the work.

## Upstream

Nilla is a fork of [Ardia](https://github.com/ardia-browser/ardia). A fix that applies to Ardia too is welcome there,
under Ardia's own rules. Don't open Nilla issues on Ardia's tracker, and don't report Ardia's bugs here unless they
happen in Nilla.

## License of contributions

Nilla's own files, and those it carries from Ardia, are Apache-2.0, and Nilla as distributed is GPL-3.0 (see
`NOTICE`). By contributing you agree that your contribution is licensed under the Apache License 2.0, as its section
5 provides, and as part of Nilla under the GPL-3.0 as distributed. There is no CLA, and nobody gets the right to
relicense your work. Keep every existing copyright and license header.

You may add a `Signed-off-by:` line to your commits ([Developer Certificate of Origin](https://developercertificate.org));
it's welcome, not required.
