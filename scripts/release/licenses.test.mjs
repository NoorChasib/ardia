import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(repo, path), "utf8");
const run = (script, ...args) => spawnSync("bash", [join(repo, script), ...args], { encoding: "utf8" });

const plist = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>${Object.entries(entries)
    .map(([key, value]) => `<key>${key}</key>${Array.isArray(value) ? `<array>${value.map((schemes) => `<dict><key>CFBundleURLSchemes</key><array>${schemes.map((s) => `<string>${s}</string>`).join("")}</array></dict>`).join("")}</array>` : `<string>${value}</string>`}`)
    .join("")}</dict></plist>\n`;

function devApp(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "nilla-licenses-"));
  const app = join(root, "Nilla.app");
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents/Resources"), { recursive: true });
  writeFileSync(join(app, "Contents/MacOS/Nilla"), "#!/bin/sh\n");
  chmodSync(join(app, "Contents/MacOS/Nilla"), 0o755);
  const info = { CFBundleIdentifier: "com.nilladigital.nilla", CFBundleExecutable: "Nilla", CFBundleName: "Nilla", CFBundleDisplayName: "Nilla", SUFeedURL: "", SUPublicEDKey: "", NLReportServerURL: "", NLReleaseNotesURL: "", CFBundleURLTypes: [["http", "https"], ["file"]], ...overrides };
  writeFileSync(join(app, "Contents/Info.plist"), plist(info));
  return { root, app };
}

test("the Mac app carries the three root licence texts and the bang list's MIT text, byte for byte", () => {
  const { root, app } = devApp();
  try {
    assert.equal(run("scripts/release/licenses.sh", "copy", app).status, 0);
    const dir = join(app, "Contents/Resources/Licenses");
    assert.deepEqual(readdirSync(dir).sort(), ["LICENSE", "LICENSE.Apache-2.0", "NOTICE", "bangs-LICENSE"]);
    assert.equal(readFileSync(join(dir, "bangs-LICENSE"), "utf8"), read("third_party/bangs/LICENSE"));
    assert.equal(readFileSync(join(dir, "NOTICE"), "utf8"), read("NOTICE"));
    assert.equal(run("scripts/release/licenses.sh", "check", app).status, 0);
    writeFileSync(join(dir, "NOTICE"), "changed");
    assert.notEqual(run("scripts/release/licenses.sh", "check", app).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every build of the app copies the licences: the Xcode phase, the Developer ID export and build-app's rebuild trigger", () => {
  assert.match(read("apps/browser/macos/Nilla.xcodeproj/project.pbxproj"), /scripts\/release\/licenses\.sh\\" copy \\"\$TARGET_BUILD_DIR\/\$WRAPPER_NAME\\"/);
  assert.match(read("scripts/release/export-sign.sh"), /scripts\/release\/licenses\.sh" copy "\$app"/);
  assert.match(read("scripts/release/verify.sh"), /scripts\/release\/licenses\.sh" check "\$app"/);
  assert.match(read("scripts/agent/build-app"), /LICENSE LICENSE\.Apache-2\.0 NOTICE third_party\/bangs\/LICENSE scripts\/release\/licenses\.sh/);
});

test("verify.sh --dev passes a development build and refuses one with an update feed, an extra URL scheme or no licences", () => {
  const python = spawnSync("python3", ["-c", "import plistlib"]);
  if (python.status !== 0) return;
  const cases = [
    [{}, true, true],
    [{}, false, false],
    [{ SUFeedURL: "https://updates.example.test/appcast.xml" }, true, false],
    [{ CFBundleURLTypes: [["http", "https"], ["file"], ["nilla"]] }, true, false],
    [{ CFBundleExecutable: "Other" }, true, false],
  ];
  for (const [overrides, licences, passes] of cases) {
    const { root, app } = devApp(overrides);
    try {
      if (licences) run("scripts/release/licenses.sh", "copy", app);
      const result = run("scripts/release/verify.sh", "--dev", app);
      assert.equal(result.status === 0, passes, `${JSON.stringify(overrides)} licences=${licences}: ${result.stderr}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
