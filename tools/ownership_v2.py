#!/usr/bin/env python3
import bisect
import collections
import fnmatch
import pathlib
import re
import subprocess
import sys

USAGE = """usage: ownership_v2.py <repo> <ref> <census.tsv> <outdir>

Schedules every tracked file at <ref> for the Nilla Layer 1 waves.
Ownership is exclusive inside a wave and scheduled across waves:
wave 1 hand owners (G W M D S I B), wave 2 the mechanical pass (R),
wave 3 the area owners (C-*). Writes <outdir>/<owner>.txt, schedule.tsv,
contract-files.tsv, closure.tsv, handoffs.tsv, moves.tsv, frozen-tokens.tsv,
engine-literals.tsv, engine-literal-occurrences.tsv, engine-literals-excluded.tsv
and summary.txt. It runs once in wave 0 and once after wave 1, never after
wave 2: its rules name pre-rename paths (wave 3 lists are remapped instead)."""

if len(sys.argv) != 5:
    sys.exit(USAGE)
repo, ref, census, outdir = sys.argv[1:5]
out = pathlib.Path(outdir)
out.mkdir(parents=True, exist_ok=True)

L1_CATS = {"internal-layer1", "docs-site-github-extras", "package-name", "user-visible", "user-visible:test",
           "nila-identity", "upstream-service-or-repo", "remove:legacy-migration", "remove:upstream-governance",
           "decide:sync-protocol-constant"}

LOCKFILES = ["bun.lock", "*/bun.lock", "*Podfile.lock", "*package-lock.json", "*yarn.lock", "*uv.lock",
             "*pnpm-lock.yaml", "*gradle.lockfile", "apps/browser/src/conventions-baseline.json",
             "apps/phone/src/state/settings/credits.json"]
GENERATED = ["packages/phone/ios/ArdiaKit/Sources/ArdiaShared/Scripts/ardia-core.js",
             "packages/phone/ios/ArdiaKit/Sources/ArdiaShared/Scripts/ardia-sync.js",
             "packages/shaders/ios/Meadow/*", "packages/shaders/windows/meadow/page.ts"]
MAC_LEAD = ["scripts/dmg/DS_Store", "scripts/dmg/background.tiff"]
LEAD_DATA = ["apps/browser/src/naming-allowlist.json"]
LEAD_FILES = LOCKFILES + GENERATED + MAC_LEAD + LEAD_DATA

ENGINE_ROOTS = ["engine/*", "scripts/windows/engine/*"]

X_LAYER2 = ENGINE_ROOTS + [
    "apps/browser/assets/offline-game/*", "apps/browser/assets/offline-game-pipeline/*",
    "packages/ardiacore/prebuilt-engines*.tsv", "packages/ardiacore/scripts/fetch-engine.sh",
    "packages/ardiacore/scripts/ubo.sh", "packages/ardiacore/ios/page_script.js",
    "packages/ardiacore/src/engine/api.ts", "docs/brand/ardia/*", "scripts/windows/fetch-engine.ps1",
    "scripts/windows/engine-source.sh", "scripts/engine-source.sh", "scripts/linux/ardia.apparmor",
    "scripts/linux/ardia-launch", "scripts/linux/dev.ardia.linux.policy",
    "apps/browser/windows/Ardia/EngineApi.h", "packages/sync/tests/fixtures/sealed-0.2.32.b64"]

X_KEEP = ["LICENSE", "LICENSE.Apache-2.0", "third_party/*", "docs/perf/0.2.*", "docs/audit/*", "docs/history/*",
          "*THIRD_PARTY_NOTICES.txt"]

M_DELETE_SEEDS = ["packages/sync/ios/Core/LegacyMigration.swift", "packages/sync/tests/LegacyMigrationTests.swift",
                  "packages/sync/tests/LegacyDockTileTests.swift", "packages/sync/scripts/legacy-migration-*",
                  "apps/browser/src/lib/legacy.ts", "apps/browser/src/lib/legacy.test.mjs",
                  "packages/sync/src/companion/legacy.ts", "scripts/lib/legacy-name.sh",
                  "packages/sync/tools/legacy-migration/*", "packages/sync/ios/Core/DocumentRewriter.swift"]
I_BEFORE_M = ["packages/sync/ios/Core/SyncCrypto.swift", "packages/sync/ios/Core/SecretStore.swift",
              "packages/sync/ios/SyncModule.swift"]
M_EDIT_SEEDS = ["scripts/lib/instance.mjs", "packages/sync/Package.swift", "packages/sync/package.json",
                "packages/sync/src/companion/cycle.ts", "packages/sync/src/companion/view.ts",
                "packages/sync/src/companion/companion.test.ts", "apps/browser/src/state/sync/pinned.test.mjs"]
M_KEEP_INERT = ["*PhoneLegacy*", "*/LegacyModule.kt", "*/LegacyModule.swift", "*/LegacyNamesTest.kt",
                "*/LegacyPreferencesFile.kt", "*/LegacyImportGate.swift", "*/UpgradeGate.kt", "apps/phone/src/state/legacy/*",
                "apps/phone/src/platform/legacy.ts", "packages/phone/src/legacy*.ts", "apps/phone/src/dev/legacyApi*",
                "apps/phone/test/legacyFixture.ts", "apps/phone/test/r8/*"]
M_DERIVED_DELETE_ROOTS = ["packages/sync/*", "packages/phone/*", "apps/phone/*", "apps/browser/src/lib/*",
                          "scripts/lib/*", "apps/browser/macos/*", "packages/shell/*", "tools/*"]

G_RULES = [".github/*", "CLA.md", ".coderabbit.yaml", ".claude/*", "scripts/stats.mjs", "scripts/stats/*",
           "scripts/telemetry-env.mjs", "scripts/telemetry-sql.mjs", "scripts/update-checks.mjs", "scripts/replay.mjs",
           "scripts/lib/releases.sh", "scripts/lib/repo.mjs", "scripts/lib/repo.test.mjs",
           "scripts/lib/release-note.mjs", "scripts/lib/release-note.test.mjs", "scripts/release.sh",
           "scripts/release/*", "scripts/windows/publish-alpha.sh", "scripts/symbolicate-crash.sh", "package.json",
           "scripts/check-all.sh"]
G_DELETE = [".github/workflows/cla.yml", ".github/workflows/linked-issue.yml", ".github/workflows/vouch-*.yml",
            ".github/workflows/deploy.yml", ".github/vouch/*", ".github/TEAM.td", ".github/VOUCHED.td", "CLA.md",
            ".coderabbit.yaml", ".claude/skills/stats/*", ".claude/skills/elevenlabs/*",
            ".claude/skills/release/SKILL.md", ".claude/skills/release/scripts/site-version.mjs",
            ".claude/skills/release/scripts/update-tap.sh", ".claude/skills/release/scripts/rollout-everyone.sh",
            ".claude/skills/release/references/*", "scripts/stats.mjs", "scripts/stats/*",
            "scripts/telemetry-env.mjs", "scripts/telemetry-sql.mjs", "scripts/update-checks.mjs", "scripts/replay.mjs"]
G_MOVE = {".claude/skills/release/scripts/": "scripts/release/"}

W_RULES = ["apps/site/*", "apps/dashboard/*", "apps/videos/*", "infra/site/*", "infra/dashboard/*", "infra/telemetry/*",
           "infra/hexclave-cli/*", "infra/shared.ts", "infra/lib.sh", "packages/shaders/scripts/meadow.mjs",
           "packages/shaders/turbo.json", "scripts/dmg/background.html", "scripts/dmg/render.sh", "docs/growth.md",
           "docs/dashboard-triage.md", "docs/dashboard-settings.md", "apps/linux/vite.config.ts",
           "apps/linux/src/shims/web/gl/meadow.ts", "apps/linux/src/shims/site-meadow.d.ts"]
W_KEEP_MOVED = ["apps/site/src/scripts/meadow/*", "apps/site/src/scripts/meadowApp.ts", "apps/site/src/data/heroPoster.ts",
                "apps/site/src/data/heroFrames.mjs", "apps/site/src/assets/hero/*", "apps/site/public/switches.json"]
