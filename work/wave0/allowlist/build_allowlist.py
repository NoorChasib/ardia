#!/usr/bin/env python3
"""usage: build_allowlist.py <repo> <ref> <ownership-dir> <out-json> <out-decisions.tsv>

Writes Layer 1's naming allowlist (apps/browser/src/naming-allowlist.json) from the
wave 0 ownership outputs and the lead's classification of every engine literal."""
import collections
import csv
import fnmatch
import json
import re
import subprocess
import sys

if len(sys.argv) != 6 or sys.argv[1] in ("-h", "--help"):
    sys.exit(__doc__)
repo, ref, own, out_json, out_tsv = sys.argv[1:6]


def git(*args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, errors="replace", check=True).stdout


def tsv(path):
    with open(path, encoding="utf-8") as f:
        rows = list(csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE))
    return rows[0], rows[1:]


commit = git("rev-parse", ref).strip()
engine_key = subprocess.run([f"{repo}/engine/engine-key.sh", ref], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()

LINUX = ["apps/linux/*", "scripts/linux/*", "docs/linux-*.md", "docs/perf/*linux*.md"]
CLI = ["apps/cli/*", "docs/cli.md"]
WINDOWS = ["apps/browser/windows/*", "scripts/windows/*", "packages/expo-windows/*", ".github/workflows/windows.yml",
           "apps/browser/src/platform/windows*", "docs/windows.md", "docs/windows/*"]
LINUX_LAYOUT = LINUX + CLI + [".github/workflows/linux.yml", ".github/workflows/release.yml", "packages/shell/scripts/*",
                              "scripts/release/*", "docs/releasing.md"]

FROZEN = ["engine/*", "scripts/windows/engine/*", "apps/browser/assets/offline-game/*",
          "apps/browser/assets/offline-game-pipeline/*", "packages/ardiacore/prebuilt-engines*.tsv",
          "packages/ardiacore/scripts/fetch-engine.sh", "packages/ardiacore/scripts/ubo.sh",
          "packages/ardiacore/ios/page_script.js", "packages/ardiacore/src/engine/api.ts", "docs/brand/ardia/*",
          "scripts/windows/fetch-engine.ps1", "scripts/windows/engine-source.sh", "scripts/engine-source.sh",
          "scripts/linux/ardia.apparmor", "scripts/linux/ardia-launch", "scripts/linux/dev.ardia.linux.policy",
          "apps/browser/windows/Ardia/EngineApi.h", "packages/sync/tests/fixtures/sealed-0.2.32.b64"]
KEEP = ["LICENSE", "LICENSE.Apache-2.0", "NOTICE", "third_party/*", "docs/perf/*", "docs/audit/*", "docs/history/*",
        "*THIRD_PARTY_NOTICES.txt"]
LEAD = ["bun.lock", "*/bun.lock", "*Podfile.lock", "*package-lock.json", "*yarn.lock", "*uv.lock", "*pnpm-lock.yaml",
        "*gradle.lockfile", "apps/browser/src/conventions-baseline.json", "apps/phone/src/state/settings/credits.json",
        "scripts/dmg/DS_Store", "scripts/dmg/background.tiff", "apps/browser/src/naming-allowlist.json"]
GENERATED = ["packages/phone/ios/ArdiaKit/Sources/ArdiaShared/Scripts/ardia-core.js",
             "packages/phone/ios/ArdiaKit/Sources/ArdiaShared/Scripts/ardia-sync.js",
             "packages/shaders/ios/Meadow/*", "packages/shaders/windows/meadow/page.ts"]
D_FINAL = ["README.md", "CONTRIBUTING.md", "AGENTS.md", "CLAUDE.md", "docs/release-notes/README.md", "docs/releasing.md"]
SKIP_HAND = {"scripts/linux/package.py": "C-linux", "scripts/linux/install.sh": "C-linux",
             "scripts/linux/runtime_files.py": "C-linux", "scripts/linux/linux_formats.py": "C-linux",
             "scripts/linux/arch/PKGBUILD": "C-linux", "scripts/linux/fetch-engine.sh": "C-linux",
             "scripts/linux/publish-engine.sh": "C-linux", "scripts/linux/publish_engine.py": "C-linux",
             "scripts/linux/smoke.mjs": "C-linux", "apps/cli/install.sh": "C-cli-extras",
             "apps/cli/scripts/build.sh": "C-cli-extras"}
SKIP_TREE = ["packages/sync/tests/fixtures/sync-vectors/*"]

protect = []
pid = set()


def add(id, cls, why, *, text=None, regex=None, scope=None, exclude=None, boundary="word", quoted=False, mechanism=None, keeps_bundle_name=False):
    assert id not in pid, id
    pid.add(id)
    row = {"id": id, "class": cls, "mechanism": mechanism or ("class" if regex else "literal")}
    if text is not None:
        row["text"] = text
        row["boundary"] = boundary
        if quoted:
            row["quoted"] = True
    else:
        row["regex"] = regex
    if scope:
        row["scope"] = scope
    if exclude:
        row["except"] = exclude
    if keeps_bundle_name:
        row["keepsBundleName"] = True
    row["why"] = why
    protect.append(row)
    return id


add("S-env", "S", "Every ARDIA_* variable stays until Layer 2; 27 are engine-read and two paths forward by prefix.",
    regex=r"(?:(?<![A-Za-z0-9_])|(?<=-D))ARDIA_[A-Z0-9_]*")
add("S-switch-prefix", "S", "Every --ardia-* switch and the dynamic --ardia- prefix stay until Layer 2.",
    regex=r"--ardia-[A-Za-z0-9-]*")
switches = sorted(open(f"{own}/../eng_switches.txt").read().split(), key=lambda s: (-len(s), s))
add("S-switch-names", "S", "Engine switch names written without their dashes (lists, regexes, argument builders).",
    regex=r"(?<![A-Za-z0-9_])(?<![A-Za-z0-9_]-)(?:" + "|".join(re.escape(s) for s in switches) + r")(?![A-Za-z0-9_-])",
    exclude=["apps/phone/*"])
add("S-prefix-forwarding", "S", "The quoted engine switch prefix the Mac launch filters drop from chromiumSwitches and forwarded arguments (the engine reads \"ardia-\" + key, ac_launch_switches.cc), the wiring test that pins it (council C2), and the reserved-switch test that filters with it (close: user-data-dir and engine switches in either dash spelling).",
    text="ardia-", boundary="none", quoted=True,
    scope=["packages/ardiacore/ios/ArdiaHost+Launch.mm", "packages/ardiacore/tests/launch-config-switches.test.mjs", "packages/ardiacore/tests/chromium-switches.test.cc"])
add("R-ardiacore", "R", "The ArdiaCore interface: any token containing ardiacore in any case.",
    regex=r"(?i)[A-Za-z0-9_]*ardiacore[A-Za-z0-9_]*")
add("R-scope-ardiacore", "R", "The package name @ardia/ardiacore keeps its scope (rule 12 exception).",
    regex=r"@ardia(?:\\?/)(?=ardiacore)")
add("R-g-ardia", "R", "Engine globals g_ardia_*.", regex=r"(?<![A-Za-z0-9_])g_ardia_[A-Za-z0-9_]*")
add("R-engine-paths", "R", "Paths into engine/ and scripts/windows/engine (the engine key's files keep their names).",
    regex=r"(?:\.\./)*(?:engine|scripts/windows/engine)/[A-Za-z0-9_.+/-]*")
add("R-engine-gn", "R", "Engine source paths and GN labels inside the Chromium tree.",
    regex=r"(?<![@A-Za-z0-9_.\\-])(?://)?(?:chrome/browser/ardia|chrome/app/theme/ardia|ardia/(?:core|linux|win))(?![A-Za-z0-9_])(?:[/:][A-Za-z0-9_.+/:-]*)?")
add("C-page-globals", "C", "Page and host globals the engines define or call (__ardiaHost, __ardiaReply, __ardiaEvent, __ardiaBootstrap).",
    regex=r"__ardia[A-Za-z0-9_]*")
add("C-ardiaRequest", "C", "The Linux host's request binding name.", text="ardiaRequest")
add("C-ardiaOffscreen", "C", "Target info field the engine adds (ac_cli_token_policy_events.cc).", text="ardiaOffscreen")
add("C-littleArdia-report", "C", "The engine's video upscaling report key littleArdia (ac_video_upscaling.mm:266).",
    text="littleArdia", scope=["apps/browser/scripts/video-upscaling-test.mjs"])
add("C-elementPicker", "C", "Symbol.for key the Linux engine's page evaluation reads.", text="ardia.elementPicker", boundary="none")
add("F-page-operations", "F", "Page-script names inside the evaluations ac_linux_page_operations.h pins by length and SHA-256 (apps/linux/scripts/page-operations.mjs --check): changing them makes the prebuilt Linux engine refuse the reader and element-picker operations.",
    regex=r"ardia\.(?:reader|elementPicker)\b|(?<![A-Za-z0-9_-])ardia-(?:reader|element-picker|box|tag|hint)(?![A-Za-z0-9_-])")
add("D-dom-hooks", "D", "DOM ids, classes, attributes and policies the engines read or write.",
    regex=r"(?<![A-Za-z0-9_])(?:data-)?ardia-(?:reveal|hide-element[A-Za-z0-9-]*|pip-[A-Za-z0-9-]*|ver|bridge|symbols|blocking-off|reload)(?![A-Za-z0-9_])")
add("D-uBO-reload", "I", "uBO storage key the Mac fetch and the Linux seed share.", text="ardiaReloadPending")
add("I-uBO-seed-prefix", "I", "ubo-seed strips every storage key that starts with ardia (the engine's own keys).",
    text="ardia", quoted=True, scope=["scripts/linux/ubo-seed.mjs"])
for t, why in [("ardia.window.small", "Little window identifier the Mac engine matches (ac_video_upscaling.mm:31)."),
               ("ArdiaProbe", "Windows engine probe."), ("ArdiaHTM", "Windows engine ProgID (chromium-win-install-names.patch).")]:
    add("E-" + t, "E", why, text=t, boundary="word")
add("F-scheme", "F", "The ardia: app URL scheme in every spelling (URLs, escaped and double-escaped regexes, quoted scheme names, alternations). A call's only argument, such as Python's str(ardia) or os.readlink(ardia), is a variable, not an alternation, and renames with its assignment.",
    regex=r"(?<![A-Za-z0-9_.-])ardia(?=:(?:\\{0,2}/|\(|[\"'`\])]))|(?<=[(|])(?<![A-Za-z0-9_]\()ardia(?=[|)])|(?<=:)ardia(?=\|)")
add("F-app-scheme-const", "F", "APP_SCHEME and scheme comparisons with the bare name.",
    regex=r"(?<=APP_SCHEME = [\"'])ardia(?=[\"'])|(?<=scheme === [\"'])ardia(?=[\"'])|(?<=scheme == [\"'])ardia(?=[\"'])|(?<=@\")ardia(?=\")")
add("F-phone-browse-scheme", "F", "The phones' browse scheme constants, BrowserUrl.BROWSE_SCHEME on Android and BrowserURL.browseScheme on iOS. ExternalLinks, WebViewPage and WebTab compare them with the scheme of the internal ardia:// app and synced URLs, which F-scheme keeps, so each constant keeps ardia with the URLs it classifies, and identity.test.mjs asserts that value. The system-link scheme is the separate nilla constant (owner I, 3fdb394ea).",
    regex=r"(?<=BROWSE_SCHEME = \")ardia(?=\")|(?<=browseScheme = \")ardia(?=\")",
    scope=["packages/phone/android/*/BrowserUrl.kt", "packages/phone/ios/*/TabPolicies.swift", "scripts/lib/identity.test.mjs"])
add("F-scheme-list", "F", "The bare ardia scheme in the omnibox's KNOWN_SCHEMES set (plan 0.4 F): ardia:settings resolves only while it is listed.",
    regex=r"(?<=[\"'])ardia(?=[\"'],)", scope=["packages/core/src/omnibox.ts"])
add("F-chrome-hostname", "F", "The chrome://ardia host name as a bare hostname (bootstrap.js only initialises on hostname ardia).",
    regex=r"(?<=hostname: [\"'])ardia(?=[\"'])|(?<=hostname [!=]== [\"'])ardia(?=[\"'])")
add("F-chrome-host", "F", "chrome://ardia/ and its host name on Linux.", regex=r"chrome://ardia(?![A-Za-z0-9_-])")
add("F-oauth", "F", "Loopback OAuth route the Linux engine serves (ac_linux_live.h:34).", regex=r"/ardia-oauth(?![A-Za-z0-9_-])")
add("F-bridge", "F", "Linux content-blocker bridge page and script names.", regex=r"ardia-linux-bridge(?:\.js|\.html)?(?![A-Za-z0-9_-])")
add("G-little-links", "G", "Frozen engine API setLittleArdiaOpensNewTabLinks in every form (api.ts:191, ac_linux_link_tabs.h).",
    regex=r"[A-Za-z0-9_.]*[Ss]etLittleArdiaOpensNewTabLinks[A-Za-z0-9_]*|gLittleArdiaOpensNewTabLinks|kLittleArdiaWindow")
add("G-webstore", "G", "The Web Store button label all three engines draw (chromium-helium-branding.patch's extstore fixup on the Mac and Windows, ac_linux_web_store.cc on Linux), only where a check or acceptance step asserts what the engine shows; the app's own relabel script (webStore.ts and its Linux copy in hostPageScripts.ts) and its settings copy are app-owned and rename together.",
    regex=r"(?:Add to|Remove from) Ardia\b", scope=["apps/linux/scripts/acceptance/*", "docs/windows.md", "docs/dia-feature-parity.md"])
add("H-linux-modules", "H", "Linux wire names: module and view names the Linux engine dispatches, in any form. ArdiaError is the shared @ardia/core class, not a module.",
    regex=r"(?<![A-Za-z0-9_$])Ardia(?!Error(?![A-Za-z0-9_]))(?=[A-Z\[$(])[A-Za-z0-9_]*", scope=LINUX)
add("H-linux-profile-folder", "H", "The Linux engine's per-profile documents folder <profile>/Ardia (ac_linux_host.cc:694).",
    regex=r"(?<=Default[/\\])Ardia(?![A-Za-z0-9_])|(?<=\"Default\", \")Ardia(?=\")", scope=LINUX)
add("H-linux-app-name", "H", "The Linux import keyring app name (ac_linux_import_keyring.h kKWalletAppId).",
    regex=r"(?<=APP_NAME = \")Ardia(?=\")", scope=["apps/linux/src/importUnlock.ts"])
add("H-linux-same-words", "H", "Names the Linux engine compiles in; their Mac, Windows and phone copies are renamed.",
    regex=r"Ardia Sync Key|Ardia Sync|Ardia Recovery Kit\.txt|Ardia Passwords\.csv|ardia-import-handle:|ardia-import-",
    scope=LINUX)
add("N-linux-layout", "N", "Linux package and install layout names the Linux engine, packaging and engine tests read.",
    regex=r"(?<![A-Za-z0-9_-])(?:usr/)?(?:bin|lib|share|libexec|apparmor\.d|opt)/ardia(?:-dev)?(?![A-Za-z0-9_-]|\.(?:mjs|cjs|js|ts|tsx|py|json)\b)|(?<=`)ardia-dev(?=`)|(?<![A-Za-z0-9_-])ardia(?=/lib/ardia)|Package: ardia\b|(?<![A-Za-z0-9_-])ardia\.(?:desktop|apparmor|tar\.xz)\b|(?<![A-Za-z0-9_-])ardia-launch\b|(?:Exec|Icon|StartupWMClass)=ardia\b|(?<=profile )ardia(?= )|(?<=Name=)Ardia\b|(?<=apparmor/)ardia(?![A-Za-z0-9_-])|(?<=Package: \")ardia(?=\")",
    scope=LINUX_LAYOUT)
add("N-cli-artifacts", "N", "The Linux CLI artifact names (tarball, top folder, digest, installer copy).",
    regex=r"(?<![A-Za-z0-9_-])ardia-cli(?=[-.])[A-Za-z0-9_.${}<>*-]*", exclude=["scripts/release.sh", "apps/cli/pyproject.toml"])
add("N-cli-home", "N", "The CLI's Linux home and data folders (class A and N).",
    regex=r"/ardia/cli\b|\.config/ardia\b|\.local/share/ardia\b|(?<=/ )[\"']ardia[\"']|[\"']ardia[\"'](?= /)", scope=None)
add("N-linux-data-folder", "A", "The Linux engine's data folder ardia under a config home, spelled after a shell variable (the CLI's Linux data folder, class A): $ARDIA_CONFIG_HOME/ardia, ${ARDIA_CONFIG_HOME}/ardia, ${XDG_CONFIG_HOME:-~/.config}/ardia and ${ARDIA_CONFIG_HOME:-${XDG_CONFIG_HOME:-~/.config}}/ardia in the CLI's help (endpoint.py LINUX_DATA_DIR_SHOWN) and the docs. Renamed, the help would name a folder the CLI and the engine never use.",
    regex=r"(?:(?<=CONFIG_HOME/)|(?<=CONFIG_HOME\}/)|(?<=\.config\}/)|(?<=\.config\}\}/))ardia(?![A-Za-z0-9_-])")
add("N-linux-ids", "N", "dev.ardia.linux ids (bundle id, polkit action, libsecret schemas).", regex=r"dev\.ardia\.linux[A-Za-z0-9_.]*")
add("A-rendezvous", "A", "CLI rendezvous files and route (endpoint.py, ControlSocket.swift, ac_cli_control.cc, ac_linux_control_core.h).",
    regex=r"ArdiaControl(?:\.json|\.sock(?:\.lock)?)?(?![A-Za-z0-9_])|/ardia/active\b")
add("B-profile-files", "B", "Profile files the engines read and write by name.",
    regex=r"Ardia Tab History(?: Cleared)?")
AC_RENAMED = ("ACFeedbackURL", "ACReleaseNotesURL")


def ac_names(pattern, *pathspec):
    found = git("grep", "-I", "-ohE", pattern, ref, "--", *pathspec)
    return sorted({m for m in re.findall(r"AC[A-Za-z0-9_]+", found) if m not in AC_RENAMED})


AC_KEY_POSITIONS = ["<key>", "forInfoDictionaryKey: \"", "objectForInfoDictionaryKey:@\"", "infoDictionary?[\"",
                    "infoDictionary[\"", "infoString(\"", "Add :", "Set :", "Delete :", "Print :"]
add("J-ac-plist-keys", "J", "Every AC* Info.plist key in a key position (a plist <key>, an Info.plist read in Swift or Objective-C, a PlistBuddy path), whatever follows AC, except exactly ACFeedbackURL and ACReleaseNotesURL, which their owner renames to NL* (R41). Plan 0.4 class J.",
    regex="(?:" + "|".join("(?<=" + re.escape(p) + ")" for p in AC_KEY_POSITIONS) + ")AC(?!(?:FeedbackURL|ReleaseNotesURL)(?![A-Za-z0-9_]))[A-Za-z0-9_]+")
AC_ENGINE = ac_names(r"(^|[^A-Za-z0-9_])AC([A-Z][a-z]|[A-Z]+[A-Z][a-z])[A-Za-z0-9_]*", "engine")
AC_KEYS = sorted((set(ac_names(r"<key>AC[A-Za-z0-9_]+</key>", "*.plist"))
                  | set(ac_names(r"(@\"|forKey: ?\"|DefaultsKey = \")AC[A-Za-z0-9_]+\"", ":!engine", ":!scripts/windows/engine"))) - set(AC_ENGINE))
add("J-ac-key-names", "J", "The AC* Info.plist and defaults key names the shell, engines and release scripts read, wherever they are named: " + ", ".join(AC_KEYS) + " (from the plists and defaults reads at the base commit; ACFeedbackURL and ACReleaseNotesURL rename under R41).",
    regex=r"(?<![A-Za-z0-9_])(?:" + "|".join(AC_KEYS) + r")(?![A-Za-z0-9_])")
add("R-ac-engine-names", "R", "The AC* class and function names the Mac engine defines (engine/ at the base commit), named by the shell and docs: " + ", ".join(AC_ENGINE) + ". Plan 0.4 class R.",
    regex=r"(?<![A-Za-z0-9_])(?:" + "|".join(AC_ENGINE) + r")(?![A-Za-z0-9_])")
add("J-plist", "J", "Picture-in-picture plist the Mac engine reads (ac_pip_mac.mm:27).", text="ArdiaPictureInPicture.plist", boundary="none")
add("P-windows-dll-target", "P", "The app project's TargetName: MSBuild writes ArdiaApp.dll, which the prebuilt Windows engine loads (main.cc:95) and assemble.ps1 and rebundle.ps1 package.",
    regex=r"(?<=<TargetName>)ArdiaApp(?=</TargetName>)", scope=["apps/browser/windows/Ardia/Ardia.vcxproj"])
add("P-windows-test-build", "P", "Windows test-build marker (test_gate.h:9).", text="Ardia.test-build", boundary="none")
add("P-windows-exports", "P", "Windows engine exports and their DLL.",
    regex=r"ArdiaApp\.dll|ArdiaApp(?:Run|Start|Stop|PreTranslate|StartFailure|PreTranslateMessage)[A-Za-z0-9_]*|ArdiaEngineApi")
WIN_FOLDER_END = r"(?=[/\\;\"'`<>\s,)\]]|$)"
add("P-windows-folder", "P", "The Windows app folder apps/browser/windows/Ardia and its icon (series_win.py, ardia_resources_win.txt).",
    regex=r"(?<![A-Za-z0-9_.-])Ardia(?=[/\\])|Ardia\.ico\b", scope=WINDOWS + ["apps/browser/src/platform/*", "docs/engine-build-windows.md"])
add("P-windows-folder-sibling", "P", "The Windows app folder named from a sibling project as ..\\Ardia, also as the last entry of a path list (MSBuild include directories end it with ; or <).",
    regex=r"(?<=\.\.[/\\])Ardia" + WIN_FOLDER_END, scope=["apps/browser/windows/*"])
add("P-windows-folder-refs", "P", "Paths to apps/browser/windows/Ardia from anywhere in the repo (relative or from the root), also when the folder ends the path (sparse checkouts, path lists, quoted or backticked names).",
    regex=r"(?<=windows/)Ardia" + WIN_FOLDER_END + r"|(?<=windows\\)Ardia" + WIN_FOLDER_END + r"|(?<=windows\\\\)Ardia(?=\\\\|[\"'`])")
add("P-windows-profile-folders", "P", "Profile folder names the Windows engine makes and accepts: kDirectoryPrefix \"Ardia \" plus the profile id (scripts/windows/engine/src/ardia/win/profiles.cc:19), as the app's profile domain builds them (also inside a private-session id, <name>@Ardia <id>) and its self-check and tests name them.",
    regex=r"(?<=FOLDER_PREFIX = \")Ardia (?=\")|(?<=([\"']))Ardia (?=(?:[a-z0-9-]+(?: \(removing\))?|Work)\1)|(?<=@)Ardia (?=[a-z0-9-]+[\"'])|(?<=`)Ardia (?=\$\{)",
    scope=["packages/expo-windows/src/*", "apps/browser/src/platform/windows*"])
add("P-windows-profile-folders-native", "P", "The same \"Ardia \" profile folder prefix where the Windows app checks a folder before deleting it (EngineHostModule.h ProfileFolderPrefix, which IsProfileFolderName compares with what the engine's profiles.cc made) and in the launch smoke's held-folder fixture Chromium\\Ardia self-check-stuck (removing), the folder the self-check (engineCalls.ts) names through FOLDER_PREFIX. Renamed, the app would refuse to delete every folder the engine makes and the smoke would hold a folder the self-check never looks at.",
    regex=r'(?<=ProfileFolderPrefix = ")Ardia (?=")|(?<=Chromium\\)Ardia (?=[a-z0-9-]+(?: \(removing\))?")',
    scope=["apps/browser/windows/Ardia/EngineHostModule.h", "scripts/windows/launch-smoke.ps1"])
add("P-windows-real-profile-guard", "P", "The installed upstream profile folders the Windows app's test gate refuses (TestGate.h: %LOCALAPPDATA%\\Ardia and %APPDATA%\\Ardia), which are the folder the prebuilt engine's test_gate.cc RealFolderClashOf refuses; the source test that asserts them; and the launch smoke's real-profile input, which asks both the app and the engine to refuse that folder and a junction to it. Renamed, the app and the engine would guard different folders and the smoke would stop sending the upstream folder to the engine. Refusing Nilla's own %LOCALAPPDATA%\\Nilla is a separate, added check (C-windows, wave 3).",
    regex=r'(?:(?<=L"LOCALAPPDATA"\) / L")|(?<=L"APPDATA"\) / L")|(?<=L"LOCALAPPDATA"\\\) \\/ L")|(?<=L"APPDATA"\\\) \\/ L")|(?<=\$realProfile = Join-Path \$env:LOCALAPPDATA "))Ardia(?=")',
    scope=["apps/browser/windows/Ardia/TestGate.h", "apps/browser/src/platform/windowsLaunchConfig.test.mjs", "scripts/windows/launch-smoke.ps1"])
add("P-windows-profile-test-folder", "P", "The test engine's user-data folder in windowsEngineCalls.test.mjs, which must stay the same folder as its host.info fake (C:\\Ardia\\User Data, kept by P-windows-folder).",
    regex=r"(?<=nativeFolder = \"c:/)ardia(?=/user data/\")", scope=["apps/browser/src/platform/windowsEngineCalls.test.mjs"])
add("X-ardia-install-guards", "never", "Independence guards that name the upstream Ardia install on purpose (owner decision 2): the Linux dev launcher and its test refuse Ardia's config, data and cache folders and start the build's bin/ardia; the Windows dev launcher refuses %LOCALAPPDATA%\\Ardia; the carryover check watches the real home's com.ardia folders; identity.test.mjs asserts the old ids and the ardia OS scheme are gone. Renamed, each would guard Nilla's own folders or ids instead.",
    regex=r"(?i)ardia",
    scope=["scripts/linux/nilla-dev-run", "scripts/linux/nilla-dev-run.test.mjs"], mechanism="never")
add("X-ardia-install-guards-windows", "never", "The Windows dev launcher's refusal of Ardia's data folder %LOCALAPPDATA%\\Ardia (owner decision 2). Its default app path follows the renamed launcher.",
    regex=r"(?<=LOCALAPPDATA \")Ardia(?=\")|\$ardia\b|Ardia's", scope=["scripts/windows/nilla-dev-run.ps1"], mechanism="never")
add("X-ardia-install-guards-carryover", "never", "The carryover check's real-home folders include Ardia's com.ardia ones (G, owner decision 2).",
    regex=r"(?<=\"com\.nilladigital\", \")com\.ardia(?=\")|(?<=real home's )Ardia(?= folders)", scope=["scripts/release/carryover.mjs"], mechanism="never")
add("X-identity-old-names", "never", "identity.test.mjs asserts that the old bundle id and the ardia OS scheme registrations are gone; those negative patterns keep the old names.",
    regex=r"com\\\.ardia\\\.browser|(?<=android:scheme=\")ardia(?=\")|(?<=android:data=\")ardia(?=:)|(?<=<string>)ardia(?=<\\/string>)",
    scope=["scripts/lib/identity.test.mjs"], mechanism="never")
add("X-ardia-install-guards-cli", "never", "The CLI's independence guards name the upstream Ardia install on purpose (owner decision 2): the Linux refusals that say they never reach an installed Ardia's ~/.config/ardia or ~/.local/share/ardia/cli, and the hooks tests that plant Ardia's own dev.ardia.hooks LaunchAgent and systemd unit and check that install and uninstall never touch them. Renamed, the messages would name Nilla and the tests would guard Nilla's own label.",
    regex=r"(?<=an installed )Ardia's(?= ~/\.(?:config|local/share)/ardia)|dev\.ardia(?:\.hooks(?:\.plist|\.service)?)?(?![A-Za-z0-9_.-])",
    scope=["apps/cli/ardia_cli/endpoint.py", "apps/cli/ardia_cli/hooks.py", "apps/cli/tests/test_automation.py", "apps/cli/tests/test_linux.py"], mechanism="never")
add("X-ardia-sync-folder-guard", "never", "The shared Sync guard names the upstream Ardia Sync folder on purpose (owner decision 2): the Mac and Windows Sync adapters refuse it before any probe, save or chain write. Renamed, it would refuse Nilla's own Nilla Sync folder.",
    regex=r"(?i)ardia", scope=["packages/sync/src/upstreamSyncFolder.ts"], mechanism="never")
add("X-ardia-upstream-folders-cli", "never", "The CLI's list of an installed Ardia's folders (owner decision 2): the data, config, cache, state, CLI and log folders, and the Mac bundle id folder, that nilla-browser refuses as a data dir or config folder. The module imports nothing of the CLI's own. Renamed, it would refuse Nilla's own folders.",
    regex=r"(?i)ardia", scope=["apps/cli/ardia_cli/upstream.py"], mechanism="never")
add("P-windows-engine-files", "P", "Windows engine build files named in docs.", regex=r"ardia_resources_win\.txt|ardia-chromium-win-[A-Za-z0-9_$]*|ardia-layer-win")
add("Q-cli-refusals", "Q", "Refusal texts the engines produce and the CLI parses.",
    regex=r"isn't allowed for the ardia command|on a tab the ardia command didn't open|(?<![A-Za-z0-9_-])ardia: (?=[A-Z][a-z]+\.[a-zA-Z]|\{[A-Za-z_*.]+\}|a command|no attached session|params must|too many commands)|\[ardia\] ")
add("Q-engine-texts", "Q", "Engine-produced texts that app code or tests match.",
    regex=r" ms for a previous Ardia, | ms for the previous Ardia on this profile to finish exiting|Ardia can't save downloads in that folder|Ardia HTML Document|Ardia Test Sink|Ardia Scripts|Ardia Safe Storage|Ardia's Safe Storage key is damaged\.|Ardia can't read its Safe Storage key\.|Ardia Live Folder Token")
add("T-header", "T", "Network header; never mechanical (S routes it).", regex=r"(?i)x[-_]ardia[-_]key")
add("U-hosts", "U", "ardia.dev, its hosts and netnyahoo.com: never mechanical; S routes them and R reports leftovers. Bundle file names such as Ardia.app are not hosts: they follow the product rename. Scoped to the files that name them on purpose (council C5): the guards and watches that refuse them and their tests, the Linux switches shim, the dead FEEDBACK_URL test_report.py asserts, the sync interop fixtures, and the docs that describe Ardia's site.",
    regex=r"(?<![a-z0-9])(?i:(?:[a-z0-9-]+\.)*ardia\.dev)(?![A-Za-z0-9_-])|(?i:netnyahoo\.com)",
    scope=["apps/browser/scripts/perf/upstreamGuard.test.mjs", "apps/browser/src/state/report/actions.ts", "apps/linux/src/host.test.mjs",
           "apps/linux/src/hostUpdates.test.mjs", "apps/linux/src/hostUpdates.ts", "docs/dia-feature-parity.md", "docs/engine-build.md",
           "packages/expo-windows/src/selfCheck/syncFixture.ts", "packages/sync/tests/fixtures/*", "scripts/windows/upstream-watch.cs",
           "scripts/windows/upstream-watch.test.ps1"])
add("U-logs-scope", "U", "The OTLP logs scope name ardia.app that telemetry rows carry (ClickHouse ScopeName): S routes it with the hosts.",
    text="ardia.app", boundary="none", quoted=True, scope=["packages/core/src/telemetryWire.ts"])
add("X-owner-installed-app", "never", "The owner's installed upstream app in the agent safety scripts (cpu-cap's never list, unregister-builds' keep list): a real application on the owner's Mac, not this build's product.",
    regex=r"/Applications/(?:Ardia|Netnyahoo)\.app", scope=["scripts/agent/*"], mechanism="never", keeps_bundle_name=True)
add("O-offline-game", "O", "Offline game names (frozen game.js and its pipeline).", regex=r"(?i)ardiapagecolor|IDR_ARDIA_GAME_HTML")
add("K-brand-folder", "K", "docs/brand/ardia stays until Layer 2 (gen.sh reads source/mark.png).", regex=r"brand/ardia(?![A-Za-z0-9_-])")
add("K-staging", "F", "The Linux engine's download staging folder prefix.", regex=r"\.ardia-staging-?")
add("V-false-positives", "never", "Words that contain the letters but are not the name.",
    regex=r"(?i)[a-z]*(?:guardian|ancardia|lombardia|cardiac)[a-z]*", mechanism="never")
add("V-fixture", "never", "The Ardia Ltd fixture company (packages/import fixtures).", regex=r"Ardia Ltd", mechanism="never")
add("V-credit-phone-row", "never", "The phone's Ardia credit row: its name and upstream URL, and the whole row as S wrote it (its sentence, licence and the ardia-browser/ardia URL).",
    regex=r"(?<=\{ name: \")Ardia(?=\", use: )|(?<=\{ name: \"Ardia\", use: copy\(\)\.(?:ardia|nilla)Credit, license: \"Apache License 2\.0\", url: \")https://github\.com/mantrakp04/ardia(?=\" \})|\{ name: \"Ardia\", use: \"The browser Nilla is forked from\.\", license: \"Apache License 2\.0\", url: \"https://github\.com/ardia-browser/ardia\" \}",
    scope=["apps/phone/src/components/settings/DataPages.tsx"], mechanism="never")
add("V-upstream-guard", "never", "The bench's fixed upstream list (upstreamGuard.mjs UPSTREAM_HOSTS and UPSTREAM_OWNERS) and the addresses its test checks against it. They name the upstream project on purpose: renamed, the guard would stop catching real requests to ardia.dev, netnyahoo.com and the upstream GitHub owners.",
    regex=r"(?i)[A-Za-z0-9_.\\-]*(?:ardia|netnyahoo)[A-Za-z0-9_.\\-]*|mantrakp04",
    scope=["apps/browser/scripts/perf/upstreamGuard.mjs", "apps/browser/scripts/perf/upstreamGuard.test.mjs"], mechanism="never")
add("V-services-engine-source", "never", "docs/services.md names the upstream release repo the prebuilt engine comes from at build time, which stays upstream in Layer 1 (as V-engine-fetch-lines).",
    regex=r"(?<=the prebuilt engine from `)ardia-browser/ardia(?=` releases)", scope=["docs/services.md"], mechanism="never")
add("H-services-doc-linux-gate", "H", "docs/services.md lists the Linux wire names layer1Gate.ts refuses (ArdiaTelemetry.post, ArdiaSync.* ...): they stay Ardia in the Linux code (H-linux-modules), so the doc names them as the code does.",
    regex=r"(?<![A-Za-z0-9_$])Ardia(?!Error(?![A-Za-z0-9_]))(?=[A-Z\[$(])[A-Za-z0-9_]*", scope=["docs/services.md"])
add("V-credit-text", "never", "Credit wording that names Ardia as Nilla's origin.",
    regex=r"(?i)(?:based on|a fork of|forked from|a modified version of|built on) Ardia\b|Ardia, Copyright 2026 Mantra Patel|Mantra Patel|Ardia's contributors|Ardia contributors", mechanism="never")
add("V-history-versions", "never", "A versioned Ardia build in the docs (Ardia 0.2.46): history and measurements of Ardia builds, never Nilla's claims (owner requirements, branding inputs).",
    regex=r"(?<![A-Za-z0-9_-])Ardia(?= v?0\.\d+\.\d+)", scope=["docs/*", "*.md"], mechanism="never")
add("V-history-phone-sizes", "never", "Dated measurements of Ardia's phone builds in docs/phone.md: the installed size breakdown names the Open in Ardia extension and ArdiaKit as the measured build shipped them, and the 2026-11-16 21:40 scroll re-measure names the lab's -ArdiaDemoScale launch argument it ran with. They record Ardia builds, so they keep the names they were recorded under (owner requirements: historical Ardia measurements are kept).",
    regex=r"(?<=\(Share, )Open in Ardia(?=, Widgets\) \|)|ArdiaKit(?='s resource bundles \|)|(?<=our native module with )ArdiaKit(?= linked in: 3\.2 MB)|(?<=5\.9 MB binary is )ArdiaKit(?= plus its SwiftUI screens)|(?<=with the lab's `)-ArdiaDemoScale(?= 1000`)",
    scope=["docs/phone.md"], mechanism="never")
add("V-history-cli-timing", "never", "The dated timing of the Ardia CLI tarball in docs/cli.md: it measured ardia --version from that tarball, whose launcher is still bin/ardia.",
    regex=r"(?<=`)ardia(?= --version` takes about 10 ms)", scope=["docs/cli.md"], mechanism="never")
add("V-history-engine-check", "never", "The dated 0.21.1 to 0.21.2 engine check in docs/engine-build.md (2026-11-12) quotes the Ardia-branded section and copy the prebuilt engine showed.",
    regex=r"(?<=section branded )Ardia(?= \(\"Ardia sends what you type)|(?<=section branded Ardia \(\")Ardia(?= sends what you type)",
    scope=["docs/engine-build.md"], mechanism="never")
add("Q-offscreen-test-fake", "Q", "The Linux engine's refusal text, as the offscreen test's fake of the engine returns it (ac_linux_automation_window.h, ac_linux_host.cc). The app passes the engine's reason through, so the fake keeps the engine's words; offscreen.ts's own fallback is Nilla's.",
    regex=r"(?<=reason: \")Ardia(?= couldn't take that tab off-screen\.\")", scope=["apps/browser/src/state/automation/offscreen.test.mjs"])
add("W-symbol-artwork-header", "W", "The header of the two generated symbol tables. packages/demo/scripts/icons/gen-data.mjs already writes Nilla demo symbol artwork, but regenerate.mjs needs macOS with swiftc (native SF Symbol renders and the fit cache), so the files keep the last generated header until wave 4 regenerates them on the Mac and drops this entry.",
    regex=r"(?<=^/\*! )Ardia(?= demo symbol artwork\.)", scope=["apps/linux/src/shims/web/symbols/data.ts", "packages/demo/src/shims/web/symbols/data.ts"])
add("X-ardia-sync-folder-guard-native", "never", "The native copies of the shared Sync and Shared Folders guard and their tests (owner decision 2, H2): the Mac's UpstreamSyncFolder.swift (Ardia Sync, Ardia Shared and both refusals), Android's UpstreamSyncFolder.kt (NAME), the Swift tests that plant an Ardia file and check it is untouched, and the shared folder test's name. Renamed, each would refuse Nilla's own Nilla Sync and Nilla Shared folders.",
    regex=r"(?i)ardia", scope=["packages/sync/ios/Core/UpstreamSyncFolder.swift", "packages/sync/tests/UpstreamSyncFolderTests.swift", "packages/sync/src/upstreamSyncFolder.test.ts",
                               "packages/phone/android/src/main/java/com/nilladigital/nilla/sync/core/UpstreamSyncFolder.kt"], mechanism="never")
add("X-ardia-shared-parent-test", "never", "The Shared Folders test that binds a parent of Ardia Shared and Ardia Sync fixtures (in every spelling the guard folds) and checks nothing inside them is listed, written, moved, deleted or created (council C7). Renamed, it would test Nilla's own folders.",
    regex=r"(?i)(?<![A-Za-z])ardia(?= shared| sync)|(?<=AParentOf)Ardias(?=SharedFolder)", scope=["packages/sync/tests/SharedFolderDirectoryTests.swift"], mechanism="never")
add("X-ardia-app-folders-guard-mac", "never", "The Mac app's list of an installed Ardia's folders (UpstreamAppFolders.swift, the same list as the CLI's upstream.py), its tests and the wiring test: ConfigFolder never reads or writes a config path that resolves into them (council C8). Renamed, the guard would refuse Nilla's own folders.",
    regex=r"(?i)(?<![A-Za-z0-9_])ardia(?![A-Za-z0-9_])", scope=["packages/shell/ios/ConfigCore/UpstreamAppFolders.swift", "packages/shell/config-tests/UpstreamAppFoldersTests.swift", "packages/shell/scripts/configFolder.test.mjs"], mechanism="never")
add("X-ardia-app-folders-guard-native", "never", "The Mac app's native copy of the installed-Ardia folder list (NillaUpstreamFolders.h, which launch-config-switches.test.mjs asserts equal to UpstreamAppFolders.swift), its C++ test that plants a linked Application Support/com.nilladigital.nilla and Chromium folder into Ardia's, and the launch refusal and wiring-test names that say so: the data dir is refused before anything reads or writes it when it resolves into those folders (reconcile.md Deferred, owner's full hardening). Renamed, the guard would refuse Nilla's own data dir.",
    regex=r"(?i)(?<![A-Za-z0-9_])ardia(?![A-Za-z0-9_])", scope=["packages/ardiacore/ios/NillaUpstreamFolders.h", "packages/ardiacore/tests/upstream-folders.test.cc"], mechanism="never")
add("X-ardia-app-folders-guard-native-copy", "never", "The data dir refusal in runWithArgc and the wiring tests' names say the folders belong to an installed Ardia.",
    regex=r"(?<=installed )Ardia(?='s folders| folders)", scope=["packages/ardiacore/ios/ArdiaHost+Launch.mm", "packages/ardiacore/tests/launch-config-switches.test.mjs"], mechanism="never")
add("X-ardia-sync-folder-guard-windows", "never", "The Windows native copy of the Sync guard (SyncHandles.h UpstreamFolderName and UpstreamRefusal, which windowsSyncFolderGuard.test.mjs asserts equal to upstreamSyncFolder.ts) and the launch smoke's Ardia Sync alias fixture. Renamed, the native check would refuse Nilla Sync and the smoke would stop planting the upstream folder.",
    regex=r"(?<=UpstreamFolderName = L\")Ardia Sync(?=\")|(?<=UpstreamRefusal\[\] = \")That folder is Ardia's Sync folder\. Nilla keeps its sync data apart from Ardia's, so choose another folder\.(?=\")|(?<=Join-Path \$syncAliases \")Ardia Sync(?=\")|(?<=no symbolic link to )Ardia Sync(?= here)",
    scope=["apps/browser/windows/Ardia/SyncHandles.h", "scripts/windows/launch-smoke.ps1"], mechanism="never")
add("X-ardia-install-guards-windows-checks", "never", "The Windows independence checks name Ardia's install on purpose (owner decision 2, H4): installer-check.ps1 proves the installer leaves Ardia's folders, uninstall entry, ArdiaHTM/ArdiaPDF ProgIDs and ardia scheme alone, and nilla-dev-run.test.ps1 plants Ardia's folders and junctions to them for the launcher to refuse. Renamed, both would check Nilla's own names instead.",
    regex=r"(?i)ardia", scope=["scripts/windows/installer-check.ps1", "scripts/windows/nilla-dev-run.test.ps1"], mechanism="never")
add("X-ardia-install-guards-windows-roots", "never", "The Windows dev launcher's upstream roots (Ardia and Programs\\Ardia under every Local and Roaming base, H4) and the source test's list of nilla-dev-run.test.ps1 case names, which must match that file.",
    regex=r"(?<=Join-Path \$base \")(?:Programs\\)?Ardia(?=\")|^\s*for \(const kind of \[\"a junction to Ardia's data folder\"[^\n]*",
    scope=["scripts/windows/nilla-dev-run.ps1", "apps/browser/src/platform/windowsLaunchConfig.test.mjs"], mechanism="never")
add("X-ardia-upstream-folders-cli-tests", "never", "The CLI guard's tests plant and name an installed Ardia's folders in every spelling (owner decision 2, H1), and usage.py says the Linux CLI never writes into Ardia's CLI home. Renamed, the tests would guard Nilla's own folders.",
    regex=r"(?i)ardia", scope=["apps/cli/tests/test_upstream_guard.py"], mechanism="never")
add("X-ardia-upstream-folders-cli-usage", "never", "usage.py's Linux refusal names an installed Ardia's CLI home (~/.local/share/ardia/cli), the folder it never writes into.",
    regex=r"(?<=so it never writes into an installed )Ardia's ~/\.local/share/ardia/cli", scope=["apps/cli/ardia_cli/usage.py"], mechanism="never")
add("V-import-source-ardia", "never", "The Ardia import source (OWNER-IMPORT, plan 2.1): the Discovery row for Ardia's Chromium profile (id ardia, name Ardia, bundle id com.ardia.browser, keychain Ardia Safe Storage) and its fixture test, which builds a copied Ardia profile layout. They name the other browser Nilla imports from.",
    regex=r"chromium\(\"ardia\", \"Ardia\", \[\"com\.ardia\.browser\"\], \"com\.ardia\.browser/Chromium\", \"Ardia\"\)", scope=["packages/import/ios/Core/Discovery.swift"], mechanism="never")
add("V-import-source-ardia-tests", "never", "The Ardia import source's fixture test (OWNER-IMPORT): every name in it is Ardia's profile layout, bundle id and keychain item.",
    regex=r"(?i)ardia", scope=["packages/import/tests/ArdiaSourceTests.swift"], mechanism="never")
add("V-import-source-ardia-onboarding", "never", "Ardia listed like any other browser (lead decision 2026-11-19): the Mac onboarding's found-only Ardia tile (found by its app bundle, as Chrome and Helium are), its preset id and name and the setup code's preset value, and the Linux and Windows feature lists that hide the tile because their importers have no Ardia source in Layer 1. They name the other browser Nilla imports from.",
    regex=r'^\s*\[\{ id: "ardia", name: "Ardia", app: "/Applications/Ardia\.app", onlyWhenFound: true \}\],$'
          r'|(?<=\| "opera" \| )"ardia"(?= \| "fresh";)|^\s*ardia: "Ardia",$|^\s*ardia: \{\},$'
          r'|(?<="vivaldi", "opera", )"ardia"(?=\] \};)'
          r'|(?<=hiddenBrowserSources: \["safari", "dia", )"ardia"(?=\])|(?<=hiddenBrowserSources: \["safari", "dia", "helium", )"ardia"(?=\])',
    scope=["apps/browser/src/components/onboarding/sourceTiles.ts", "apps/browser/src/state/onboarding/presets.ts", "apps/browser/src/state/presets/setupCode.ts",
           "apps/browser/src/lib/platformFeatures.linux.ts", "apps/browser/src/lib/platformFeatures.windows.ts"], mechanism="never")
add("V-import-source-ardia-js-tests", "never", "The JS test that drives the Arc theme lookup, onboarding and the importer against a recording import module: its fixture source is Ardia (id, name and fake profile paths), the browser whose profile must be read only after the user picks it.",
    regex=r"(?i)ardia", scope=["apps/browser/src/state/import/readsAfterPick.test.mjs"], mechanism="never")
add("X-ardia-install-guards-windows-watch", "never", "The Windows CI no-upstream watch (plan 2.6): upstream-traces.ps1 checks that the upstream app's folders, its ArdiaHTM ProgID and its RegisteredApplications entry don't exist, upstream-watch.cs names the upstream GitHub owners it refuses (the same fixed list as the Linux upstream_rules.py), and upstream-watch.test.ps1 sends it upstream hosts and paths. Renamed, they would watch for Nilla's own names instead.",
    regex=r"(?i)ardia", scope=["scripts/windows/upstream-traces.ps1", "scripts/windows/upstream-watch.cs", "scripts/windows/upstream-watch.test.ps1"], mechanism="never")
add("V-licence-texts-phone", "never", "The phone's licence texts: a byte copy of NOTICE (Ardia's verbatim block and the credit), LICENSE.Apache-2.0 and the bang list's licence, written by bun run --cwd apps/phone licenses and checked byte for byte by licenseTexts.test.ts.",
    regex=r"(?i)ardia", scope=["apps/phone/src/state/settings/licenseTexts.json"], mechanism="never")
add("V-conventions-layer2-names", "never", "docs/conventions.md's Names that stay Ardia until Layer 2 section: the engine contract list, which names each kept Ardia spelling on purpose. Bounded by its heading and the next heading.",
    regex=r"^### Names that stay Ardia until Layer 2$[\s\S]*?(?=^#{1,3} )", scope=["docs/conventions.md"], mechanism="never")
add("V-history-provenance-blocks", "never", "Text restored byte for byte from Ardia (ac1d3453c) under a provenance line saying it was recorded in Ardia before the fork (D21; owner requirements: historical Ardia measurements are kept): docs/phone.md's audit against main, the two speed sections and Ardia's TestFlight plan, and docs/linux-port.md's Upstream syncs. Each span runs from its provenance line to the named heading after it.",
    regex=r"^> Recorded in Ardia \(https://github\.com/ardia-browser/ardia\) before Nilla forked it on 2026-11-18\. Names, flags, paths and issue numbers are Ardia's, as recorded\.$[\s\S]*?(?=^#### Landscape and Duo: the specification$)"
          r"|^> This section and the next were recorded in Ardia \(https://github\.com/ardia-browser/ardia\) before Nilla forked it on 2026-11-18\.[^\n]*$[\s\S]*?(?=^#### Measuring speed on a real iPhone$)"
          r"|^> Ardia's plan for replacing its SwiftUI app on TestFlight in place, recorded in Ardia \(https://github\.com/ardia-browser/ardia\) before Nilla forked it on 2026-11-18\.[^\n]*$[\s\S]*?(?=^#### TestFlight: the workflow, its certificate and its testers$)"
          r"|^> Recorded in Ardia \(https://github\.com/ardia-browser/ardia\) before Nilla forked it on 2026-11-18\. Names, paths and issue numbers are Ardia's, as recorded\.$[\s\S]*?(?=^## Known gaps$)",
    scope=["docs/phone.md", "docs/linux-port.md"], mechanism="never")
add("V-upstream-apps-phone-doc", "never", "docs/phone.md names Ardia's phone apps (com.ardia.browser.ios and .android) as the separate app a Nilla install sits beside and never reads (owner decision 2): the Android gate, tester checklist step 1, the SwiftUI reference app, the measurement build and Sync state.",
    regex=r"(?<=They never read )Ardia's\napp \(`com\.ardia\.browser\.android`\)"
          r"|^- \[ \] \*\*iPhone:\*\* on a phone that also has Ardia's app \(`com\.ardia\.browser\.ios`\)[^\n]*"
          r"|^- \[ \] \*\*Android:\*\* the same with Ardia's app \(`com\.ardia\.browser\.android`\)[^\n]*"
          r"|It is Ardia's app, built from an Ardia commit with Ardia's bundle id \(`com\.ardia\.browser\.ios`\)"
          r"|(?<=so it installs beside )Ardia's SwiftUI app \(`com\.ardia\.browser\.ios`\)"
          r"|Ardia's app\n  \(`com\.ardia\.browser\.ios`\) has its own container, app group and Keychain item, which Nilla can't read, so a phone\n  that had Ardia connected",
    scope=["docs/phone.md"], mechanism="never")
add("V-history-phone-evidence", "never", "Dated evidence in docs/phone.md: the /tmp/ardia-phone-shots folders past runs wrote (new runs use /tmp/nilla-phone-shots) and the Ardia.app.dSYM the size proof matched.",
    regex=r"(?<=`)/tmp/ardia-phone-shots/[^`\s]*|(?<=binary's UUID matches `)Ardia\.app\.dSYM(?=`)", scope=["docs/phone.md"], mechanism="never")
add("X-linux-isolation-doc", "never", "docs/linux-port.md's isolation text names Ardia's profile and folders (owner decision 2, H3), and two Linux layout names that stay until Layer 2: the tarball's ardia folder and the engine's GeoClue desktop id ardia (kDesktopId).",
    regex=r"(?<=has, or could later get, an )Ardia profile: today's Linux engine picks Ardia's default folder|(?<=refuses a host with )Ardia's folders|(?<=and today's engine opens )Ardia's default profile"
          r"|(?<=nilla-dev-run \")\$scratch/ardia(?=\")|(?<=desktop id `)ardia(?=`)",
    scope=["docs/linux-port.md"], mechanism="never")
add("Q-engine-texts-docs", "Q", "docs/engine-build.md quotes the prebuilt engine's own Safe Storage dialogs and the control server's refusal as the engine draws them today.",
    regex=r"Ardia can't open its Safe Storage key\.|This copy of Ardia can't use your keychain\.|(?<=tells the user to reinstall )Ardia(?= from ardia\.dev)|ardia: <Method>(?= isn't allowed for the ardia command)",
    scope=["docs/engine-build.md"])
add("V-history-dated-docs", "never", "Dated records of Ardia builds: the 0.21.1 to 0.21.2 engine check (2026-11-12) on Ardia's command bar, the 2026-11-14 Windows walk with the Ardia-Setup-arm64 installer, and the 2026-11-10 Windows engine build's 34 Ardia resources.",
    regex=r"(?<=no network change\. )Ardia's(?= command bar doesn't use Chrome's autocomplete)|(?<=with the `)Ardia-Setup-arm64(?=` installer of run)|(?<=56 Helium resources, 34 )Ardia(?= ones and the Windows icon)",
    scope=["docs/engine-build.md", "docs/windows.md", "docs/engine-build-windows.md"], mechanism="never")
add("V-credit-raycast", "never", "Raycast contributors (D25).", regex=r"(?<=\"author\": \")mantrakp04(?=\")|ridemountainpig",
    scope=["extras/raycast-ardia/package.json"], mechanism="never")
add("V-engine-fetch-lines", "never", "The upstream engine-fetch defaults (naming.md 4.8): prebuilt engines still come from upstream in Layer 1.",
    regex=r"\$\{\{ vars\.(?:ARDIACORE_PREBUILT_REPO|WINDOWS_ENGINE_REPO|ENGINE_REPO) \|\| '(?:ardia-browser|mantrakp04)/ardia' \}\}|\$\{(?:ARDIACORE_PREBUILT_REPO|ENGINE_REPO):-(?:ardia-browser|mantrakp04)/ardia\}",
    mechanism="never")
add("V-engine-repo", "never", "ENGINE_REPO in scripts/lib/releases.sh: the upstream repo the prebuilt engines, their Corresponding Source and their symbols come from in Layer 1 (release.sh, symbolicate-crash.sh). repo.test.mjs asserts it differs from REPO and equals the fetch defaults (council C1).",
    regex=r'(?<=^ENGINE_REPO=")ardia-browser/ardia(?="$)', scope=["scripts/lib/releases.sh"], mechanism="never")
add("V-engine-repo-test", "never", "repo.test.mjs names the upstream engine repo the fetch defaults must equal, and passes it to the Linux publisher to prove --upload ignores it (council C1).",
    regex=r"\(\?:ardia-browser\|mantrakp04\)\\/ardia|ardia-browser/ardia", scope=["scripts/lib/repo.test.mjs"], mechanism="never")
add("C-vsr-trace", "C", "The Mac engine's video upscaler trace events ArdiaVSR.* (ac_video_upscaler.mm), which the upscaling test filters and counts by name (council C3).",
    regex=r"(?<![A-Za-z0-9_])ArdiaVSR(?![A-Za-z0-9_])", scope=["apps/browser/scripts/video-upscaling-test.mjs"])
add("C-version-product", "C", "The product name the engine's namesub puts on chrome://version (ardia_namesub.py: Helium becomes Ardia), which the acceptance and release smoke checks match before a tab (council C3).",
    regex=r"(?<=/\^)Ardia(?=\\t/)|(?<=`)Ardia(?=\\t\$\{chromiumVersion\})", scope=["packages/ardiacore/scripts/acceptance.mjs", "scripts/release/smoke.mjs"])
add("R-linux-syntax-gn", "R", "Names in the frozen engine tree that the Linux syntax check reads: the ardia_sources list in chrome/browser/ardia/BUILD.gn and the gen/ardia folder its mojoms generate into (council C3).",
    regex=r"(?<![A-Za-z0-9_])ardia_sources(?= (?:=|\\\+=) \\\[)|(?<=\"gen/)ardia(?=\")", scope=["scripts/linux/syntax_check_156.py"])
add("R-docs-engine-symbols", "R", "Engine symbols the docs name as the frozen engines spell them: the ardia:: C++ namespace, NativeTheme::SetArdiaLinuxThinScrollBars, the Windows launch guard's Local\\ArdiaBrowser.* objects, the engine/chromium/.../ardia/ folder written with an ellipsis, the engine's CLI refusal text and the Safe Storage account \"Ardia\" (council C4).",
    regex=r"(?<![A-Za-z0-9_])ardia::(?=[A-Za-z_<])|(?<![A-Za-z0-9_])SetArdiaLinuxThinScrollBars(?![A-Za-z0-9_])|(?<=Local\\)ArdiaBrowser(?=\.)|(?<=…/)ardia(?=/)|ardia: <method> <reason> isn't allowed for the ardia command|(?<=keychain item, account \")Ardia(?=\")",
    scope=["docs/*.md"])
add("V-history-folder", "never", "The folder that archives Ardia's release notes, retired docs and their credits (docs/history/ardia/): Ardia's records, never Nilla's (council C4).",
    regex=r"(?<![A-Za-z0-9_-])(?:docs/)?history/ardia(?![A-Za-z0-9_-])")
add("N-linux-tarball-folder", "N", "The Linux tarball's top folder ardia/ (package.py arcname), written as ./ardia/install.sh where the docs say how to install it (council C4).",
    regex=r"(?<=\./)ardia(?=/install\.sh)|(?<=<extracted>/)ardia(?=/bin/ardia)", scope=LINUX_LAYOUT)
add("N-cli-launcher-doc", "N", "The CLI home's launcher current/bin/ardia (hooks.py and install.sh), which the hooks LaunchAgent runs; the docs name it as the code does (council C4).",
    regex=r"(?<=current/bin/)ardia(?![A-Za-z0-9_-])", scope=["docs/*.md"])
add("V-conventions-file-names", "never", "docs/conventions.md says the app-side ObjC files keep their Ardia<Thing> names until Layer 2 (council C4).",
    text="`Ardia<Thing>`", boundary="none", scope=["docs/conventions.md"], mechanism="never")
add("V-conventions-engine-contract", "never", "docs/conventions.md lists the engine-contract names the presence test pins, as the engines spell them (council C5).",
    regex=r"(?<=`)ardia-(?=`)|(?<![A-Za-z0-9_])Ardia\.test-build|(?<=`\")Ardia(?= \"`)|(?<![A-Za-z0-9_])ardia_sources(?![A-Za-z0-9_])|X-Ardia-Key|(?<![A-Za-z0-9_])ArdiaVSR(?![A-Za-z0-9_])",
    scope=["docs/conventions.md"], mechanism="never")
add("V-linux-ci-engine-source", "never", "docs/linux-ci.md says the Linux engines Layer 1 fetches are Ardia's, published in ardia-browser/ardia, and that Nilla publishes none (council C1).",
    regex=r"ardia-browser/ardia|(?<=in Layer 1 they are )Ardia's", scope=["docs/linux-ci.md"], mechanism="never")

engine_tree = git("ls-tree", "-r", "--name-only", ref, "--", "engine", "scripts/windows/engine").splitlines()
engine_basenames = sorted({p.rsplit("/", 1)[-1] for p in engine_tree
                           if re.search(r"(?i)ardia", p.rsplit("/", 1)[-1]) and "ardiacore" not in p.rsplit("/", 1)[-1].lower()},
                          key=lambda s: (-len(s), s))
add("R-engine-basenames", "R", "Basenames of engine files (patches, resource lists, scripts) wherever they are named: the frozen files keep their names until Layer 2.",
    regex=r"(?<![A-Za-z0-9_.-])(?:" + "|".join(re.escape(b) for b in engine_basenames) + r")(?![A-Za-z0-9_-])", mechanism="basename")
engine_tokens = set()
for t in subprocess.run(["git", "-C", repo, "grep", "-ohIP", r"[A-Za-z0-9_-]*(?i:ardia)[A-Za-z0-9_-]*", ref, "--", "engine", "scripts/windows/engine"],
                        capture_output=True, text=True, errors="replace").stdout.split():
    t = t.split(":", 1)[-1] if t.startswith(ref + ":") else t
    t = t.strip("-")
    if re.fullmatch(r"(?i)ardia_*", t) or "ardiacore" in t.lower() or t == "ardia-browser" or not re.search(r"(?i)ardia", t):
        continue
    engine_tokens.add(t)
engine_tokens = sorted(engine_tokens, key=lambda s: (-len(s), s))
ENGINE_DOCS = ["docs/engine-build.md", "docs/engine-build-windows.md"]
add("R-engine-doc-symbols", "R", "Engine symbols, namespaces, files and build names the engine docs cite (every ardia token in engine/ and scripts/windows/engine at the base): the docs describe the retained engine until Layer 2.",
    regex=r"(?<![A-Za-z0-9_-])(?:" + "|".join(re.escape(t) for t in engine_tokens) + r")(?![A-Za-z0-9_-])|(?<![A-Za-z0-9_])ardia(?=::)|(?<=source_set\(\")ardia(?=\")",
    scope=ENGINE_DOCS)
add("R-engine-branding-row", "R", "The engine-build.md row for chromium-helium-branding.patch: it says what the prebuilt engine shows (Ardia), which stays true until Layer 2.",
    regex=r"^\| `chromium-helium-branding\.patch` \|.*$", scope=["docs/engine-build.md"])

frozen_hdr, frozen_rows = tsv(f"{own}/frozen-tokens.tsv")
frozen_tokens = sorted({r[0] for r in frozen_rows})
add("O-frozen-tokens", "O", "Names frozen files declare and R files use (frozen-tokens.tsv).",
    regex=r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(t) for t in sorted(frozen_tokens, key=lambda s: (-len(s), s))) + r")(?![A-Za-z0-9_])")

