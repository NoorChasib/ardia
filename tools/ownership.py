#!/usr/bin/env python3
"""Partition the tracked files at a ref into Nila Layer 1 owners.

usage: ownership.py <repo> <ref> <census.tsv> <outdir>

Writes <outdir>/<owner>.txt (one path per line, paths at <ref>) and <outdir>/summary.tsv.
Wave 1 owners hold hand edits; R is the mechanical pass (wave 2); C-* are wave 3 areas.
"""
import subprocess, sys, fnmatch, collections, pathlib

repo, ref, census, outdir = sys.argv[1:5]
out = pathlib.Path(outdir); out.mkdir(parents=True, exist_ok=True)
files = subprocess.run(["git", "-C", repo, "ls-tree", "-r", "--name-only", ref], capture_output=True, text=True, check=True).stdout.split("\n")
files = [f for f in files if f]

L1_CATS = {"internal-layer1", "docs-site-github-extras", "package-name", "user-visible", "user-visible:test",
           "nila-identity", "upstream-service-or-repo", "remove:legacy-migration", "remove:upstream-governance"}
hits = collections.Counter()
for line in open(census, encoding="utf-8", errors="replace"):
    cat, path = line.split("\t", 2)[:2]
    if cat in L1_CATS:
        hits[path] += 1

CONTRACT = """apps/browser/src/components/window/TabWebView.tsx apps/browser/src/state/commands/commandCatalog.ts
apps/browser/src/state/live/alerts.ts apps/browser/src/state/live/store.ts apps/browser/src/state/live/types.ts
apps/browser/src/state/report/actions.ts apps/browser/src/state/sidebar/effects.ts apps/cli/install.sh
apps/linux/scripts/acceptance/lib/liveServices.mjs apps/linux/scripts/host-contract-extension.mjs
apps/linux/scripts/host-contract-loader.mjs apps/linux/scripts/host-test-loader.mjs apps/linux/src/appModuleFallbacks.ts
apps/linux/src/hostCapabilities.ts apps/linux/src/hostCast.ts apps/linux/src/hostCrashReports.ts
apps/linux/src/hostExtensionView.ts apps/linux/src/hostLive.ts apps/linux/src/hostModules.ts apps/linux/src/liveSources.ts
apps/linux/src/shims/expo-modules-core.ts apps/linux/src/shims/web/motion/swipe.ts packages/core/src/ingestKeys.ts
packages/shell/ios/BangListFetch.swift packages/shell/ios/CrashReports.swift packages/shell/ios/ReportFiles.swift
packages/shell/ios/ReportUploader.swift packages/shell/ios/ShellModule.swift packages/shell/ios/SystemModule.swift
packages/shell/ios/WindowManager.swift packages/shell/src/app.ts packages/shell/src/documents.ts
packages/shell/src/lifecycle.ts packages/shell/src/notifications.ts packages/shell/src/report.ts packages/shell/src/windows.ts
packages/sync/ios/Core/Wordlist.swift packages/sync/src/hlc.ts packages/sync/src/scopeState.ts packages/sync/src/scope.ts
scripts/linux/arch/PKGBUILD scripts/linux/ardia.apparmor scripts/linux/ardia-launch scripts/linux/dev.ardia.linux.policy
scripts/linux/fetch-engine.sh scripts/linux/install.sh scripts/linux/package.py scripts/linux/publish_engine.py
scripts/linux/publish-engine.sh scripts/linux/runtime_files.py infra/feedback/lib/validate.mjs infra/feedback/lib/ids.mjs""".split()

X_LAYER2 = ["engine/*", "scripts/windows/engine/*", "apps/browser/assets/offline-game/*",
            "apps/browser/assets/offline-game-pipeline/*", "packages/ardiacore/prebuilt-engines*.tsv",
            "packages/ardiacore/scripts/fetch-engine.sh", "packages/ardiacore/scripts/ubo.sh",
            "packages/ardiacore/ios/page_script.js", "packages/ardiacore/src/engine/api.ts",
            "packages/ardiacore/src/pageEvents.ts", "packages/ardiacore/ios/ArdiaWindowController.mm",
            "docs/brand/ardia/*", "scripts/windows/fetch-engine.ps1", "scripts/windows/engine-source.sh",
            "scripts/engine-source.sh", "scripts/linux/ardia.apparmor", "scripts/linux/ardia-launch",
            "scripts/linux/dev.ardia.linux.policy"]