W_DELETE = ["apps/site/*", "apps/dashboard/*", "apps/videos/*", "infra/site/*", "infra/dashboard/*", "infra/telemetry/*",
            "infra/hexclave-cli/*", "infra/shared.ts", "infra/lib.sh", "docs/growth.md", "docs/dashboard-triage.md",
            "docs/dashboard-settings.md"]
MEADOW_ROOT = "packages/shaders/meadow-src/"
W_MOVE = {"apps/site/src/scripts/meadow/": MEADOW_ROOT + "scripts/meadow/",
          "apps/site/src/scripts/meadowApp.ts": MEADOW_ROOT + "scripts/meadowApp.ts",
          "apps/site/src/data/heroPoster.ts": MEADOW_ROOT + "data/heroPoster.ts",
          "apps/site/src/data/heroFrames.mjs": MEADOW_ROOT + "data/heroFrames.mjs",
          "apps/site/src/assets/hero/": MEADOW_ROOT + "assets/hero/"}
S_MOVE = {"apps/site/public/switches.json": "apps/browser/src/platform/fixtures/switches.json"}

OVERRIDES = {"apps/site/public/switches.json": "S-services", "apps/linux/src/host.ts": "S-services",
             "apps/linux/src/host.test.mjs": "S-services",
             "apps/linux/scripts/acceptance/lib/liveServices.mjs": "S-services",
             "scripts/release/verify.sh": "I-identity", "scripts/lib/launchEnv.mjs": "I-identity",
             "scripts/lib/launchEnv.test.mjs": "I-identity", "apps/browser/windows/Ardia/LaunchConfig.h": "I-identity",
             "apps/cli/install.sh": "I-identity", "packages/shell/ios/CliInstaller.swift": "I-identity"}

SWITCH_TESTS = "seed switches through launch.switches and reloadLaunchConfigForTests(), or overrideServicesForTests({ switchesUrl }), not switches-cache.json (S)"
SYSTEM_LINK_TESTS = "system links are nilla:// now (I, 3fdb394ea): feed nilla:// links; internal ardia:// app URLs stay"
VAULT = "the vault extension .nns becomes .nls on every platform in one commit (I finding 8)"
LOGO = "draw Nilla's mark from the branding hand-off, not Ardia's geometry (B)"
VAULT_TESTS = "tests that name vault files follow the vault extension (.nls) in the same commit as the vault (I finding 8); the shared and local document names (sync-state.nns, sync-journal.nns, sync-snapshot.nns) keep .nns"
FIXTURE_MIRROR = "regenerate by hand from the regenerated windows-interop mac.json and mac/ files in the same commit as the fixtures (no generator writes it); windowsRecoveryKit.test.mjs checks it byte for byte"
AUMID_SMOKE = "the launch-log check expects the app's AppUserModelID NillaDigital.Nilla (AppIcon.h), not Ardia.Browser; keep it separate from launcher-identity.ps1's effective window AUMID so an engine override shows as its own failure (review)"
REAL_PROFILE = "decide whether a test instance also refuses Nilla's own %LOCALAPPDATA%\\Nilla and %APPDATA%\\Nilla; if so add it next to the upstream Ardia folders (P-windows-real-profile-guard keeps those paired with the engine's test_gate.cc), never in their place (review)"
README_WINDOWS = "after R, the Windows quick start launches Nilla.exe, the launcher assemble.ps1 writes after R, in the nilla-dev-run.ps1 command and the sentence before it; keep the Linux instructions (review)"
CLI_HOME = "done by the lead before R (8cec0272c): the Mac CLI config folder is ~/.config/nilla, matching ArdiaLaunchConfig.mm (I1), and hooks use Nilla's label, logs and CLI home; recheck after R"
W3_OVERRIDES = {
    "apps/browser/src/state/tabs/prewarm.test.mjs": ("C-ui", SWITCH_TESTS),
    "apps/browser/src/components/window/dockMotion.test.mjs": ("C-ui", SWITCH_TESTS),
    "apps/browser/src/state/tabs/launchTab.test.mjs": ("C-ui", SWITCH_TESTS),
    "apps/browser/src/state/sync/pinned.ts": ("C-ui", "call the adapters directly and drop inTodaysNames (M)"),
    "apps/browser/src/state/sync/scopeAdapters.ts": ("C-ui", "call the adapters directly and drop inTodaysNames (M)"),
    "apps/browser/src/state/sync/adapters.ts": ("C-ui", "delete the identity adapter inTodaysNames (M)"),
    "apps/browser/src/state/telemetry/settingsSnapshot.ts": ("C-ui", "appIconSetting accepts the hyphenated icon ids, tested against every AppIcons.swift id (B)"),
    "packages/sync/ios/Core/PreferencesDomain.swift": ("C-mac", "delete the leftover legacy helper (M)"),
    "packages/sync/ios/Core/MigrationError.swift": ("C-mac", "delete the leftover legacy helper (M)"),
    "packages/sync/ios/Core/MigrationFiles.swift": ("C-mac", "delete the leftover legacy helper (M)"),
    "packages/sync/ios/Core/SecretStore.swift": ("C-mac", "drop its MigrationFiles calls and the legacy-keychain.json store (M)"),
    "packages/sync/ios/Core/SyncVault.swift": ("C-mac", VAULT),
    "apps/browser/windows/Ardia/SyncFiles.h": ("C-mac", VAULT),
    "apps/browser/windows/Ardia/SyncSelfTest.h": ("C-mac", VAULT),
    "packages/phone/android/src/main/java/com/ardia/sync/core/SyncVault.kt": ("C-mac", VAULT),
    "packages/phone/android/src/main/java/com/ardia/sync/DocumentTreeStorage.kt": ("C-mac", VAULT),
    "packages/phone/android/src/main/java/com/ardia/sync/SyncFiles.kt": ("C-mac", VAULT),
    "packages/phone/ios/ArdiaKit/Sources/ArdiaSync/SyncFiles.swift": ("C-mac", VAULT),
    "packages/expo-windows/src/sync/vault.ts": ("C-mac", VAULT),
    "packages/expo-windows/src/selfCheck/sync.ts": ("C-mac", VAULT),
    "apps/browser/src/state/sync/fixtures/windowsSyncDouble.mjs": ("C-mac", VAULT),
    "packages/sync/tests/WindowsInteropTests.swift": ("C-mac", "regenerate the windows-interop fixtures on the Mac (wave 4)"),
    "apps/browser/src/state/sync/windowsVault.test.mjs": ("C-mac", "reads the windows-interop fixtures; green after their Mac regeneration"),
    "packages/ardiacore/ios/ArdiaLaunchConfig.mm": ("C-mac", "switchOn: ignores cached remote switches unless the services snapshot sets switchesUrl (S1)"),
    "packages/ardiacore/ios/ArdiaHost+Launch.mm": ("C-mac", "LaunchTabSwitchedOff reads switches through the fixed switchOn: (S1)"),
    "infra/feedback/test/unit.test.mjs": ("C-repo-docs", "reads no deleted hosting file (fixed in faf8b60d8); rerun after R"),
    "infra/feedback/test/service.test.mjs": ("C-repo-docs", "reads no deleted hosting file (fixed in faf8b60d8); rerun after R"),
    "apps/phone/android/app/src/main/res-system/drawable/ardia_logo.xml": ("C-phone", LOGO),
    "apps/phone/android/app/src/main/res-system/drawable/ardia_logo_plain.xml": ("C-phone", LOGO),
    "apps/phone/android/app/src/main/java/com/ardia/browser/android/system/ArdiaWidgets.kt": ("C-phone", "check the widgets in both states with the new marks (B)"),
    "apps/phone/src/components/ui/ArdiaLogo.tsx": ("C-phone", LOGO),
    "apps/phone/android/ardia-design/src/main/java/com/ardia/design/ArdiaLogoMark.kt": ("C-phone", LOGO),
    "packages/phone/ios/ArdiaKit/Sources/ArdiaDesign/Components/ArdiaLogoMark.swift": ("C-phone", LOGO),
    "apps/phone/src/render/expoInfoPages.render.test.tsx": ("C-phone", "About has only Source Code, opening NoorChasib/nilla (S)"),
    "packages/phone/android/src/test/java/com/ardia/phone/PhoneSystemLinksTest.kt": ("C-phone", SYSTEM_LINK_TESTS),
    "packages/phone/android/src/test/java/com/ardia/phone/SyncOfferTest.kt": ("C-phone", SYSTEM_LINK_TESTS),
    "apps/phone/android/app/src/test/java/com/ardia/browser/android/ShareSheetTest.kt": ("C-phone", SYSTEM_LINK_TESTS),
    "packages/phone/ios/ArdiaKit/Tests/ArdiaDesignTests/SystemSharedTests.swift": ("C-phone", SYSTEM_LINK_TESTS),
    "apps/cli/ardia_cli/config_files.py": ("C-cli-extras", CLI_HOME),
    "apps/cli/ardia_cli/config_cli.py": ("C-cli-extras", CLI_HOME),
    "apps/cli/ardia_cli/automation_cli.py": ("C-cli-extras", CLI_HOME),
    "apps/cli/tests/test_config.py": ("C-cli-extras", CLI_HOME),
    "apps/cli/tests/test_automation.py": ("C-cli-extras", CLI_HOME),
    "apps/cli/ardia_cli/usage.py": ("C-cli-extras", "done by the lead before R (8cec0272c): cli_home() defaults to ~/Library/Application Support/Nilla/CLI like install.sh (I); recheck after R"),
    "apps/cli/ardia_cli/cli.py": ("C-cli-extras", "run_to_closed_pipe catches DataDirUnset (one line, exit 2) and the help stops promising installer skill runs (I)"),
    "packages/expo-windows/src/sync/index.ts": ("C-windows", "done by the lead before R (e2247157b): Nilla Sync default and the upstream Sync folder guard; recheck after R that windowsSyncFolder.test.mjs and upstreamSyncFolder.test.mjs pass"),
    "packages/expo-windows/src/selfCheck/appSystem.ts": ("C-windows", "expect the disabled default-browser state, not ArdiaHTM (I finding 4)"),
    "scripts/windows/launcher-identity.ps1": ("C-windows", "read the effective AUMID of the engine's top-level windows (I finding 9)"),
    "scripts/windows/tour.ps1": ("C-windows", "delete cold-app in its finally block or build it outside -Out (G)"),
    "scripts/windows/launch-smoke.ps1": ("C-windows", AUMID_SMOKE),
    "apps/browser/windows/Ardia/TestGate.h": ("C-windows", REAL_PROFILE),
    "apps/browser/src/platform/windowsLaunchConfig.test.mjs": ("C-windows", REAL_PROFILE),
    "packages/expo-windows/src/selfCheck/syncFixture.ts": ("C-mac", FIXTURE_MIRROR),
    "apps/browser/src/state/sync/windowsRecoveryKit.test.mjs": ("C-mac", FIXTURE_MIRROR),
    "packages/phone/android/src/test/java/com/ardia/sync/DocumentTreeStorageTest.kt": ("C-mac", VAULT_TESTS),
    "packages/phone/android/src/test/java/com/ardia/sync/core/SyncVaultTest.kt": ("C-mac", VAULT_TESTS),
    "packages/phone/android/src/test/java/com/ardia/sync/core/SyncVectors.kt": ("C-mac", VAULT_TESTS),
    "packages/phone/android/src/test/java/com/ardia/sync/core/SyncVectorsTest.kt": ("C-mac", VAULT_TESTS),
    "packages/phone/android/src/androidTest/java/com/ardia/sync/SyncEndToEndTest.kt": ("C-mac", VAULT_TESTS),
    "packages/phone/ios/ArdiaKit/Tests/ArdiaSyncTests/SyncEndToEndTests.swift": ("C-mac", VAULT_TESTS),
    "packages/sync/tests/SyncCoreTests.swift": ("C-mac", VAULT_TESTS),
    "packages/sync/tests/SyncVectorsTests.swift": ("C-mac", VAULT_TESTS),
    "packages/sync/scripts/e2e.mjs": ("C-mac", VAULT_TESTS),
    "README.md": ("C-repo-docs", README_WINDOWS),
}

