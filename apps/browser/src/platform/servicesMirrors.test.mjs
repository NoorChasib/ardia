import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_SERVICES } from "../../../../packages/core/src/services.ts";

const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const plist = read("apps/browser/macos/Ardia-macOS/Info.plist");
const windows = read("apps/browser/windows/Ardia/UpdateModule.h");
const android = read("apps/phone/android/app/src/main/java/com/ardia/browser/android/LabNetworkLog.kt");

const plistString = (key) => {
  const found = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  assert.ok(found, `Info.plist has no ${key}`);
  return found[1];
};

const windowsBuilt = (name) => {
  const found = windows.match(new RegExp(`inline constexpr std::wstring_view ${name} = L"([^"]*)";`));
  assert.ok(found, `UpdateModule.h has no ${name}`);
  return found[1];
};

test("the Mac's build-time mirrors in Info.plist match services.ts", () => {
  assert.equal(plistString("NLReportServerURL"), DEFAULT_SERVICES.feedbackUrl ?? "");
  assert.equal(plistString("SUFeedURL"), DEFAULT_SERVICES.macFeedUrl ?? "");
  assert.equal(plistString("NLReleaseNotesURL"), DEFAULT_SERVICES.releaseNotesUrl ?? "");
  assert.ok(plistString("NLFeedbackURL").startsWith(`${DEFAULT_SERVICES.issueUrl}?`));
  if (!DEFAULT_SERVICES.macFeedUrl) assert.equal(plistString("SUPublicEDKey"), "");
});

test("the Windows updater's build-time mirrors match services.ts", () => {
  assert.equal(windowsBuilt("kBuiltWindowsFeedUrl"), DEFAULT_SERVICES.windowsFeedUrl ?? "");
  assert.equal(windowsBuilt("kBuiltWindowsTrustedPrefix"), DEFAULT_SERVICES.windowsTrustedPrefix ?? "");
});

test("the Android lab log's telemetry host matches services.ts", () => {
  const found = android.match(/private val TELEMETRY_HOST: String\? = (null|"([^"]*)")/);
  assert.ok(found, "LabNetworkLog.kt has no TELEMETRY_HOST");
  assert.equal(found[1] === "null" ? null : found[2], DEFAULT_SERVICES.telemetryUrl ? new URL(DEFAULT_SERVICES.telemetryUrl).hostname : null);
});