asserted = json.load(open(f"{own}/../wave0/allowlist/test-asserted-linked.json"))
asserted_rows = []
for row in asserted:
    for path, test in row["pairs"]:
        if any(fnmatch.fnmatchcase(path, g) for g in FROZEN + list(SKIP_HAND)):
            continue
        asserted_rows.append((row["text"], path, test))
by_path = collections.defaultdict(list)
for text, path, test in asserted_rows:
    by_path[path].append((text, test))
for path in sorted(by_path):
    texts = sorted({t for t, _ in by_path[path]}, key=lambda s: (-len(s), s))
    tests = sorted({t for _, t in by_path[path]})
    add("K-asserted:" + path, "K", "Strings engine tests assert in this file (" + ", ".join(tests) + ").",
        regex="|".join(re.escape(t) for t in texts), scope=[path], mechanism="literal")

lines = [
    {"id": "M-feedback-url", "class": "M", "path": "apps/browser/src/state/report/actions.ts",
     "text": 'export const FEEDBACK_URL = "https://ardia.dev/api/feedback";', "assertedBy": "engine/ardiacore-linux/tests/test_report.py:77"},
    {"id": "M-ingest-header", "class": "M", "path": "packages/core/src/ingestKeys.ts",
     "text": 'export const INGEST_KEY_HEADER = "X-Ardia-Key";', "assertedBy": "engine/ardiacore-linux/tests/test_report.py:79"},
    {"id": "M-app-parts", "class": "M", "path": "apps/linux/src/shims/expo-modules-core.ts",
     "text": 'const APP_PARTS = ["ArdiaUpdater", "ArdiaNotifications", "ArdiaScripting", "ArdiaDev"];',
     "assertedBy": "engine/ardiacore-linux/tests/test_notifications.py:98"},
    {"id": "M-shell-parts", "class": "M", "path": "apps/linux/src/shims/expo-modules-core.ts",
     "text": 'const SHELL_PARTS = ["ArdiaAppWindows", "ArdiaFocus", "ArdiaMenus", "ArdiaDialogs"];',
     "assertedBy": "plan-v2 0.4 class H (kept with APP_PARTS)"},
    {"id": "M-escape-emit", "class": "M", "path": "packages/ardiacore/ios/ArdiaWindowController.mm",
     "text": '    [target emit:@"command" payload:@{@"command" : @"escape", @"text" : @""}];',
     "assertedBy": "engine/ardiacore-linux/tests/test_page_keys.py:46"},
    {"id": "M-page-events", "class": "M", "path": "packages/ardiacore/src/pageEvents.ts", "text": '  onCommand: "command",',
     "assertedBy": "engine/ardiacore-linux/tests/test_page_keys.py:47"},
    {"id": "M-host-modules-shell", "class": "M", "path": "apps/linux/src/hostModules.ts",
     "text": None, "contains": 'if (name === "ArdiaShell" && !hostSupports(`${name}.${method}`, host)) {',
     "assertedBy": "engine/ardiacore-linux/tests (test-asserted scan)"},
    {"id": "M-pkgbuild-depends", "class": "M", "path": "scripts/linux/arch/PKGBUILD", "text": None, "contains": "'polkit'",
     "assertedBy": "engine/patches/build/tests/test_platform_tooling.py:598-616 (R skips the file)"},
]
for entry in lines:
    blob = git("show", f"{ref}:{entry['path']}").split("\n")
    if entry["text"] is None:
        hit = [l for l in blob if entry["contains"] in l]
        assert len(hit) == 1, entry
        entry["text"] = hit[0]
        del entry["contains"]
    entry["found"] = entry["text"] in blob