S_RULES = ["packages/core/src/services.ts", "packages/core/src/ingestKeys.ts", "apps/browser/src/state/telemetry/*",
           "apps/browser/src/platform/killSwitches*", "apps/browser/src/platform/launchConfig.ts",
           "apps/browser/src/state/report/*", "apps/browser/src/state/releaseNotes/*",
           "apps/browser/src/components/ntp/TelemetryAsk.tsx", "apps/browser/src/components/onboarding/PrivacyStep.tsx",
           "apps/browser/src/components/onboarding/SetupCode*",
           "apps/browser/src/components/settings/panes/ShareDiagnostics.tsx",
           "apps/browser/src/components/settings/panes/UpdatesSection.tsx",
           "apps/browser/src/components/settings/panes/SetupCodeRow.tsx",
           "apps/browser/src/components/settings/rows/generalRows.ts", "apps/browser/src/platform/windowsUpdateManifest*",
           "apps/browser/macos/Ardia-macOS/Info.plist", "packages/shell/ios/AppUpdater.swift",
           "packages/shell/ios/AppModule.swift", "packages/shell/ios/MainMenu.swift", "packages/shell/ios/ReportUploader.swift",
           "packages/expo-windows/src/updater/*", "packages/expo-windows/src/modules.ts",
           "packages/expo-windows/src/selfCheck/appSystem.ts", "apps/browser/windows/Ardia/UpdateModule.h",
           "apps/linux/src/hostUpdates*", "apps/linux/src/updateReleases*", "apps/linux/src/hostTelemetry*",
           "apps/linux/src/reportProblem*", "apps/linux/src/hostReport*", "apps/linux/src/appServices*",
           "apps/linux/src/AppMenuButton.tsx", "apps/linux/src/hostModules.ts", "apps/linux/src/layer1Gate*",
           "apps/cli/ardia_cli/telemetry.py", "apps/cli/ardia_cli/feedback.py", "apps/cli/ardia_cli/star.py",
           "apps/cli/ardia_cli/usage.py", "apps/cli/tests/test_feedback*.py", "apps/cli/tests/test_telemetry*.py",
           "apps/phone/src/platform/telemetry.ts", "apps/phone/src/lib/telemetryCopy.ts", "*/LabNetworkLog.kt",
           "apps/browser/scripts/perf/native-bench.mjs", "apps/phone/src/dev/selfTest.ts", "*/LabBlockingTest.kt",
           "*/SyncCodeReading.kt", "apps/phone/src/components/settings/DataPages.tsx",
           "apps/phone/src/components/settings/ExpoAboutPages.tsx", "apps/phone/scripts/corex-build",
           "packages/shell/ios/SharePicker.swift", "packages/demo/src/shims/web/RefusedPage.tsx",
           "packages/demo/src/frameable.ts", "infra/feedback/*", "apps/site/public/switches.json",
           "docs/services.md", "docs/kill-switches.md", "docs/feedback.md"]

