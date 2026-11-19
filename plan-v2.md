# Nilla conversion plan, v2

This is the single plan that implementation agents follow to convert the fork `NoorChasib/ardia` into **Nilla**, an
independent browser. It replaces `plan.md`. Every accepted correction from `plan.md` §6 (R1-R51), `plan-review.md`
(F1-F51) and `review-codex.md` (C1-C12) is folded into the section it changes, so one phase brief holds everything
its agent needs. §6 maps each of those findings to the section that handles it.

**Precedence.** `owner-requirements.md` wins over this plan, and this plan wins over `plan.md`, the four inventories
(`infra-services.md`, `governance.md`, `naming.md`, `readme-docs-license.md`) and the branding hand-off. In every input,
"Nila" means **Nilla**.

**How it was written.** A read-only survey of `/home/noor/Code/ardia` at `phase3/final-candidate` (`e15125104`) through
`git show` and `git grep`. Nothing in the repo was checked out, edited, built, committed or launched, and no outside
service was contacted. Files were written only under `~/ardia-work/nila-cleanup/`.

**The real base** is PR 4's final head: PR 3's tip plus one docs commit. Wave 0 regenerates every list below at that
commit (§5 step 3). Paths and line numbers are quoted at `e15125104` and may move slightly.

Supporting data, all reproducible from this folder:

| File | What it is |
| --- | --- |
| `tools/ownership_v2.py` | The scheduler: exclusive ownership inside each wave, scheduled ownership across waves, closure checks (§2.2). Replaces `tools/ownership.py`. Runs in wave 0 and after wave 1, never after wave 2 |
| `tools/remap_lists.py` | Rewrites the wave 3 lists through R's move map and checks every path exists (§2.4, E3) |
| `work/ownership-v2/` | Its output at `e15125104`: `<owner>.txt`, `schedule.tsv`, `contract-files.tsv`, `closure.tsv`, `handoffs.tsv`, `moves.tsv`, `frozen-tokens.tsv`, `engine-literals.tsv`, `engine-literal-occurrences.tsv`, `engine-literals-excluded.tsv`, `summary.txt` |
| `tools/naming_census.py`, `work/census.tsv` | Every Ardia/Netnyahoo occurrence with its category (from naming.md) |
| `~/ardia-work/branding/nila/` | Branding hand-off for Nilla: `manifest.json` (assets by role and layer), `icons/INDEX.md`, `strings/inventory.tsv` (column `as_nilla`), `tools/` (the build, verify-manifest and inventory scripts). A branding agent is regenerating it for Nilla, so refer to entries by role, not by today's file names |

`P` below is the reverse-DNS prefix **`com.nilladigital`**.

---

## 0. Settled facts and rules every agent follows

### 0.1 Names and identifiers

Nilla has five letters, like Ardia. Fixed-offset name handling (`packages/ardiacore/src/nativeModules.ts:26`
`name[5]`/`name.slice(6)`; `apps/linux/src/hostModules.ts:85-86` `slice(5, 6)`) keeps working, so it is not rewritten
(§0.5 item 1). A module-to-domain test still guards it.

| Thing | Layer 1 value | Stays Ardia until Layer 2 |
| --- | --- | --- |
| Product, window titles, About, menus | Nilla | engine-drawn copy (chrome://credits, Web Store "Add to Ardia", engine error strings in §0.4 class Q) |
| Mac app | `Nilla.app`, `PRODUCT_NAME = Nilla`, `MARKETING_VERSION = 0.1.0` | `ArdiaApp.dll` on Windows, every `ArdiaCore*` name |
| Mac bundle id / data folder | `com.nilladigital.nilla`; `~/Library/Application Support/com.nilladigital.nilla` (derived from the bundle id, `ArdiaHost+Launch.mm:128`) | – |
| iPhone | `com.nilladigital.nilla.ios` plus `.share`, `.widgets`, `.open`, `.measure`, `.sync`; app group `group.com.nilladigital.nilla.ios` | – |
| Android | `applicationId com.nilladigital.nilla.android` | – |
| Kotlin packages and folders | `com.ardia.browser.android` → `com.nilladigital.nilla.android`; `com.ardia.<pkg>` → `com.nilladigital.nilla.<pkg>`; folders follow the packages (`com/nilladigital/nilla/...`) | – |
| JNI | `Java_com_nilladigital_nilla_<pkg>_<Class>_<method>`, `FindClass("com/nilladigital/nilla/<pkg>/<Class>")` | – |
| Windows | installer `AppId` new GUID, `{localappdata}\Programs\Nilla`, `Nilla-Setup-<cpu>.exe`, AUMID `NillaDigital.Nilla`, app data `%LOCALAPPDATA%\Nilla` | folder `apps/browser/windows/Ardia`, `Ardia.ico` path, `ArdiaApp.dll`, `ArdiaApp*` exports, `Ardia.test-build`, ProgIDs (none written in Layer 1, §0.2) |
| Linux | `Name=Nilla`, Maintainer, Homepage, Description | `Package: ardia`, `bin/ardia`, `lib/ardia/`, `ardia.desktop`, polkit and libsecret ids, `dev.ardia.linux` bundle id, `chrome://ardia/` |
| CLI | command **`nilla-browser`**; dist `nilla-browser`; module `apps/cli/nilla_browser_cli`; `[project.scripts] nilla-browser = "nilla_browser_cli.cli:main"` | Linux tarball `ardia-cli-<v>-linux-x64.tar.gz`, top folder `ardia-cli-<v>/`, `bin/ardia` (plus `bin/nilla-browser`), CLI home `.../ardia/cli`, `ARDIA_CLI_*`, `ArdiaControl.*` |
| JS workspace scope | `@nilla/*` | `@ardia/ardiacore` |
| App URL scheme | phone: `nilla://` (registered with the OS) | desktop `ardia://` (engine `IsAppURL`), and `ardia://` app URLs inside synced documents |
| Features | "Little Nilla", "Nilla Sync" (folder name), wordmark "nilla" | Linux sync (disabled in Layer 1, §0.2) |
| Sync protocol (Mac, Windows, phone) | salt `nilla-sync/v1`, magic `NLS1`, vault extension `.nls` | shared document names `sync-state.nns`, `sync-journal.nns` (`syncDoc.ts:71-72`, `ac_linux_policy.h:11-15`) |
| App keychain items | "Nilla Connected Accounts", "Nilla Recovery Kit", "Nilla Live Tokens", "Nilla Sync Key" | "Ardia Safe Storage" (engine; not used in Layer 1, §0.2) |
| `dev.ardia.*` app ids | `P.nilla.{hooks, browse.auth, cli-installer, demo, fixture.dia, idle-watch}` | `dev.ardia.linux*` |
| Repo | `NoorChasib/nilla` | prebuilt-engine source `ardia-browser/ardia` (Layer 1 only) |
| Env and switches | unchanged | every `ARDIA_*` variable and `--ardia-*` switch, including the prefix forwarding (`ac_linux_cli.cc:119`, `ArdiaLaunchConfig.mm:217-218`, `scripts/lib/launchEnv.mjs:14-17`) |

Grammar: "an Ardia" becomes "a Nilla" (`\b([Aa])n (Ardia|ardia|ARDIA)\b` → `\1 \2`, 57 hits in 32 files at `e15125104`).
Column-aligned copy keeps its width for the product name, but not for the CLI command (`ardia` is 5 characters,
`nilla-browser` 13), so CLI help alignment is re-checked by hand.

### 0.2 Independence (owner decision 2): Layer 1 builds share nothing with an installed Ardia

A Layer 1 build, on any platform, never reads or writes an installed Ardia's data, keychain or secret-store items,
sync folder, or OS registrations. Where today's prebuilt engine forces an Ardia name, Layer 1 turns that feature off or
isolates it on the app side and records the engine-side fix as a Layer 2 item. Independence is never relaxed for
convenience. This replaces `plan.md` §0.11, D12 and the "dev-only, don't install beside Ardia" rows of §2.6 (§0.5
item 2).

**Windows and Linux need OS isolation, not only app guards (C5).** Today's prebuilt Windows and Linux engines choose
their profile before any app code runs (Windows `main.cc:611-619` picks `%LOCALAPPDATA%\Ardia\User Data` unless
`ARDIA_DATA_DIR` is set, and the app starts only in `PostBrowserStart`, `:538-545`; Linux defaults to `~/.config/ardia`,
`chromium-linux-branding.patch:24-36`). An app-side guard that runs after that is a warning, not a boundary. So in
Layer 1:
- Every Windows and Linux launch, install, tour or smoke run happens **only inside disposable OS isolation**: a GitHub
  hosted runner, a throwaway VM, or (Linux) a user and mount namespace with a scratch `$HOME`. Never on a host or user
  account that has, or could later get, an Ardia profile. This is mandatory, not a recommendation.
- **No Windows or Linux binary leaves its isolation:** no installable artifact (setup exe, app folder, tarball, deb,
  AppImage, Arch package, CLI tarball) is uploaded, attached or handed out (R22). CI uploads logs and smoke results only.
  This holds until Layer 2 gives the engines Nilla's defaults or an enforced pre-engine launch boundary exists.
- A bare-launch test runs only in disposable isolation. Its pass condition is that the Ardia folders were never created
  (checked by listing the folders), not that the guard message appeared: the message proves only that app code ran.
- The `Ardia.cpp` guard, `nilla-dev-run` and the Linux "not isolated" page stay as defence in depth.

**User-initiated import is the one allowed read (OWNER-IMPORT).** Nilla may read an installed Ardia's data only when
the user picks Ardia in the importer (owner decision 2: "Nilla can import from Ardia like any browser"). The import
reads a snapshot (`SQLiteSnapshot.swift`), writes nothing to Ardia's folder, and never runs at startup (§2.3 wave 3,
C-mac).

| Platform | Resource | Layer 1 action (owner) | Engine-forced residue → Layer 2 item |
| --- | --- | --- | --- |
| Mac | Data folder | New bundle id moves it (I) | – |
| Mac | Chromium's "Ardia Safe Storage" keychain item (`chromium-safe-storage-name.patch`) | `ArdiaLaunchConfig.mm` always adds `--use-mock-keychain` to the engine switches (I). Cookies and saved passwords are then sealed with Chromium's mock key, which is acceptable for development builds (D2) | "Nilla Safe Storage", and the switch goes |
| Mac | App keychain items | Renamed (I) | – |
| Mac | Team-bound access groups (passkeys, unexportable keys, SPC) | Ad hoc build with no team; listed as not working (§2.7) | the owner's team (D15) |
| Mac | Sync | "Nilla Sync" folder, new salt and magic; the legacy "Netnyahoo Sync" lookup (`SyncModule.swift:349`) goes (I, then M) | – |
| Mac | OS registrations | Default browser, login item and Dock follow the bundle id. The Info.plist registers only `http`, `https` and `file`, never `ardia`. The Dock-tile migration is deleted (M) | – |
| Mac | CLI rendezvous | `ArdiaControl.json`/`.sock` live in the data folder, which is Nilla's | names → Layer 2 |
| Windows | App data | `Paths.h:80` default and `EngineHostModule.h:133` `ProfileDataRoot()` become `%LOCALAPPDATA%\Nilla` (I) | – |
| Windows | Chromium's profile | The engine opens `%LOCALAPPDATA%\Ardia\User Data` (compiled `kProductPathName`) unless `ARDIA_DATA_DIR` is set, which moves it to `<dir>\Chromium` (`main.cc:254-263`). No app code runs before Chromium opens its profile. Layer 1: (1) the installer creates no `[Icons]`, `[Run]`, `[Registry]` or Ardia `[Dirs]` entries, so nothing launches the engine without the variable; (2) `ArdiaAppStart` in `Ardia.cpp` shows "This development build of Nilla runs only with ARDIA_DATA_DIR set" and quits before writing app data when `!Paths::HasCustomDataDirectory()`; (3) `scripts/windows/nilla-dev-run.ps1` (new) starts it with `ARDIA_DATA_DIR=%LOCALAPPDATA%\Nilla` or a scratch folder. The Windows package is unpacked and installed only on CI or a disposable VM (I) | `kProductPathName` "Nilla"; restore shortcuts |
| Windows | ProgIDs, `StartMenuInternet`, `RegisteredApplications`, file associations | None written: the whole `[Registry]` block (`Ardia.iss:43-77`) goes. `SystemModule.h`'s "set as default browser" and "open at login" actions report unsupported, because the engine would register `ArdiaHTM` (`chromium-win-install-names.patch:26,33`) (I) | `NillaHTM`/`NillaPDF`, restore the actions |
| Windows | AUMID | `NillaDigital.Nilla` in `AppIcon.h:22`. No shortcut or registry value carries an AUMID in Layer 1. Check in CI that `launcher-identity.ps1` sees the engine's windows carry it; if the engine sets its own, defer the AUMID to Layer 2 (I) | – |
| Windows | Keychain (Credential Manager) items | Renamed (`KeychainModule.h:95`) (I) | – |
| Windows | Sync | "Nilla Sync", new salt and magic (`SyncCrypto.h:82`, `SyncSecrets.h`) (I) | – |
| Linux | Chromium profile and default data folder `ardia` (`chromium-linux-branding.patch:33`) | Extract-and-run only, never `install.sh`, the deb or the AppImage on a host. `scripts/linux/nilla-dev-run` (new) refuses to start without a scratch or Nilla-only `ARDIA_DATA_DIR` and `ARDIA_CONFIG_HOME`, and passes `--password-store=basic`. The Linux UI shows a blocking "development build" page and makes no writes if the bootstrap says the instance isn't isolated (I, C-linux) | `nilla` data folder |
| Linux | Sync (salt, magic and "Ardia Sync" folder compiled in, `ac_linux_sync_crypto.h:25-26`, `ac_linux_sync.cc:641`) | **Off**: the Layer 1 gate (§0.3) drops every `ArdiaSync.*` method from the host's capability list, so the UI treats Sync as unsupported (S) | Nilla salt, magic and folder |
| Linux | libsecret items (`dev.ardia.linux.SyncKey`, `dev.ardia.linux.LiveToken`) | Off with Sync; connected accounts (`ArdiaLive.*` token calls) are dropped by the same gate (S) | `P.nilla.linux.*` |
| Linux | Desktop id, default browser, autostart, polkit, GeoClue | Never registered: the gate drops `ArdiaSystem.setAsDefaultBrowser`, `setLaunchAtLogin` and `ArdiaCli.install` (S) | `nilla.desktop` and the rest |
| Phone | App sandbox, app group, keychain group | New ids (I) | – |
| Phone | Registered URL scheme and background task | One I commit in wave 1 changes the registrations and every OS-level builder together: the Android intent filter (`AndroidManifest.xml:53`), both shortcut files (`res-system/xml/shortcuts.xml`, `res/xml/phone_shortcuts.xml`), the main iOS `apps/phone/ios/Ardia/Info.plist` (URL type `:30-36` and `BGTaskSchedulerPermittedIdentifiers` `:13`) with the matching `SyncService.backgroundTaskIdentifier` (`SyncService.swift:50`). The shared constants `BROWSE_SCHEME` (`BrowserUrl.kt:4`) and `browseScheme` (`TabPolicies.swift:63`) split into an OS link scheme `nilla` (used by `SystemLink.kt:30` and `SystemShared.swift:16-40`) and an app URL scheme `ardia` (internal and synced URLs, `ExternalLinks`, `WebViewPage`, `WebTab`). App URLs stored in synced documents stay `ardia://` to match the desktop. Verified on a phone build: the shortcuts and widget links open Nilla, and the background sync task registers (§2.6) | – |
| Phone | Sync | "Nilla Sync" folder, new salt and magic (I) | – |
| Phone | Compose-app upgrade importer (`PhoneLegacy*`, `LegacyModule`, `UpgradeGate.kt`) | Kept, inert: it reads only Nilla's own sandbox, where no Compose source can exist (§0.5 item 6) | removed in its own PR |
| CLI | Linux default data folder `~/.config/ardia` (`endpoint.py:36-41`) | On Linux, `nilla-browser` refuses to guess: it needs `ARDIA_DATA_DIR` or `ARDIA_CONFIG_HOME` and prints how to set them. On the Mac it finds Nilla's folder through the bundle-id mirror (I) | `nilla` folder |
| CLI | Installed command and link | `nilla-browser`, so it never overwrites an `ardia` link: `install.sh` links, checks and uninstalls `bin/nilla-browser` only (I). The Mac CLI home becomes `~/Library/Application Support/Nilla/CLI` in both mirrors, `install.sh:51` and `CliInstaller.swift:33` (I). `install.sh` defaults to `repo=NoorChasib/nilla` (no releases, so a download fails closed) and in Layer 1 accepts only a `file://` `ARDIA_CLI_URL`. The Mac "install the command" action reports unsupported unless a test instance passes the `cliInstallScript` and a local tarball fixture (I). The Linux home `.../ardia/cli` is an engine contract (class N), and `ArdiaCli.install` is gated off on Linux, so `install.sh` runs on Linux only inside disposable isolation (R11) | `nilla` home on Linux |

Each row's owner verifies it (§2.6): Mac in a hidden instance, Windows in CI (no `%LOCALAPPDATA%\Ardia`, no
`HKCU\Software\Classes\ArdiaHTM`, no `RegisteredApplications\Ardia` after the tour), Linux in the namespace check
(no `~/.config/ardia` created, no libsecret item written).

### 0.3 Services (owner decision 4)

- **Every endpoint ships as `null`** in `packages/core/src/services.ts` (§2.3 B). Only `sourceRepo:
  "NoorChasib/nilla"` and `issueUrl: "https://github.com/NoorChasib/nilla/issues/new"` are non-null.
- **No no-consent ping, ever** (D23): the `daily_active` sender, its scheduler, its state document and its copy are
  deleted, not gated.
- **Windows updater:** `configured()` requires a non-empty feed **and** a non-empty approved prefix. `Allowed()`
  (`UpdateModule.h:88-90`) and `readInstaller()` (`manifest.ts:25`) reject an empty prefix, because
  `startsWith("")` accepts every URL.
- **Linux engine-compiled destinations stay unconditionally disabled in Layer 1.** The engine fixes the telemetry,
  update, kill-switch and report destinations (`ac_linux_telemetry_policy.h:9`, `ac_linux_updates_policy.h:12-14`,
  `ac_linux_report_core.h:20`), so any non-null setting would turn upstream back on. A new
  `apps/linux/src/layer1Gate.ts` sits at the **common host boundary**, `apps/linux/src/host.ts`, not in
  `hostModules.ts`: the service and sync adapters call the native host directly through `invokeHost`
  (`hostTelemetry.ts:35-38`, `hostReport.ts:67-71`, `hostSync.ts:409-414`), so a resolver-level gate would miss them.
  `host.ts:40` wraps `window.__ardiaHost` once (`ardiaHost = gateHost(window.__ardiaHost)`), and `invokeHost`, `callHost`
  and `hostSupports` also check the gate for any host passed in. The gate removes from `bootstrap.capabilities` both the
  gated method names and the capability keys the UI tests (`report.send`, `hostReport.ts:4`), and rejects gated calls
  with an "unsupported" error **before** native dispatch, whatever `services.ts` says: `ArdiaTelemetry.post`,
  `ArdiaUpdates.releases`, `ArdiaShell.fetchKillSwitches`, `ArdiaReport.upload`, `ArdiaReport.post`, `report.send`, plus
  the independence rows of §0.2. The `services.feedbackUrl === FEEDBACK_URL` rule from `plan.md` is deleted.
- **Native transports are covered as well as Chromium's:** Mac `ReportUploader.swift:16-21` (URLSession) and Sparkle,
  Windows `UpdateModule.h:126-145` (WinHTTP), the CLI (`telemetry.py`, `feedback.py`), the phone (`platform/telemetry.ts`,
  `LabNetworkLog.kt`). Each refuses an empty URL in its own code, and the §2.6 no-upstream check denies egress by
  default and logs every attempt from the app, the CLI and every child process, not just the resolver (R20).
- **Allowed outside traffic in Layer 1:** Helium's bang list (`services.helium.imput.net`, `BangListFetch.swift:8`,
  credited, D19) and, at build time only, the prebuilt-engine download from `ardia-browser/ardia` releases. Both are
  named exceptions in the no-upstream check.

### 0.4 Engine contract list (every platform)

These names are read or written by today's prebuilt engines or asserted by engine tests. Layer 1 keeps each one, and
the rename tool (§2.3 D) excludes it by the mechanism named. Mechanisms:

- **frozen**: the path is in `X-layer2.txt`; no agent stages it.
- **skip**: R skips the whole file; the named wave-3 owner hand-edits it.
- **literal**: the string is in `apps/browser/src/naming-allowlist.json` with its scope (quoted-only, or a file list);
  R leaves matching spans. Text around a protected span on the same line may change (R13).
- **class**: a token-class regex in the allowlist; also span protection.
- **basename**: R never `git mv`s the path; content may change.
- **line**: only for an exact line an engine test asserts (class M, the `SHELL_PARTS`/`APP_PARTS` lines, the
  `PKGBUILD` lines). Its pre-image is in the allowlist and R's pre-commit gate fails if its diff changes that line.