hand_lines = json.load(open(f"{own}/../wave0/allowlist/hand-lines.json", encoding="utf-8"))
hand_count = collections.Counter()
for row in hand_lines:
    with open(f"{repo}/{row['path']}", encoding="utf-8") as f:
        assert row["text"] in f.read().split("\n"), ("hand line no longer in the tree", row["path"], row["text"])
    hand_count[row["path"]] += 1
    lines.append({"id": f"L-{row['path']}#{hand_count[row['path']]}", "class": row["class"], "path": row["path"], "text": row["text"],
                  "why": row["why"], "assertedBy": "council C5: replaces the file's whole-file exemption; the line was reviewed by hand"})

basenames = []
tracked = git("ls-tree", "-r", "--name-only", ref).splitlines()
never_move_globs = FROZEN + KEEP + ["packages/ardiacore/*", "apps/browser/windows/Ardia/Ardia.ico"]
for path in tracked:
    parts = path.split("/")
    if not re.search(r"(?i)ardia", parts[-1]) or "ardiacore" in parts[-1].lower():
        continue
    if path.startswith(("engine/", "scripts/windows/engine/")):
        continue
    if any(fnmatch.fnmatchcase(path, g) for g in never_move_globs):
        basenames.append(parts[-1])
basenames = sorted(set(basenames), key=lambda s: (-len(s), s))
stems = sorted({b.split(".")[0] for b in basenames if "." in b and re.search(r"(?i)ardia", b.split(".")[0])
                and not re.fullmatch(r"(?i)ardia", b.split(".")[0])}, key=lambda s: (-len(s), s))