I_RULES = ["apps/browser/macos/Ardia.xcodeproj/project.pbxproj", "apps/browser/macos/*.xcconfig",
           "apps/browser/macos/Ardia-macOS/*.entitlements", "apps/browser/macos/ExportOptions*",
           "apps/browser/macos/Ardia-macOS/ExportOptions*", "apps/phone/ios/Ardia.xcodeproj/project.pbxproj",
           "apps/phone/ios/Config/*", "apps/phone/ios/*/*.entitlements", "apps/phone/app.json",
           "apps/phone/android/app/build.gradle", "apps/phone/android/gradle.properties", "scripts/windows/installer/*",
           "apps/browser/windows/Ardia/AppIcon.h", "apps/browser/windows/Ardia/KeychainModule.h",
           "apps/browser/windows/Ardia/Paths.h", "apps/browser/windows/Ardia/EngineHostModule.h",
           "apps/browser/windows/Ardia/SystemModule.h", "apps/browser/windows/Ardia/SyncCrypto.h",
           "apps/browser/windows/Ardia/SyncSecrets.h", "apps/browser/windows/ArdiaLauncher/Launcher.cpp",
           "packages/shell/ios/KeychainModule.swift", "packages/sync/ios/Core/SyncKeyStore.swift",
           "packages/phone/ios/ArdiaKit/Sources/ArdiaSync/SyncService.swift", "scripts/release/verify.sh",
           "packages/shell/docktile/build.sh", "apps/cli/ardia_cli/endpoint.py", "scripts/lib/identity.sh",
           "scripts/lib/identity.test.mjs", "packages/core/src/identity.ts", "extras/raycast-ardia/package.json",
           "extras/raycast-ardia/src/scripts.ts", "extras/raycast-ardia/LICENSE",
           "apps/browser/src/state/sync/fixtures/windowsSyncDouble.mjs", "*/SyncFolders.kt", "*/SyncFolderAccess.swift",
           "*/SyncKeys.kt", "*/BrowserSchema.swift", "packages/ardiacore/ios/ArdiaLaunchConfig.mm",
           "apps/browser/windows/Ardia/Ardia.cpp", "apps/phone/android/app/src/main/AndroidManifest.xml",
           "scripts/linux/nilla-dev-run", "scripts/windows/nilla-dev-run.ps1",
           "apps/phone/ios/Ardia/Info.plist", "apps/phone/android/app/src/main/res-system/xml/shortcuts.xml",
           "apps/phone/android/app/src/main/res/xml/phone_shortcuts.xml",
           "packages/phone/android/src/main/java/com/ardia/browser/BrowserUrl.kt",
           "packages/phone/android/src/main/java/com/ardia/appmodel/SystemLink.kt",
           "packages/phone/ios/ArdiaKit/Sources/ArdiaBrowser/Tabs/TabPolicies.swift",
           "packages/phone/ios/ArdiaKit/Sources/ArdiaDesign/SystemShared.swift",
           "packages/sync/tests/fixtures/sync-vectors/*", "packages/sync/tests/SyncVectorsTests.swift",
           "*/sync/core/SyncVectors.kt", "*/sync/core/SyncVectorsTest.kt", "*/sync/core/KotlinSyncVectorSetTest.kt",
           "*/sync/core/SyncKeysTest.kt", "packages/sync/tests/fixtures/sealed-nilla-0.1.b64",
           "apps/cli/ardia_cli/config_cli.py", "apps/cli/ardia_cli/hooks.py", "apps/cli/ardia_cli/scripts_cli.py",
           "apps/cli/ardia_cli/automation_cli.py", "apps/cli/tests/test_linux.py", "apps/cli/tests/test_config.py",
           "apps/cli/tests/test_automation.py", "apps/cli/tests/test_scripts.py", "apps/cli/tests/test_endpoint*.py",
           "apps/phone/src/dev/defaultBrowserSwitch.test.ts", "apps/phone/src/dev/releaseDryRun.test.ts"]
R_SKIP_TREE = ["packages/sync/tests/fixtures/sync-vectors/*"]
R_EXTRA = {"apps/phone/src/lib/shownWhatsSent.test.ts": "reads the copy key ardiaCredit, which the census counts as attribution but R renames in the copy"}
R_HAND_IN_COMMIT = {"apps/cli/scripts/build.sh": "module references only, in the module-move commit"}
NATIVE_EXT = {".h", ".hpp", ".cpp", ".mm", ".m", ".swift", ".kt", ".iss", ".plist", ".entitlements", ".ps1", ".xcconfig",
              ".gradle", ".pbxproj"}
I_SYNC_TOKENS = ["netnyahoo-sync/v1", "NNS1", "Netnyahoo Sync", "Ardia Sync", "ardia-sync/v1"]
I_SYNC_ROOTS = ["apps/browser/windows/*", "packages/sync/*", "packages/phone/*", "apps/phone/*", "packages/shell/*",
                "apps/browser/src/state/sync/*", "apps/browser/macos/*"]
I_SYNC_EXCLUDE = ["apps/browser/src/state/sync/syncDoc.ts", "*ardia-sync.js", "*.md"]

B_RULES = ["docs/brand/nilla/*", "apps/browser/assets/ntp-mark*", "apps/browser/assets/new-tab-mark*",
           "apps/browser/assets/app-icon.png", "apps/browser/macos/Ardia-macOS/AppIcon*",
           "apps/browser/macos/Ardia-macOS/Assets.xcassets/*", "packages/shell/ios/AppIcons.swift",
           "apps/browser/src/components/settings/panes/Appearance.tsx", "apps/browser/src/state/settings/paneData.ts",
           "apps/browser/src/components/onboarding/LookStep.tsx", "apps/phone/ios/App/AppIcon*",
           "apps/phone/ios/*/Images.xcassets/*", "apps/phone/ios/*/Assets.xcassets/*",
           "apps/phone/android/app/src/main/res/*", "apps/phone/android/app/src/main/res-system/drawable/ardia_logo*.xml",
           "apps/phone/assets/*",
           "apps/browser/windows/Ardia/*.ico", "extras/raycast-ardia/assets/*", "scripts/linux/icons/*"]

D_RULES = ["README.md", "CONTRIBUTING.md", "AGENTS.md", "CLAUDE.md", "NOTICE", "docs/release-notes/*",
           "docs/ardiacore-spike.md", "docs/ardiacore-parity.md", "docs/releasing.md", "docs/perf/field-journeys.md",
           "docs/perf/sprint.md", "docs/windows/*.png"]
D_FINAL = ["README.md", "CONTRIBUTING.md", "AGENTS.md", "CLAUDE.md", "NOTICE", "docs/release-notes/README.md",
           "docs/releasing.md"]

R_SKIP_HAND = {"scripts/linux/package.py": "C-linux", "scripts/linux/install.sh": "C-linux",
               "scripts/linux/runtime_files.py": "C-linux", "scripts/linux/linux_formats.py": "C-linux",
               "scripts/linux/arch/PKGBUILD": "C-linux", "scripts/linux/fetch-engine.sh": "C-linux",
               "scripts/linux/publish-engine.sh": "C-linux", "scripts/linux/publish_engine.py": "C-linux",
               "scripts/linux/smoke.mjs": "C-linux", "apps/cli/install.sh": "C-cli-extras",
               "apps/cli/scripts/build.sh": "C-cli-extras"}

WAVE1 = [("M-legacy", None), ("G-governance-ci", G_RULES), ("W-web-surfaces", W_RULES), ("S-services", S_RULES),
         ("I-identity", I_RULES), ("B-brand", B_RULES), ("D-docs", D_RULES)]
WAVE3 = [("C-mac", ["apps/browser/macos/*", "packages/*/ios/*", "packages/ardiacore/*", "patches/*", "scripts/dmg/*",
                    "scripts/agent/*", "packages/shell/docktile/*", "packages/sync/*", "scripts/release/verify.sh",
                    "scripts/release/export-sign.sh"]),
         ("C-linux", ["apps/linux/*", "scripts/linux/*"]),
         ("C-windows", ["apps/browser/windows/*", "packages/expo-windows/*", "scripts/windows/*"]),
         ("C-phone", ["apps/phone/*", "packages/phone/*"]),
         ("C-cli-extras", ["apps/cli/*", "extras/*"]),
         ("C-ui", ["apps/browser/*", "packages/*"]),
         ("C-repo-docs", ["*"])]

GENERIC_STEMS = {"index", "readme", "package", "main", "types", "utils", "util", "config", "test", "tests", "tsconfig",
                 "lib", "app", "build", "check", "run", "setup", "style", "styles", "global", "constants", "data",
                 "helpers", "shared", "common", "license", "notice", "changelog", "manifest", "info", "default",
                 "src", "dist", "vite", "astro", "env", "server", "client", "deploy", "favicon", "icon", "logo"}

CODE_EXT = {".ts", ".tsx", ".mjs", ".js", ".cjs", ".json", ".py", ".sh", ".swift", ".m", ".mm", ".h", ".hpp", ".cpp",
            ".cc", ".kt", ".kts", ".gradle", ".yml", ".yaml", ".toml", ".ps1", ".iss", ".plist", ".xcconfig",
            ".pbxproj", ".html", ".css", ".gn", ".tsv", ".txt", ".rb", ".cfg", ".ini", ".xml"}


def match(path, pats):
    return any(fnmatch.fnmatchcase(path, p) for p in pats)