| Class | Contract (examples, at `e15125104`) | Read by | Mechanism |
| --- | --- | --- | --- |
| A. Rendezvous files | `ArdiaControl.json` (`endpoint.py:16` ↔ `ac_cli_control.cc:64`), `ArdiaControl.sock`, `ArdiaControl.sock.lock` (`ControlSocket.swift:7-8` ↔ `ac_linux_control_core.h:16-17`), `/ardia/active`, the CLI's Linux data folder `ardia` | CLI, Mac shell, both engines | literal |
| B. Profile and restore files | "Ardia Tab History", "Ardia Tab History Cleared" (`ArdiaWebView+Transfer.mm:47` ↔ `ac_tab_restore_history.cc:63`), "Ardia Passwords.csv", "Ardia Recovery Kit.txt" | Mac, Linux engine | literal (lead classifies the last two in wave 0) |
| C. JSON fields and message keys | `ardiaOffscreen` (`ac_cli_token_policy_events.cc:242,256`), the quoted `"littleArdia"` report key (`ac_video_upscaling.mm:266` ↔ `video-upscaling-test.mjs:449`), page globals `__ardiaHost`, `__ardiaReply`, `__ardiaEvent`, `ardiaRequest`, `__ardia*` | engines, page scripts | literal (quoted-only) and class `__ardia\w*` |
| D. DOM events and CSS hooks | `ardia-reveal`, `ardia-hide-element*` (`page_script.js`, compiled into Linux by `apply.sh:34`), `ardia-pip-*` classes, `ardia-ver` | Linux engine | frozen (`page_script.js`), literal |
| E. Window and layer identifiers | `ardia.window.small` (`ArdiaEarlyWindow.mm:402` ↔ `ac_video_upscaling.mm:31`), `ArdiaGlass`, Windows classes `ArdiaHostedPage`, `ArdiaProbeWindow` | Mac and Windows engines | literal |
| F. Routes, schemes, UI hosts | `/ardia-oauth` (`googleAuth.ts:7` ↔ `ac_linux_live.h:34`, `test_live.py:84`), `ardia://`, `ardia:`, `APP_SCHEME = "ardia"`, `ardia:(?:\/\/)?`, `ardia:\/\/`, the scheme lists in `engines.ts:42`, `omnibox.ts:22`, `ArdiaWebView+Navigation.mm:12`, `chrome://ardia/`, `ardia-ui`, `ardia-ui-dir`, `ardia-linux-bridge(.js)`, `ardia-content-blocker-dir` | engines | literal; test that `toAppUrl("chrome://settings")` returns `ardia://settings` |
| G. Engine API and setting keys the engine reads | `webView.setLittleArdiaOpensNewTabLinks` in every form (frozen `api.ts:191` ↔ `ac_linux_link_tabs.h:18-20`; 13 R files use it), `ArdiaSettings`/`ArdiaImport` app names (`ac_linux_host.cc:676`), the Web Store label "Add to Ardia" | engines | frozen (`api.ts`), literal |
| H. Linux wire names | every `Ardia[A-Z]\w*` module token and `"Ardia<Module>.<method>"` string in `apps/linux/**`, `scripts/linux/**` in any form (quoted, template prefix, object key, property access, regex); `SHELL_PARTS`/`APP_PARTS` lines (`expo-modules-core.ts`, asserted by `test_notifications.py:98`) | Linux engine (`ac_linux_host.cc:3217-3233`, builds names at `:5199-5200`) | class (path-scoped) and line |
| I. uBO | the `ardia` prefix stripped in `scripts/linux/ubo-seed.mjs:84` and `ubo-seed.test.mjs` (`ardiaReloadPending`), `ubo.sh` | Linux engine, Mac fetch | literal, frozen |
| J. Plist and defaults names | `ArdiaPictureInPicture.plist` (`ac_pip_mac.mm:27` ↔ `ArdiaPiPController+SelfTest.mm:115`); every `AC*` Info.plist key except `ACFeedbackURL` and `ACReleaseNotesURL` (R41) | Mac engine | literal, class `\bAC[A-Z]\w*` |
| K. Files engine tests read by path | `work/ownership-v2/contract-files.tsv`: 85 files and 7 directories read directly (kinds `path`, `suffix`, `basename`, `joined-path` for Python `REPO / 'dir'` then `dir / 'file'` reads, `module`), plus 690 files in their recursive import closure (kind `imported-by-contract`, side-effect imports included). Only the direct rows are basename-protected; a transitive row may move only if every importer's specifier moves with it, and the engine suites prove it. `REQUIRED_CONTRACT` in the tool is a regression list of known contracts the scan must find (summary line "required contract paths missing: none"). Includes `ArdiaWebView+Navigation.mm` (`test_page_messages.py:103`), `state/live/{googleAuth,github,documents,sources}.ts`, `apps/linux/src/{hostSync,hostCredentials,fileCapabilities}.ts`, `scripts/linux/linux_formats.py` (imported, `test_platform_tooling.py:30`), `scripts/linux/{release.sh,symbolize.py}`, `scripts/agent/locked`, `docs/engine-build.md`, `apps/browser/windows/Ardia/Ardia.ico`, `infra/feedback/lib/{validate,ids}.mjs`, the CLI schema fixtures | engine tests | basename; content edits keep the asserted strings |
| L. Frozen fixture | `packages/sync/tests/fixtures/sealed-0.2.32.b64` (old protocol vector, `test_sync.py:14,61` ↔ `sync_scenarios.cc:163-172`) | Linux engine test | frozen; I adds a separately named Nilla vector |
| M. Asserted lines | `export const FEEDBACK_URL = "https://ardia.dev/api/feedback";` (`state/report/actions.ts`, `test_report.py:77`); `export const INGEST_KEY_HEADER = "X-Ardia-Key";` (`ingestKeys.ts`, `:79`); the `APP_PARTS` line; the asserted lines of `ArdiaWindowController.mm` and `pageEvents.ts` (`test_page_keys.py:46-48`); `PKGBUILD` has no `#`, has `'polkit'` and installs `usr/bin/ardia`, `usr/lib/ardia/chrome`, `polkit-1/actions/dev.ardia.linux.policy` (`test_platform_tooling.py:598-616`) | engine tests | line |
| N. Package and layout names | `Package: ardia` (`test_platform_tooling.py:555`), `bin/ardia`, `ardia/lib/ardia/`, `ardia-cli-<v>-linux-x64.tar.gz`, `ardia-cli-<v>/`, `ardia-cli.sha256`, `ardia-cli-install.sh`, `.../ardia/cli`, `kInstallerName`, `ardia.desktop`, `dev.ardia.linux` | engine tests, Linux engine | skip (the Linux packaging scripts and `apps/cli/install.sh`, `apps/cli/scripts/build.sh`). `linux_formats.py`'s permitted edits (Maintainer, Homepage, Description) are C-linux's in wave 3, the file's only owner; `test_platform_tooling.py:555` runs in C-linux's checks (R5) |
| O. Frozen files that use names R renames elsewhere | `work/ownership-v2/frozen-tokens.tsv`: `EngineApi.h` types `ArdiaEngineApi`, `ArdiaApp{Run,Start,Stop,PreTranslate,StartFailure}Function` (used by `Ardia.cpp`, `Launcher.cpp`, `EngineHostModule.h`, `Host.h`, `ImportModule.h`); `setLittleArdiaOpensNewTabLinks`; `ardiaPageColor` (offline game) | compile | literal (every form) |
| P. Windows engine | `Ardia.test-build` (`test_gate.h:9` ↔ `TestGate.h:15`), `ArdiaAppStartFailure` and the other `ArdiaApp*` exports, `ArdiaApp.dll`, the folder `apps/browser/windows/Ardia` and `Ardia.ico` (`series_win.py:328-329`, `ardia_resources_win.txt:1`), "no scratch ARDIA_DATA_DIR" (`main.cc:70` ↔ `TestGate.h`, `LaunchConfig.h`) | Windows engine build and runtime | frozen (`EngineApi.h`), basename, literal |
| Q. Engine-produced strings the app or tests match | " isn't allowed for the ardia command", "on a tab the ardia command didn't open", "Ardia couldn't take that tab off-screen.", "Ardia has no data folder", `ardia: ` and `[ardia] ` prefixes | CLI tests, Mac host, engines | literal; user-visible Ardia text here is a listed Layer 1 limit |
| R. The `ArdiaCore` interface | any token containing `ardiacore` in any case; `ARDIACORE_EXPORT`, `g_ardia_*`, `ac_*`, `AC*` engine classes, `ARDIACORE_PREBUILT_*`, `build-ardiacore`, `packages/ardiacore` itself | everything | class |
| S. Env and switches | every `ARDIA_*` and `--ardia-*` name, the dynamic `--ardia-` prefix | engines | class |
| T. Network header | `X-Ardia-Key` | engines, `infra/feedback` | literal |

How the list is maintained: wave 0 regenerates `contract-files.tsv`, the engine-literal files and `frozen-tokens.tsv`
with `ownership_v2.py`. The literal scan covers **every non-engine tracked text file**, whatever its owner or wave
(R3): `engine-literals.tsv` is the per-literal summary (326 literals at `e15125104`), `engine-literal-occurrences.tsv`
lists every match with path, line, column, length and the file's schedule (8,850 matches in 1,258 files), and
`engine-literals-excluded.tsv` lists the 101 engine literals the scan does not match by text (bare product names,
format and escaped strings, literals under 6 characters) with the class rule or hand check that covers each. The lead
classifies each literal as **protect** (same artifact on both sides; the default for anything unclear) or **rename**
(only the same words, for example a Mac-only copy of text the Linux engine also prints), and the protect/rename
manifest in `naming-allowlist.json` is generated from the full occurrence file, not from samples. Known false
positives (`.claude/settings.json`, `scripts/release.sh`, the demo favicon) are pruned by listed path. A Codex review
covers the classified list and the move table before R runs.

### 0.5 Where the reviews disagreed, and what was decided (checked against the code)

1. **Module prefix (C2, R1/F1).** Codex's blocker assumed a 4-letter "Nila" (`NilaTabs` → `abs`). With Nilla the fixed
   offsets in `nativeModules.ts:26` and `hostModules.ts:85-86` are correct, so neither contract file is rewritten.
   Kept from R1: the Linux path-scoped `Ardia[A-Z]\w*` rule (the Linux engine names modules), the `hostModuleName`
   mapping in R's own commit, and tests: `test:host` requires `NillaPasswords`, `NillaSync` and a `<Module>.call` and
   asserts the host receives `Ardia*`; a `nativeModules` test checks every Mac/Windows module maps to its domain.
2. **Independence (C5 versus `plan.md` §0.11, D12, §2.6).** Codex wins, by owner decision 2. Layer 1 isolates on the app
   side (§0.2); D12 ("accept that Linux uses Ardia's folder and salt") is withdrawn.
3. **Daily ping (C9, R17).** Deleted, not consent-gated (D23).
4. **Apache-2.0 4(b) (C12).** The owner settled it: a NOTICE statement plus git history, no per-file notices. The
   history must survive, so the stack and the `nilla/*` branches merge with merge commits.
5. **CI artifacts (R22 versus D22).** R22 wins: CI uploads **logs and smoke results only**, never an installable
   artifact. The owner's D2 says no tester hand-out, and a short retention still distributes a binary; a public app
   commit also does not identify the exact source of the older `--nearest` engine inside it. Private binary artifacts
   need the owner's explicit approval first, and then access controls and a recorded engine source per artifact (D22).
6. **What M deletes (C6, R7).** `PhoneLegacy.kt`/`.swift`, `LegacyModule` and `UpgradeGate.kt` are the upgrade from
   Ardia's earlier Compose app (`docs/phone.md` "Upgrade from the Compose app"), not the Netnyahoo → Ardia migration.
   Deleting them takes the phone's whole import state machine (`state/legacy/*`, the gate in `SyncWorker` and the
   browsing source) with them, which only a phone build verifies. M deletes the Netnyahoo migration closure only. The
   Compose importer stays, inert (a new `applicationId` and app group mean no Compose source exists), and its removal
   is its own PR (§5). C6's dangling-dependant problem disappears with it, because `PhoneLegacy` is no longer deleted.
7. **The Mac sync constants (R7).** R7 had M inline the old values into `SyncCrypto.swift`. That adds a "netnyahoo"
   literal to a non-migration file, which the conventions ratchet reports as new. Instead I detaches
   `SyncCrypto.swift`, `SecretStore.swift` and `SyncModule.swift` from `LegacyName`/`Renamed` first, with Nilla
   values, and M commits after that (§2.4).
8. **The `services.feedbackUrl === FEEDBACK_URL` rule.** Deleted (R18): it would re-enable ardia.dev on Linux.
9. **Services override (C11, R15).** No `NILA_SERVICES_FILE`. Mac and Windows tests pass `services=<path>` as an
   `ARDIA_TEST` key; the launch configs already ignore `ARDIA_TEST` outside authorized test instances
   (`ArdiaLaunchConfig.mm:221,289-291` `testValue` returns nil; `LaunchConfig.h:201-208` drops the keys). I owns the three key lists in wave 1 (`launchEnv.mjs`
   `TEST_KEYS`, `ArdiaLaunchConfig.mm` `AppTestKeys()`, `LaunchConfig.h` `TestKeys()`, plus `launchEnv.test.mjs`) and
   adds `services` to all three by S's hand-off; S owns the readers. Linux tests only the null defaults
   (`hostLaunchConfig.ts:11` hardcodes `testInstance:false`); node tests use a test-only setter (§2.3 B).
10. **Upstream issue numbers (R26, D21).** Stripped, not linked.
11. **DMG fonts (R32, D24).** Default: system fonts. W drops Mona Sans and Martian Mono, and changes both
    `background.html`'s font stack and `render.sh:22-25`'s load assertion to the system face. Fetching the fonts' OFL
    texts is an outside download, so it happens only with the owner's separate approval; if approved, the exact OFL
    texts and copyright lines ship beside the fonts and in the DMG.
12. **New Tab hills.** The manifest marks the redrawn hills "optional"; the owner chose them, so B applies them.
13. **CLI names.** `nilla-browser` (not `nilla`): `bin/nilla-browser` beside the kept `bin/ardia` inside the Linux
    tarball only (R11), module `nilla_browser_cli` moved by R (R29) in the same commit as its producer,
    `apps/cli/scripts/build.sh` (OWNER-CLI). Installed links, homes and acquisition: §0.2 CLI rows.
14. **Windows AUMID.** `NillaDigital.Nilla` (owner), replacing `plan.md` D19's `NoorChasib.Nila`.

### 0.6 Other settled findings (from `plan.md` §0, still true)

- `infra/feedback` can't be deleted: `test_report.py:66,75` read `lib/validate.mjs` and `lib/ids.mjs`. It stays a
  dormant, self-contained template (§2.3 B).
- `packages/ardiacore/ios/page_script.js` is compiled into the Linux engine, so it is frozen.
- The site isn't a leaf: `packages/shaders` builds the app's meadow from site sources; `scripts/dmg/background.html` uses
  its fonts and icon; `scripts/lib/release-note.mjs:38` reads its release videos; `test:root` runs `./apps/site/src`;
  `apps/linux/vite.config.ts:71-79,113,117` aliases `@ardia-site/meadow` and excludes its folder from esbuild;
  `killSwitches.test.mjs:36` reads `site/public/switches.json`. W moves the meadow first, keeping its relative tree; S
  moves `switches.json`.
- The whole `ARDIA_*`/`--ardia-*` namespace stays until Layer 2 (27 of 138 names are engine-read, and two paths
  forward by prefix).
- `docs/brand/ardia/` stays until Layer 2: `offline-game-pipeline/gen.sh:7` reads `source/mark.png`.
- No icon remapping and no migration of saved choices: Nilla has no users, so unknown ids fall back to the default.
- The Mac Sparkle off switch is sound: empty `SUFeedURL` and `SUPublicEDKey` block starts and manual checks
  (`AppUpdater.swift:197-235`).
- `engine/engine-key.sh:10` covers `engine`, `apps/browser/assets/offline-game` and `offline-game-pipeline`; X-layer2
  holds all three and `scripts/windows/engine`.
- **New: `apps/browser/src/conventions-baseline.json` is a per-file ratchet.** Both a higher count ("new") and a lower
  one ("fixed") fail `conventions.test.mjs` (`:500-509`). Every wave changes counts, so the lead owns the file
  (§2.5).

---

## 1. Owner decisions

**Settled, not reopened:** rename everything in two layers; an independent app with no migration; `Nilla.app` and
Nilla-named artifacts; "Little Nilla" and "Nilla Sync"; the CLI command `nilla-browser`; no domain in use yet (every
ardia.dev URL behind one disabled config); services off; governance removed; CLA.md deleted; NOTICE layout with
"Copyright 2026 Noor Chasib"; testimonials and Ardia's benchmark claims removed; the Highland icon with 23 switchable
alternates; the redrawn New Tab hills; a new sync salt and magic; Apache-2.0 4(b) met by NOTICE plus history; D4 deletes
the site, dashboard, videos and their hosting (infra/feedback stays dormant); the phone hill-climb is its own PR;
merge commits for the stack. Nilla is a personal, non-commercial project: no store listings and no trademark work, and
still no wafer or vanilla imagery.

### D1-D8 (answered)

| # | Decision | Answer |
| --- | --- | --- |
| D1 | Reverse-DNS prefix | `com.nilladigital`, products `com.nilladigital.nilla...`, full-prefix Kotlin packages. Kept in as few places as the platforms allow (§2.3 C) |
| D2 | Layer 1 builds are development builds only | Yes: no release, appcast, store upload or tester hand-out. CI uploads logs and smoke results only (D22, R22) |
| D3 | Engine for Layer 1 | `engine/` untouched; build against the nearest published engine (`--nearest`). The fork's `engine/` is 71 files past the newest pin, so app calls to newer `ac_*` functions may fail on it; §2.6 records such gaps as existing, not rename bugs |
| D4 | Site, dashboard, videos, infra | Delete `apps/site`, `infra/site`, `apps/dashboard`, `infra/dashboard`, `infra/telemetry`, `infra/hexclave-cli`, `infra/shared.ts`, `infra/lib.sh`, `deploy.yml`, `apps/videos`, `.claude/skills/elevenlabs`, after moving what other code needs. Keep `infra/feedback` dormant and `packages/demo` |
| D5 | Phone app | Kept, with Nilla ids, uploaded nowhere |
| D6 | Dia parity | Stays the product goal; `docs/dia-feature-parity.md` and `dia-spec.md` stay |
| D7 | AGENTS.md rules | Keep the engineering rules; "commit straight to main" becomes branches plus PRs; agents never publish releases until the owner grants it; upstream issue numbers go; Codex second opinion stays; Boat VMs only if the owner has an account; "AI only through the plugin" stays as the owner's rule |
| D8 | Contribution terms | No CLA; inbound equals outbound (Apache-2.0 §5) in CONTRIBUTING; optional DCO, not enforced |

### D20-D25 (lead defaults; the owner may override)

| # | Decision | Default |
| --- | --- | --- |
| D20 | Copyright holder | "Noor Chasib" everywhere (confirmed by the owner): NOTICE, About, Windows `LegalCopyright` (Layer 2), new-file headers, CONTRIBUTING. readme-docs-license's "and the Nilla contributors" and "The Nilla Authors" are superseded |
| D21 | Upstream issue numbers | Stripped from AGENTS, CONTRIBUTING, README and the living docs; history keeps them under one header line naming the upstream repo |
| D22 | CI artifacts in Layer 1 | Logs and smoke results only (`nilla-dev-<sha>-<what>-logs`); no installable artifact on any platform (R22, §0.2). Private binary artifacts only if the owner approves them later, with access controls and the matching engine source recorded per artifact |
| D23 | Daily ping | Deleted |
| D24 | DMG fonts | System fonts by default; Mona Sans and Martian Mono are dropped and `render.sh`'s font assertion follows. Keeping them needs the owner's separate approval for the OFL fetch, then the exact OFL texts and copyright lines ship with them (R32) |
| D25 | Raycast extension | Keep its declared MIT terms; add an MIT `LICENSE` naming the upstream author (`mantrakp04`, Mantra Patel, with contributor `ridemountainpig`) and Noor Chasib for the changes; never published |

### Needed before the first public Nilla release (Layer 2 timeframe)