escaped_basenames = sorted({"".join(r"\\" + re.escape(c) if c in ".+" else re.escape(c) for c in b) for b in basenames if "." in b},
                           key=lambda s: (-len(s), s))
extensions = sorted({b.rsplit(".", 1)[1] for b in basenames if "." in b}, key=lambda s: (-len(s), s))
stem_alternation = "|".join(re.escape(b) for b in stems)
extension_alternation = "|".join(re.escape(e) for e in extensions)
add("K-basenames", "K", "Basenames of paths that never move (packages/ardiacore, frozen and kept files): references keep them, also as escaped regexes (stem\\.ext, stem\\.\\w+, stem\\.(?:h|mm)), brace lists (stem.{h,mm}) and file-name regexes that start with a stem (/^ArdiaWebView.*\\.mm$/). A stem before an escaped member access (ArdiaHost\\.beginPressLoop in a source-reading test) is the renamed class, not a file, so it is not kept.",
    regex=r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(b) for b in basenames) + r")(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?:" + "|".join(escaped_basenames) + r")(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?:" + stem_alternation + r")(?=\\\.(?:(?:" + extension_alternation + r")(?![A-Za-z0-9_])|\\w|\()|\.\{)|(?:(?<=\^)|(?<=/))(?:" + stem_alternation + r")(?=(?:\.\*|\.\+|\[\^/\]\*|\[\^/\]\+)[^\s/]*?\\\.(?:" + extension_alternation + r")(?![A-Za-z0-9_]))", mechanism="basename")