def git(*args, inp=None):
    return subprocess.run(["git", "-C", repo, *args], input=inp, capture_output=True, check=True).stdout


entries = []
for line in git("ls-tree", "-r", "-l", ref).decode("utf-8", "replace").split("\n"):
    if not line:
        continue
    meta, path = line.split("\t", 1)
    mode, kind, sha, size = meta.split()
    if kind == "blob":
        entries.append((path, sha, int(size) if size.isdigit() else 0))
files = [e[0] for e in entries]
file_set = set(files)

wanted = [(p, s) for p, s, n in entries if n <= 1_500_000]
batch = git("cat-file", "--batch", inp="".join(s + "\n" for _, s in wanted).encode())
text = {}
pos = 0
for path, sha in wanted:
    header_end = batch.index(b"\n", pos)
    size = int(batch[pos:header_end].split()[2])
    blob = batch[header_end + 1:header_end + 1 + size]
    pos = header_end + 1 + size + 1
    if b"\0" not in blob[:8000]:
        text[path] = blob.decode("utf-8", "replace")

hits = collections.Counter()
for line in open(census, encoding="utf-8", errors="replace"):
    parts = line.split("\t", 2)
    if len(parts) >= 2 and parts[0] in L1_CATS:
        hits[parts[1]] += 1

is_engine = {f: match(f, ENGINE_ROOTS) for f in files}
app_files = [f for f in files if not is_engine[f]]
app_text = {f: text[f] for f in app_files if f in text}

contract = {}
path_like = re.compile(r"(?:\.\.?/)*[A-Za-z0-9_@+.-]+(?:/[A-Za-z0-9_@+.-]+)+")
dirs = set()
for f in app_files:
    parts = f.split("/")
    for i in range(1, len(parts)):
        dirs.add("/".join(parts[:i]))
suffix_index = collections.defaultdict(list)
for f in app_files:
    parts = f.split("/")
    for i in range(1, len(parts)):
        suffix_index["/".join(parts[i:])].append(f)
for f in files:
    if not is_engine[f] or f not in text:
        continue
    for raw in set(path_like.findall(text[f])):
        cand = raw
        while cand.startswith("./") or cand.startswith("../"):
            cand = cand[cand.index("/") + 1:]
        cand = cand.rstrip(".")
        if cand.startswith("engine/") or cand.startswith("scripts/windows/engine/"):
            continue
        if cand in file_set:
            contract.setdefault(cand, ("path", f))
        elif cand in dirs and "/" in cand and cand.split("/")[0] in {"apps", "packages", "scripts", "infra", "extras", "docs"}:
            contract.setdefault(cand + "/", ("dir", f))
        elif "/" in cand and cand.count("/") >= 1 and "." in cand.rsplit("/", 1)[-1]:
            found = suffix_index.get(cand, [])
            if raw.startswith("./src/") or raw.startswith("../browser/") or raw.startswith("../../"):
                found = [g for g in found if g.startswith("apps/") or g.startswith("packages/")]
            if 0 < len(found) <= 2:
                for g in found:
                    contract.setdefault(g, ("suffix", f))
CONTRACT_EXTRA = {"scripts/linux/linux_formats.py": "engine/patches/build/tests/test_platform_tooling.py"}
base_index = collections.defaultdict(list)
for f in app_files:
    base_index[pathlib.PurePosixPath(f).name].append(f)
quoted_base = re.compile(r"""['"]([A-Za-z0-9_+.-]+\.(?:ts|tsx|mjs|js|py|sh|swift|mm|m|h|json|b64|txt|plist|kt))['"]""")
for f in files:
    if not is_engine[f] or f not in text or "/tests/" not in f:
        continue
    for name in set(quoted_base.findall(text[f])):
        found = base_index.get(name, [])
        if 0 < len(found) <= 2:
            for g in found:
                contract.setdefault(g, ("basename", f))
assign_re = re.compile(r"""(?m)^\s*(\w+)\s*=\s*(\w+)\s*/\s*['"]([^'"]+)['"]\s*$""")
join_re = re.compile(r"""\b(\w+)\s*/\s*['"]([^'"]+)['"]""")
for f in files:
    if not is_engine[f] or f not in text or not f.endswith(".py"):
        continue
    roots = {}
    for var, parent, sub in assign_re.findall(text[f]):
        if parent in ("REPO", "ROOT", "REPO_ROOT"):
            roots[var] = sub.strip("/")
        elif parent in roots:
            roots[var] = roots[parent] + "/" + sub.strip("/")
    for var, sub in join_re.findall(text[f]):
        if var in roots:
            cand = roots[var] + "/" + sub.strip("/")
            if cand in file_set:
                contract[cand] = ("joined-path", f)
            elif cand in dirs:
                contract.setdefault(cand + "/", ("dir", f))
for g, why in CONTRACT_EXTRA.items():
    if g in file_set:
        contract.setdefault(g, ("module", why))