X_KEEP = ["LICENSE", "LICENSE.Apache-2.0", "third_party/*", "docs/perf/0.2.*", "docs/audit/*"]

RULES = [
    ("X-layer2", X_LAYER2),
    ("X-keep", X_KEEP),
    ("M-legacy", ["packages/sync/ios/Core/LegacyMigration.swift", "packages/sync/tests/LegacyMigrationTests.swift",
                  "packages/sync/tests/LegacyDockTileTests.swift", "packages/sync/scripts/legacy-migration-*",
                  "apps/browser/src/lib/legacy.ts", "apps/browser/src/lib/legacy.test.mjs",
                  "packages/sync/src/companion/legacy.ts", "scripts/lib/legacy-name.sh", "*PhoneLegacy*",
                  "scripts/lib/instance.mjs"]),
    ("G-governance-ci", [".github/*", "CLA.md", ".coderabbit.yaml", ".claude/*", "scripts/stats.mjs", "scripts/stats/*",
                         "scripts/telemetry-env.mjs", "scripts/telemetry-sql.mjs", "scripts/update-checks.mjs",
                         "scripts/replay.mjs", "scripts/lib/releases.sh", "scripts/lib/repo.mjs", "scripts/lib/repo.test.mjs",
                         "scripts/lib/release-note.mjs", "scripts/lib/release-note.test.mjs", "scripts/release.sh",
                         "scripts/windows/publish-alpha.sh", "scripts/symbolicate-crash.sh", "package.json",
                         "scripts/check-all.sh", "scripts/release/appcast.sh", "scripts/release/package.sh",
                         "scripts/release/export-sign.sh"]),
    ("W-web-surfaces", ["apps/site/*", "apps/dashboard/*", "apps/videos/*", "infra/site/*", "infra/dashboard/*",
                        "infra/telemetry/*", "infra/hexclave-cli/*", "infra/shared.ts", "infra/lib.sh",
                        "packages/shaders/scripts/meadow.mjs", "packages/shaders/turbo.json", "scripts/dmg/background.html",
                        "docs/growth.md", "docs/dashboard-triage.md", "docs/dashboard-settings.md"]),
    ("S-services", ["packages/core/src/services.ts", "packages/core/src/ingestKeys.ts",
                    "apps/browser/src/state/telemetry/config.ts", "apps/browser/src/state/telemetry/transport.ts",
                    "apps/browser/src/state/telemetry/transport.test.mjs", "apps/browser/src/state/telemetry/daily.ts",
                    "apps/browser/src/state/telemetry/daily.test.mjs", "apps/browser/src/state/telemetry/copy.ts",
                    "apps/browser/src/state/telemetry/copy.test.mjs", "apps/browser/src/state/telemetry/platformCopy.ts",
                    "apps/browser/src/state/telemetry/platformWording.ts", "apps/browser/src/state/telemetry/copyWords*.ts",
                    "apps/browser/src/state/telemetry/localCopy*", "apps/browser/src/state/telemetry/fixtures/*",
                    "apps/browser/src/platform/killSwitches*", "apps/browser/src/platform/launchConfig.ts",
                    "apps/browser/src/state/report/*", "apps/browser/src/state/releaseNotes/*",
                    "apps/browser/src/components/ntp/TelemetryAsk.tsx", "apps/browser/src/components/onboarding/PrivacyStep.tsx",
                    "apps/browser/src/components/onboarding/SetupCode*", "apps/browser/src/components/settings/panes/ShareDiagnostics.tsx",
                    "apps/browser/src/components/settings/panes/UpdatesSection.tsx",
                    "apps/browser/src/components/settings/panes/SetupCodeRow.tsx", "apps/browser/src/components/settings/rows/generalRows.ts",
                    "apps/browser/src/platform/windowsUpdateManifest*", "apps/browser/macos/Ardia-macOS/Info.plist",
                    "packages/shell/ios/AppUpdater.swift", "packages/shell/ios/AppModule.swift",
                    "packages/expo-windows/src/updater/*", "packages/expo-windows/src/modules.ts",
                    "packages/expo-windows/src/selfCheck/appSystem.ts", "apps/browser/windows/Ardia/UpdateModule.h",
                    "apps/linux/src/hostUpdates*", "apps/linux/src/updateReleases*", "apps/linux/src/hostTelemetry*",
                    "apps/linux/src/reportProblem*", "apps/linux/src/hostReport*", "apps/linux/src/appServices*",
                    "apps/linux/src/AppMenuButton.tsx", "apps/cli/ardia_cli/telemetry.py", "apps/cli/ardia_cli/feedback.py",
                    "apps/cli/ardia_cli/star.py", "apps/cli/ardia_cli/usage.py", "apps/cli/tests/test_feedback*.py",
                    "apps/cli/tests/test_telemetry*.py", "apps/phone/src/platform/telemetry.ts",
                    "apps/phone/src/lib/telemetryCopy.ts", "*/LabNetworkLog.kt", "apps/browser/scripts/perf/native-bench.mjs",
                    "apps/phone/src/dev/selfTest.ts", "*/LabBlockingTest.kt", "*/SyncCodeReading.kt",
                    "apps/phone/src/components/settings/DataPages.tsx", "apps/phone/src/components/settings/ExpoAboutPages.tsx",
                    "apps/phone/src/state/settings/libraryCredits.ts", "apps/phone/scripts/corex-build",
                    "packages/shell/ios/SharePicker.swift", "infra/feedback/*",
                    "docs/services.md", "docs/kill-switches.md", "docs/feedback.md"]),
    ("I-identity", ["apps/browser/macos/Ardia.xcodeproj/project.pbxproj", "apps/browser/macos/*.xcconfig",
                    "apps/browser/macos/Ardia-macOS/*.entitlements", "apps/browser/macos/ExportOptions*",
                    "apps/browser/macos/Ardia-macOS/ExportOptions*", "apps/phone/ios/Ardia.xcodeproj/project.pbxproj",
                    "apps/phone/ios/Config/*", "apps/phone/app.json", "apps/phone/android/app/build.gradle",
                    "apps/phone/android/gradle.properties", "scripts/windows/installer/*",
                    "apps/browser/windows/Ardia/AppIcon.h", "apps/browser/windows/Ardia/KeychainModule.h",
                    "packages/shell/ios/KeychainModule.swift", "packages/sync/ios/Core/SyncKeyStore.swift",
                    "packages/phone/ios/ArdiaKit/Sources/ArdiaSync/SyncService.swift", "scripts/release/verify.sh",
                    "scripts/linux/linux_formats.py", "packages/shell/docktile/build.sh", "apps/cli/ardia_cli/endpoint.py",
                    "apps/cli/pyproject.toml", "scripts/lib/identity.sh", "packages/core/src/identity.ts",
                    "extras/raycast-ardia/package.json", "extras/raycast-ardia/src/scripts.ts"]),
    ("B-brand", ["docs/brand/nila/*", "apps/browser/assets/ntp-mark*", "apps/browser/assets/new-tab-mark*",
                 "apps/browser/assets/app-icon.png", "apps/browser/macos/Ardia-macOS/AppIcon*",
                 "apps/browser/macos/Ardia-macOS/Assets.xcassets/*", "packages/shell/ios/AppIcons.swift",
                 "apps/browser/src/components/settings/panes/Appearance.tsx", "apps/browser/src/state/settings/paneData.ts",
                 "apps/browser/src/components/onboarding/LookStep.tsx", "apps/phone/ios/App/AppIcon*",
                 "apps/phone/ios/*/Images.xcassets/*", "apps/phone/android/app/src/main/res/*",
                 "apps/phone/assets/*", "apps/browser/windows/Ardia/*.ico", "extras/raycast-ardia/assets/*",
                 "scripts/linux/icons/*"]),
    ("D-docs", ["README.md", "CONTRIBUTING.md", "AGENTS.md", "CLAUDE.md", "NOTICE", "docs/release-notes/*",
                "docs/ardiacore-spike.md", "docs/ardiacore-parity.md", "docs/releasing.md", "docs/history/*",
                "docs/perf/field-journeys.md", "docs/perf/sprint.md"]),
]
WAVE3 = [
    ("C-mac", ["apps/browser/macos/*", "packages/shell/ios/*", "packages/ardiacore/*", "packages/sync/ios/*",
               "packages/import/ios/*", "packages/shaders/ios/*", "packages/*/ios/*", "patches/*", "scripts/dmg/*",
               "scripts/agent/*", "packages/shell/docktile/*"]),
    ("C-linux", ["apps/linux/*", "scripts/linux/*"]),
    ("C-windows", ["apps/browser/windows/*", "packages/expo-windows/*", "scripts/windows/*"]),
    ("C-phone", ["apps/phone/*", "packages/phone/*"]),
    ("C-cli-extras", ["apps/cli/*", "extras/*"]),
    ("C-ui", ["apps/browser/*", "packages/*"]),
    ("C-docs-tooling", ["docs/*", "scripts/*", "infra/*", "*"]),
]
HAND_FINAL = {"README.md", "CONTRIBUTING.md", "AGENTS.md", "NOTICE", "docs/services.md", "docs/releasing.md"}

