import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const PREFIX = /export const ID_PREFIX = "([^"]+)";/.exec(read("packages/core/src/identity.ts"))?.[1];

const mirrors = {
  "apps/browser/macos/Nilla.xcconfig": /^NILLA_ID_PREFIX = (\S+)$/m,
  "apps/phone/ios/Config/Nilla.xcconfig": /^NILLA_ID_PREFIX = (\S+)$/m,
  "apps/phone/android/gradle.properties": /^nillaIdPrefix=(\S+)$/m,
  "scripts/lib/identity.sh": /^NILLA_ID_PREFIX=(\S+)$/m,
  "apps/cli/ardia_cli/endpoint.py": /^ID_PREFIX = "([^"]+)"$/m,
};

test("the id prefix is com.nilladigital in packages/core/src/identity.ts", () => {
  assert.equal(PREFIX, "com.nilladigital");
});

test("every mirror of the id prefix agrees with identity.ts", () => {
  for (const [path, pattern] of Object.entries(mirrors)) {
    assert.equal(pattern.exec(read(path))?.[1], PREFIX, `${path} holds a different prefix`);
  }
});

test("identity.sh derives the product ids from the prefix and leaves the team empty", () => {
  const out = execFileSync("bash", ["-c", `. "$1"; printf '%s\\n' "$NILLA_BUNDLE_ID" "$NILLA_PHONE_BUNDLE_ID" "$NILLA_ANDROID_ID" "$NILLA_TEAM_ID"`, "sh", new URL("scripts/lib/identity.sh", root).pathname], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.deepEqual(out.split("\n"), [`${PREFIX}.nilla`, `${PREFIX}.nilla.ios`, `${PREFIX}.nilla.android`, "", ""]);
});

test("the Mac and phone xcconfigs build their ids from the prefix and take the team from NILLA_TEAM_ID", () => {
  const mac = read("apps/browser/macos/Nilla.xcconfig");
  assert.match(mac, /^PRODUCT_BUNDLE_IDENTIFIER = \$\(NILLA_ID_PREFIX\)\.nilla$/m);
  assert.match(mac, /^DEVELOPMENT_TEAM = \$\(NILLA_TEAM_ID\)$/m);
  assert.match(mac, /^NILLA_TEAM_ID =$/m);
  const phone = read("apps/phone/ios/Config/Nilla.xcconfig");
  assert.match(phone, /^NILLA_PHONE_BUNDLE_ID = \$\(NILLA_ID_PREFIX\)\.nilla\.ios$/m);
  assert.match(phone, /^DEVELOPMENT_TEAM = \$\(NILLA_TEAM_ID\)$/m);
  assert.match(phone, /^NILLA_TEAM_ID =$/m);
});

test("the CLI's bundle id is the prefix plus nilla", () => {
  assert.match(read("apps/cli/ardia_cli/endpoint.py"), /^BUNDLE_ID = f"\{ID_PREFIX\}\.nilla"$/m);
});

test("the Mac project takes its bundle id and team from Nilla.xcconfig and signs only its own keychain groups", () => {
  const project = read("apps/browser/macos/Ardia.xcodeproj/project.pbxproj");
  assert.doesNotMatch(project, /PRODUCT_BUNDLE_IDENTIFIER|DEVELOPMENT_TEAM|DevelopmentTeam|U5L5T3NGVV/);
  assert.equal([...project.matchAll(/baseConfigurationReference = (\w+) \/\* Nilla\.xcconfig \*\/;/g)].length, 2, "both project configurations are based on Nilla.xcconfig");
  assert.equal([...project.matchAll(/PRODUCT_NAME = Nilla;/g)].length, 2);
  assert.deepEqual([...new Set([...project.matchAll(/MARKETING_VERSION = "?([^";]*)"?;/g)].map((m) => m[1]))], ["0.1.0"]);
  for (const file of ["Ardia.entitlements", "Ardia-ICloudPasskeys.entitlements"]) {
    const entitlements = read(`apps/browser/macos/Ardia-macOS/${file}`);
    const groups = entitlements.match(/<key>keychain-access-groups<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? "";
    assert.deepEqual(
      [...groups.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]),
      ["webauthn", "unexportable-keys", "secure-payment-confirmation"].map((group) => `$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER).${group}`),
      `${file} signs only its own keychain groups`,
    );
  }
  assert.doesNotMatch(read("apps/browser/macos/ExportOptions-DeveloperID.plist"), /teamID/);
});

test("the release check and the Dock tile build read their ids from identity.sh", () => {
  for (const path of ["scripts/release/verify.sh", "packages/shell/docktile/build.sh"]) {
    const script = read(path);
    assert.match(script, /identity\.sh"/, path);
    assert.doesNotMatch(script, /com\.ardia\.browser|U5L5T3NGVV/, path);
  }
});

test("the phone apps take their ids from the prefix: the iOS targets, app group, Expo config and Android applicationId", () => {
  const project = read("apps/phone/ios/Ardia.xcodeproj/project.pbxproj");
  assert.doesNotMatch(project, /com\.ardia\.browser|DEVELOPMENT_TEAM|DevelopmentTeam|U5L5T3NGVV/);
  assert.equal([...project.matchAll(/baseConfigurationReference = (\w+) \/\* Nilla\.xcconfig \*\/;/g)].length, 2);
  const ids = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]*)"?;/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(ids)].sort(), ["$(NILLA_PHONE_BUNDLE_ID)", "$(NILLA_PHONE_BUNDLE_ID).open", "$(NILLA_PHONE_BUNDLE_ID).share", "$(NILLA_PHONE_BUNDLE_ID).widgets"]);
  const group = `group.${PREFIX}.nilla.ios`;
  for (const name of ["Ardia", "Ardia-DefaultBrowser", "Open", "Share", "Widgets"]) {
    const entitlements = read(`apps/phone/ios/Config/${name}.entitlements`);
    assert.deepEqual([...entitlements.matchAll(/<string>(group\.[^<]+)<\/string>/g)].map((m) => m[1]), [group], name);
  }
  assert.match(read("packages/phone/ios/ArdiaKit/Sources/ArdiaBrowser/Models/BrowserSchema.swift"), new RegExp(`appGroupIdentifier = "${group.replace(/\./g, "\\.")}"`));
  const expo = JSON.parse(read("apps/phone/app.json")).expo;
  assert.equal(expo.ios.bundleIdentifier, `${PREFIX}.nilla.ios`);
  assert.equal(expo.android.package, `${PREFIX}.nilla.android`);
  assert.match(read("apps/phone/android/app/build.gradle"), /^ {8}applicationId "\$\{nillaIdPrefix\}\.nilla\.android"$/m);
  assert.doesNotMatch(read("apps/phone/ios/Config/ExportOptions-TestFlight.plist"), /teamID/);
});

test("the phone registers nilla:// with the OS, and its builders of OS links use it while app URLs stay ardia://", () => {
  assert.match(read("apps/phone/android/app/src/main/AndroidManifest.xml"), /<data android:scheme="nilla" \/>/);
  assert.doesNotMatch(read("apps/phone/android/app/src/main/AndroidManifest.xml"), /android:scheme="ardia"/);
  for (const path of ["apps/phone/android/app/src/main/res-system/xml/shortcuts.xml", "apps/phone/android/app/src/main/res/xml/phone_shortcuts.xml"]) {
    const shortcuts = read(path);
    assert.doesNotMatch(shortcuts, /android:data="ardia:/, path);
    assert.ok([...shortcuts.matchAll(/android:targetPackage="([^"]+)"/g)].every((m) => m[1] === `${PREFIX}.nilla.android`), path);
  }
  const plist = read("apps/phone/ios/Ardia/Info.plist");
  const bgTask = `${PREFIX}.nilla.ios.sync`;
  assert.match(plist, new RegExp(`<key>BGTaskSchedulerPermittedIdentifiers</key>\\s*<array>\\s*<string>${bgTask.replace(/\./g, "\\.")}</string>`));
  assert.match(plist, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>nilla<\/string>/);
  assert.doesNotMatch(plist, /<string>ardia<\/string>|com\.ardia\.browser/);
  assert.ok(read("packages/phone/ios/ArdiaKit/Sources/ArdiaSync/SyncService.swift").includes(`backgroundTaskIdentifier = "${bgTask}"`));
  const tabPolicies = read("packages/phone/ios/ArdiaKit/Sources/ArdiaBrowser/Tabs/TabPolicies.swift");
  assert.match(tabPolicies, /browseScheme = "ardia"/);
  assert.match(tabPolicies, /systemLinkScheme = "nilla"/);
  assert.doesNotMatch(read("packages/phone/ios/ArdiaKit/Sources/ArdiaDesign/SystemShared.swift"), /browseScheme/);
  const browserUrl = read("packages/phone/android/src/main/java/com/ardia/browser/BrowserUrl.kt");
  assert.match(browserUrl, /BROWSE_SCHEME = "ardia"/);
  assert.match(browserUrl, /SYSTEM_LINK_SCHEME = "nilla"/);
  assert.match(read("packages/phone/android/src/main/java/com/ardia/appmodel/SystemLink.kt"), /const val SCHEME = BrowserUrl\.SYSTEM_LINK_SCHEME/);
});