rules = [
    {"id": "grammar", "plan": "0.1", "find": r"\b([Aa])n (Ardia|ardia|ARDIA)\b", "replace": r"\1 \2"},
    {"id": "1-plugins", "plan": "D.5 rule 1", "find": r"mantrakp04/ardia-plugins", "replace": "NoorChasib/nilla-plugins"},
    {"id": "3a-repo-url", "plan": "D.5 rule 3a", "find": r"(?<=github\.com/)(?:ardia-browser|mantrakp04)/ardia(?![A-Za-z0-9_-])", "replace": "NoorChasib/nilla"},
    {"id": "3b-repo-url-escaped", "plan": "D.5 rule 3b", "find": r"(?<=github\.com\\/)(?:ardia-browser|mantrakp04)\\/ardia(?![A-Za-z0-9_-])", "replace": r"NoorChasib\\/nilla"},
    {"id": "3c-repo-slug", "plan": "D.5 rule 3c", "find": r"(?<![A-Za-z0-9_.-])(?:ardia-browser|mantrakp04)/ardia(?![A-Za-z0-9_-])", "replace": "NoorChasib/nilla"},
    {"id": "3d-repo-slug-escaped", "plan": "D.5 rule 3d", "find": r"(?<![A-Za-z0-9_.-])(?:ardia-browser|mantrakp04)\\/ardia(?![A-Za-z0-9_-])", "replace": r"NoorChasib\\/nilla"},
    {"id": "4-group-ios", "plan": "D.5 rule 4", "find": r"group\.com\.ardia\.browser\.ios", "replace": "group.com.nilladigital.nilla.ios"},
    {"id": "5-android", "plan": "D.5 rule 5", "find": r"com\.ardia\.browser\.android", "replace": "com.nilladigital.nilla.android"},
    {"id": "6-ios", "plan": "D.5 rule 6", "find": r"com\.ardia\.browser\.ios", "replace": "com.nilladigital.nilla.ios"},
    {"id": "7-bundle", "plan": "D.5 rule 7", "find": r"com\.ardia\.browser(?![A-Za-z0-9_])", "replace": "com.nilladigital.nilla"},
    {"id": "7-bundle-escaped", "plan": "D.5 rules 4-7, escaped in regexes (as 3b and 3d)", "find": r"com(\\{1,2})\.ardia\1\.browser(?![A-Za-z0-9_])", "replace": r"com\1.nilladigital\1.nilla"},
    {"id": "8-kotlin-packages", "plan": "D.5 rule 8", "find": r"(?<![A-Za-z0-9_.])com\.ardia(?![A-Za-z0-9_])", "replace": "com.nilladigital.nilla"},
    {"id": "8-kotlin-folders", "plan": "D.5 rule 8", "find": r"(?<![A-Za-z0-9_.-])com/ardia/browser(?=/|\")", "replace": "com/nilladigital/nilla"},
    {"id": "8-kotlin-folders-root", "plan": "D.5 rule 8", "find": r"(?<![A-Za-z0-9_.-])com/ardia(?=/|\"|$)", "replace": "com/nilladigital/nilla"},
    {"id": "9-jni", "plan": "D.5 rule 9", "find": r"(?<![A-Za-z0-9])(Java_)?com_ardia_(?:browser_)?", "replace": r"\1com_nilladigital_nilla_"},
    {"id": "10-dev-ids", "plan": "D.5 rule 10", "find": r"dev\.ardia\.(?=hooks\b|browse\.auth\b|cli-installer\b|demo\b|fixture\.dia\b|idle-watch\b)", "replace": "com.nilladigital.nilla."},
    {"id": "11-test-hosts", "plan": "D.5 rule 11", "find": r"\.ardia\.test\b", "replace": ".nilla.test"},
    {"id": "12-scope", "plan": "D.5 rule 12", "find": r"@ardia(?=/|\\/)", "replace": "@nilla"},
    {"id": "smoke-drift-path", "plan": "D.6 hand edit (review: the skip file imports a moved helper)", "find": r"(?<=acceptance/lib/)ardia(?=\.mjs)", "replace": "nilla", "scope": ["scripts/linux/smoke.mjs"]},
    {"id": "smoke-drift-lower", "plan": "D.6 hand edit (review: names R renames in the helper, the UI and ubo-seed)", "find": r"(?<![A-Za-z0-9_])ardia(?=Linux\b|SeedFromPackage\b|-linux-window\b|-seed\b)", "replace": "nilla", "scope": ["scripts/linux/smoke.mjs"]},
    {"id": "smoke-drift-title", "plan": "D.6 hand edit (review: launchArdia and the CLI's own scripts list text)", "find": r"(?<=\blaunch)Ardia(?![A-Za-z0-9_])|(?<=reported by )Ardia\b|(?<![A-Za-z0-9_])Ardia(?= smoke\b)", "replace": "Nilla", "scope": ["scripts/linux/smoke.mjs"]},
    {"id": "webstore-adapter-label", "plan": "D.6 hand edit (Codex wave 0 finding 6: the Linux adapter routes the shared Web Store script by exact text, so its copy of the app-owned label renames with webStore.ts)", "find": r"(?<=el\.textContent = \")(Add to|Remove from) Ardia(?=\";)", "replace": r"\1 Nilla", "scope": ["apps/linux/src/hostPageScripts.ts"]},
    {"id": "cli-script", "plan": "D.3 (E11)", "find": r"^ardia = \"ardia_cli\.cli:main\"$", "replace": "nilla-browser = \"nilla_browser_cli.cli:main\"", "scope": ["apps/cli/pyproject.toml"]},
    {"id": "cli-skill-permission", "plan": "D.3 (E11)", "find": r"(?<=Bash\()ardia(?=:\*\))", "replace": "nilla-browser", "scope": ["apps/cli/*"]},
    {"id": "cli-module", "plan": "D.3 (OWNER-CLI, E11)", "find": r"(?<![A-Za-z0-9_])ardia_cli(?![A-Za-z0-9])", "replace": "nilla_browser_cli"},
    {"id": "cli-dist", "plan": "D.3 (E11)", "find": r"(?<=^name = \")ardia-cli(?=\"$)", "replace": "nilla-browser", "scope": ["apps/cli/pyproject.toml"]},
    {"id": "cli-module-name", "plan": "D.3 (E11)", "find": r"^module-root = \"\"$", "replace": "module-root = \"\"\nmodule-name = \"nilla_browser_cli\"", "scope": ["apps/cli/pyproject.toml"], "addsLines": True},
    {"id": "13a-cli-command", "plan": "D.5 rule 13a", "find": r"(?m)(^[ \t]*|`|\$ )ardia(?= (?:apply|browse|commands|computer|config|events|feedback|groups|history|hooks|notes|on|pinned|run|scripts|skills|star|tabs|theme|windows)\b)", "replace": r"\1nilla-browser"},
    {"id": "13a-the-command", "plan": "D.5 rule 13a", "find": r"\b([Tt])he (`?)ardia(`?) command\b", "replace": r"\1he \2nilla-browser\3 command"},
    {"id": "14-upper", "plan": "D.5 rule 14", "find": r"ARDIA", "replace": "NILLA"},
    {"id": "14-title", "plan": "D.5 rule 14", "find": r"Ardia", "replace": "Nilla"},
    {"id": "14-lower", "plan": "D.5 rule 14", "find": r"ardia", "replace": "nilla"},
]
reports = [
    {"id": "2-tap", "what": "Homebrew tap leftovers (G removed them), scanned in the pre-image", "regex": r"ardia-browser/homebrew-tap|tap/ardia|Casks/ardia", "scan": "pre"},
    {"id": "13-netnyahoo", "what": "Netnyahoo leftovers after M (owners named in M's check)", "regex": r"(?i)netnyahoo"},
    {"id": "upstream-links", "what": "Callable ardia-browser or mantrakp04 links outside credit spans and engine-fetch lines (OWNER-URL)", "regex": r"ardia-browser|mantrakp04"},
    {"id": "upstream-hosts", "what": "ardia.dev and netnyahoo.com leftovers and the ardia.app telemetry scope (never mechanical; S routes them)", "regex": r"(?i:ardia\.dev|netnyahoo\.com)|(?<![A-Za-z0-9_-])ardia\.app(?![A-Za-z0-9_-])"},
    {"id": "nilla-word", "what": "nilla <word> CLI candidates for the wave 3 owners (E11)",
     "regex": r"(?<![A-Za-z0-9_./-])nilla(?: (?:apply|browse|commands|computer|config|events|feedback|groups|history|hooks|notes|on|pinned|run|scripts|skills|star|tabs|theme|windows|--?[a-z][a-z-]*)\b|(?=[\"'] ?[,)\]]|[\"']$))"},
]