| # | Decision | Recommendation |
| --- | --- | --- |
| D9 | GPL Corresponding Source | Every release carries its engine source archive per platform (`engine-source.sh` covering `helium-chromium`, `helium-macos` and `helium-linux` plus the Linux patch set), never only a link |
| D10 | "Modified" notices | Settled for Layer 1 (NOTICE plus history). Layer 2 adds no per-file lines; new engine files get `Copyright 2026 Noor Chasib. Apache-2.0.` |
| D11 | Env and switch rename | All `ARDIA_*`/`--ardia-*` become `NILLA_*`/`--nilla-*` in Layer 2 |
| D13 | `ac_`/`AC` prefixes | `nc_` and `NC` (NillaCore) |
| D14 | Offline game | Ardia brand art (`prompts/notice.txt`): drop it in Layer 2 or commission new art; drop first |
| D15 | Apple team, Sparkle key, notarization key, Android keystore, Authenticode | Only for public builds. The checklist also includes the phone's Apache text and NOTICE page under Open Source Licenses |
| D16 | Update host | GitHub Releases on `NoorChasib/nilla` (appcast, Windows manifest, Linux list); no server |
| D17 | Repo settings | Issues on (bug form), Discussions on. Mac CI on `vars.MAC_RUNNER`/`vars.XCODE_APP`. Windows CI fetches the engine with `-Repository ${{ vars.WINDOWS_ENGINE_REPO \|\| 'ardia-browser/ardia' }}`, so Layer 1 uses upstream's pinned engine (owner decision 4) and Layer 2 sets the variable; engine-dependent checks are reported unverified only when the fetch itself fails (E9) |
| D18 | Version | `0.1.0` from Layer 1 |
| D19 | Smaller items | No Homebrew tap. Raycast kept, unpublished. Linux maintainer `Noor Chasib <NoorChasib@users.noreply.github.com>` unless the owner gives an address. iOS privacy URL: `PRIVACY.md` in the repo. Helium's live bang list stays (credited). Report a Problem opens a GitHub issue draft. Layer 1 desktop shows `ardia://`. Ardia's release notes and perf history move to `docs/history/ardia/`; `docs/audit/` stays byte for byte as a dated record, and its provenance line lives in D's new `docs/history/ardia/README.md` (R26) |

D12 is withdrawn (§0.5 item 2).

---

## 2. Layer 1: everything outside the engine interface (branch `nilla/layer1`)

### 2.1 Ground rules for every Layer 1 agent

- **The boundary.** Never edit or stage the frozen paths (`work/ownership-v2/X-layer2.txt`, 1,107 files at
  `e15125104`): `engine/**`, `scripts/windows/engine/**`, `apps/browser/assets/offline-game/**`,
  `apps/browser/assets/offline-game-pipeline/**`, `docs/brand/ardia/**`, `packages/ardiacore/{prebuilt-engines*.tsv,
  scripts/fetch-engine.sh, scripts/ubo.sh, ios/page_script.js, src/engine/api.ts}`, `scripts/{engine-source.sh,
  windows/fetch-engine.ps1, windows/engine-source.sh}`, `scripts/linux/{ardia.apparmor, ardia-launch,
  dev.ardia.linux.policy}`, `apps/browser/windows/Ardia/EngineApi.h`, `packages/sync/tests/fixtures/sealed-0.2.32.b64`.
  `ArdiaWindowController.mm` and `pageEvents.ts` are contract files, not frozen (R6).
- **The contract list (§0.4)** is binding on every agent, not only on R.
- **Text never renamed:** `LICENSE`, `LICENSE.Apache-2.0`, `third_party/**`, both `THIRD_PARTY_NOTICES.txt`; Ardia's
  verbatim NOTICE block; copyright, SPDX and Helium headers; the credit spans (README Acknowledgements, About "Based on
  Ardia", the phone `DataPages.tsx` Ardia row, the Raycast contributors, the NOTICE Ardia block); `docs/history/**`,
  `docs/perf/0.2.*`, `docs/audit/**`; the false-positive words (guardian, ancardia, lombardia, cardiac); the 8
  upstream engine-fetch default lines (naming §4.8); the "Ardia Ltd" SQLite fixture; and, once C-mac adds it in wave 3,
  the Ardia import source's name and ids (`ardia`, "Ardia", `com.ardia.browser`, `com.ardia.browser/Chromium`,
  "Ardia Safe Storage"). No Ardia import source exists at `e15125104`; it is new work (§2.3 wave 3, C-mac).
- **Generated files are never hand-edited** (R27): `ardia-core.js`, `ardia-sync.js`, the meadow outputs
  (`packages/shaders/ios/Meadow/**`, `packages/shaders/windows/meadow/page.ts`) belong to the lead, who regenerates them
  at the end of each wave (§2.5). Their `--check` steps fail between a source change and that regeneration; that is
  expected, and no agent "fixes" it by editing the output.