JS_EXT = (".ts", ".tsx", ".mjs", ".js", ".cjs")
import_re = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*)["'](\.{1,2}/[^"']+)["']""")


def resolve_import(importer, spec):
    target = str(pathlib.PurePosixPath(importer).parent / spec)
    norm = []
    for part in target.split("/"):
        if part == "..":
            norm and norm.pop()
        elif part != ".":
            norm.append(part)
    target = "/".join(norm)
    for cand in (target, target + ".ts", target + ".tsx", target + ".mjs", target + ".js", target + "/index.ts",
                 target + "/index.mjs", target + ".d.ts"):
        if cand in file_set:
            return cand
    return None


import_graph = collections.defaultdict(set)
importers_of = collections.defaultdict(set)
for f in app_files:
    if f in text and f.endswith(JS_EXT):
        for spec in import_re.findall(text[f]):
            t = resolve_import(f, spec)
            if t and t != f:
                import_graph[f].add(t)
                importers_of[t].add(f)
imported = {}
queue = [c for c in contract if not c.endswith("/")]
while queue:
    c = queue.pop()
    for t in sorted(import_graph.get(c, ())):
        if t not in contract and t not in imported:
            imported[t] = c
            queue.append(t)
REQUIRED_CONTRACT = ["apps/browser/src/state/live/sources.ts", "apps/browser/src/state/live/googleAuth.ts",
                     "packages/ardiacore/ios/ArdiaWebView+Navigation.mm", "scripts/linux/linux_formats.py",
                     "infra/feedback/lib/validate.mjs", "infra/feedback/lib/ids.mjs",
                     "apps/linux/src/hostSync.ts", "apps/linux/src/hostLive.ts",
                     "packages/sync/tests/fixtures/sealed-0.2.32.b64"]
required_missing = [p for p in REQUIRED_CONTRACT if p in file_set and p not in contract and p not in imported]
contract_paths = {c for c in contract if not c.endswith("/")}
contract_dirs = {c for c in contract if c.endswith("/")}

owner = {}
for f in files:
    if match(f, LOCKFILES) and match(f, W_DELETE):
        owner[f] = "W-web-surfaces"
    elif match(f, LEAD_FILES):
        owner[f] = "L-lead"
    elif match(f, X_LAYER2):
        owner[f] = "X-layer2"
    elif match(f, X_KEEP):
        owner[f] = "X-keep"
    elif f in OVERRIDES:
        owner[f] = OVERRIDES[f]
    elif match(f, M_DELETE_SEEDS) or match(f, M_EDIT_SEEDS):
        owner[f] = "M-legacy"
    else:
        for name, pats in WAVE1[1:]:
            if match(f, pats):
                owner[f] = name
                break

for f in app_files:
    if f in owner or f not in app_text or not match(f, I_SYNC_ROOTS) or match(f, I_SYNC_EXCLUDE):
        continue
    if any(tok in app_text[f] for tok in I_SYNC_TOKENS):
        owner[f] = "I-identity"

deleted = {}
for f in files:
    o = owner.get(f)
    if o == "M-legacy" and match(f, M_DELETE_SEEDS):
        deleted[f] = "M-legacy"
    elif o == "G-governance-ci" and match(f, G_DELETE):
        deleted[f] = "G-governance-ci"
    elif o == "W-web-surfaces" and match(f, W_DELETE) and not match(f, W_KEEP_MOVED):
        deleted[f] = "W-web-surfaces"
moved = {}
moved_by = {}
for f in files:
    if f in deleted:
        continue
    for table, who in ((G_MOVE, "G-governance-ci"), (W_MOVE, "W-web-surfaces"), (S_MOVE, "S-services")):
        for src, dst in table.items():
            if (src.endswith("/") and f.startswith(src)) or f == src:
                if owner.get(f) == who or (who == "W-web-surfaces" and f.startswith("apps/site/")):
                    moved[f] = (dst + f[len(src):]) if src.endswith("/") else dst
                    moved_by[f] = who
for f in files:
    if owner.get(f) == "D-docs" and f not in D_FINAL and f not in moved:
        moved[f] = "docs/history/ardia/" + f.split("/", 1)[1]
        moved_by[f] = "D-docs"

stem_count = collections.Counter()
for f in files:
    stem_count[pathlib.PurePosixPath(f).stem.lower()] += 1

path_tok = re.compile(r"[A-Za-z0-9_@+.-]*(?:/[A-Za-z0-9_@+.-]+)+|[A-Za-z0-9_@+-]+\.[A-Za-z0-9]+")
word_tok = re.compile(r"[A-Za-z_][A-Za-z0-9_]{5,}")
inverted = collections.defaultdict(set)
for f, body in app_text.items():
    forms = set(word_tok.findall(body))
    for raw in set(path_tok.findall(body)):
        tok = raw
        while tok.startswith("./") or tok.startswith("../"):
            tok = tok[tok.index("/") + 1:]
        tok = tok.strip("./")
        if not tok:
            continue
        comps = tok.split("/")
        for i in range(len(comps)):
            tail = "/".join(comps[i:])
            forms.add(tail)
            stem_tail = tail.rsplit(".", 1)[0] if "." in comps[-1] else tail
            forms.add(stem_tail)
        for j in range(1, min(len(comps), 3) + 1):
            forms.add("/".join(comps[:j]) + "/")
            forms.add("/".join(comps[:j]))
    for form in forms:
        inverted[form].add(f)

decl_re = re.compile(r"(?m)^(?:public |internal |private |final |open |export |@objc )*(?:class|struct|enum|object|protocol|actor|typealias|interface|func|fun|const|function)\s+([A-Z][A-Za-z0-9_]{5,})")


LANG_GROUPS = [{".swift", ".m", ".mm", ".h"}, {".kt", ".kts", ".java", ".cpp"}, {".ts", ".tsx", ".mjs", ".js", ".cjs"},
               {".py"}, {".sh"}]


def lang_of(path):
    ext = pathlib.PurePosixPath(path).suffix
    for i, group in enumerate(LANG_GROUPS):
        if ext in group:
            return i
    return None


GENERIC_DIRS = {"scripts", "assets", "src", "lib", "data", "public", "test", "tests", "components", "pages", "images",
                "img", "fonts", "icons", "bin", "tools", "fixtures", "docs", "app", "ios", "android", "windows", "macos",
                "linux", "shared", "utils", "release", "videos", "site", "hero", "media", "static", "styles", "core"}
WEB_STEMS = {"apple-touch-icon", "favicon", "robots", "sitemap", "site", "og-image", "opengraph-image", "humans",
             "security", "browserconfig"}


def keys_for(path):
    p = pathlib.PurePosixPath(path)
    stem = p.stem
    out_keys = {path}
    if p.suffix:
        out_keys.add(str(p.with_suffix("")))
    if stem.lower() not in GENERIC_STEMS and stem.lower() not in WEB_STEMS and len(stem) >= 4:
        if "." in p.parent.name:
            pass
        elif p.parent.name.lower() in GENERIC_DIRS:
            if p.parent.parent.name:
                out_keys.add(f"{p.parent.parent.name}/{p.parent.name}/{stem}")
        else:
            out_keys.add(f"{p.parent.name}/{stem}")
        if stem_count[stem.lower()] == 1 and len(stem) >= 6:
            out_keys.add(p.name)
    return out_keys


def package_name(path):
    body = text.get(path, "")
    m = re.search(r'"name"\s*:\s*"([^"]+)"', body)
    if not m:
        return None
    name = m.group(1)
    return name if ("/" in name or "-" in name) else None


def references(targets, exclude, symbols=False):
    keymap = collections.defaultdict(set)
    symbol_lang = collections.defaultdict(set)
    for t in targets:
        for k in keys_for(t):
            keymap[k].add(t)
        if t.endswith("/package.json"):
            n = package_name(t)
            if n:
                keymap[n].add(t)
                keymap[n + "/"].add(t)
        if symbols and t in text:
            for name in decl_re.findall(text[t]):
                keymap[name].add(t)
                symbol_lang[name].add(lang_of(t))
    top_dirs = {"/".join(t.split("/")[:2]) for t in targets if t.split("/")[0] in {"apps", "infra"}}
    for d in top_dirs:
        if all(x in targets for x in files if x.startswith(d + "/")):
            keymap[d + "/"].add(d + "/")
    found = collections.defaultdict(set)
    for k in keymap:
        for f in inverted.get(k, ()):
            if f in exclude:
                continue
            if k in symbol_lang and "/" not in k and "." not in k and lang_of(f) not in symbol_lang[k]:
                continue
            found[f].add(k)
    for t in targets:
        for f in importers_of.get(t, ()):
            if f not in exclude:
                found[f].add("import:" + t)
    return found


handoffs = []
closure_rows = []
m_deleted = {f for f, o in deleted.items() if o == "M-legacy"}
for _ in range(4):
    refs = references(m_deleted, m_deleted, symbols=True)
    grew = False
    for f, ks in sorted(refs.items()):
        name = pathlib.PurePosixPath(f).name
        if is_engine[f] or owner.get(f) in ("X-layer2", "X-keep", "L-lead"):
            continue
        if ("legacy" in f.lower()) and match(f, M_DERIVED_DELETE_ROOTS) and not match(f, M_KEEP_INERT) \
                and f not in m_deleted:
            m_deleted.add(f)
            deleted[f] = "M-legacy"
            owner[f] = "M-legacy"
            closure_rows.append((f, "M-legacy", "delete", ",".join(sorted(ks))[:200]))
            grew = True
    if not grew:
        break
m_refs = references(m_deleted, m_deleted, symbols=True)
for f, ks in sorted(m_refs.items()):
    if is_engine[f] or owner.get(f) in ("X-layer2", "X-keep", "L-lead"):
        continue
    current = owner.get(f)
    if f.endswith(".md"):
        closure_rows.append((f, "M-legacy", "prose-wave3", ",".join(sorted(ks))[:200]))
        continue
    if match(f, I_BEFORE_M):
        if current != "I-identity":
            handoffs.append((f, current or "-", "I-identity", "I detaches it from the legacy code before M deletes"))
        owner[f] = "I-identity"
        closure_rows.append((f, "M-legacy", "before-M:I-identity", ",".join(sorted(ks))[:200]))
        continue
    if current in (None, "M-legacy", "S-services", "I-identity", "B-brand"):
        if current not in (None, "M-legacy"):
            handoffs.append((f, current, "M-legacy", "transferred to M for the legacy closure"))
        owner[f] = "M-legacy"
        closure_rows.append((f, "M-legacy", "edit", ",".join(sorted(ks))[:200]))
    else:
        handoffs.append((f, "M-legacy", current, "edit handed to the owner: " + ",".join(sorted(ks))[:160]))
        closure_rows.append((f, "M-legacy", "handoff:" + current, ",".join(sorted(ks))[:200]))

for who in ("G-governance-ci", "W-web-surfaces", "D-docs"):
    gone = {f for f, o in deleted.items() if o == who} | {f for f, o in moved_by.items() if o == who}
    if not gone:
        continue
    refs = references(gone, set(deleted))
    for f, ks in sorted(refs.items()):
        if is_engine[f] or owner.get(f) in ("X-layer2", "X-keep", "L-lead") or f in deleted:
            continue
        current = owner.get(f)
        if f.endswith(".md") or f.startswith("docs/"):
            closure_rows.append((f, who, "prose-wave3", ",".join(sorted(ks))[:200]))
            continue
        if current is None:
            owner[f] = who
            closure_rows.append((f, who, "edit", ",".join(sorted(ks))[:200]))
        elif current == who:
            closure_rows.append((f, who, "own", ",".join(sorted(ks))[:200]))
        else:
            handoffs.append((f, who, current, "edit handed to the owner: " + ",".join(sorted(ks))[:160]))
            closure_rows.append((f, who, "handoff:" + current, ",".join(sorted(ks))[:200]))

MANUAL_HANDOFFS = [
    ("scripts/lib/launchEnv.mjs", "S-services", "I-identity", "add the services ARDIA_TEST key to TEST_KEYS"),
    ("packages/ardiacore/ios/ArdiaLaunchConfig.mm", "S-services", "I-identity", "add services to AppTestKeys()"),
    ("apps/browser/windows/Ardia/LaunchConfig.h", "S-services", "I-identity", "add services to TestKeys()"),
    ("scripts/lib/launchEnv.test.mjs", "S-services", "I-identity", "keep the three key lists equal with services"),
    ("scripts/linux/package.py", "B-brand", "C-linux", "icon source scripts/linux/icons/hicolor/256x256/apps/nilla.png, installed as share/icons/hicolor/256x256/apps/ardia.png, with a test that the packaged bytes match it"),
    ("apps/linux/linuxWording.ts", "S-services", "C-linux", "done by the lead before R (12d16b224, S-linuxWording.patch); C-linux only rechecks it after R"),
    ("scripts/windows/installer-check.ps1", "I-identity", "C-windows", "assert no [Registry], [Icons], [Run] or Ardia [Dirs]"),
    ("scripts/linux/linux_formats.py", "I-identity", "C-linux", "Maintainer, Homepage and Description only; Package: ardia stays"),
]
for path, frm, to, what in MANUAL_HANDOFFS:
    if path in file_set:
        handoffs.append((path, frm, to, what))

test_name = re.compile(r"(?:\.test\.|_test\.|Test\.|Tests\.|/tests?/|/test_|-check\.|/acceptance/)")
WAVE1_EDITORS = ("S-services", "I-identity", "B-brand", "W-web-surfaces", "G-governance-ci", "M-legacy")
native_rows = []
for src in sorted(f for f in files if owner.get(f) in WAVE1_EDITORS and f not in deleted and not is_engine[f]):
    p = pathlib.PurePosixPath(src)
    if p.suffix not in NATIVE_EXT or len(p.stem) < 5 or len(base_index.get(p.name, [])) != 1:
        continue
    for f in sorted(inverted.get(p.name, ())):
        if f == src or is_engine[f] or not test_name.search(f) or f in deleted:
            continue
        current = owner.get(f)
        if current in ("X-layer2", "X-keep", "L-lead"):
            continue
        if current is None:
            owner[f] = owner[src]
            native_rows.append((f, owner[src], "native-test", p.name))
        elif current != owner[src]:
            handoffs.append((f, owner[src], current, "test reads " + p.name + ", which " + owner[src] + " edits"))
            native_rows.append((f, owner[src], "handoff:" + current, p.name))
closure_rows.extend(native_rows)

buckets = collections.defaultdict(set)
schedule = collections.defaultdict(list)
for f in files:
    o = owner.get(f)
    if o:
        buckets[o].add(f)
        if o in dict(WAVE1):
            schedule[f].append(("1", o, "delete" if f in deleted else ("move" if f in moved else "edit")))


W3_OVERRIDE_GLOBS = [("packages/sync/tests/fixtures/windows-interop/*", "C-mac",
                      "regenerate on the Mac with ARDIA_WRITE_SYNC_FIXTURES=1 (swift WindowsInteropTests, then the JS test) for the nilla-sync/v1 salt and NLS1 (I)")]
for f in files:
    for pattern, who, what in W3_OVERRIDE_GLOBS:
        if fnmatch.fnmatchcase(f, pattern):
            W3_OVERRIDES.setdefault(f, (who, what))


def area(f):
    if f in W3_OVERRIDES:
        return W3_OVERRIDES[f][0]
    target = moved.get(f, f)
    for name, pats in WAVE3:
        if match(target, pats):
            return name
    return "C-repo-docs"


no_rename = set(contract_paths)
no_rename_reason = {}
for f in files:
    o = owner.get(f)
    if not (hits.get(f) or f in R_EXTRA) or o in ("X-layer2", "X-keep", "L-lead") or f in deleted or f in D_FINAL:
        continue
    if moved_by.get(f) == "D-docs" or match(f, R_SKIP_TREE):
        continue
    if f in R_HAND_IN_COMMIT:
        buckets["R-mechanical"].add(f)
        schedule[f].append(("2", "R-mechanical", "hand-edit: " + R_HAND_IN_COMMIT[f]))
    if f in R_SKIP_HAND:
        buckets[R_SKIP_HAND[f]].add(f)
        schedule[f].append(("3", R_SKIP_HAND[f], "hand-edit, R skips the file"))
        continue
    buckets["R-mechanical"].add(f)
    schedule[f].append(("2", "R-mechanical", "rename, manifest-protected lines kept" if f in contract_paths else "rename"))
    a = area(f)
    buckets[a].add(f)
    schedule[f].append(("3", a, "copy and fallout"))
for f, (who, ks) in {r[0]: (r[1], r[3]) for r in closure_rows if r[2] == "prose-wave3"}.items():
    if f in deleted or owner.get(f) in ("X-layer2", "X-keep", "L-lead") or f in D_FINAL:
        continue
    a = area(f)
    if not any(w == "3" for w, _, _ in schedule[f]):
        buckets[a].add(f)
        schedule[f].append(("3", a, "remove references to removed paths"))

w3_missing = sorted(f for f in W3_OVERRIDES if f not in file_set)
w3_added = []
for f, (who, what) in sorted(W3_OVERRIDES.items()):
    if f not in file_set or f in deleted:
        continue
    rows = schedule[f]
    w3 = [i for i, (w, _, _) in enumerate(rows) if w == "3"]
    for i in w3:
        rows[i] = ("3", who, "assigned: " + what)
    if not w3:
        rows.append(("3", who, "assigned: " + what))
        w3_added.append(f)
    buckets[who].add(f)

wave_of = {"M-legacy": "1", "G-governance-ci": "1", "W-web-surfaces": "1", "S-services": "1", "I-identity": "1",
           "B-brand": "1", "D-docs": "1", "R-mechanical": "2"}
for name, _ in WAVE3:
    wave_of[name] = "3"
overlaps = collections.Counter()
per_wave = collections.defaultdict(collections.Counter)
for name, members in buckets.items():
    w = wave_of.get(name)
    if not w:
        continue
    for f in members:
        per_wave[w][f] += 1
for w, counter in per_wave.items():
    overlaps[w] = sum(1 for c in counter.values() if c > 1)

covered = set()
for f in files:
    if schedule.get(f) or owner.get(f) in ("X-layer2", "X-keep", "L-lead"):
        covered.add(f)
uncovered = sorted(f for f in hits if f in file_set and f not in covered)

retained_gwd = [f for f in files if owner.get(f) in ("G-governance-ci", "W-web-surfaces", "D-docs") and f not in deleted
                and hits.get(f)]
retained_gwd_later = [f for f in retained_gwd if any(w in ("2", "3") for w, _, _ in schedule[f])]
retained_gwd_final = [f for f in retained_gwd if f in D_FINAL]
retained_gwd_archived = [f for f in retained_gwd if moved_by.get(f) == "D-docs"]
retained_gwd_unscheduled = [f for f in retained_gwd if f not in retained_gwd_later and f not in D_FINAL
                            and f not in retained_gwd_archived]

frozen_app = [f for f in files if owner.get(f) == "X-layer2" and not is_engine[f] and f in text]
tok_re = re.compile(r"[A-Za-z0-9_]*(?:[Aa]rdia|ARDIA)[A-Za-z0-9_]*")
r_tokens = collections.defaultdict(set)
for f in buckets["R-mechanical"]:
    if f in text:
        for t in set(tok_re.findall(text[f])):
            r_tokens[t].add(f)
frozen_rows = []
for f in frozen_app:
    for t in sorted(set(tok_re.findall(text[f]))):
        if "ardiacore" in t.lower() or t.startswith("ARDIA_") or t in ("Ardia", "ardia", "ARDIA"):
            continue
        users = r_tokens.get(t, set()) - {f}
        if users:
            frozen_rows.append((t, f, len(users), " ".join(sorted(users)[:4])))

lit_re = re.compile(r'"((?:[^"\\\n]|\\.){3,160})"')
eng_lits = collections.Counter()
for f in files:
    if is_engine[f] and f in text and "/tests/" not in f:
        for lit in lit_re.findall(text[f]):
            if re.search(r"ardia", lit, re.I) and "ardiacore" not in lit.lower():
                eng_lits[lit] += 1
excluded_lits = []
distinct = []
for l in sorted(eng_lits):
    if l.strip().lower() in ("ardia", "ardia ", "ardia:"):
        excluded_lits.append((l, eng_lits[l], "bare product name: covered by rule 14 and the class rules"))
    elif "%" in l or "\\" in l:
        excluded_lits.append((l, eng_lits[l], "format or escaped literal: the lead matches it by hand"))
    elif len(l) < 6:
        excluded_lits.append((l, eng_lits[l], "shorter than 6: matched only through the class rules"))
    else:
        distinct.append(l)
lit_rows = []
anchor = re.compile(r"rdia|RDIA")
by_offset = collections.defaultdict(list)
for lit in distinct:
    m = anchor.search(lit)
    if m:
        by_offset[m.start()].append(lit)
lit_files = collections.defaultdict(set)
lit_occ = []
for f in sorted(app_files):
    body = text.get(f)
    if not body:
        continue
    line_starts = [0] + [i + 1 for i, ch in enumerate(body) if ch == "\n"]
    seen = set()
    for m in anchor.finditer(body):
        for off, lits in by_offset.items():
            start = m.start() - off
            if start < 0:
                continue
            for lit in lits:
                if (lit, start) not in seen and body.startswith(lit, start):
                    seen.add((lit, start))
                    lit_files[lit].add(f)
                    ln = bisect.bisect_right(line_starts, start)
                    lit_occ.append((lit, f, ln, start - line_starts[ln - 1] + 1, len(lit)))
for lit, fs in sorted(lit_files.items(), key=lambda kv: (-len(kv[1]), kv[0])):
    lit_rows.append((lit, eng_lits[lit], len(fs), " ".join(sorted(fs)[:5])))

for name, members in buckets.items():
    (out / f"{name}.txt").write_text("\n".join(sorted(members)) + "\n")
with open(out / "schedule.tsv", "w") as s:
    s.write("path\tl1_hits\tschedule\n")
    for f in sorted(schedule):
        s.write(f"{f}\t{hits.get(f, 0)}\t" + " ; ".join(f"w{w}:{o}:{why}" for w, o, why in schedule[f]) + "\n")
with open(out / "contract-files.tsv", "w") as s:
    s.write("path\tkind\treferenced_by\n")
    for c in sorted(contract):
        s.write(f"{c}\t{contract[c][0]}\t{contract[c][1]}\n")
    for c in sorted(imported):
        s.write(f"{c}\timported-by-contract\t{imported[c]}\n")
with open(out / "closure.tsv", "w") as s:
    s.write("path\tremover\taction\tkeys\n")
    for row in closure_rows:
        s.write("\t".join(row) + "\n")
with open(out / "handoffs.tsv", "w") as s:
    s.write("path\tfrom\tto\twhat\n")
    for row in sorted(set(handoffs)):
        s.write("\t".join(row) + "\n")
with open(out / "moves.tsv", "w") as s:
    s.write("from\tto\n")
    for f in sorted(moved):
        s.write(f"{f}\t{moved[f]}\n")
with open(out / "frozen-tokens.tsv", "w") as s:
    s.write("token\tfrozen_file\tr_files_using_it\tsample\n")
    for row in frozen_rows:
        s.write("\t".join(str(x) for x in row) + "\n")
with open(out / "engine-literals.tsv", "w") as s:
    s.write("literal\tengine_uses\tlayer1_files\tsample\n")
    for row in lit_rows:
        s.write("\t".join(str(x) for x in row) + "\n")
with open(out / "engine-literal-occurrences.tsv", "w") as s:
    s.write("literal\tpath\tline\tcolumn\tlength\towner_now\tschedule\n")
    for lit, f, ln, col, n in sorted(lit_occ, key=lambda r: (r[1], r[2], r[3], r[0])):
        sched = " ; ".join(f"w{w}:{o}" for w, o, _ in schedule.get(f, [])) or "-"
        s.write(f"{lit}\t{f}\t{ln}\t{col}\t{n}\t{owner.get(f, '-')}\t{sched}\n")
with open(out / "engine-literals-excluded.tsv", "w") as s:
    s.write("literal\tengine_uses\treason\n")
    for row in excluded_lits:
        s.write("\t".join(str(x) for x in row) + "\n")

lines = ["owner\twave\tfiles\tfiles_with_L1_hits\tL1_hits"]
for name in sorted(buckets):
    members = buckets[name]
    lines.append(f"{name}\t{wave_of.get(name, '-')}\t{len(members)}\t{sum(1 for f in members if hits.get(f))}\t"
                 f"{sum(hits.get(f, 0) for f in members)}")
old_contract = set()
old_path = pathlib.Path(outdir).parent / "ownership" / "contract-files.txt"
if old_path.exists():
    old_contract = {l.strip() for l in old_path.read_text().splitlines() if l.strip()}
lines += [
    "",
    f"tracked files: {len(files)}; files with Layer 1 hits: {sum(1 for f in hits if f in file_set)}",
    f"overlaps inside a wave: wave1={overlaps['1']} wave2={overlaps['2']} wave3={overlaps['3']}",
    f"files with Layer 1 hits and no schedule: {len(uncovered)}",
    f"deleted in wave 1: {len(deleted)} (M {sum(1 for o in deleted.values() if o == 'M-legacy')}, "
    f"G {sum(1 for o in deleted.values() if o == 'G-governance-ci')}, W {sum(1 for o in deleted.values() if o == 'W-web-surfaces')})",
    f"moved in wave 1: {len(moved)}",
    f"retained G/W/D files with hits: {len(retained_gwd)}; scheduled for R or wave 3: {len(retained_gwd_later)}; "
    f"written final by D: {len(retained_gwd_final)}; archived by D: {len(retained_gwd_archived)}; unscheduled: {len(retained_gwd_unscheduled)}",
    f"M closure rows: {sum(1 for r in closure_rows if r[1] == 'M-legacy')}; "
    f"G/W closure rows: {sum(1 for r in closure_rows if r[1] != 'M-legacy')}; handoffs: {len(set(handoffs))}",
    f"contract paths: {len(contract_paths)} files, {len(contract_dirs)} dirs, {len(imported)} imported by them; "
    f"new versus ownership/contract-files.txt: {len(contract_paths - old_contract)}; "
    f"old ones no longer found: {len(old_contract - contract_paths)}",
    f"frozen-token rows: {len(frozen_rows)}; engine literals found in Layer 1 files: {len(lit_rows)}; "
    f"occurrences: {len(lit_occ)} in {len({r[1] for r in lit_occ})} files; excluded literals: {len(excluded_lits)}",
    f"native-file test rows: {len(native_rows)}; required contract paths missing: {' '.join(required_missing) or 'none'}",
    f"generated and Mac-only files held by the lead: {sum(1 for f in files if match(f, GENERATED + MAC_LEAD))}",
    f"explicit wave 3 assignments: {len(W3_OVERRIDES) - len(w3_missing)}; scheduled only by them: {len(w3_added)}; "
    f"not at ref: {' '.join(w3_missing) or 'none'}",
]
for f in uncovered[:20]:
    lines.append(f"  unscheduled {f}")
for f in retained_gwd_unscheduled[:20]:
    lines.append(f"  retained-unscheduled {f}")
missing = [p for _, pats in WAVE1[1:] for p in pats if "*" not in p and p not in file_set]
lines.append("named paths not at ref (new files or later moves): " + " ".join(missing))
(out / "summary.txt").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