moves = {
    "never": [{"glob": g, "why": "frozen (X-layer2)"} for g in FROZEN]
    + [{"glob": g, "why": "kept byte for byte (X-keep)"} for g in KEEP]
    + [{"glob": "packages/ardiacore/*", "why": "class R: every ardiacore path stays"},
       {"glob": "apps/browser/windows/Ardia", "why": "class P: the Windows engine build reads the folder (series_win.py)"},
       {"glob": "apps/browser/windows/Ardia/Ardia.ico", "why": "class P: ardia_resources_win.txt maps it"}],
    "neverComponent": r"(?i)ardiacore",
    "contractPaths": [],
    "basenameOnly": GENERATED + LEAD,
    "componentMaps": [
        {"match": r"(^|/)com/ardia/browser$", "merge": True, "why": "Kotlin package com.ardia.browser becomes com.nilladigital.nilla (rule 7)"},
        {"match": r"(^|/)com/ardia$", "replace": "nilladigital/nilla", "why": "Kotlin packages com.ardia.<pkg> become com.nilladigital.nilla.<pkg> (rule 8)"},
        {"match": r"^apps/cli/ardia_cli$", "replace": "nilla_browser_cli", "why": "CLI module (OWNER-CLI, E11)"},
    ],
    "componentCase": [["ARDIA", "NILLA"], ["Ardia", "Nilla"], ["ardia", "nilla"]],
}
c_hdr, c_rows = tsv(f"{own}/contract-files.tsv")
moves["contractPaths"] = sorted({r[0] for r in c_rows if r[1] in ("path", "joined-path", "module", "dir", "suffix")})

