# Linux acceptance suite

`apps/linux/scripts/acceptance` runs headless acceptance scenarios against a packaged Linux Nilla. Each scenario
launches Nilla with throwaway profiles and checks a feature through the shell, the page and CDP. The suite prints one
result per scenario as JSON:

- `pass`: every check passed;
- `fail`: a check failed;
- `manual`: every automated check passed, and the steps that need a person are listed.

No scenario runs in CI. The package job runs `scripts/linux/smoke.mjs` only (see [linux-ci.md](linux-ci.md)).

## Running it

```sh
bun run --cwd apps/linux build
bun run acceptance:linux <path to the packaged executable> apps/linux/dist
```

- **Where to run it.** From the repository root, from `apps/linux`, or from a folder with no `package.json` of its own.
  Any other package folder (`apps/browser`, `packages/*`) has its own `package.json` without the script, and Bun stops
  there with `Script not found`.
- **Paths.** Bun runs the script in the folder of the `package.json` that defines it and sets no `INIT_CWD`, so relative
  paths resolve against the repository root, or against `apps/linux` when run there
  (`bun run acceptance:linux <executable> dist`). (Under npm, which sets `INIT_CWD`, they resolve against the directory
  it was called from.)
- **UI directory.** The second argument is optional. When given, the UI is loaded from it (`--ardia-ui-dir`);
  otherwise the bundled UI is used.
- **`--only F01,F23`** runs a subset by scenario id.
- **`--list`** prints every scenario.
- **`--results <dir>`** chooses where evidence goes. The default is a new temporary directory.
- **`--keep`** keeps every scratch profile, not only failing ones.
- **Exit status.** `0` when nothing failed, `1` when a scenario failed, `2` for a usage error.
- **Deadlines.** A check stops after 60 s and a scenario after 3 to 8 minutes. A check that misses its deadline is cancelled
  and must stop within 15 s or the scenario stops; a scenario that leaves work running 15 s after it stops fails, and
  the suite stops there so nothing overlaps the next scenario.

Results go to stdout and to `<results>/results.json`. Each scenario writes its checks, details and screenshots under
`<results>/<id>/`. A failing scenario keeps its scratch profiles, including the browser log and `*-command.json` with
the exact command line.

`bun run --cwd apps/linux acceptance:self-test` tests the harness without a Nilla build: the CDP client against a
mock peer, the launch plumbing and shell driver against a mock host, the runner and its report, the classifiers, the
fixture servers and certificates, and `scripts/linux/smoke.mjs`. When `/usr/bin/chromium` (or
`ARDIA_ACCEPTANCE_CHROMIUM`) is installed, it also checks SPKI trust, resolver mapping, gated downloads, synthesized
drops, kiosk print to PDF, process-group cleanup and the content blocker's bridge page.

## Every launch

- **Profile.** A fresh `--user-data-dir`. `HOME` and the XDG directories point inside it.
- **Display.** `--ozone-platform=headless` with SwiftShader, and `DISPLAY`/`WAYLAND_DISPLAY` cleared.
- **Isolation.** The browser can't reach the session bus or a CUPS server, so no portal dialog appears on the desktop.
- **Debugging port.** `--remote-debugging-port=0`, read back from `DevToolsActivePort`.
- **Background.** Launches use `ARDIA_BACKGROUND=1`, except where a scenario needs print, DevTools or real activation.
- **Process groups.** Each browser runs in its own process group. Cleanup closes it through CDP `Browser.close`, then
  sends `SIGTERM` and `SIGKILL` to that group only. Ctrl+C stops every scenario's browsers; a second Ctrl+C kills
  what is left.
- **Seeds.** Profiles start with a one-window `linux-session.json` and a completed `onboarding.json`, unless the
  scenario tests those.
- **Network.** `*.nilla.test` resolves to local fixture servers through `--host-resolver-rules`, and every other host
  to `NOTFOUND`, so nothing leaves the machine. HTTPS fixtures use a CA generated for the run, trusted only through
  `--ignore-certificate-errors-spki-list`. The default search engine's suggestion host is mapped to a local server that
  logs request headers.

Requirements: `openssl` and Node 22 or newer (for the built-in WebSocket client).

## Scenarios

| Id | Checks |
| --- | --- |
| F01 | Find, Print, Save Page and DevTools act on the exact pane |
| F02 | Isolated and shared-data profiles, private windows |
| F03 | Site panel connection security for HTTPS, HTTP, mixed, bad-certificate and internal pages |
| F23 | History jumps of two or more, zoom feedback, reset and per-site persistence |
| F08 | Download events, controls, settings and restart |
| F09 | Extension management, toolbar action, popup and side panel, with `fixtures/extension/` |
| F10 | Online search suggestions through the native host, only when enabled, and never from a private window |
| F26 | Unsupported platform settings are hidden and startup has no backend rejections |
| F27 | Onboarding starts once on a fresh profile and app services run once per launch |
| F28 | Sidebar rows and Top Apps tiles reorder by drag in a space the window switched to, not only the one it opened in |
| F29 | Settings › Tabs › Close button position: the hover ✕ sits 6 pt from the row's end on the Right and over the favicon on the Left (tab, active, pinned, group member, split pane, live item and PR rows), titles don't move, Back to Pinned URL moves trailing beside a spinner or badge, renaming shows none, both sides close, unload and hide, at widths 160 and 400 with the sidebar on either side, and the choice survives a relaunch |

Each scenario's report lists its manual steps, such as touchpad pinch zoom, Web Store installs, popup placement and
onboarding by hand.

## Hooks the scenarios use

A scenario that fails because a label or flow changed, rather than because the feature broke, says in the failing
check's `detail` what it waited for. The kept scratch profile has the browser log.

- **Shell hooks:** `nillaLinux.store`, `emitCommand`, `webviews`, `extensions` and `openExtension`.
- **Bridge:** `__ardiaHost.invoke`, `__ardiaHost.call` and `__ardiaHost.on`.
- **Window marker:** `[data-nilla-linux-window]`.
- **Visible labels:** labels from the shared components, such as `Site Controls`, `Zoom: N%`, `Find on Page` and the
  Settings pane names.