def match(path, pats):
    return any(fnmatch.fnmatchcase(path, p) for p in pats)

owner, area = {}, {}
for f in files:
    for name, pats in RULES:
        if match(f, pats):
            owner[f] = name
            break
    for name, pats in WAVE3:
        if match(f, pats):
            area[f] = name
            break

buckets = collections.defaultdict(list)
for f in files:
    o = owner.get(f)
    if o:
        buckets[o].append(f)
    in_r = (o is None or o in ("S-services", "I-identity", "B-brand", "M-legacy", "X-contract-content-only")) \
        and not (o or "").startswith("X-layer2") and f not in HAND_FINAL and hits.get(f)
    if o in ("G-governance-ci", "W-web-surfaces", "D-docs", "X-keep", "X-layer2"):
        in_r = False
    if in_r:
        buckets["R-mechanical"].append(f)
        buckets[area[f]].append(f)

contract_present = [c for c in CONTRACT if c in set(files)]
(out / "contract-files.txt").write_text("\n".join(sorted(contract_present)) + "\n")
with open(out / "summary.tsv", "w") as s:
    s.write("owner\tfiles\tfiles_with_L1_hits\tL1_hits\n")
    for name in sorted(buckets):
        lst = sorted(set(buckets[name]))
        (out / f"{name}.txt").write_text("\n".join(lst) + "\n")
        s.write(f"{name}\t{len(lst)}\t{sum(1 for f in lst if hits.get(f))}\t{sum(hits.get(f, 0) for f in lst)}\n")

wave1 = [n for n, _ in RULES if not n.startswith("X")]
seen = collections.Counter()
for n in wave1:
    for f in set(buckets.get(n, [])):
        seen[f] += 1
dup = [f for f, c in seen.items() if c > 1]
w3 = collections.Counter()
for n, _ in WAVE3:
    for f in set(buckets.get(n, [])):
        w3[f] += 1
dup3 = [f for f, c in w3.items() if c > 1]
uncovered = [f for f in hits if f in set(files) and f not in owner and f not in set(buckets["R-mechanical"])]
print(open(out / "summary.tsv").read())
print("wave-1 overlaps:", len(dup), "wave-3 overlaps:", len(dup3), "L1-hit files with no owner:", len(uncovered))
for f in uncovered[:20]:
    print("  uncovered", f)
missing = [p for n, pats in RULES for p in pats if "*" not in p and p not in set(files)]
print("named paths not at ref (new files or wrong guesses):", " ".join(missing))