lit_hdr, lit_rows = tsv(f"{own}/engine-literals.tsv")
occ_hdr, occ_rows = tsv(f"{own}/engine-literal-occurrences.tsv")
occ_by = collections.defaultdict(list)
for r in occ_rows:
    occ_by[r[0]].append(r)
compiled = []
for p in protect:
    if "regex" in p:
        rx = re.compile(p["regex"], re.M)
    else:
        t = re.escape(p["text"])
        if p.get("quoted"):
            rx = re.compile(r"(?<=[\"'`])" + t + r"(?=[\"'`])")
        elif p["boundary"] == "word":
            pre = r"(?<![A-Za-z0-9_])" if re.match(r"\w", p["text"][0]) else ""
            post = r"(?![A-Za-z0-9_])" if re.match(r"\w", p["text"][-1]) else ""
            rx = re.compile(pre + t + post)
        else:
            rx = re.compile(t)
    compiled.append((p, rx))


def glob_ok(path, p):
    if p.get("scope") and not any(fnmatch.fnmatchcase(path, g) for g in p["scope"]):
        return False
    if p.get("except") and any(fnmatch.fnmatchcase(path, g) for g in p["except"]):
        return False
    return True


cache = {}


def line_text(path, n):
    if path not in cache:
        cache[path] = git("show", f"{ref}:{path}").split("\n")
    lines_ = cache[path]
    return lines_[n - 1] if n - 1 < len(lines_) else ""


