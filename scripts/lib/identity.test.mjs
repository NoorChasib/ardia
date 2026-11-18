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