- **One owner per file per wave.** An agent stages only the paths its `work/ownership-v2/<owner>.txt` lists for its wave
  (`schedule.tsv` gives each file's waves) plus the new files its brief names. Edits another owner needs are written
  into briefs up front (`handoffs.tsv`), so no agent waits on another. The checkout is shared and worktrees are
  forbidden: stage explicit paths, check `git diff --cached --stat` lists only your files, run a bare
  `git commit -m ...`, never `git commit -- <paths>`. For a file that also holds someone else's uncommitted hunks, stage
  a blob (AGENTS.md).
- **Engine key identical at every commit:** `engine/engine-key.sh HEAD` equals `engine/engine-key.sh <base>`, and
  `git diff --stat <base> -- $(engine/engine-key.sh --paths) scripts/windows/engine` is empty.
- **No comments** in any file the plan adds or edits, scripts included, inside or outside the repo (`tools/*.py`, the
  rename tool, `nilla-dev-run`, the gate). Only shebangs, licence headers, tool directives and `--help` headers stay.
  Never strip a licence header.
- **Commits** follow the repo's "Area: sentence" style and carry no attribution lines. One commit per step, so each
  check bisects.
- **Isolation.** Each agent gets `~/ardia-work/nilla-build/<agent>/DerivedData`, its own `ARDIA_DATA_DIR`
  (`~/ardia-work/nilla-build/<agent>/data`, the variable keeps its name) and remote-debugging port 9300 plus its index.
  Hidden instances only. Never touch `/Applications/Ardia.app` or the owner's profiles. Windows and Linux builds,
  installers and packages run only inside disposable OS isolation (CI runners, throwaway VMs, a scratch-`$HOME`
  namespace), never on a host or account with an Ardia profile (§0.2).
- **Instrumentation.** AGENTS.md's "instrument what you ship" becomes: record events and list them in What's Sent; they
  go nowhere while `services.ts` has no endpoint.

### 2.2 Ownership and scheduling

`tools/ownership_v2.py` replaces `tools/ownership.py`. It keeps ownership exclusive inside a wave and schedules a file
into later waves when it needs more work (C7/F8): a retained G, W or D file that still has Layer 1 names goes to R in
wave 2 and to its area owner in wave 3. It also computes the closures of what wave 1 deletes or moves (C6/F7).

Run (wave 0, on the real base):

```
python3 -I tools/ownership_v2.py /home/noor/Code/ardia <base> work/census.tsv work/ownership-v2
```

Outputs: `<owner>.txt`; `schedule.tsv` (each file's waves, owners and actions); `contract-files.tsv`; `closure.tsv` and
`handoffs.tsv` (every reference to a deleted or moved path or symbol, every test that reads a native file a wave-1
owner edits, and who edits it); `moves.tsv`; `frozen-tokens.tsv`; `engine-literals.tsv`,
`engine-literal-occurrences.tsv` and `engine-literals-excluded.tsv` (§0.4); `summary.txt`.

**When it runs (E3, E7).** Twice: in wave 0 on the base, and after wave 1 on that HEAD, each time right after
`tools/naming_census.py` regenerates `work/census.tsv` (hits are keyed by path, so files moved or created in wave 1
fall out of R's list unless the census is rerun first). The census reads three engine-derived inputs
(`work/eng_switches.txt`, `eng_env.txt`, `iface_lits.txt`) that have no generator in `tools/`; they are reused only while
`engine/engine-key.sh HEAD` equals the value they were made at (`2d8afa2a646d...`), and the lead regenerates them by
hand from `engine/` if it ever differs. It is **never rerun after wave 2**: its rules name pre-rename paths, so on the
renamed tree every C-* list would come out nearly empty. After R, `tools/remap_lists.py` rewrites the wave 3 lists
through R's move map instead (§2.4).

What it checks:
- **Closure.** For each deleted or moved path it looks up the path, its suffixes, its stem, its package name, every file
  that imports it by a relative specifier (resolved against the importer's folder, side-effect imports included) and,
  for M, the symbols the deleted files declare (same language only, so a Swift `enum Renamed` doesn't match JavaScript
  test titles). Generic keys are not used (E6): `parent/stem` keys become `grandparent/parent/stem` when the parent is a
  common folder name (`scripts`, `assets`, `videos`, ...), dotted parents (host-shaped folders such as `signin.example`)
  and web-standard names (`apple-touch-icon`, `favicon`) give no key, and a package name counts only when scoped or
  hyphenated. Every hit is owned by the deleting agent in the same wave, handed to that file's wave-1 owner as a written
  edit, or, for prose, scheduled for wave 3. The lead reads every `closure.tsv` row with action `edit` before wave 1
  starts.
- **Native-file tests (E4).** For every native file (`.h`, `.cpp`, `.mm`, `.swift`, `.kt`, `.iss`, `.plist`,
  `.entitlements`, `.ps1`, `.xcconfig`, `.gradle`, `.pbxproj`) a wave-1 owner edits, every test that names its basename
  goes to the same owner in the same wave, or gets a hand-off row if another wave-1 owner holds it. Callers that the
  name scan cannot see are listed in the rules by hand (I's CLI modules and tests that call `installed_data_dir()`).
- **Lockfiles, generated outputs and Mac-only files** belong to the lead (`L-lead`, 22 files): the `bun.lock` and
  `Podfile.lock` files, `conventions-baseline.json`, `apps/phone/src/state/settings/credits.json`, `ardia-core.js`,
  `ardia-sync.js`, the meadow outputs, `scripts/dmg/DS_Store` and `scripts/dmg/background.tiff`. Lockfiles inside a
  folder W deletes are W's (4).
- **Sequencing inside wave 1.** `SyncCrypto.swift`, `SecretStore.swift` and `SyncModule.swift` belong to I, and M's
  deletion commit lands after I's detach commit (§0.5 item 7).
- **R skips** 11 hand-edited files (`R_SKIP_HAND`: the Linux packaging scripts, `apps/cli/install.sh`,
  `apps/cli/scripts/build.sh`), scheduled straight to C-linux or C-cli-extras, and the sync-vector tree
  (`R_SKIP_TREE`, I's, regenerated on the Mac). The one exception: R hand-edits `build.sh`'s module references in its
  module-move commit (`R_HAND_IN_COMMIT`, OWNER-CLI).
- **Lists decide ownership, not area names (E10).** The wave 3 area column in §2.3 is a summary; `WAVE3` in the tool
  matches C-mac first, so `packages/ardiacore/**` and `packages/sync/**` (their `src/` included) are C-mac's, and the
  `<owner>.txt` files are binding.

Numbers at `e15125104` (8,007 tracked files; 2,886 with Layer 1 hits), after the verification fixes of 2026-11-18:

| Owner | Wave | Files | Files with L1 hits | L1 hits |
| --- | --- | --: | --: | --: |
| M-legacy | 1 | 28 | 20 | 305 |
| G-governance-ci | 1 | 140 | 54 | 560 |
| W-web-surfaces | 1 | 946 | 224 | 1,675 |
| S-services | 1 | 302 | 108 | 974 |
| I-identity | 1 | 155 | 98 | 1,434 |
| B-brand | 1 | 114 | 7 | 8 |
| D-docs | 1 | 150 | 8 | 486 |
| R-mechanical | 2 | 2,594 | 2,594 | 20,023 |
| C-mac | 3 | 506 | 506 | 4,549 |
| C-ui | 3 | 699 | 699 | 2,954 |
| C-phone | 3 | 656 | 656 | 2,846 |
| C-linux | 3 | 272 | 272 | 2,040 |
| C-windows | 3 | 221 | 221 | 1,495 |
| C-cli-extras | 3 | 159 | 159 | 2,850 |
| C-repo-docs | 3 | 94 | 93 | 3,754 |
| L-lead | – | 22 | 10 | 143 |
| X-layer2 (frozen) | – | 1,107 | 15 | 76 |
| X-keep | – | 25 | 2 | 4 |

- Overlaps inside a wave: wave 1 **0**, wave 2 **0**, wave 3 **0**.
- Files with Layer 1 hits and no schedule: **0**.
- Retained G/W/D files with hits: 52. Scheduled for R or wave 3: 47; written final by D: 4; archived by D: 3;
  unscheduled: **0**.
- Schedules: 2,331 files run in waves 2 and 3; 1,568 only in wave 1 (mostly deletions, plus the 47 sync-vector files);
  263 in waves 1, 2 and 3; 4 in waves 1 and 3 (R skips them); 9 only in wave 3.
- Wave 1 deletes 985 files (M 15, G 71, W 899) and moves 210 (no file is both moved and deleted).
- Closure: 25 rows for M, 79 for G and W, 8 native-file test rows; 22 hand-offs (14 computed, 8 written into briefs).
- Contract paths: 85 files and 7 directories read directly, 690 in their recursive import closure; 33 more direct
  files than `plan.md`'s list, none dropped; required contract paths missing: none.
- `frozen-tokens.tsv`: 9 rows. Engine literals: 326 found in Layer 1 files, 8,850 occurrences in 1,258 files, 101
  excluded with reasons.
- Every Layer 1 entry of the branding manifest with a current path is in `B-brand.txt`, except `docs/brand/ardia`
  (frozen, §0.6).

The C-* names: `C-repo-docs` is `plan.md`'s C-docs-tooling (docs, remaining scripts and root files).

### 2.3 Phase briefs

Each brief lists: files, why it matters, what to do, protected strings, checks and risks. The file lists are
`work/ownership-v2/<owner>.txt` regenerated at the base.

#### Phase A, owner G: governance and CI (wave 1)

**Why:** upstream's vouch, CLA, review-bot and release machinery would act on the fork, and the workflows still name
upstream identities.

- **Delete:** `.github/workflows/{cla,linked-issue,vouch-check-pr,vouch-manage,deploy}.yml`, `.github/vouch/**`,
  `.github/TEAM.td`, `.github/VOUCHED.td`, `CLA.md`, `.coderabbit.yaml`, `.claude/skills/{stats,elevenlabs}/**`,
  `.claude/skills/release/SKILL.md` and `references/`, `scripts/{stats.mjs, stats/**, telemetry-env.mjs,
  telemetry-sql.mjs, update-checks.mjs, replay.mjs}`.
- **Move the release scripts (R21):** the `.claude/skills/release/scripts/` tree goes to `scripts/release/`, except
  `site-version.mjs`, `update-tap.sh` and `rollout-everyone.sh`, which are deleted and appear in no move row
  (`moves.tsv` and the delete list are disjoint). In the same commit: repoint
  the callers (`release.yml:438,440`, `scripts/release.sh:225`, `scripts/lib/releases.sh:6`,
  `.github/release/check-sparkle.sh`, `apps/browser/scripts/air-traffic-test.mjs`, `little-ardia-links-test.mjs`; the
  last two are G's by hand-off); remove the `update-tap.sh` call and the ardia.dev probes (`publish.sh:133,136,150`),
  the `RELEASE_NOTES_URL` ardia.dev default, the legacy Sparkle-account search (`release.sh:55-62`) and the `ardia`
  notary profile default (`scripts/release/lib.sh:9`). Upstream release text goes too, not only the probes: the nightly
  notes line (`publish.sh:123`, "Ardia-Nightly.dmg (https://ardia.dev/nightly)") and the closing hint
  (`scripts/release.sh:225`, "the feed and ardia.dev/nightly follow"); G greps the moved tree for `ardia.dev` and
  `Ardia-` artifact names and rewrites or removes each one. Release entry points refuse **before building or signing**
  (R21): `scripts/release.sh`, `publish.sh`, `publish-alpha.sh` and the `release.yml`, `ios-release.yml` and
  `android-release.yml` jobs exit first with "Releases aren't set up for Nilla yet" unless a `NILLA_RELEASES_ENABLED`
  repo variable is set, which Layer 1 never sets. G never runs `publish-engine.sh --upload` or `publish_engine.py` with
  upload (R43).
- **Hand-offs G applies** (`handoffs.tsv`): M's removal of the `legacy-name.sh` calls from `scripts/release.sh`,
  `scripts/release/package.sh`, `smoke.sh`, `channel-test.sh` and `update-test.sh`; W's removal of the release-video
  check (`scripts/lib/release-note.mjs:38`, `release-note.test.mjs`, `scripts/release/notes.sh`), the `apps/videos`
  and `apps/site` entries in `package.json` and `scripts/check-all.sh`, the site and nginx lines in
  `scripts/lib/repo.test.mjs:10-11`, and the `infra/site` reference in `publish.sh`. `release-note.test.mjs` must pass on
  an empty release-notes folder.
- **Gate jobs:** remove the `gate` job and its `needs:`/`if:` lines in `ios.yml`, `android.yml`, `linux.yml`,
  `windows.yml` (keep Windows' `depth`/`full-ci` step); `checks.yml:14,69-71`; `package.json` `test:vouch`;
  `windows.yml:21` and `android-release.yml:54` (`t3/...` branches).
- **Repo constants (E8):** keep the names `REPO` and `REPO_URL` and change only the value: `REPO="NoorChasib/nilla"`
  (`scripts/lib/releases.sh:1`) and `export const REPO = "NoorChasib/nilla"` (`scripts/lib/repo.mjs:1`), so the frozen
  `scripts/engine-source.sh:8,37`, `scripts/linux/release.sh:187` (contract), `scripts/publish-engine.sh:88-96`,
  `apps/phone/scripts/release-ios:42` and the asserted `-R "$REPO"` line (`symbolicate-crash.test.mjs:298`) keep
  working unedited. Add a new `ENGINE_REPO="ardia-browser/ardia"` beside them in `releases.sh` and use it only in
  `release.sh:134` (engine-source link) and `symbolicate-crash.sh`, the two G files that mean the engine's repo.
  Accepted consequence: the frozen `engine-source.sh` prints `NoorChasib/nilla`'s tree URL in Layer 1; its engine-source
  meaning returns in Layer 2. CI passes `-Repository ${{ vars.WINDOWS_ENGINE_REPO || 'ardia-browser/ardia' }}` to
  `fetch-engine.ps1` explicitly (`windows.yml:404`).
- **Identity from variables:** team `vars.APPLE_TEAM_ID` (`signing.sh:49-50`, `release.yml:261`); `runs-on: ${{
  vars.MAC_RUNNER || 'macos-26' }}` (9 uses of `xcode-27`), `DEVELOPER_DIR` from `vars.XCODE_APP`;
  `ANDROID_RELEASE_SIGNER` from `vars`; the iOS privacy URL from `vars`; drop the Homebrew tap step
  (`release.yml:425-436`). Windows engine-dependent steps run on upstream's pinned engine (D17, E9); only if the fetch
  itself fails do they print the reason and report the install and AUMID checks as **unverified**, not passed.
- **Artifacts (D22, R22):** remove every `upload-artifact` of an installable output (tarball, deb, AppImage, Arch
  package, CLI tarball, setup exe, app folder, `.app`, `.apk`, `.ipa`; `linux.yml:198-215`, `windows.yml:149,279,290,
  384-390`, the others). What stays uploads logs and smoke results only, named `nilla-dev-${{ github.sha }}-<what>-logs`
  with `retention-days: 3`. A check step fails the job if an upload path matches an installable extension. No release
  job runs in Layer 1.
- **Templates:** `ISSUE_TEMPLATE/config.yml` points at `NoorChasib/nilla` Discussions; `bug_report.yml` reworded for
  Nilla (keep the Dia line, D6); `pull_request_template.md` makes `Closes #` optional.
- **Root files:** `package.json` drops `test:vouch`, the `!apps/site` exclusion and `./apps/site/src` from `test:root`;
  `scripts/check-all.sh` drops `apps/dashboard`, `apps/videos`, `apps/site`; `caches.yml:54` drops
  `bun-install-hexclave-`. The `@ardia/*` filters, the Raycast path (`package.json:27`) and the workspace and project
  paths in workflows (`ios.yml:101,133`, `windows.yml:114,121,256,341-342`, `checks.yml:62`, `linux.yml:127`) are R's
  in wave 2 (R8).
- **Checks:** `bun run test:portable`; `bun run check`; `actionlint` on the workflows if installed, else CI;
  `git grep -n -w -E 'vouch|TEAM\.td|VOUCHED|coderabbit|cla\.yml|linked-issue|Bonzai|full-send|hexclave' -- .github
  scripts package.json ':(top,glob)*'` (case-sensitive, word boundaries, G's own scope; E13) is empty, and
  `git grep -n 'xcode-27' -- .github scripts` lists only the cache keys `swiftpm-xcode-27.1` (`ios.yml:128`,
  `scripts/ci/prune-caches.test.mjs:46-47`), which are names, not runner pins. `packages/core/src/bangList.ts:392`
  (`VoucherCodes`), `ardia-core.js` and the docs (`docs/{linux-ci,phone,testing,windows}.md`, wave 3) are out of scope;
  a release-entry check runs `scripts/release.sh` with no variable set and expects the refusal before any build step. `bun install --frozen-lockfile` fails until the lead regenerates lockfiles at the end of wave 1;
  that is expected.
- **Risk:** `pull_request_target` workflows run from the PR's base, so deleting them doesn't stop them on the stack. The
  lead disables them in repo settings first (§5 step 1).

#### Phase A, owner W: web surfaces (wave 1)

**Why:** D4 deletes Ardia's site, dashboard and videos, which carry upstream marketing, testimonials, legal pages,
benchmark claims and hosting config. Other code depends on parts of them, which move first.

- **Move first** (`moves.tsv`, R9), keeping the site's relative tree under one new root `packages/shaders/meadow-src/`
  so no relative import or glob changes: `apps/site/src/scripts/meadow/**` → `meadow-src/scripts/meadow/**`,
  `scripts/meadowApp.ts` → `meadow-src/scripts/meadowApp.ts` (its `./meadow/*` imports, `:1-3`, still resolve),
  `data/heroPoster.ts` and `data/heroFrames.mjs` → `meadow-src/data/` (its `../assets/hero/posters.json` import and
  `import.meta.glob("../assets/hero/*.webp")`, `:1,18`, still resolve), `assets/hero/**` → `meadow-src/assets/hero/**`.
  Then every path that names the old root, in the same commit:
  - `packages/shaders/scripts/meadow.mjs`: `site = join(repo, "apps/site/src")` (`:33`) →
    `join(repo, "packages/shaders/meadow-src")`,
    and its help text (`:2-12`) and messages (`:175,178`); `posterDir` (`:38`), the glob shim's `"../assets/hero/"`
    (`:58`) and the bundle entries `data/heroPoster.ts` (`:60`) and `scripts/meadowApp.ts` (`:139`) stay as they are,
    because they are relative to `site`.
  - `packages/shaders/turbo.json:6`: drop the four `$TURBO_ROOT$/apps/site/...` inputs (the new folder is inside the
    package, so `$TURBO_DEFAULT$` covers it).
  - `apps/linux/vite.config.ts`: `siteMeadow` (`:71`) → `here("../../packages/shaders/meadow-src/scripts/meadow/")`, the
    plugin's prefix test (`:79`), the alias (`:113`, `@ardia-site/meadow/(scene|clock|cycle)`, name kept for R) and the
    esbuild exclusion regex (`:117`, `/\/apps\/site\/src\/scripts\/meadow\//` →
    `/\/packages\/shaders\/meadow-src\/scripts\/meadow\//`).
  - `apps/linux/src/shims/web/gl/meadow.ts:89-91` and `apps/linux/src/shims/site-meadow.d.ts` import through the alias,
    so they need no path change; they stay W's so a rename of the alias in wave 2 has one prior owner.
  - `scripts/typescript-version.test.mjs:8` drops `apps/dashboard` and `apps/videos` (closure row).
  All of these files are W's in wave 1 (`W-web-surfaces.txt`).
- **`switches.json` is S's, not W's:** S moves `apps/site/public/switches.json` to
  `apps/browser/src/platform/fixtures/switches.json` (`moves.tsv`, owner S) in the same commit as the
  `killSwitches.test.mjs:36` path change.
- **DMG background (R28, R32):** the two `woff2` fonts are deleted with the site (system fonts by default, D24).
  `scripts/dmg/background.html` switches to the system font stack, takes its icon from B's
  `apps/browser/assets/app-icon.png`, and its word and tagline become Nilla's; `scripts/dmg/render.sh:22-25` asserts the
  system face instead of "Mona Sans Variable" and "Martian Mono Variable". Those source edits and a portable check
  (`bash -n render.sh`; the HTML names no font file under `apps/site`) are W's in wave 1. Rendering
  `scripts/dmg/background.tiff` needs `sips` and `tiffutil` (`render.sh:30-34`), so it is the Mac session's in wave 4
  (`L-lead.txt`, §2.6 Mac).
- **Hand-offs W writes into others' briefs:** G (release videos, package.json, check-all, repo.test, publish.sh); S
  (`infra/feedback` tests that read deleted infra).
- **Delete (D4):** `apps/site`, `apps/dashboard`, `apps/videos`, `infra/{site,dashboard,telemetry,hexclave-cli}`,
  `infra/shared.ts`, `infra/lib.sh`, `docs/growth.md`, `docs/dashboard-triage.md`, `docs/dashboard-settings.md`.
  `apps/site/src/data/legal.ts` (upstream's operator and email) and `voices.ts` (testimonials) go with the site and are
  never reworded. AGENTS.md's Dashboard section goes in D's rewrite.
- **Checks (R9, E13):** before B's icon commit lands, `node packages/shaders/scripts/meadow.mjs --check` passes on the
  moved tree (proves the move changed nothing in the outputs); `bun run --cwd apps/linux build` (the alias and the
  exclusion); `bun run --cwd apps/linux test:graph`; `bun run test:root`; `git grep -n -E 'apps/site|@ardia-site'` lists
  only the alias name and history. W doesn't wait for B: if B's icon is already in, W runs `meadow.mjs` without
  `--check` into a scratch copy and diffs only the non-icon files. After B and W commit, the lead runs
  `bun run --cwd packages/shaders meadow`, commits the outputs, and reruns `--check` and the Linux build; the deletion
  is complete only then.

#### Phase M: legacy migration (wave 1)

**Why:** Ardia carried a Netnyahoo → Ardia rename migration. Nilla has no predecessor, and the code names upstream's
old app, bundle id and keychain items.

- **Files** (`M-legacy.txt`, 28): delete `packages/sync/ios/Core/{LegacyMigration,LegacyMigrator,LegacyDockTile,
  DocumentRewriter}.swift`, `packages/sync/tests/{LegacyMigrationTests,LegacyDockTileTests,LegacyKeychainTests}.swift`,
  `packages/sync/tools/legacy-migration/**`, `packages/sync/scripts/legacy-migration-*`, `apps/browser/src/lib/legacy.ts`
  and its test, `packages/sync/src/companion/legacy.ts`, `scripts/lib/legacy-name.sh` and `legacy-name.test.mjs`.
  Edit `packages/sync/Package.swift` (drop the `legacy-migration` product and `LegacyMigrationTool` target),
  `packages/sync/package.json:12` (drop the e2e call), `apps/browser/macos/Ardia-macOS/main.swift:10-16`,
  `AppDelegate.swift` (the Dock tile), the 4 importers of `lib/legacy` (`bookmarks.ts:2` with `LEGACY_BOOKMARK_SEED`,
  `settings.ts:19`, `sync/adapters.ts:10`, `sync/settingsAdapter.ts:4`), `scripts/lib/instance.mjs:92-93`, and the two
  importers of `packages/sync/src/companion/legacy.ts` (E1): `cycle.ts:20` (drop `fromLegacyUrl`, used at `:298`) and
  `view.ts:3` (drop `fromLegacy`, used at `:105,132,261,303,310`). Delete the two test cases of the removed rewrite:
  `packages/sync/src/companion/companion.test.ts:259` (the `netnyahoo://yahu` bookmark and its assertion) and
  `apps/browser/src/state/sync/pinned.test.mjs:133-140` (the `netnyahoo://history` pin). `ardia-sync.js` is the lead's
  (§2.5): M does not touch it; its `--check` (`packages/sync` `test:portable`) fails until the lead regenerates it at
  the end of wave 1, which is expected.
- **Order:** commit after I's "Sync: own constants" commit (I detaches `SyncCrypto.swift`, `SecretStore.swift` and
  `SyncModule.swift`).
- **Not M's:** the phone's Compose importer (§0.5 item 6); the residual-name gate (`conventions.test.mjs:318-319,406`
  is R's in wave 2); prose in `docs/{conventions,releasing,sync,testing}.md` (wave 3).
- **Checks:** `swift build` for `packages/sync` on the Mac (here: `bun run --cwd packages/sync check` for the type
  check, and `test:portable` minus the bundle `--check`); `bun run --cwd apps/browser test`; after M and I commit,
  `git grep -l -i netnyahoo -- ':!docs/history' ':!docs/perf/0.2.*' ':!engine'` lists exactly these files (E13), each
  with its owner: `apps/browser/src/conventions.test.mjs` (R, wave 2, residual-name gate), `apps/browser/scripts/perf/
  js-bench.mjs` (C-ui), `apps/phone/scripts/asc.mjs` (C-phone), `scripts/release/carryover.mjs:73-74` (G, which moves it
  and drops its Netnyahoo-name branch in wave 1), `ardia-sync.js` until the lead regenerates it, and the
  prose in `AGENTS.md` (D), `docs/{agent-brief,conventions,perf/README,phone,sync}.md` (C-repo-docs). Any other file is
  M's or I's bug.

#### Phase B, owner S: services behind config hooks (wave 1)

**Why:** owner decision 4. No Nilla build may send anything upstream, and every service gets one switch for the
owner's own endpoints later.

- **`packages/core/src/services.ts` (new):** one frozen constant, every endpoint nullable and `null`: `telemetryUrl`,
  `feedbackUrl`, `switchesUrl`, `ingestKeys` (`{app, cli, site} | null`), `macFeedUrl`, `windowsFeedUrl`,
  `windowsTrustedPrefix`, `linuxReleasesUrl`, `releaseNotesUrl`, `siteUrl`; non-null `sourceRepo: "NoorChasib/nilla"`
  and `issueUrl`. `ingestKeys.ts` keeps only the asserted `INGEST_KEY_HEADER` line. `services.testing.ts` (new) exports
  `overrideServicesForTests(partial)`, which throws unless the existing test loader set its test flag. The import guard
  is S's own new test, `packages/core/src/services.testing.test.mjs`, which scans `git ls-files` and fails any non-test
  file that imports `services.testing` (E5: `conventions.test.mjs` is R's and C-ui's, not S's).
- **Test override wiring (C11, R15).** One snapshot, read once, before any consumer starts:
  - The key: `services=<path to a JSON file>` in `ARDIA_TEST`. I adds `services` to the three key lists by S's hand-off
    (`launchEnv.mjs` `TEST_KEYS`, `ArdiaLaunchConfig.mm` `AppTestKeys()`, `LaunchConfig.h` `TestKeys()`; §0.5 item 9).
    The parsers already ignore it outside authorized test instances.
  - Mac: a new `packages/shell/ios/ServicesConfig.swift` (S) reads `LaunchConfig.shared.testValue("services")` once,
    validates it against the `services.ts` field list (unknown field, non-https URL or wrong type: refuse and log), and
    is the only source `ReportUploader.swift`, `AppUpdater.swift` and `AppModule.swift` read endpoints from. The JS side
    gets the same snapshot through `AppModule`'s launch-config export and applies it with `overrideServicesForTests`
    before `index.ts` starts telemetry, switches or reports.
  - Windows: `UpdateModule.h`, the only native WinHTTP sender besides the allowed bang-list fetch
    (`ShellModule.h:221`), reads the feed and prefix from the snapshot the same way (S owns the reader; I owns
    `LaunchConfig.h`). Reports and telemetry on Windows go through the JS transport and the override.
  - Tests: positive tests inject a snapshot before the modules import (a Swift unit test for `ServicesConfig`, a node
    test that sets the override before `import`ing `telemetry/index.ts`), and a negative test shows a non-test instance
    ignores it.
  - Linux Layer 1 tests the null defaults only (the gate wins anyway).
- **Telemetry:** delete `state/telemetry/daily.ts`, `daily.test.mjs`, the `startDaily`/`sendDailyPing`/`devDaily`
  wiring in `index.ts`, the `"daily"` kind (`requestLog.ts:7`, `transport.ts:13-14`), the Linux `hostTelemetry.ts`
  import (`:6`) and its `DAILY_DOC` entry in `TELEMETRY_DOCUMENTS` (`:28`), and the "opened today" copy
  (`copy.ts:16-18,204`); move `utcDay` out for `usage.ts`. In `localCopy.test.mjs`, drop the `sendDailyPing` import
  (`:13`) and the daily case (`:88-92`), and replace it with a case that records an opted-in event, keeps it in the
  local copy, and shows a dry-run send is reported "not sent", never "delivered" (R17). `mayPost()` returns false
  while `telemetryUrl` is null; a dry run returns a distinct "not sent" status that no caller counts as delivered or
  uses to drain a queue (`transport.ts:37-39`). Consent and retry tests reach a mocked transport through
  `setTelemetryHost` plus the override. Settings › Privacy (`ShareDiagnostics.tsx`), onboarding (`PrivacyStep.tsx`) and
  `ntp/TelemetryAsk.tsx` gate their rendering, not the consent state: "Nilla sends no usage data." Rewrite What's Sent
  (`copy.ts`, `platformCopy.ts`, `copyWords*.ts`, phone `telemetryCopy.ts`) and regenerate
  `fixtures/whats-sent-windows-*.json`; the `linuxWording.ts` lines go to C-linux as text.
- **Kill switches:** `refreshSwitches()` (`killSwitches.ts:138`) skips the fetch while `switchesUrl` is null, and
  `switchOn()` ignores cached remote values then (`:122-124`). `startKillSwitches()` (`killSwitchesLaunch.ts:5-13`)
  stops depending on the updater: it schedules a refresh when `services.switchesUrl` is non-null, whatever
  `updaterState()` says, and does nothing otherwise (C11). S moves `apps/site/public/switches.json` to
  `apps/browser/src/platform/fixtures/switches.json` and repoints `killSwitches.test.mjs:36` in the same commit.
- **Report a Problem:** keep the asserted `FEEDBACK_URL` line as the Linux engine's compiled endpoint, unused. The sheet
  uploads only when `feedbackUrl` is non-null (never on Linux, §0.3). Otherwise it opens `issueUrl` with a static body;
  diagnostics are shown separately for the user to copy, and a test asserts the navigation URL holds no diagnostics
  field (`apps/linux/src/reportProblem.ts:32-34` appends them today). The Mac `ReportUploader.swift` refuses an empty
  URL.
- **Updates:** Mac `Info.plist` `SUFeedURL ""`, `SUPublicEDKey ""`; `AppUpdater.swift:11` test-feed default `nil`; the
  pane says "Updates aren't set up for this build"; the switches fetch is skipped too. Rename only `ACFeedbackURL` →
  `NLFeedbackURL` (`issueUrl`) and `ACReleaseNotesURL` → `NLReleaseNotesURL` (`""`) with every reader
  (`AppModule.swift:71-74`, `MainMenu.swift:336`) and test writer in one commit; other `AC*` keys wait (R41). Windows:
  `FEED` and `kPublishedUnder` empty, `configured()` needs both non-empty, `Allowed()` and `readInstaller()` reject an
  empty prefix, `selfCheck/appSystem.ts:182` updated; test an installed, stamped build with updates off. Linux: the gate.
  `releaseNotesPage.ts` opens nothing.
- **Linux gate (`apps/linux/src/layer1Gate.ts`, new; C9, R18):** a fixed list applied at the common host boundary,
  `apps/linux/src/host.ts` (S's in wave 1): `ardiaHost` (`:40`) becomes `gateHost(window.__ardiaHost)`, and `invokeHost`,
  `callHost`, `hostSupports` and `hostModuleMethod` check the gate for any host they're given, before native dispatch.
  The gate filters `bootstrap.capabilities` (method names and capability keys, `report.send` included) and rejects
  gated calls: the service methods of §0.3 and the independence methods of §0.2 (`ArdiaSync.*`, `ArdiaLive.*`,
  `ArdiaSystem.setAsDefaultBrowser`, `setLaunchAtLogin`, `ArdiaCli.install`). It filters the runtime list only: the
  exported `SYNC_CAPABILITIES` (`hostSync.ts`) and `LIVE_CAPABILITIES` (`hostLive.ts:4`) constants stay untouched,
  because `test_sync.py:60-65` and `test_live.py:86` assert they equal the engine's lists (E15). `hostModules.ts` needs
  no gate code. Tests in `test:host` (`host.test.mjs`, S's): a fake host advertising the engine's full capability list
  (`engineCapabilities.test.mjs`'s `ENGINE`) is wrapped, then every direct adapter (`hostTelemetrySend`,
  `hostReportPost`, `syncKeyStoreStatus`, `syncModuleMethod`, the live client, `hostUpdates`) and every module proxy
  call for a gated name is made; the test asserts **zero** native `invoke`/`call` invocations, that each gated name is
  absent from `hostSupports`, and that the UI hides the entry points (Settings rows, Report send, Sync pane).
- **About and Legal Notices (GPL §5(d)):** `AppUpdater.swift:142` takes the readme-docs-license §3.4 text; `:150` and
  `UpdatesSection.tsx:17` read `services.sourceRepo`; `UpdatesSection.tsx` `VersionDetails` adds the one-line GPL notice
  and "Based on Ardia", for all three platforms. Linux `AppMenuButton.tsx` shows the same notice plus Licenses and
  Source links; its "ArdiaCore on Chromium" label becomes "Chromium <version>".
- **CLI:** `telemetry.py:11-13` and `feedback.py:13` become `None`; `nilla-browser feedback` prints the issue URL;
  `star.py`, `usage.py` drop the star nudge; `test_feedback.py:572-577` compares every Python and TS field, with its
  `:575` regex replaced.
- **Phone:** `platform/telemetry.ts` off; `LabNetworkLog.kt` host from config; `DataPages.tsx` drops the ardia.dev rows,
  "Source Code" → `NoorChasib/nilla`, keeps the Ardia credit row ("The browser Nilla is forked from") plus a Nilla row;
  `selfTest.ts` and `LabBlockingTest.kt` use a local fixture host instead of `lab.ardia.dev`; `corex-build:32` clones
  `NoorChasib/nilla`.
- **Other links (R36):** `ExpoAboutPages.tsx:14-16`, `packages/demo/src/shims/web/RefusedPage.tsx:12`,
  `packages/demo/src/frameable.ts:25`, `packages/expo-windows/src/modules.ts:31`, `SyncCodeReading.kt:61`,
  `packages/shell/ios/SharePicker.swift:80`: through `services.ts` or a local, neutral value.
- **Setup codes:** hide "Have a setup code from ardia.dev?" (`SetupCodeStep.tsx`, `SetupCodeRow.tsx`,
  `generalRows.ts:162`) while `siteUrl` is null.
- **`infra/feedback` (R23, C10):** keep `lib/{validate,ids}.mjs` byte for byte; delete `hexclave.deploy.ts` and
  `deploy.sh` and the tests that read deleted infra (`test/storage.test.mjs`, `unit.test.mjs:269-272`); replace its
  `../shared` imports with local ones. Keys: `lib/core.mjs:5-14` stops importing `APP_INGEST_KEY`, `CLI_INGEST_KEY` and
  `SITE_INGEST_KEY` from `ingestKeys.ts` (S removes them) and drops the "run infra/feedback/deploy.sh build" fallback;
  a new `lib/keys.mjs` takes the accepted keys from `FEEDBACK_APP_KEY` and `FEEDBACK_CLI_KEY` in production mode
  (required, no default) and, with `--local`, uses fixed test-only keys (`local-app-key`, `local-cli-key`) that the
  server refuses outside loopback. `service.mjs:3,11` builds `SURFACE_BY_KEY` from `keys.mjs`. `INGEST_KEY_HEADER` still
  comes from `ingestKeys.ts`. `GITHUB_REPO`, `DASHBOARD_URL`, `PUBLIC_URL` are required in production mode only, and
  `--local` stays loopback. Check: start it with `--local`, post one report to `127.0.0.1` with the local app key and
  get its id back, with `apps/site` and `infra/shared.ts` already deleted. Not deployed.
- **Test guards:** `native-bench.mjs:894` asserts no request reaches the fixed upstream list (§2.6), not values from
  `services.ts`. `apps/linux/scripts/acceptance/lib/liveServices.mjs` (S's in wave 1; it had no owner before) is a
  contract file: change only its ardia.dev guard.
- **Docs (new or rewritten):** `docs/services.md` (each field, its native mirrors in Swift, WinHTTP, Python and the
  phone, and what turning it on needs: the Mac public key, the Windows trusted prefix, an ingest key), `docs/kill-switches.md`,
  `docs/feedback.md`.
- **Checks:** `bun run --cwd apps/browser test` (telemetry, report, killSwitches, windowsUpdateManifest, localCopy);
  `bun run --cwd packages/core test` (with `services.testing.test.mjs`); `bun run --cwd apps/linux test:host` (the
  zero-native-calls gate test); `bun run --cwd apps/linux test:graph`; `python3 -m unittest discover -s apps/cli/tests`;
  the phone jest suite; `bun run --cwd infra/feedback test` and the loopback submission (`bun run --cwd infra/feedback local`); the engine suites
  (`test_report.py`, `test_sync.py`, `test_live.py`) unchanged and passing; the no-upstream check (§2.6).
- **Risks:** privacy and network logic, so a Codex review before and after. Gate rendering and posting only; the consent
  state machine stays.

#### Phase C, owner I: identities and independence (wave 1)

**Why:** owner decision 2. Every id, data path, keychain item, sync value and OS registration must be Nilla's, and the
§0.2 isolations land here.

- **One prefix, mirrored:** `NILLA_ID_PREFIX = com.nilladigital` in `apps/browser/macos/Nilla.xcconfig` (included by
  both configurations; `PRODUCT_BUNDLE_IDENTIFIER = $(NILLA_ID_PREFIX).nilla`, `DEVELOPMENT_TEAM = $(NILLA_TEAM_ID)`,
  empty, `AdHoc.xcconfig` signs locally), an `apps/phone/ios/Config` xcconfig, `nillaIdPrefix` in
  `apps/phone/android/gradle.properties`, `scripts/lib/identity.sh`, `packages/core/src/identity.ts` (also used by
  Raycast) and `apps/cli/ardia_cli/endpoint.py`. `scripts/lib/identity.test.mjs` fails if any mirror differs.
- **Mac:** `project.pbxproj` drops the hard-coded `DEVELOPMENT_TEAM = U5L5T3NGVV` (including `TargetAttributes`
  `DevelopmentTeam`, `:165`) and `PRODUCT_BUNDLE_IDENTIFIER`, sets `PRODUCT_NAME = Nilla`, `MARKETING_VERSION = 0.1.0`.
  Entitlements keep the `$(PRODUCT_BUNDLE_IDENTIFIER).{webauthn,unexportable-keys,secure-payment-confirmation}` groups
  and delete the `com.netnyahoo.browser.*` groups. `ExportOptions-DeveloperID.plist`, `scripts/release/verify.sh:18,37-41,53`
  (I's in wave 1, before G's `scripts/release/*` rule; E5) and `packages/shell/docktile/build.sh:6` read `identity.sh`. `ArdiaLaunchConfig.mm` adds `--use-mock-keychain` to
  the engine switches on every launch (§0.2). Verify the signed entitlements of an ad hoc build separately from the
  Developer ID check.
- **Phone:** iOS ids and the app group in the entitlements, `Config/*-Info.plist`, `app.json:9-14`,
  `ExportOptions-TestFlight.plist`, and `BrowserSchema.swift:126` in the same commit, with the two phone tests that read
  them (`apps/phone/src/dev/defaultBrowserSwitch.test.ts`, `releaseDryRun.test.ts`; E4). Android: only
  `applicationId` (`build.gradle:88`); `namespace` (`:80`) moves with the Kotlin packages in R. **Scheme and background
  task, one commit (OWNER-PHONE):** the registrations and OS-level link builders of §0.2's phone row:
  `AndroidManifest.xml:53`, `res-system/xml/shortcuts.xml`, `res/xml/phone_shortcuts.xml`, the main
  `apps/phone/ios/Ardia/Info.plist` (URL type and `BGTaskSchedulerPermittedIdentifiers` →
  `com.nilladigital.nilla.ios.sync`), `SyncService.swift:50` (same id), and the scheme split in `BrowserUrl.kt`,
  `SystemLink.kt`, `TabPolicies.swift` and `SystemShared.swift`. All of these are I's in wave 1.
- **Windows:** `Ardia.iss`: new `AppId` GUID, `AppName`/`AppPublisher` Nilla, URLs `NoorChasib/nilla`,
  `{localappdata}\Programs\Nilla`, `OutputBaseFilename Nilla-Setup-{#Cpu}`, `LicenseFile=` the GPL text; remove
  `[Registry]`, `[Icons]`, `[Run]` and the Ardia `[Dirs]` entry. `Paths.h:80`, `EngineHostModule.h:133`
  (`%LOCALAPPDATA%\Nilla`), the `Ardia.cpp` start guard, `SystemModule.h` (default browser and login item unsupported),
  `AppIcon.h:22` (AUMID `NillaDigital.Nilla`, verified by `launcher-identity.ps1` in CI or deferred),
  `scripts/windows/nilla-dev-run.ps1` (new). `installer-check.ps1` (C-windows, wave 3, by I's hand-off) asserts the
  absence of every removed entry. I also owns the tests that read these native files as text (E4, `closure.tsv`
  action `native-test`): `windowsDefaultBrowser.test.mjs` (drop the `[Registry]` rows and the `ArdiaHTM` ProgID
  assertions, assert the actions report unsupported; the `installer-check.ps1` assertion moves with C-windows),
  `windowsDialogPages.test.mjs` and `windowsGradientFill.test.mjs` (`Ardia.cpp`), `windowsLaunchConfig.test.mjs`
  (`LaunchConfig.h`, `Launcher.cpp`, `SyncSecrets.h`) and `SyncSelfTest.h`.
- **Launch configs (C11):** I owns all three launch-config key lists in wave 1 (`scripts/lib/launchEnv.mjs`,
  `ArdiaLaunchConfig.mm`, `apps/browser/windows/Ardia/LaunchConfig.h`) and `scripts/lib/launchEnv.test.mjs`
  (`:39-43` asserts the first two agree). Besides `--use-mock-keychain`, it adds S's `services` test key to all three
  (hand-off).
- **Linux:** `scripts/linux/nilla-dev-run` (new, §0.2). `linux_formats.py`'s Maintainer (D19), Homepage and
  Description are C-linux's in wave 3 (hand-off; R5, E5), and so is the UI's "not isolated" page.
- **Keychain and service names:** "Nilla Connected Accounts", "Nilla Recovery Kit", "Nilla Live Tokens"
  (`KeychainModule.swift:7`, `KeychainModule.h:95`), "Nilla Sync Key" (`SyncKeyStore.swift:14`, `SyncService.swift:156`).
- **Sync detach commit (first, before M):** `SyncCrypto.swift` gets its own `magic`/`salt` constants with the Nilla
  values; `SecretStore.swift:107-132` its own service-name constants instead of `Renamed.*`; `SyncModule.swift:349`
  loses the legacy folder lookup.
- **Sync (Mac, Windows, phone):** "Nilla Sync" folder (`SyncFolders.kt`, `SyncFolderAccess.swift`, the Windows path;
  the "Netnyahoo Sync" entries at `SyncFolders.kt:7`, `SyncFolderAccess.swift:33` go); salt `nilla-sync/v1`, magic
  `NLS1`, vault extension `.nls` (`SyncCrypto.h:82`, `SyncKeys.kt:85`, `SyncCrypto.swift`); `syncDoc.ts` keeps `.nns`;
  `windowsSyncDouble.mjs` follows. **Sync vectors (E2):** I owns the whole `packages/sync/tests/fixtures/sync-vectors/`
  tree (47 files, on R's skip list `R_SKIP_TREE`, never text-renamed), `SyncVectorsTests.swift`, `SyncVectors.kt`,
  `SyncVectorsTest.kt`, `KotlinSyncVectorSetTest.kt` and `SyncKeysTest.kt`. The vectors are sealed with the old salt
  and magic, so they are regenerated, never edited: on a Mac, `ARDIA_SYNC_VECTORS_WRITE=<repo>/packages/sync/tests/
  fixtures/sync-vectors swift test --filter SyncVectorsTests` (rewrites `expected.json`, `vault/` and `swift/`), then
  the `packages/phone/android` unit-test task with `--tests '*KotlinSyncVectorSetTest*'` and the same variable
  (`packages/phone/android/build.gradle:165-166` forwards it; rewrites `kotlin/vault/`), committed as one "Sync: regenerate vectors for Nilla" commit. That step runs in a Mac session right
  after I's sync commit (or at the latest at the start of wave 4, §2.4); between I's commit and it, the Swift and Kotlin
  vector tests are **expected red** and the Linux `test_sync.py` stays green (it reads only `sealed-0.2.32.b64`).
  `sealed-0.2.32.b64` is frozen. I adds `packages/sync/tests/fixtures/sealed-nilla-0.1.b64`, produced by a new
  `packages/sync/scripts/seal-nilla-vector.mjs` (I) from `windowsSyncDouble.mjs`'s `cryptoDouble` with a zero key, scope
  `app`, file `f1` and the text "from nilla 0.1". Readers: `SyncKeysTest.kt:20` (with its `chainTag`/`scopeTag`
  expectations `:17-18` recomputed for the new salt) and a new case in `SyncVectorsTests.swift`; the only old Mac
  reader, `LegacyMigrationTests.swift:614`, is deleted by M.
- **CLI:** `endpoint.py`: the Mac data folder from the mirror; on Linux, no default (§0.2). `installed_data_dir()`'s
  callers and their tests are I's in the same commit (E4): `config_cli.py`, `hooks.py`, `scripts_cli.py`,
  `automation_cli.py`, `tests/test_linux.py`, `test_config.py`, `test_automation.py`, `test_scripts.py`; each handles
  the refusal with the "set `ARDIA_DATA_DIR` or `ARDIA_CONFIG_HOME`" message. **Install paths (OWNER-CLI):**
  `apps/cli/install.sh` (I in wave 1, C-cli-extras in wave 3) links, checks and uninstalls `bin/nilla-browser` only,
  uses the Mac home `Library/Application Support/Nilla/CLI` (`:51`), defaults `repo=NoorChasib/nilla` (`:38`), and in
  Layer 1 refuses a download unless `ARDIA_CLI_URL` is `file://`; `packages/shell/ios/CliInstaller.swift:33` uses the
  same Mac home, and its install action reports unsupported unless a test instance passes `cliInstallScript` and a
  local tarball fixture. A new case in `apps/cli/tests/test_linux.py` (I's; it already drives `install.sh`) runs `install.sh` with a scratch `HOME`,
  a `file://` fixture tarball and `curl` stubbed to fail, and asserts that only `Nilla/CLI` (Mac) or the scratch
  `ARDIA_CLI_HOME` (Linux) and `bin/nilla-browser` are created, no `ardia` link appears, and no download is attempted.
  The dist, scripts and module rename are R's (R29).
- **Raycast:** `extras/raycast-ardia/package.json`: `"name": "nilla-browser"`, `"title": "Nilla"`,
  `"author": "NoorChasib"`, `"contributors": ["mantrakp04", "ridemountainpig"]`, `"license": "MIT"`; `src/scripts.ts`
  takes `BUNDLE_ID` from `identity.ts`; new `LICENSE` (D25).
- **Checks:** `node --test scripts/lib/identity.test.mjs`; `node --test scripts/lib/launchEnv.test.mjs`; the native-file
  tests above; `plutil -lint` or `xmllint` on plists and entitlements (Mac or CI); `iscc` syntax (Windows CI); the CLI
  tests (all of them: I owns every caller); `gradlew :app:help` if a JDK exists, else CI; the Linux engine suite
  (`test_platform_tooling.py`, `test_sync.py`). Expected red after I, with the step that turns each green: the Swift and
  Kotlin vector tests (the Mac regeneration step); tests that assert an id string R rewrites everywhere
  (`com.ardia.browser` in files I doesn't own) until R. I records that list in its commit message so R starts from a
  known baseline.
- **Risks:** data and keychain paths: Codex review before and after. The Mac data folder
  `~/Library/Application Support/com.nilladigital.nilla` is checked on the Mac (§2.6).

#### Phase E, owner B: icons and wordmark (wave 1)

**Why:** Nilla may never use Ardia's name or logo as its brand (Apache-2.0 §6), and today's New Tab hills are cut from
Ardia's logo painting.

- **Input:** the branding manifest. Apply every Layer 1 entry (replace, add, remove, edit), including the New Tab hill
  entries the manifest marks "optional" (the owner chose the redrawn set). Skip the Layer 2 entries (engine product
  logos, `mac/app.icns`, `Assets.car`, the Windows engine's icon mapping), the `docs/brand/ardia` removal (§0.6) and the
  site entries, which target `docs/brand/nilla/web/` instead. The README header icon goes to
  `docs/brand/nilla/app-icon-256.png`. Re-run the hand-off's verify-manifest and inventory tools at the base first.
- **Placement:** B writes to the manifest's current paths; R's `git mv` carries them. `docs/brand/nilla/` gets the SVG
  sources, `palettes.json`, the wordmark files and the hand-off's tools with comments removed, plus a README like
  `docs/brand/ardia/README.md` (which itself is frozen).
- **Icon picker:** `AppIcons.swift`: Highland plus the 23 alternates in `palettes.json` order, each drawn whole from its
  `AppIconVariant-<id>` imageset, no plate, no monochrome filter; remove the `AppIconMark*` imagesets. `Appearance.tsx`,
  `paneData.ts`, `LookStep.tsx`: the grid grows from 7 to 24; check wrapping and name fit.
- **Phone:** `colors.xml` background from the manifest's edit entry, and the vector adaptive icon. B also owns the
  `Assets.xcassets` entries the manifest lists (`apps/phone/ios/Action/Assets.xcassets/AppIcon.appiconset/OpenInArdia.png`
  and its `Contents.json`, `apps/phone/ios/App/Assets.xcassets/AppIconPreview.imageset/AppIconPreview.png`) and the two
  Android widget marks `apps/phone/android/app/src/main/res-system/drawable/ardia_logo.xml` and `ardia_logo_plain.xml`
  (used by `ArdiaWidgets.kt:152,280,324` and two widget layouts), which are Ardia's logo and have no manifest entry yet
  (E12). The lead asks the branding agent for Nilla vector marks for those two drawables when it regenerates the
  hand-off; until they exist, B blocks on them rather than shipping Ardia's mark under a Nilla name. R renames the
  files and their `R.drawable` references in wave 2.
- **Linux:** hicolor set in `scripts/linux/icons/`; `package.py`'s icon source moves from the engine's
  `product_logo_256.png` to `scripts/linux/icons/256x256.png`, still installed as `ardia.png` (hand-off to C-linux).
- **Windows:** replace `apps/browser/windows/Ardia/Ardia.ico` in place (path is a contract).
- **Checks:** the verify-manifest tool (every current path exists, sizes match); every manifest Layer 1 entry with a
  current path is in `B-brand.txt` (a directory entry counts when its files are; at `e15125104` only the frozen
  `docs/brand/ardia` is outside); the build tool reproduces the committed files byte for byte; on the Mac, Icon
  Composer for `AppIcon.icon` (dark, clear, tinted), the Dock, and the picker in a hidden instance.

#### Phase F, owner D: README, CONTRIBUTING, AGENTS.md, NOTICE and docs (wave 1)

**Why:** the owner's attribution request and the licences need exact text, and AGENTS.md steers every later agent.

- **`NOTICE`** (lands in wave 1): Nilla's block on top, starting with the owner's two sentences exactly as written:
  "Nilla, Copyright 2026 Noor Chasib. Nilla is a modified version of Ardia, forked on 2026-11-18." Then a separate
  sentence for the credit and links: "Ardia (https://github.com/ardia-browser/ardia, originally
  https://github.com/mantrakp04/ardia) is by Mantra Patel and its contributors." (OWNER-NOTICE). Then Nilla's licence
  split, the Corresponding Source paragraph (source per
  platform, D9, pointing at `NoorChasib/nilla`), the third-party list (Ardia, React Native for Windows), the disclaimer
  extended with "Other product names and logos belong to their owners and appear only to identify those products.", then
  Ardia's 27-line NOTICE byte for byte under "Ardia's NOTICE, as Ardia distributed it". `scripts/release/verify.sh:33-35`
  still passes.
- **`README.md`:** the readme-docs-license §4 draft with this plan's names (`nilla-browser`; `ARDIA_DATA_DIR`,
  `--ardia-ui-dir`, `fetch-engine.sh --nearest` as they are), the wordmark from `docs/brand/nilla/`, and
  **Acknowledgements**: Nilla is a fork of Ardia (both URLs) by Mantra Patel and its contributors, a sincere thank-you,
  Helium (The Helium Authors), ungoogled-chromium, Chromium, a pointer to NOTICE, and the disclaimer "Other product
  names and logos belong to their owners and appear only to identify those products." (R49). No Ardia logo,
  screenshots, download links, Discord or tap. Upstream issue numbers stripped (D21). **The draft's build block is
  replaced, not renamed (OWNER-README):** the install line lists only the retained workspaces with their own lockfile
  (the root, `apps/phone`, `extras/raycast-nilla`), never `apps/dashboard`, `apps/site` or `apps/videos`; macOS runs the
  hidden-instance form with a scratch `ARDIA_DATA_DIR`; Linux shows `scripts/linux/nilla-dev-run` with a scratch
  `ARDIA_DATA_DIR` and `ARDIA_CONFIG_HOME` inside a disposable VM or namespace, never `"$(fetch-engine.sh)/chrome"`
  directly and never system packaging (§0.2); Windows says Layer 1 builds run in CI or a disposable VM only. A short
  "Known limits" paragraph bounds `--nearest`: the newest published engine may lack newer `ac_*` calls (D3), and some
  engine-drawn text still says Ardia (§2.7).
- **`CONTRIBUTING.md`:** remove the vouch, TEAM, bug-fix-only, claim, linked-issue, review-bot and CLA rules; add the
  licence of contributions (D8) and an "Upstream" section; keep the engineering substance; numbers stripped.
- **`AGENTS.md`:** for Nilla with NoorChasib as owner (governance.md §6, D7). Keep the engineering rules. Remove
  issues-first, claims, vouch, Bonzai, `full-send`, the Dashboard section, the release skill and upstream's release
  authorization. "Never touch `/Applications/Ardia.app`" becomes "the owner's installed Ardia or Nilla". Add **"Names that
  stay Ardia until Layer 2"** (§0.4 in short) and the §0.2 isolation rules. New repo map. `CLAUDE.md` stays `@AGENTS.md`.
- **Archive:** `git mv` to `docs/history/ardia/`: `docs/release-notes/*.md` (123, credit lines kept),
  `docs/ardiacore-{spike,parity}.md`, `docs/perf/{field-journeys,sprint}.md`, `docs/releasing.md`, `docs/windows/*.png`
  (16, unlinked from `docs/windows.md` by C-repo-docs). The archived history files get one header line naming the
  upstream repo, and keep their numbers. `docs/audit/**` stays byte for byte (X-keep; PR 4 adds a file there); its
  provenance goes into a new `docs/history/ardia/README.md` (D's), which names the upstream repo and lists `docs/audit/`
  as a record made on Ardia's tree (R26). Rewrite `docs/release-notes/README.md` and a new `docs/releasing.md` ("Not set
  up yet": D15, D16, D9, keeping "Source and licenses"). D also edits the paths `closure.tsv` assigns it (for example
  `packages/ardiacore/scripts/acceptance.mjs`'s reference to the archived parity doc).
- **Paths (E14):** D writes every repo path in its post-rename form, copied from the move table R's tool generates in
  wave 0 (`apps/browser/macos/Nilla-macOS`, `extras/raycast-nilla`, `apps/cli/nilla_browser_cli`, ...), and points the
  wordmark at B's `docs/brand/nilla/` paths from the manifest.
- **Checks:** `git diff <base> -- LICENSE LICENSE.Apache-2.0` empty; the first two NOTICE sentences equal the owner's
  text; the Ardia block in NOTICE equals `git show <base>:NOTICE` byte for byte; every path D names is in the wave 0
  move table's target column or unchanged at the base (a small script). The "markdown links resolve" check
  (`lychee --offline` or a script) moves to the lead's step right after R (§2.4), when the paths exist;
  `bun run --cwd apps/browser test`; `occlusion-compositor-wiring.test.mjs` still finds its rows in
  `docs/engine-build.md` (path stays).

#### Phase D, owner R: mechanical rename (wave 2, alone in the checkout)

**Why:** about 20,000 internal occurrences in 2,594 files, which only a deterministic tool can rename safely and redo on
a new base.

1. **Preconditions:** waves 1a and 1b committed (M, G, W deletions in), lockfiles regenerated, then
   `tools/naming_census.py` and `ownership_v2.py` rerun on that HEAD, in that order (E7). `R-mechanical.txt` is the
   edit list, now including retained G, W and D files (R8).
2. **Tool and manifest.** `~/ardia-work/nila-cleanup/tools/nilla_rename.py` (outside the repo, no comments) is
   **written in wave 0** (E7), so its move table can be reviewed and D can copy names from it, and rerun after wave 1.
   Its inputs are explicit (R13): the eligible-file list is `R-mechanical.txt` (the scheduler's output, which already
   excludes lead, frozen, kept, skip-hand and skip-tree files) **plus** every path in the move table, and the rules come
   **only** from `apps/browser/src/naming-allowlist.json`; the census categories never filter a file out. It skips
   binaries and generated files (§2.1), rewrites matched spans, prints counts per file, is deterministic, and writes
   `work/rename/moves.tsv` (old path, new path; files and directories) and `work/rename/edits.tsv` (path, line, rule).
   The allowlist holds §0.4, §2.1's never-renamed text with its credit spans, the classified engine literals, the frozen
   tokens and the exact asserted-line pre-images, and is written and Codex-reviewed in wave 0. **Pre-commit gate, two
   kinds (R13):** (a) for each `line` entry, the exact asserted line must be byte-identical after R; (b) for each
   `literal` and `class` entry, every protected span in the pre-image must still be present, unchanged, on the
   corresponding line after R, while text around it may change. So `scripts_cli.py:73` keeps `ArdiaControl.json` and
   `ARDIA_DATA_DIR` while its "the installed Ardia's" copy becomes Nilla's.
3. **Moves first** (`git mv`, outermost first). The table is generated from `git ls-tree -r -d` plus basenames, minus
   exclusions (R25), and reviewed by Codex in wave 0. R stages every path in the table as well as `R-mechanical.txt`:
   115 tracked files at `e15125104` (after these fixes) have an Ardia path component but are in no edit list (37 under
   `packages/phone/ios/ArdiaKit`, 30 under `apps/browser/macos/Ardia-macOS`, 15 under `packages/phone/android/src`, ...);
   they move with their folder unless the folder is a contract (`apps/browser/windows/Ardia`) (E7). Generated files move only with their folder and are then regenerated by the lead (R27). It includes `apps/browser/macos/Ardia-macOS`, `Ardia.xcodeproj`,
   `Ardia.xcworkspace` → `Nilla-*`; `apps/phone/ios/Ardia*` → `Nilla*`; `packages/phone/ios/ArdiaKit` and its
   `{Sources,Tests}/Ardia*` → `NillaKit`, `Nilla*`; the Kotlin folders, derived from the package map
   (`com/ardia/browser/android` → `com/nilladigital/nilla/android`, `com/ardia/<pkg>` → `com/nilladigital/nilla/<pkg>`,
   including `ardia-design/src/*/java/com/ardia` and `resources/com/ardia`); `apps/phone/android/ardia-design` →
   `nilla-design`; `packages/phone/android/src/main/assets/ardia-browser` → `nilla-browser`;
   `apps/browser/windows/ArdiaLauncher` → `NillaLauncher` and the `.sln`/`.vcxproj` names (`ArdiaApp.dll` output name
   stays); `apps/cli/ardia_cli` → `apps/cli/nilla_browser_cli` with the pyproject `name = "nilla-browser"`,
   `[project.scripts] nilla-browser = "nilla_browser_cli.cli:main"` and `module-name = "nilla_browser_cli"` under
   `[tool.uv.build-backend]` (uv_build would otherwise look for `nilla_browser`; E11), and the producer
   `apps/cli/scripts/build.sh` hand-edited in the same commit (OWNER-CLI, E11): its nine module references
   (`cp -R "$cli_dir/ardia_cli"`, `$site/ardia_cli/...`, the import check at `:160`, `-m ardia_cli` at `:173`) become
   `nilla_browser_cli`, while the Linux contract names stay inside the artifact (top folder `ardia-cli-<v>/`,
   `bin/ardia`); C-cli-extras adds `bin/nilla-browser` in wave 3 (R29); `extras/raycast-ardia` →
   `extras/raycast-nilla`; `apps/browser/src/{components,state}/littleArdia` → `littleNilla`; the remaining `Ardia*`
   basenames. Never moved: `apps/browser/windows/Ardia` and `Ardia.ico`, every contract-file basename
   (`ArdiaWebView+Navigation.mm` included), every `ardiacore` path, the frozen paths.
4. **Grammar pre-pass** (§0.1).
5. **Literal rules, longest first:**

   | # | Find | Replace | Not on |
   | --: | --- | --- | --- |
   | 1 | `mantrakp04/ardia-plugins` | `NoorChasib/nilla-plugins` | – |
   | 2 | tap leftovers (`ardia-browser/homebrew-tap`, `tap/ardia`, `Casks/ardia`) | report; G removed them | – |
   | 3a | `github.com/ardia-browser/ardia`, `github.com/mantrakp04/ardia` (host kept, scheme and suffix untouched) | `github.com/NoorChasib/nilla` | engine-fetch defaults (`linux.yml:64`, `release.yml:310`, `ENGINE_REPO`, `fetch-engine.ps1` default), credit spans, NOTICE, history |
   | 3b | `github.com\/ardia-browser\/ardia`, `github.com\/mantrakp04\/ardia` (escaped in regexes and JSON) | `github.com\/NoorChasib\/nilla` | as 3a |
   | 3c | bare slugs `ardia-browser/ardia`, `mantrakp04/ardia` not preceded by `github.com/` | `NoorChasib/nilla` | as 3a |
   | 3d | escaped bare slugs `ardia-browser\/ardia`, `mantrakp04\/ardia` | `NoorChasib\/nilla` | as 3a |
   | 4 | `group.com.ardia.browser.ios` | `group.com.nilladigital.nilla.ios` | – |
   | 5 | `com.ardia.browser.android` | `com.nilladigital.nilla.android` | – |
   | 6 | `com.ardia.browser.ios` | `com.nilladigital.nilla.ios` | – |
   | 7 | `com.ardia.browser` | `com.nilladigital.nilla` | `engine/**`; the Ardia import source row (added in wave 3, after R) |
   | 8 | `com.ardia.<pkg>` (Kotlin packages `phone`, `sync`, `design`, `blocking`, `browsing`, `appmodel`, `shared`, `search`, `store`, `settings`; `com.ardia.SOURCE`; `com.ardia.signing`), folder `com/ardia/` | `com.nilladigital.nilla.<pkg>`, folders from the package map | – |
   | 9 | JNI exports `Java_com_ardia_<...>` and `FindClass("com/ardia/...")` in `packages/phone/android/src/main/cpp` | generated from the package map: `Java_com_nilladigital_nilla_<pkg>_...`, `com/nilladigital/nilla/<pkg>/...` | – |
   | 10 | `dev.ardia.{hooks, browse.auth, cli-installer, demo, fixture.dia, idle-watch}` | `com.nilladigital.nilla.{...}` | `dev.ardia.linux*` |
   | 11 | `.ardia.test` | `.nilla.test` | `engine/**` |
   | 12 | `@ardia/` | `@nilla/` | `@ardia/ardiacore` |
   | 13 | Netnyahoo leftovers after M | report; the owners are named in §2.3 M's check (C-ui, C-phone, C-repo-docs) | – |
   | 13a | CLI command spans: `` `ardia <subcommand>` ``, `$ ardia <subcommand>`, `ardia <subcommand>` at a line start in code blocks, "the ardia command", "the `ardia` command", for the subcommands `apps/cli/ardia_cli/cli.py` registers | `nilla-browser <subcommand>`, "the nilla-browser command" | class Q engine strings (" isn't allowed for the ardia command", "on a tab the ardia command didn't open"), class N names (E11) |
   | 14 | `ARDIA` / `Ardia` / `ardia`, also inside tokens (`littleArdia`, `ardia_host`, `ArdiaShell`, `openLinksInLittleArdia`) | `NILLA` / `Nilla` / `nilla` | the allowlist; §0.4 classes; `apps/linux/**`, `scripts/linux/**` module tokens (class H) |

   Never mechanical: `ardia.dev` and its hosts, `netnyahoo.com`, `X-Ardia-Key`. S routed them; leftovers are reported.
   After rule 14, R prints every remaining `nilla <word>` candidate per wave 3 owner (from the remapped lists), so
   each owner fixes the ones in its own files (E11). After rules 3a-3d, R prints every remaining callable
   `ardia-browser`/`mantrakp04` link outside the credit spans and the engine-fetch lines (OWNER-URL).
6. **Hand edits inside R's commit:** the Linux `hostModuleName()` mapping in `apps/linux/src/shims/expo-modules-core.ts:71`
   (a leading `Nilla` maps back to `Ardia` before the existing lookups; `SHELL_PARTS`/`APP_PARTS` keep their asserted
   lines; Layer 2 deletes the mapping) plus the `test:host` and `nativeModules` tests (§0.5 item 1); the escaped alias
   alias regexes, each specified separately (R14):
   - `apps/linux/vite.shared.ts:110` and `packages/demo/vite.config.ts:107`, `^@ardia\/(shell|ardiacore|shaders|sync|import)$`
     → `${shims}$1.tsx`: split into `^@nilla\/(shell|shaders|sync|import)$` → `${shims}$1.tsx` and
     `^@ardia\/ardiacore$` → `${shims}ardiacore.tsx`, both still anchored and still ending in `$`.
   - `apps/linux/vite.config.ts:111`, `^@ardia\/shell$` → `./src/shims/shell.tsx`: becomes `^@nilla\/shell$`, same
     target; `:112`, `^@ardia\/ardiacore$` → `./src/shims/ardiacore.tsx`: unchanged (class R). Neither gains the other
     packages.
   - `conventions.test.mjs:325` `NATIVE_PACKAGE`, `^(?:@ardia\/(?:ardiacore|shell|shaders|import|sync)(?:\/.*)?|expo-modules-core)$`:
     becomes `^(?:@ardia\/ardiacore(?:\/.*)?|@nilla\/(?:shell|shaders|import|sync)(?:\/.*)?|expo-modules-core)$`, keeping
     subpath and `expo-modules-core` coverage.
   - Checks: a `test:graph` assertion that `@ardia/ardiacore` resolves to `src/shims/ardiacore.tsx` and each of
     `@nilla/shell`, `@nilla/sync`, `@nilla/shaders`, `@nilla/import` resolves to its shim on Linux and the demo, and that
     `@nilla/core` resolves to the real workspace package; a conventions test case that an import of
     `@nilla/shell/sub` and of `expo-modules-core` from a component file is still reported. Then the added lines of
   `patches/*.patch` (for example `ArdiaInterfaceScaleDidChange`, `react-native-macos@0.81.9.patch:41,1725`), after
   which the lead regenerates the lockfile's patch hash.
7. **Residual-name gate** (`conventions.test.mjs`): replace `LEGACY_BRAND`/`LEGACY_PREFIX` (`:318-319`) and the
   migration-file exemption (`:34,406`) with one rule: every `/ardia|netnyahoo/i` match in `git grep` is covered by the
   allowlist, a path class or a token class; update the `AC[A-Z]`, `ArdiaCore[A-Z]` and `@ardia/...` patterns
   (`:319-325`, `docs/conventions.md:249-252`). Add positive checks (R33): the NOTICE Ardia block, README
   Acknowledgements naming Mantra Patel, "Based on Ardia" in About, the phone Ardia row and the Raycast contributors
   exist.
8. **R leaves alone:** lockfiles and `conventions-baseline.json` (lead), the generated files (`ardia-core.js`,
   `ardia-sync.js`, the meadow outputs; they only move with their folder, then the lead regenerates them, R27),
   `scripts/dmg/DS_Store` and `background.tiff` (Mac), the "Ardia Ltd" fixture, the 11 skip files (except
   `build.sh`'s module references, step 3), the sync-vector tree, `THIRD_PARTY_NOTICES.txt`.
9. **Checks:** every §2.6 Linux check; a script that every repo path in `.github/workflows/*.yml`, `package.json` scripts
   and `scripts/release*.sh` exists at HEAD and every turbo `--filter` names a workspace package (R8); the JNI check
   (every `Java_*` export and `FindClass` path matches a Kotlin package and class, R24).
10. **Risks:** CocoaPods renames change module names and generated `*-Swift.h` headers (Mac only); a missed interface
    token breaks Linux at runtime, hence `acceptance:linux` on the nearest engine.

#### Wave 3: per-area copy and fallout (after R is committed)

Each owner works from its **remapped** list (`work/ownership-v2/wave3/<owner>.txt`, written by `tools/remap_lists.py`
right after R, §2.4; E3), not from the pre-rename `C-*.txt`. It hand-writes its share of the branding inventory's
flagged lines (regenerate `strings/inventory.tsv` on the post-R tree with the hand-off's inventory tool: any
user-visible Ardia outside the allowlist is a bug), fixes the `nilla <word>` CLI candidates R printed for its files
(E11), fixes its type and test fallout, and runs the checks in its row. The lists decide ownership; the Area column is a
summary (E10). Owners whose code can't be compiled on this Linux box (C-mac, C-windows, and C-phone's native parts) run
the JS and source-reading tests here, leave compile and device checks to wave 4, and answer that session's findings in
their own files.

| Owner | Area (summary) | Specific work | Checks (E10) |
| --- | --- | --- | --- |
| C-ui | `apps/browser/src`, `apps/browser/scripts`, `packages/{core,shell,shaders,import}/src`, `packages/demo` | Little Nilla, Settings, onboarding and "Let the nilla-browser command control Nilla" copy; `apps/browser/scripts/perf/js-bench.mjs:371` Netnyahoo leftover | `bun run --cwd apps/browser check` and `test` (all shards); `bun run --cwd apps/browser bundle:windows`; `bun run --cwd packages/core test`; `bun run --cwd packages/demo check` and `test:shims` |
| C-mac | `apps/browser/macos`, `packages/*/ios`, `packages/ardiacore` and `packages/sync` (their `src/` included), `patches/`, `scripts/dmg`, `scripts/agent`, `scripts/release/{verify,export-sign}.sh` | `MainMenu.swift` ("New Little Nilla Window..."), `Info.plist` names and usage descriptions, Podfile, scheme `Nilla-macOS`, `scripts/agent/build-app`; the Mac licence work below; the **Ardia import source** (OWNER-IMPORT): one `chromium("ardia", "Ardia", ["com.ardia.browser"], "com.ardia.browser/Chromium", "Ardia")` row in `packages/import/ios/Core/Discovery.swift` (Ardia's Chromium profile, `Default` and `Profile <id>`, keychain "Ardia Safe Storage"; its strings go on the allowlist as an import-source name), a fixture test in `packages/import/tests` that discovers a copied Ardia profile layout, and no startup or automatic import | here: `bun run --cwd packages/sync check` and `test:portable`, `bun run --cwd packages/ardiacore check` and `test:portable`, the source-reading tests; wave 4 (Mac): `swift test` in `packages/{sync,import,shell}`, `pod install`, `xcodebuild -list`, `build-app`, `verify.sh --dev`, an Ardia import from a copied fixture profile in a hidden instance |
| C-linux | `apps/linux`, `scripts/linux` | `apps/linux/linuxWording.ts` (with S's lines), `calendarWording.ts`; the "not isolated" page (§0.2); `shellBase.tsx` `systemInfo()` shows `appName` Nilla while the engine's `bundleId` stays (R40); hand edits of the skip files: `package.py` `Name=Nilla`, B's icon line, `linux_formats.py` Maintainer (D19), Homepage (`https://github.com/NoorChasib/nilla`) and Description, keeping `Package: ardia` (R5); the Linux licence work below | `scripts/linux/ci-checks.sh --logs <dir>` (includes `test_platform_tooling.py:555` and `test_sync.py`, `test_live.py`); `bun run --cwd apps/linux check`, `test:graph`, `test:host`, `test:symbols`, `acceptance:self-test` |
| C-windows | `apps/browser/windows`, `packages/expo-windows`, `scripts/windows` except `engine/` | window titles, updater dialogs, `launcher-identity.ps1:255-263` version resources; the Windows licence work below; `installer-check.ps1` asserts the licence files and the absence of `[Registry]`, `[Icons]`, `[Run]`, shortcuts and `%LOCALAPPDATA%\Ardia` (I's hand-off) | here: `bun run --cwd packages/expo-windows check` and the `windows*.test.mjs` source-reading tests (they run in `apps/browser test`); wave 4: the Windows workflow on the PR |
| C-phone | `apps/phone`, `packages/phone` | Android label, `platformCopy.ts`, Siri `Intents.swift`, share-sheet titles, Gradle module names, `apps/phone/scripts/asc.mjs:153` Netnyahoo leftover; the phone licence work below. The scheme split and registrations are I's (wave 1) | `bun run --cwd apps/phone check` and `test`; wave 4: `gradlew testDebugUnitTest assembleDebug`, the iOS simulator build, and the **instrumentation test** `packages/phone/android/src/androidTest/.../ScriptEngineTest.kt` on an emulator or device (C3) |
| C-cli-extras | `apps/cli`, `extras` | help, examples and tests use `nilla-browser`, alignment re-checked; the skip files `install.sh` and `scripts/build.sh` keep the class N names, and `build.sh` adds `bin/nilla-browser` beside `bin/ardia`; the CLI licence work below; `nilla_browser_cli/skill/**` | `python3 -m unittest discover -s apps/cli/tests`; `bash apps/cli/scripts/build.sh` into a scratch dir where the toolchain cache allows, then `tar -tzf` for the licence entries and `bin/nilla-browser --version` from the extracted tree; `bun run --cwd extras/raycast-nilla check` and `test` |
| C-repo-docs | remaining `docs/**`, `scripts/**`, root files, `infra/feedback` prose | prose fallout from wave 1 (`closure.tsv` "prose-wave3" rows), Netnyahoo prose in `docs/{agent-brief,conventions,perf/README,phone,sync}.md`, upstream issue numbers stripped from its own files (D21), the `docs/windows.md` image links, a short "Names that stay Ardia until Layer 2" note in `docs/conventions.md` | `scripts/check-all.sh`; `bun run test:portable`; the markdown link check |

**Licence texts per package (R31).** The inputs are `LICENSE`, `LICENSE.Apache-2.0`, `NOTICE`, `third_party/bangs/LICENSE`
(Kagi and imput, MIT; in every package that bundles `packages/core`'s bang list) and the symbol notices
(`apps/linux/src/shims/web/symbols/THIRD_PARTY_NOTICES.txt` for Linux, `packages/demo/src/shims/web/symbols/
THIRD_PARTY_NOTICES.txt` for Windows, which imports them in `packages/expo-windows/src/symbol/layers.ts`). Each producer
copies what its package contains, and its check compares the packaged bytes with the repo's (`cmp`):

| Package | Producer (owner) | Destination | Files | Assertion |
| --- | --- | --- | --- | --- |
| Mac app, Layer 1 dev build | a copy step in `scripts/agent/build-app` and the Xcode Debug/AdHoc configuration (C-mac) | `Contents/Resources/Licenses/` | the three root texts, `bangs-LICENSE` | `scripts/release/verify.sh --dev <app>` (new mode, C-mac): bundle id from `identity.sh`, executable `Nilla`, the licence files, `SUFeedURL` and `SUPublicEDKey` empty. It skips the archive and dSYM, Developer ID signing, provisioning profile, team and Sparkle-key checks, which stay in the default mode for Layer 2 |
| Mac app, release | `scripts/release/export-sign.sh:35-38` (C-mac) | same | same (adds `bangs-LICENSE`) | `verify.sh` default mode (Layer 2) |
| Linux tarball | `scripts/linux/package.py` (C-linux) | `ardia/lib/ardia/licenses/` | root texts, `bangs-LICENSE`, `symbols-THIRD_PARTY_NOTICES.txt` | `tar -tzf` plus `cmp` in a new `scripts/linux/verify-licenses.py` |
| deb, AppImage, Arch | `package.py`, `PKGBUILD:7` `license=('GPL-3.0-only' 'Apache-2.0')` with `install -Dm644` lines that keep the asserted paths (C-linux) | `usr/share/doc/nilla/` | same | `dpkg-deb -c`, `--appimage-extract`, `bsdtar -tf` in the same script |
| Windows app folder and installer | `scripts/windows/assemble.ps1`, `make-installer.ps1`, `Ardia.iss` `LicenseFile=` (C-windows; I sets `LicenseFile`) | `Licenses\` | root texts, `bangs-LICENSE`, `symbols-THIRD_PARTY_NOTICES.txt` | `installer-check.ps1` hashes |
| CLI tarball | `apps/cli/scripts/build.sh` (C-cli-extras) | `ardia-cli-<v>/licenses/` | root texts, CPython's `LICENSE` from the bundled distribution, esbuild's and websockets' licence files from their packages, axe-core's (already vendored) | `tar -tzf` in `build.sh`'s own self-check; no bang list in the CLI |
| Phone | `credits.json` (lead, generated) and the licences page (C-phone) | Settings › Open Source Licenses | the Nilla row, the Ardia row (`ardia-browser/ardia`), the Apache-2.0 and NOTICE texts, the bang list's MIT text | a jest render test of the page |

### 2.4 Waves and coordination

| Wave | Agents (parallel unless noted) | Depends on |
| --- | --- | --- |
| 0 | lead: §5 steps 1-3; regenerate census, branding inventory and manifest check, `ownership_v2.py`; read every `closure.tsv` `edit` row (E6); classify the literals from `engine-literal-occurrences.tsv`; write `naming-allowlist.json`; write `tools/nilla_rename.py` and generate its move table (E7); Codex review of the allowlist and the move table; give D the move table (E14) | the base |
| 1a | G, W, D, I, S, B | wave 0 |
| 1b | M, after I's "Sync: own constants" commit | I's first commit |
| 1c | Mac session (as soon as one is free, at the latest first thing in wave 4): regenerate the sync vectors (§2.3 C, E2) and commit them; until then the Swift and Kotlin vector tests are expected red | I's sync commit |
| – | lead: lockfiles (`scripts/agent/locked pod -- bun install` at the root, `apps/phone`, `extras/raycast-ardia`), `bun run --cwd apps/phone credits`, `bun apps/phone/scripts/bundle-shared.mjs` (regenerates `ardia-core.js` and `ardia-sync.js` from S's, I's and M's sources, then `--check`; E6, R27), the meadow outputs (`bun run --cwd packages/shaders meadow`, then `--check` and `bun run --cwd apps/linux build`; R9), `conventions.test.mjs --write-baseline` (after reviewing that only decreases and removed paths changed), then `tools/naming_census.py` and `ownership_v2.py` on the new HEAD, and `nilla_rename.py`'s move table regenerated (E7) | wave 1 committed |
| 2 | R alone | wave 1 |
| – | lead: `tools/remap_lists.py /home/noor/Code/ardia HEAD work/rename/moves.tsv work/ownership-v2 work/ownership-v2/wave3` (must exit 0: every wave 3 path exists at HEAD; E3); `bundle-shared.mjs` again from the renamed sources and output paths, then `--check` (R27); lockfiles, credits and baseline again; the markdown link check over D's files (E14); `pod install` waits for the Mac session. `ownership_v2.py` is not rerun | R |
| 3 | C-ui, C-mac, C-linux, C-windows, C-phone, C-cli-extras, C-repo-docs, each on its `wave3/<owner>.txt` | R |
| – | lead: baseline, lockfiles, credits, `bundle-shared.mjs` | wave 3 |
| 4 | lead plus a Mac session: §2.6; the sync vectors if 1c hasn't run; Mac build, hidden instance, Icon Composer, `pod install`, `DS_Store`, `scripts/dmg/render.sh` → `background.tiff` (R28); Android unit and instrumentation tests on an emulator (C3); Windows CI through the PR | wave 3 |

Coordination:
- Cross-agent edits are in `handoffs.tsv` and in the briefs above, so no agent waits on another.
- Each brief names its file list and why the work matters, the §0.4 strings in its files, its build dir, data dir and port.
- The lead checks any agent it hasn't heard from every 30 minutes (last transcript activity, pending tool call, locks,
  processes); a stuck agent is a root cause to fix. Feedback goes to the owning agent.
- Codex reviews (T3 `delegate_task`, review only, full brief each round): S and I before and after; the allowlist and
  move table before R; the final branch.

### 2.5 Lockfiles and generated files

- The lead owns `bun.lock` files, both `Podfile.lock` files (a Mac, `scripts/agent/locked pod -- pod install`),
  `scripts/dmg/DS_Store` (`scripts/dmg/layout.sh` on a Mac after `Nilla.app`), `scripts/dmg/background.tiff`
  (`scripts/dmg/render.sh` on a Mac), `conventions-baseline.json` and `apps/phone/src/state/settings/credits.json`
  (`L-lead.txt`, 22 files). Never hand-edited; checked with `bun install --frozen-lockfile`. The four lockfiles inside
  folders W deletes are W's and go with their folders.
- Inside a wave, `conventions.test.mjs` may report only "fixed" entries or removed paths for an agent's own files; any
  "new" entry is that agent's bug.
- Generated outputs are the lead's too (R27, E6): `ardia-core.js` and `ardia-sync.js` (`apps/phone/scripts/
  bundle-shared.mjs:15-16` builds them from `packages/core/src/mobile.ts` and `packages/sync/src/companion/index.ts`,
  which S, I and M all change) and the meadow outputs. They are excluded from R's edits and from every wave's lists; R
  only moves them with their folder. The lead regenerates them at the end of each wave (§2.4) and runs the generator's
  `--check` (`packages/core test`, `packages/sync test:portable`, `meadow --check`). Between a source change and that
  regeneration those `--check` steps fail, which is expected. The `whats-sent-windows-*.json` fixtures stay S's (S
  regenerates them with the copy it rewrites).

### 2.6 Layer 1 checks

Each check runs once on the base (baseline) and once at the end of its phase, then all once at the end.

**On this Linux box:**
1. Engine key identical; empty diff on the key paths and `scripts/windows/engine`.
2. Engine suites through `scripts/linux/ci-checks.sh --logs <dir>` (it also runs
   `engine/chromium/src/chrome/browser/ardia/tests`); compare per-module ok and skip lists with the baseline.
3. The residual-name gate and its positive checks; the branding inventory on HEAD shows user-visible Ardia only in
   allowlisted classes.
4. `bun install --frozen-lockfile` at the root and in each project with a lockfile.
5. `scripts/check-all.sh`, `bun run test:portable`, `bun run --cwd apps/browser test` (all shards).
6. Linux UI: `bun run --cwd apps/linux check`, `test:graph`, `test:host` (gate and module-mapping tests), `test:symbols`,
   `acceptance:self-test`.
7. Metro bundles (`react-native bundle --platform macos` plus `hermesc -emit-binary` as `checks.yml:77-90`,
   `bundle:windows`), `bun run --cwd apps/phone test`.
8. CLI: `python3 -m unittest discover -s apps/cli/tests`; a read-only `nilla-browser browse` command against a scratch
   Nilla instance on the nearest engine (R2); without `ARDIA_DATA_DIR`/`ARDIA_CONFIG_HOME` it refuses.
9. The Linux app on the nearest engine, **inside disposable isolation only** (a throwaway VM, or a user and mount
   namespace with a scratch `$HOME`; §0.2): `scripts/linux/fetch-engine.sh --nearest`, `bun run --cwd apps/linux build`,
   `scripts/linux/package.py`, `scripts/linux/nilla-dev-run` with a scratch profile, `scripts/linux/smoke.mjs`,
   `bun run acceptance:linux` on an X11 display. A bare launch of the engine runs once there; it passes when
   `~/.config/ardia` does not exist afterwards, not when the guard page shows. Confirm title, About, Settings and New Tab say Nilla, `chrome://ardia/`
   loads, the licence files are in the package, Sync and connected accounts are absent.
10. **No-upstream check (Linux; R20):** run the app, the CLI and everything they spawn (renderers, utility processes,
    the CLI's browse daemon and esbuild) in one network namespace with **deny-by-default egress**: nftables drops and
    logs every packet that isn't to the namespace's test proxy, so a transient or child-process attempt is logged even
    if it never resolves. The proxy (`mitmproxy` with a throwaway CA trusted inside the namespace only) logs each
    request's host **and path**, which is what the GitHub rows of the fixed list need. The fixed list is independent of
    `services.ts`: `ardia.dev`, `*.ardia.dev`, `netnyahoo.com`, `lab.ardia.dev`, and `github.com`, `api.github.com`,
    `objects.githubusercontent.com` paths under `ardia-browser/` and `mantrakp04/`; allowed exceptions: Helium's bang
    list and the build-time engine fetch (which runs outside the namespace, before the exercise). Exercise launch,
    Settings › Updates, Report a Problem, a page load, and one run of at least the longest automatic timer interval
    with the timers enabled (telemetry flush, update check, kill-switch refresh), not only an isolated instance. Pass:
    zero upstream attempts in the nftables log and the proxy log for the whole exercise. Also confirm
    `~/.config/ardia` and libsecret items were not created.
11. `actionlint`, `xmllint`, `lychee`, `uv`, Android builds: CI or Mac items unless installed. `node --test
    scripts/lib/identity.test.mjs`; the paths-exist and turbo-filter script; the JNI check.

**On a Mac** (the session that receives the branch):
- `scripts/agent/locked pod -- pod install` (both Podfiles), `xcodebuild -list` (scheme `Nilla-macOS`),
  `scripts/agent/build-app --as <agent>` with the nearest engine.
- Hidden instance: `open -g -n --env ARDIA_BACKGROUND=1 --env ARDIA_DATA_DIR=<scratch> --env
  ARDIA_REMOTE_DEBUGGING_PORT=<port> Nilla.app`, then once more without `ARDIA_DATA_DIR` on a machine user account
  that has no Ardia profile. Check: the data folder `Application Support/com.nilladigital.nilla`; no "Ardia Safe
  Storage" access (the engine runs with `--use-mock-keychain`); Dock, menus and About say Nilla with the GPL notice and
  the Ardia credit; Updates says "not set up"; Report a Problem opens a GitHub draft URL without diagnostics; the icon
  picker shows 24 entries.
- No-upstream check (Mac; R20): the native senders' unit tests (empty config refuses), plus path-level evidence for
  the same exercise as Linux item 10, timers included: the hidden instance and every child (`Ardia Helper` renderers,
  the CLI) run with `HTTPS_PROXY`/`HTTP_PROXY` and `--proxy-server` pointed at a local logging proxy, and a pf anchor
  (`block drop log` for everything except the proxy and loopback) logs any process that bypasses it to `pflog0`. A
  single `nettop` sample is not enough. If pf can't be loaded on that Mac (no admin rights), the Mac row is reported
  **unverified** with the reason, and the sender logs are attached instead.
- `scripts/release/verify.sh --dev` against the build (Layer 1 mode, R31; the default mode needs an exported archive,
  Developer ID signing, a provisioning profile and Sparkle keys, which are Layer 2); Swift tests in `packages/*/tests`,
  including the regenerated sync vectors; an Ardia import from a copied fixture profile (OWNER-IMPORT); the iOS
  simulator build with the background sync task registered (`BGTaskScheduler` accepts
  `com.nilladigital.nilla.ios.sync`) and the shortcut and widget links opening `nilla://`; Android `gradlew
  testDebugUnitTest assembleDebug`, then `connectedDebugAndroidTest` for `ScriptEngineTest` on an emulator (C3: JNI
  linkage after the package move is **unverified** until it runs). Name what the screen lock prevented from being
  checked visually.

**On Windows (CI on the PR, x64 and ARM64; GitHub-hosted runners are the disposable isolation §0.2 requires):** fetch
upstream's pinned engine (`-Repository ${{ vars.WINDOWS_ENGINE_REPO || 'ardia-browser/ardia' }}`, D17, E9), launch with
`ARDIA_DATA_DIR`, tour, install and uninstall `Nilla-Setup-*.exe`, `installer-check.ps1`, `launcher-identity.ps1`
(AUMID). Assert no `%LOCALAPPDATA%\Ardia`, no `HKCU\Software\Classes\ArdiaHTM`, no `RegisteredApplications\Ardia`.
The bare-launch step runs last on the runner and passes only if `%LOCALAPPDATA%\Ardia` still doesn't exist afterwards;
the development-build message is logged but is not the pass condition (C5). No-upstream (R20): the runner's outbound
rule is set to block with Windows Firewall logging of dropped and allowed connections, plus a logging proxy set through
`HTTPS_PROXY` and `--proxy-server` for path-level evidence; the log covers the app, the engine's children and the CLI
for the whole tour, timers included. Only logs and smoke results are uploaded (R22). Engine-dependent checks are
reported unverified only if the engine fetch itself fails.

### 2.7 Layer 1 risks and limits

| Risk or limit | Mitigation |
| --- | --- |
| The nearest engine lacks newer `ac_*` symbols the app calls | Linux acceptance and the Mac smoke run on it; failures are existing gaps, recorded for Layer 2 |
| A mechanical rule hits an interface token | allowlist-only R, the pre-commit gate, engine suites, Linux runtime acceptance, Codex review |
| Engine-drawn Ardia text remains (chrome://credits, Web Store "Add to Ardia", notifications, class Q strings, `ardia://` in the address bar) | listed in the PR description as Layer 1 limits; D2 keeps the builds private |
| Mac passkeys, unexportable keys and SPC may not work with an ad hoc build and the engine's compiled team (R51) | not part of the Mac checks; §3 step 5 verifies them |
| Mac cookies and passwords use Chromium's mock key in Layer 1 | development builds only (D2) |
| A bare launch of the Windows or Linux engine opens the engine's compiled default profile (`%LOCALAPPDATA%\Ardia\User Data`, `~/.config/ardia`) before any app code runs | mandatory disposable OS isolation for every Windows and Linux run (§0.2); no installable artifact leaves it (R22); no launch entry is installed; app guards as defence in depth; CI asserts the folders never appear; Layer 2 renames the engine's defaults |
| A Linux Layer 1 package overlaps Ardia's runtime layout (`lib/ardia`, `bin/ardia`, desktop id, GeoClue identity) | extract-and-run only through `nilla-dev-run`; never `install.sh`, deb or AppImage on a host |
| The big rename conflicts with later changes to PRs 1-4 | freeze PRs 1-4 before R; otherwise rerun R's deterministic tool on the new base |
| Hiding the telemetry UI breaks consent tests | gate rendering and posting only |

---

## 3. Layer 2: `engine/` and the interface (branch `nilla/layer2`)

**Scope.** About 10,996 occurrences (engine tree 8,679, app side of the interface 2,317), plus everything §0.2 turned
off, in one branch:

- **Engine tree:** `engine/ardiacore` → `engine/nillacore`, `engine/ardiacore-linux` → `engine/nillacore-linux`;
  `//ardia/core` → `//nilla/core`, `//chrome/browser/ardia` → `//chrome/browser/nilla`; the mojom
  `nilla/core/mojom/nillacore.mojom`; `ARDIACORE_EXPORT` → `NILLACORE_EXPORT`, `g_ardia_*` → `g_nilla_*`; `ac_*` → `nc_*`
  (2,872 occurrences, 585 files, 456 file names) and `AC*` → `NC*` (D13); `ArdiaCore*` → `NillaCore*`.
- **Branding patches:** `ardia_namesub.py` → `nilla_namesub.py` (Helium → Nilla, `helium://` → `nilla://`, "The Chromium
  Authors" restored); `chromium-helium-branding*.patch` (flag and noise strings, crash product "Nilla", chrome://crashes
  link to `NoorChasib/nilla`, chrome://credits with `opensource_project: 'Nilla'`, Helium's GPL entry kept, an Ardia
  Apache-2.0 entry added); `chromium-branding.patch` `MAC_BUNDLE_ID=com.nilladigital.nilla`, `MAC_TEAM_ID=<owner's team>`
  (D15); `chromium-safe-storage-name.patch` "Nilla Safe Storage", then drop Layer 1's `--use-mock-keychain`; the engine
  assets from the branding manifest's Layer 2 entries, `Assets.car` built with `actool` on the Mac.
- **Linux engine:** remove the compiled URLs (`kEndpoint`, `kKillSwitchesUrl`, `kReleasesUrl`,
  `ac_linux_telemetry_policy.h`), so the app passes endpoints from `services.ts`; network-annotation text; `X-Nilla-Key`;
  sync salt, magic and folder matching Layer 1's other platforms, then re-enable Linux Sync and connected accounts by
  removing their gate rows; `nilla.desktop`, `StartupWMClass=nilla`, polkit `com.nilladigital.nilla.linux.reauthenticate`,
  libsecret `com.nilladigital.nilla.linux.{SyncKey,LiveToken}`, bundle id `com.nilladigital.nilla.linux`; default data
  folder `nilla`; `chrome://nilla/`; packaging `nilla/lib/nilla/`, `bin/nilla`, `nilla-launch`, `nilla.apparmor`,
  `com.nilladigital.nilla.linux.policy`, `nilla-cli-*.tar.gz`, `kInstallerName`, `Package: nilla`; then delete
  `layer1Gate.ts` and `nilla-dev-run`.
- **Windows engine** (`scripts/windows/engine/**`): install names, ProgIDs `NillaHTM`/`NillaPDF`, `kProductPathName`
  "Nilla" (`%LOCALAPPDATA%\Nilla`), launch scheme `nilla`, `ArdiaApp.dll` → `NillaApp.dll` with `NillaApp*` exports,
  `Ardia.test-build`, window class names, `LegalCopyright` "Noor Chasib", the `main.cc:422` copy. The installer's
  `[Registry]`, `[Icons]`, `[Run]` return with Nilla names, the `Ardia.cpp` start guard and `nilla-dev-run.ps1` go,
  and the default-browser and login actions come back.
- **App side, everything §0.4 held back:** `packages/ardiacore` → `packages/nillacore`, pod and module `NillaCore`,
  `@nilla/nillacore`; the contract files and their engine-test assertions changed together, including
  `sealed-0.2.32.b64`'s test moving to the Nilla vector; `page_script.js` event names; the Linux wire literals with the
  shim mapping deleted; `__nilla*` globals; `ArdiaControl.*` → `NillaControl.*`, "Nilla Tab History",
  `nillaOffscreen`, `/nilla-oauth`, `nilla.window.small`, `NillaPictureInPicture.plist`, the remaining `AC*` plist keys;
  `ARDIA_*` → `NILLA_*` (138 names) and `--ardia-*` → `--nilla-*` (30) including the prefix forwarding; `ardia://` →
  `nilla://` (Mac `IsAppURL`, renderer sources, Windows scheme) and stored app URLs, with the phone's synced URLs
  following; `ARDIACORE_PREBUILT_*` → `NILLA_ENGINE_*`; assets `NillaCore-<key>.tar.xz`, `nillacore-linux-x64/`,
  `nilla-engine-win-*.zip`; `ENGINE_REPO` → `NoorChasib/nilla` with the 8 upstream fetch lines flipped; the publish
  scripts upload to `NoorChasib/nilla`; the CLI's Linux home and artifacts become `nilla`; the folder
  `apps/browser/windows/Ardia`, `Ardia.ico` and `EngineApi.h` move.
- **Docs and assets:** remove `docs/brand/ardia/` once `gen.sh` and `tint_maps.py` stop reading it; the offline game is
  dropped or re-arted (D14); the engine paragraphs of AGENTS, CONTRIBUTING, README and `docs/engine-build*.md`; the
  allowlist shrinks to licence, credit, history and the Ardia importer.
- **Headers:** keep every `// Copyright 2026 Ardia. Apache-2.0.` line; new engine files get
  `// Copyright 2026 Noor Chasib. Apache-2.0.` No per-file "Modified" lines (owner's 4(b) answer).

**What it needs to build:** a Mac with the Chromium checkout at `~/chromium-build` (incremental only, holding
`scripts/agent/locked chromium`, never `gclient sync` or `gn clean`; `apply.sh` must delete the old `//ardia` and
`//chrome/browser/ardia` copies; `nilla_namesub` rewrites every `.grd`/`.xtb`, so expect hours of incremental build); the
owner's Apple team; a Linux build host (a Boat builder VM if the owner has an account) running
`scripts/linux/build.sh --apply`, then `publish-engine.sh --upload` to `NoorChasib/nilla` and a row in
`prebuilt-engines-linux.tsv`; the Windows cross-build in `~/chromium-build-win`, a Nilla `windows-engine-*` release
and a new `prebuilt.json` pin; new `prebuilt-engines.tsv` rows. Each engine release carries its per-platform source
archive (D9); `publish-engine.sh` and the Release `linux` job attach it and verify fails without it.

**How to verify it:**
1. `python3 engine/patches/series.py check`; `nilla_namesub.py --check-only` reports no `Ardia`.
2. Every engine suite passes, assertions updated in the same commit as the strings they assert.
3. The residual-name gate passes with the reduced allowlist.
4. A new engine key matched by all three pins; no `--nearest` in CI.
5. Mac hidden instance: chrome://settings/help, chrome://credits (Nilla, crediting Ardia, Helium, Chromium), the
   notification icon, "Add to Nilla", `nilla://settings`, a "Nilla Safe Storage" keychain item, Touch ID passkeys, an
   unexportable key and SPC under the owner's team.
6. Linux: `acceptance:linux`, `chrome://nilla/`, default-browser registration through `nilla.desktop`, polkit re-auth,
   libsecret entries under `com.nilladigital.nilla.linux`, Sync on.
7. Windows CI: install, uninstall, default browser, data in `%LOCALAPPDATA%\Nilla`, shortcuts with the AUMID.
8. Coexistence on each platform: Nilla installed beside Ardia shares no data folder, keychain item, registry key,
   desktop id, CLI rendezvous or sync folder.
9. Sync: Mac, Linux, Windows and phone pair and exchange tabs with the Nilla salt.
10. The full suite on all three platforms, and a Codex review (keychain, sync, data paths, URL scheme).

---

## 4. Licensing and attribution that must be preserved

- `LICENSE` (GPL-3.0, md5 `1ebbd3e3...`) and `LICENSE.Apache-2.0` (md5 `3b83ef96...`) byte for byte; `third_party/**`,
  `credits.json`, both `THIRD_PARTY_NOTICES.txt`; the DMG fonts' OFL texts and copyright lines (D24, or no fonts).
- **NOTICE:** Nilla's block on top (§2.3 F), then Ardia's 27-line NOTICE byte for byte (Apache §4(d)). The dated
  modification statement and git history meet GPL §5(a) and Apache §4(b) (owner's answer). History is never squashed:
  the stack and the `nilla/*` branches merge by merge commit.
- **Headers, unchanged:** the 89 `Copyright 2026 Ardia. Apache-2.0.` lines, the 16 SPDX lines, the 13 Helium patch
  headers, and the third-party headers (Readability, AutoscrapeLabs, the icon sets, gradlew). No automated pass strips
  them.
- **Where users see the notices:** Mac About, Linux About and the shared Settings › Updates line state the GPL, the
  absence of warranty and a source link, "Based on Ardia" and "built on Chromium, Helium and uBlock Origin"; Windows
  version resources carry the credit; chrome://credits keeps Chromium's and Helium's entries (Layer 2 adds Ardia's); the
  phone licences page has a Nilla row and an Ardia row pointing at `ardia-browser/ardia`.
- **Packages carry** LICENSE, LICENSE.Apache-2.0, NOTICE, and the third-party texts for what each one bundles:
  `third_party/bangs/LICENSE` where the bang list ships (Mac, Linux, Windows, phone), the symbol
  `THIRD_PARTY_NOTICES.txt` where the web symbol shims ship (Linux, Windows), and the CLI's bundled runtime licences
  (CPython, esbuild, websockets, axe-core). Producers, destinations, owners and assertions per package are in the §2.3
  wave 3 licence table (R31); the Layer 1 Mac check is `verify.sh --dev`.
- **Licence fields:** Arch `license=('GPL-3.0-only' 'Apache-2.0')`; root `"license": "SEE LICENSE IN NOTICE"`;
  `apps/cli/pyproject.toml` Apache-2.0; Raycast MIT with its own `LICENSE` naming Mantra Patel (`mantrakp04`), the
  contributor `ridemountainpig` and Noor Chasib (D25).
- **Corresponding Source:** Layer 1 binaries never leave the machine or CI runner they were built on (D22, R22), so
  Layer 1 conveys no object code; every Nilla release carries its engine's per-platform source archive (D9).
- **No CLA, no relicensing.** Ardia-derived code stays Apache-2.0 as files and GPL-3.0 as distributed; Nilla's new files
  are Apache-2.0.
- **The Ardia name and logo** appear only as credit (NOTICE, README Acknowledgements, About, chrome://credits, the phone
  licences, the Raycast LICENSE and contributors), in `docs/history/ardia/` and git history, as the import-source name
  of the Ardia importer row C-mac adds (no logo), and until Layer 2 in the §0.4 interface names and `docs/brand/ardia/`.
- **Never shipped as Nilla's:** Ardia's site content, testimonials, legal pages, screenshots, perf claims, marketing
  films, the old New Tab hills and the offline-game art.

---

## 5. Base and delivery

**State on 2026-11-18:** `main` (`c62611bb7`, base of PR 1), `phase1/sidebar-settings` (`c62611bb7`),
`phase2/bun-migration` (`ba7cc712b`), `phase3/final-candidate` (`e15125104`), `phase4/audit` (`3f488d687`, which forks
at `2e9c24a46`, 12 commits behind PR 3's tip, and adds one file, `docs/audit/2026-11-18-performance-and-architecture.md`).
No PRs are open on `NoorChasib/ardia`.

**Steps:**
1. **Repo settings first** (lead, with the owner's OK; reversible, no commit): disable the CLA, Vouch, Vouch manage,
   Linked issue and Deploy workflows (`gh workflow disable "<name>" -R NoorChasib/ardia`); the owner checks
   `github.com/settings/installations` for Greptile, CodeRabbit, Bonzai or a CLA app on the fork.
2. **Settle the stack.** Restack `phase4/audit` onto PR 3's final tip, so PR 4's final head is PR 3's tip plus the one
   docs commit, and open PRs 1-4. The lead renames the repo to `NoorChasib/nilla` once they're open (decision 3); GitHub
   redirects the old URLs.
3. **Cut `nilla/layer1`** from PR 4's final head, only once `git merge-base --is-ancestor <PR3 final> <PR4 head>` holds:
   `git checkout -b nilla/layer1 <PR4 head>` in the shared checkout with no other session holding uncommitted work (the
   `guard-git` hook allows `checkout -b`). Wave 0 then records `engine/engine-key.sh HEAD` (expected `2d8afa2a646d...`
   unless PRs 1-4 change `engine/`), the baseline of every §2.6 check, and regenerates at that commit:
   `naming_census.py` → `census.tsv`, the branding hand-off's manifest check and string inventory, and
   `ownership_v2.py` → `work/ownership-v2/`. Freeze PRs 1-4 from here. If either moves later:
   `git rebase --onto <new PR4 head> <old PR4 head> nilla/layer1`, then rerun `ownership_v2.py` and its closure check,
   and rerun R's tool if R had run.
4. **Run waves 0-4** (§2.4), one commit per step. Push `nilla/layer1` (`git push -u origin nilla/layer1`).
5. **Owner review, then one PR**, `nilla/layer1` with PR 4's branch as base (it retargets as the stack merges). The
   description: what changed per phase, which checks ran where, what still needs a Mac or a visual check, and the
   Layer 1 limits (§2.7). No `Closes #` requirement (G removed the check). Windows CI runs on it. Layer 1 never runs
   `publish-engine.sh --upload`, `publish_engine.py` with upload, or any release job.
6. **Follow-up PRs, after the four stacked PRs:** the phone hill-climb (`phone/hill-climb`, based on PR 2); the removal
   of the phone's Compose-app upgrade importer (§0.5 item 6), on top of `nilla/layer1`.
7. **`nilla/layer2`** branches from `nilla/layer1`'s head as a draft PR stacked on it. Its CI fails at the engine fetch
   until Nilla engines are published and pinned; it becomes ready only after §3's verification on all three platforms.

**Merge order** (merge commits throughout): PR 1 → PR 2 → PR 3 → PR 4 → `nilla/layer1` → (Nilla engines built and
pinned) → `nilla/layer2` → the first Nilla release (D9, D15, D16).

---

## 6. Coverage of every review finding

`C` numbers are `review-codex.md`'s 12 findings; `R` numbers are `plan.md` §6 (each matches `plan-review.md`'s `F`
with the same number).

| Finding | Handled in | Note |
| --- | --- | --- |
| C1 engine-owned file names (ArdiaControl.json, "Ardia Tab History", ardiaOffscreen) | §0.4 classes A-C, §2.3 D step 2 | contract list on every platform |
| C2 shorter name breaks module dispatch | §0.1, §0.5 item 1, §2.3 D step 6 | blocker superseded: Nilla has 5 letters; mapping tests kept |
| C3 Kotlin package move versus JNI | §0.1, §2.3 D step 5 rule 9, step 9, §2.3 wave 3 C-phone, §2.6 Mac | JNI names generated from the package map, checked statically; `ScriptEngineTest` runs on an emulator in wave 4, JNI unverified until then |
| C4 contract list incomplete (Navigation.mm, sealed vector) | §0.4 classes K-L, §2.2, §2.3 C | 85 direct files mechanically found; Nilla vector under a new name, vector tree regenerated on the Mac (E2) |
| C5 Layer 1 independence | §0.2 (OS isolation), §0.5 item 2, §2.3 C, §2.6, §2.7, §7 item 1 | disposable OS isolation mandatory on Windows and Linux; no installable artifacts; bare launch judged by folders, not the message |
| C6 M deletes definitions with compiled dependants | §0.5 items 6-7, §2.2, §2.3 M | closure computed; phone importer kept |
| C7 G/W/D files never renamed | §2.2, §2.3 G (root files), §2.3 D step 1 | 69 of 74 scheduled, 0 unscheduled |
| C8 Windows update constants | §0.3, §2.3 B Updates | feed and non-empty prefix required |
| C9 Linux services target upstream; consent-free daily sending | §0.3, §2.3 B Linux gate and Telemetry | gate at the `host.ts` boundary, filters `report.send`, zero native calls tested; daily ping deleted |
| C10 infra/feedback depends on deleted infra | §2.3 B infra/feedback, §2.3 W | self-contained template with its own key loader and a loopback submission check |
| C11 service verification misses native transports; override plumbing | §0.3, §0.5 item 9, §2.3 B (test override wiring, kill switches), §2.3 C launch configs, §2.6 | key lists owned by I, readers by S, one validated snapshot before consumers; switches decoupled from the updater |
| C12 Apache-2.0 4(b) | §0.5 item 4, §1, §4 | settled by the owner: NOTICE plus history, merge commits |
| R1 module names, Linux shim timing, tests | §0.4 class H, §0.5 item 1, §2.3 D step 6 | prefix-length rewrite superseded |
| R2 ArdiaControl names, CLI Linux folder, browse check | §0.4 class A, §0.2 CLI rows, §2.6 item 8 | – |
| R3 engine literals repo-wide | §0.4 (classes C, E, F, G, I, J and the maintenance paragraph), §2.2 | every non-engine file scanned; 8,850 occurrences with spans; exclusions listed with reasons |
| R4 contract-files regenerated mechanically | §0.4 class K, §2.2 | joined-path reads, recursive closure, `REQUIRED_CONTRACT` regression list; direct versus transitive rows |
| R5 `Package: ardia` kept | §0.1, §0.4 class N, §2.3 C Linux, §2.3 wave 3 C-linux | metadata edits are C-linux's only, with the engine assertion in its checks |
| R6 ArdiaWindowController.mm and pageEvents.ts are contract files | §2.1 boundary, §0.4 class M | – |
| R7 M owns the closure | §0.5 items 6-7, §2.2, §2.3 M | narrowed to the Netnyahoo migration; I detaches sync files first |
| R8 R covers G/W/D files; path and filter check | §2.2, §2.3 D steps 1 and 9 | – |
| R9 site removal dependants | §0.6, §2.3 W, §2.3 B kill switches, §2.3 G hand-offs, §2.4 lead | relative tree kept under `packages/shaders/meadow-src/`; every path update listed; `switches.json` moved by S |
| R10 app scheme spellings | §0.4 class F | test on `toAppUrl` |
| R11 Linux CLI artifact names | §0.1, §0.4 class N, §2.3 wave 3 C-cli-extras | `bin/nilla-browser` instead of `bin/nila` |
| R12 Windows test marker, export, EngineApi.h, folder and .ico | §0.4 classes O-P, §2.1, §2.3 D step 3, §2.3 E | – |
| R13 allowlist-only R, whole-file skips, pre-image gate | §0.4 mechanisms, §2.2 (R skips), §2.3 D steps 2-3 | explicit eligible list; line freeze only for exact asserted lines, span checks otherwise |
| R14 escaped alias regexes | §2.3 D step 6 | one recipe per site, anchors and targets kept, resolution and import-guard tests |
| R15 services override and native mirrors | §0.5 item 9, §2.3 B hook, Kill switches, CLI, Docs | – |
| R16 Windows `configured()` and empty prefix | §0.3, §2.3 B Updates | – |
| R17 daily ping | §0.3, §1 D23, §2.3 B Telemetry | deleted, with the `DAILY_DOC` entry and the local-copy test replaced |
| R18 Linux never calls the service methods | §0.3, §2.3 B Linux gate, §0.5 item 8 | – |
| R19 Linux extract-and-run with scratch profile | §0.2 Linux rows, §2.6 item 9, §2.7 | plus `nilla-dev-run` and the UI page |
| R20 egress-level no-upstream check | §0.3, §2.6 items 10 and Mac/Windows | deny-by-default egress, children included, path-level proxy logs, timers exercised; unverified when missing |
| R21 release scripts moved whole, upstream probes removed | §2.3 G, `moves.tsv` | moves and deletes disjoint; upstream release text removed; entry points refuse before building |
| R22 no installable CI artifacts | §0.2, §0.5 item 5, §1 D2/D22, §2.3 G Artifacts, §4 | restored: logs and smoke results only; private binaries need the owner's approval |
| R23 infra/feedback deploy scaffolding | §2.3 B infra/feedback | – |
| R24 Android namespace, folders, JNI | §2.3 C Phone, §2.3 D steps 3, 5 (rule 9), 9 | – |
| R25 generated move table | §2.3 D step 3 | – |
| R26 strip upstream issue numbers | §1 D19/D21, §2.3 F, §2.3 wave 3 C-repo-docs | `docs/audit/` untouched; provenance in `docs/history/ardia/README.md` |
| R27 generated outputs and RN patches | §2.1, §2.3 M, §2.3 D steps 3, 6, 8, §2.4, §2.5 | generated files are the lead's, excluded from R, regenerated after each wave |
| R28 commands that work here | §2.3 W, §2.4 wave 4, §2.6 items 2, 6, 11 | DMG rendering is Mac-only, wave 4; sources and portable checks in wave 1 |
| R29 CLI pyproject in R's commit | §2.3 D step 3 | module `nilla_browser_cli` |
| R30 Linux engine source archive | §1 D9, §3 build needs | Layer 2 |
| R31 every package carries the licence texts | §4, §2.3 wave 3 licence table, §2.6 Mac | producer, destination, owner and assertion per package; `verify.sh --dev` for Layer 1 |
| R32 DMG fonts' OFL texts | §0.5 item 11, §1 D24, §2.3 W | system fonts by default; fetch only with the owner's approval; renderer assertion updated |
| R33 THIRD_PARTY_NOTICES and credit spans; positive test | §2.1 text never renamed, §2.3 D steps 7-8 | – |
| R34 holder "Noor Chasib" | §1 D20 | confirmed by the owner |
| R35 issue draft without diagnostics | §2.3 B Report a Problem | – |
| R36 other upstream links | §2.3 B Other links | `frameable.ts` is at `packages/demo/src/frameable.ts` |
| R37 Windows installer only on CI or a VM; AUMID together; `-Repository` | §0.2 Windows rows, §2.3 C Windows, §2.3 G | no shortcuts or registry in Layer 1, so the AUMID lives only in code |
| R38 phone credits.json after lockfiles | §2.4 lead steps, §2.5 | – |
| R39 `.nls` only for vault files | §0.1, §2.3 C Sync | – |
| R40 Linux `appName` display | §2.3 wave 3 C-linux | – |
| R41 only two `AC*` plist keys renamed | §0.4 class J, §2.3 B Updates | – |
| R42 TargetAttributes teams, BrowserSchema app group, ad hoc entitlements | §2.3 C Mac and Phone | – |
| R43 never upload engines in Layer 1 | §2.3 G, §5 step 5 | – |
| R44 lockfiles to the lead; `windowsSyncDouble.mjs` to I | §2.2, §2.3 C Sync, §2.5 | – |
| R45 cut the branch only when the stack holds; rebase recipe | §5 step 3 | – |
| R46 `docs/windows/*.png` archived and unlinked | §2.3 F, §2.3 wave 3 C-repo-docs | – |
| R47 merge commits, NOTICE in wave 1 | §0.5 item 4, §2.3 F, §4, §5 | – |
| R48 Raycast MIT LICENSE | §1 D25, §2.3 C Raycast, §4 | names `mantrakp04` and `ridemountainpig` |
| R49 trademark disclaimer line | §2.3 F NOTICE and README | in both |
| R50 phone Apache text in the D15 checklist | §1 D15 | – |
| R51 Mac passkeys, unexportable keys, SPC unverified | §0.2 Mac row, §2.7, §3 step 5 | – |

---

## 7. Not resolved by this plan

1. **Bare launches on Windows and Linux.** No app code runs before the prebuilt engine opens its compiled default
   profile (`%LOCALAPPDATA%\Ardia\User Data`, `~/.config/ardia`). Layer 1 closes this by keeping every Windows and
   Linux binary inside disposable OS isolation and uploading no installable artifact (§0.2, R22); the app guards are
   defence in depth, not the boundary. Only Layer 2's engine rename (or an enforced pre-engine launcher) lets those
   binaries run on an ordinary machine.
2. **Windows engine and the `Ardia.cpp` guard.** Whether `ArdiaAppStart` can quit before Chromium writes to the
   profile, and whether the engine sets its own AUMID, are only provable in Windows CI.
3. **`--use-mock-keychain` on normal Mac launches** is inferred from `docs/engine-build.md:299` and `docs/testing.md:224`;
   the Mac session confirms that no "Ardia Safe Storage" prompt or item appears.
4. **The 326 engine literals** (8,850 occurrences) need the lead's protect-or-rename classification in wave 0; the scanner also reports a few
   false positives in `contract-files.tsv`.
5. **Linux maintainer address** (D19) uses the GitHub noreply form unless the owner gives one.

---

## Verification log (2026-11-18)

Two verifiers' 40 gaps, each reproduced against this plan and the code at `e15125104`. All 40 were real; none was
rejected. Tool changes are in `tools/ownership_v2.py` (rerun; outputs in `work/ownership-v2/`) and the new
`tools/remap_lists.py`. After the fixes: overlaps inside a wave 0/0/0, files with Layer 1 hits and no schedule 0,
retained G/W/D files unscheduled 0, required contract paths missing none.

| Gap | Result | Reason |
| --- | --- | --- |
| C5 | fixed | Windows picks the profile before app code (`main.cc:611-619` vs `:538-545`) and Linux defaults to `ardia`; §0.2 now makes disposable OS isolation mandatory, bans installable artifacts, and judges bare launches by folders |
| C9/R18 | fixed | adapters call `invokeHost` directly; the gate moves to `host.ts` (S's in wave 1), filters `report.send`, and a zero-native-calls test covers adapters and proxies |
| R9 | fixed | the flattened move broke `./meadow/*` and `../assets/hero`; the tree is kept under `packages/shaders/meadow-src/`, every path update listed, `switches.json` moved by S |
| R13 | fixed | the gate froze lines that must change (`scripts_cli.py:73`); explicit eligible list, line freeze only for exact asserted lines, span checks otherwise |
| R22 | fixed | v2 reversed R22 with no owner decision; logs and smoke results only, private binaries need the owner's approval |
| C10/R23 | fixed | `core.mjs:5-14` and `service.mjs:3,11` need the removed keys; new `keys.mjs`, env keys in production, test-only local keys, loopback check |
| C11/R15 | fixed | override had no native owners or startup order and switches needed the updater; I owns the key lists, S the readers, one validated snapshot, switches decoupled |
| C3 | fixed | `ScriptEngineTest.kt` was never scheduled; runs on an emulator in wave 4, JNI unverified until then |
| R3 | fixed | the scan covered R and two wave-3 buckets with 5 samples; now every non-engine file, 8,850 occurrences with spans, 101 exclusions with reasons |
| R4 | fixed | one-level imports and no joined paths; recursive closure with side-effect imports, `joined-path` rows, `REQUIRED_CONTRACT` list |
| R5 | fixed | `linux_formats.py` was I's in the brief but C-linux's in the list; metadata edits are C-linux's only |
| R14 | fixed | one recipe broke the shell-only and subpath-plus-Expo patterns; one replacement per site with resolution and guard tests |
| R17 | fixed | `localCopy.test.mjs:13,89` and `hostTelemetry.ts:28` still used the daily module; both edits and a replacement test are S's |
| R20 | fixed | one `nettop` sample and address-only logs; deny-by-default egress, children included, path-level proxy logs, timers, unverified when missing |
| R21 | fixed | `moves.tsv` moved three deleted scripts and `publish.sh:123`, `release.sh:225` kept upstream text; moves and deletes disjoint, text removed, entry points refuse before building |
| R27 | fixed | `ardia-sync.js` was scheduled for R; generated files are the lead's, excluded from R, regenerated after each wave |
| R28 | fixed | `render.sh` needs `sips`/`tiffutil`; `background.tiff` is the Mac's in wave 4, sources stay in wave 1 |
| R31 | fixed | producers and assertions were missing and `verify.sh` can't run on an ad hoc build; per-package licence table and `verify.sh --dev` |
| R32 | fixed | fetch was no longer owner-approved and `render.sh:22-25` required the fonts; system fonts by default, assertion updated |
| R26 | fixed | `docs/audit/*` is X-keep (empty at `e15125104`); audit stays byte for byte, provenance in `docs/history/ardia/README.md` |
| R49 | fixed | the disclaimer was only in NOTICE; README Acknowledgements carries it too |
| OWNER-CLI | fixed | `build.sh` lagged the module move and `install.sh`/`CliInstaller.swift` used upstream and Ardia's home; R edits `build.sh` in the move commit, I renames the link and Mac homes, fail-closed acquisition, install test |
| OWNER-URL | fixed | rule 3 turned `https://github.com/ardia-browser/ardia/...` into `https://NoorChasib/nilla/...`; split into qualified, escaped and bare rules plus a leftover report |
| OWNER-PHONE | fixed | the main iOS plist (URL type, BG task id) was R's while I changed the scheme; registrations, BG id, shortcuts and the scheme split are one I commit |
| OWNER-IMPORT | fixed | no Ardia source in `Discovery.swift`; C-mac adds a Chromium-family `ardia` row, user-initiated only, verified from a copied fixture |
| OWNER-README | fixed | the draft listed deleted workspaces and ran the Linux engine directly; build block replaced with retained workspaces and isolated entry points, `--nearest` bounded |
| OWNER-NOTICE | fixed | the second sentence was paraphrased; the owner's two sentences verbatim, credit in a separate sentence |
| E1 | fixed | `cycle.ts:20` and `view.ts:3` import the deleted `legacy.ts`; closure now follows relative imports, and the four files are M's |
| E2 | fixed | 43 of 47 vector files had no owner and two were R's; I owns the tree and tests, R skips it, Mac regeneration step named, sealed-vector generator and readers named |
| E3 | fixed | 815 of 2,626 wave 3 paths are pre-rename (counts match); `remap_lists.py` runs after R, the tool is never rerun after wave 2 |
| E4 | fixed | tests reading I's native files and `installed_data_dir()` callers were not I's; a native-file test pass (8 rows) plus explicit CLI rules, expected-red list recorded |
| E5 | fixed | briefs named files owned elsewhere; overrides give `verify.sh`, the launch configs, `host.ts`, `liveServices.mjs` and `switches.json` to the briefed owner, the rest became hand-offs (22 rows) |
| E6 | fixed | `videos`, `assets/app-icon`, `scripts/windows`, `apple-touch-icon.png` keys made 30 false W/G rows; generic keys dropped (1 W row left, a real one), bundles moved to the lead |
| E7 | fixed | census rerun missing, three inputs ungenerated, rename tool not yet in wave 0, move-only files not staged; all four stated (115 move-only files after the fixes) |
| E8 | fixed | `RELEASE_REPO`/`ENGINE_REPO` don't exist; keep `REPO`/`REPO_URL`, change the value, add `ENGINE_REPO` for two uses |
| E9 | fixed | skip-while-empty contradicted the required Windows checks; CI passes `vars.WINDOWS_ENGINE_REPO \|\| 'ardia-browser/ardia'` |
| E10 | fixed | wave 3 had no checks and the table disagreed with the tool; per-owner checks column, Mac-only steps in wave 4, lists decide |
| E11 | fixed | about 210 CLI mentions outside C-cli-extras and uv_build's default module name; rule 13a, per-owner candidate report, `module-name` |
| E12 | fixed | three manifest assets and two Ardia-logo drawables had no owner; added to B, manifest-coverage check added |
| E13 | fixed | G's grep always matched, M's check ignored known leftovers, W's check depended on B; scoped grep, exact leftover list with owners, timing-independent meadow check |
| E14 | fixed | D wrote post-rename paths before they existed; D gets the wave 0 move table, the link check moves after R |
| E15 | fixed | deleted scripts in `moves.tsv`, W-deleted lockfiles in L-lead, wrong frozen path, importer mentions, `com.ardia.signing`, `DS_Store` list, the two capability constants; all corrected |