def covering(lit, path, ln, col, length):
    text = line_text(path, ln)
    start, end = col - 1, col - 1 + length
    hits = []
    for p, rx in compiled:
        if not glob_ok(path, p):
            continue
        for m in rx.finditer(text):
            if m.start() < end and m.end() > start and re.search(r"(?i)ardia", text[max(m.start(), start):min(m.end(), end)]):
                hits.append(p["id"])
                break
    return hits


RENAME = {
    "Ardia Sync": "Mac, Windows and phone copies become Nilla Sync (0.1); only the disabled Linux sync compiles the Ardia name, protected in Linux paths.",
    "Ardia Sync Key": "Mac and phone keychain item becomes Nilla Sync Key (0.1); the Linux libsecret label is protected in Linux paths.",
    "Ardia Recovery Kit.txt": "Mac and Windows write their own kit file; the Linux engine's copy is protected in Linux paths (Linux sync is off).",
    "Ardia Passwords.csv": "The Mac save panel and Windows dialog name their own export; the Linux engine's name is protected in Linux paths.",
    "ardia-import-": "Mac and Windows snapshot prefixes are the app's own temp names; the Linux handle prefix is protected in Linux paths.",
    "littleArdia": "App state and setting keys become littleNilla; only the engine's report key in video-upscaling-test.mjs is protected.",
    "Ardia engine ": "Linux UI copy (hostCalendar.ts); no engine artifact reads it.",
    "Ardia couldn't take that tab off-screen.": "Display text the app passes through or produces itself (offscreen.ts, ArdiaHost.mm); no code matches it.",
    "Ardia couldn't take that tab off-screen, and closed it.": "Produced by the Mac host itself (ArdiaHost.mm).",
    "Ardia has no data folder": "Produced by the Mac shell itself (ControlSocket.swift, UserScripts.swift); nothing matches it.",
    "Ardia has no data folder.": "Produced by the Mac shell itself (ControlSocket.swift).",
    "Another Ardia is serving this data folder.": "Produced by the Mac shell itself (ControlSocket.swift).",
    "The installer isn't in this build of Ardia.": "Produced by the Mac shell itself (CliInstaller.swift).",
    ") has no ardia command release.": "Produced by the Mac shell itself (CliInstaller.swift); wave 3 writes nilla-browser.",
    "[control] the ardia command's socket didn't start: ": "The Mac shell's own log line (ControlSocket.swift).",
}
FRAGMENTS = {
    "ardia-": "Prefix fragment: its engine use is the --ardia- switch prefix (class S); other ardia- names are covered by their own entries.",
    "ARDIA_": "Prefix fragment: class S (S-env).",
    "/ardia/": "Path fragment: covered by A-rendezvous (/ardia/active), F-chrome-host, N-cli-home, N-linux-layout and R-engine-gn.",
    ":ardia": "GN target fragment (:ardia): covered by R-engine-gn; gradle :ardia-design and the @ardia regexes are app names.",
    "ArdiaPasswords.": "Linux module prefix: class H.",
    "ArdiaAutofill.": "Linux module prefix: class H.",
    "ardia-pip-": "Covered by D-dom-hooks.",
    "ardia-cli-": "Covered by N-cli-artifacts (scripts/release.sh pruned: a Mac artifact name the Linux engine never reads).",
    "ardia-test": "Switch name: class S. Other ardia-test- names (temp folders, channels) are app names.",
}
MODULE = re.compile(r"^Ardia[A-Z][A-Za-z]*(?:\.(?:[A-Za-z]\w*)?)?$")
manifest = []
decisions = []
for lit, eng_uses, nfiles, sample in lit_rows:
    occs = occ_by.get(lit, [])
    prot = ren = skipped = 0
    by_mech = collections.Counter()
    for _, path, ln, col, length, owner, sched in occs:
        ln, col, length = int(ln), int(col), int(length)
        r_eligible = any(s.startswith("w2:R-mechanical") for s in sched.split(" ; "))
        hits = covering(lit, path, ln, col, length)
        if hits:
            prot += 1
            by_mech.update(hits[:1])
            outcome = "protect:" + hits[0]
        else:
            ren += 1
            outcome = "rename"
        if not r_eligible:
            skipped += 1
            outcome += " (not R's file: " + (sched.split(" ; ")[0] if sched != "-" else owner) + ")"
        decisions.append((lit, path, ln, col, outcome))
    if lit in RENAME:
        decision, why = "rename", RENAME[lit]
    elif lit in FRAGMENTS:
        decision, why = "class", FRAGMENTS[lit]
    elif MODULE.match(lit) and not re.match(r"^ArdiaApp(?:\.dll|Start|Stop|PreTranslate|Run)|^ArdiaEngineApi|^ArdiaControl|^ArdiaPictureInPicture\.plist|^ArdiaHTM$|^ArdiaProbe|^ArdiaHostedPage", lit):
        decision = "protect-linux"
        why = "Linux wire name (class H): protected in Linux paths; the Mac and Windows modules are app-side and become Nilla*."
    else:
        decision = "protect"
        why = "Same artifact on both sides" + (" (" + ", ".join(k for k, _ in by_mech.most_common(2)) + ")" if by_mech else "")
    manifest.append({"text": lit, "engineUses": int(eng_uses), "files": int(nfiles), "occurrences": len(occs),
                     "decision": decision, "protectedOccurrences": prot, "renamedOccurrences": ren,
                     "notRsFiles": skipped, "coveredBy": [k for k, _ in by_mech.most_common()], "why": why})

ex_hdr, ex_rows = tsv(f"{own}/engine-literals-excluded.tsv")
excluded = []
for lit, uses, reason in ex_rows:
    raw = lit.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
    if raw.strip().lower() in ("ardia", "ardia ", "ardia:"):
        cover = "rule 14 and the class rules (bare product name)"
    elif "g_ardia_" in raw:
        cover = "R-g-ardia"
    elif re.search(r"ardiapagecolor|ardiaPageColor", raw, re.I):
        cover = "O-offline-game"
    elif "ardia.elementPicker" in raw:
        cover = "C-elementPicker"
    elif "Ardia Safe Storage" in raw:
        cover = "Q-engine-texts"
    elif re.search(r"Ardia(?:SetHybridUiShown|TabActive|HostVisibilityChanged|AutoPictureInPicture|ReregisterGlobalCommands|WriteAfterValueRestore)|ardia_alive|ardiaResult|ardiaError|ardiaPeek", raw):
        cover = "engine-internal name with no app occurrence at the base"
    elif "Desktop Entry" in raw or "Icon=ardia" in raw:
        cover = "N-linux-layout"
    elif "ardia/win/" in raw:
        cover = "R-engine-gn"
    else:
        cover = "engine-only text with no app occurrence at the base (hand check)"
    excluded.append({"text": raw, "engineUses": int(uses), "coveredBy": cover})

pruned = [
    {"literal": "ardia-cli-", "path": "scripts/release.sh", "why": "The Mac release names its own CLI tarball; the Linux engine never reads it."},
    {"literal": "ardia-links", "path": "apps/browser/scripts/little-ardia-links-test.mjs", "why": "File name, not the switch (kebab boundary excludes it)."},
    {"literal": "ardia-links", "path": "apps/phone/*", "why": "Log text, not the Windows switch (S-switch-names except)."},
    {"literal": "ardia-links", "path": "docs/dia-feature-parity.md", "why": "Part of little-ardia-links, not the switch."},
    {"literal": "ardia-", "path": ".claude/settings.json", "why": "Known false positive (plan 0.4): G rewrites the file in wave 1."},
    {"literal": "ardia-", "path": "packages/demo/public/favicons/*", "why": "Known false positive (plan 0.4): binary favicon bytes."},
]

doc = {
    "schema": 1,
    "about": "Names Nilla Layer 1 keeps for today's prebuilt engines. The residual-name gate (apps/browser/src/conventions.test.mjs) reads paths (frozen, keep, lead, generated, skipTree), moves, protect and lines; a lines entry covers one whole line and must still be in its file. rules, reports, paths.finalByD, paths.skipHand and paths.ruleLimited are the rename tool's inputs (the wave 2 rename, rerun for Layer 2); finalByD and skipHand are files the tool left to hand edits, not gate exemptions. The generator and the rename tool are kept outside the repository with the Nilla conversion's working notes; edit the allowlist only through the generator.",
    "base": {"commit": commit, "engineKey": engine_key},
    "paths": {"frozen": FROZEN, "keep": KEEP, "lead": LEAD, "generated": GENERATED, "finalByD": D_FINAL,
              "skipHand": SKIP_HAND, "skipTree": SKIP_TREE,
              "ruleLimited": {"apps/cli/scripts/build.sh": ["cli-module"],
                              "scripts/linux/smoke.mjs": ["smoke-drift-path", "smoke-drift-lower", "smoke-drift-title"],
                              "apps/linux/src/hostPageScripts.ts": ["webstore-adapter-label"]}},
    "moves": moves,
    "protect": protect,
    "lines": lines,
    "rules": rules,
    "reports": reports,
}
with open(out_json, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
    f.write("\n")
with open(out_tsv, "w", encoding="utf-8") as f:
    f.write("literal\tpath\tline\tcolumn\toutcome\n")
    for row in decisions:
        f.write("\t".join(str(x) for x in row) + "\n")
counts = collections.Counter(m["decision"] for m in manifest)
print(json.dumps(counts), "protect entries:", len(protect), "lines:", len(lines), "rules:", len(rules),
      "occurrences protected:", sum(m["protectedOccurrences"] for m in manifest),
      "renamed:", sum(m["renamedOccurrences"] for m in manifest))
