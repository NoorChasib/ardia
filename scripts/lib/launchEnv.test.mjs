import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { COMMA_KEYS, INSTANCE_KEYS, TEST_KEYS, launchVariables, mergeLaunchEnv } from "./launchEnv.mjs";

test("an extra ARDIA_INSTANCE adds to the defaults instead of replacing them", () => {
  const base = { ARDIA_BACKGROUND: "1", ...launchVariables({ instance: { updateFeed: "http://127.0.0.1:1/appcast.xml", allowOcclusion: true } }) };
  const merged = mergeLaunchEnv(base, { ARDIA_INSTANCE: "chromiumSwitches=--enable-features=A,B --x" });
  assert.equal(merged.ARDIA_BACKGROUND, "1");
  assert.equal(merged.ARDIA_INSTANCE, "updateFeed=http://127.0.0.1:1/appcast.xml,allowOcclusion,chromiumSwitches=--enable-features=A,B --x");
});

test("a later entry for the same key wins, and test, trace and switch lists merge the same way", () => {
  const merged = mergeLaunchEnv(
    launchVariables({ instance: { downloadsDir: "/a" }, test: { reauth: "granted" }, trace: ["pip"], switchOverrides: { launchTab: false } }),
    { ARDIA_INSTANCE: "downloadsDir=/b", ARDIA_TEST: "keychain=file", ARDIA_TRACE: "visibility,pip", ARDIA_SWITCHES: "launchTab=on,webkitSignIn=on" },
  );
  assert.equal(merged.ARDIA_INSTANCE, "downloadsDir=/b");
  assert.equal(merged.ARDIA_TEST, "reauth=granted,keychain=file");
  assert.equal(merged.ARDIA_TRACE, "pip,visibility");
  assert.equal(merged.ARDIA_SWITCHES, "launchTab=on,webkitSignIn=on");
});

test("repeated entries of one variable each add their keys", () => {
  const merged = mergeLaunchEnv({ ARDIA_INSTANCE: "allowAudio" }, { ARDIA_INSTANCE: "allowOcclusion" }, { ARDIA_TEST: "reauth=granted" }, { ARDIA_TEST: "contextMenu" });
  assert.equal(merged.ARDIA_INSTANCE, "allowAudio,allowOcclusion");
  assert.equal(merged.ARDIA_TEST, "reauth=granted,contextMenu");
});

test("other variables pass through, a null one included (it unsets the variable)", () => {
  assert.deepEqual(mergeLaunchEnv({ HOME: "/h", ARDIA_DATA_DIR: "/d" }, { ARDIA_DATA_DIR: null }), { HOME: "/h", ARDIA_DATA_DIR: null });
});

test("a comma-holding value stops at the next key the app knows", () => {
  const merged = mergeLaunchEnv({ ARDIA_TEST: "liveMock=http://x/a,b" }, { ARDIA_TEST: "appMenu" }, { ARDIA_TEST: "importDiaWindows=2" });
  assert.equal(merged.ARDIA_TEST, "liveMock=http://x/a,b,appMenu,importDiaWindows=2");
});

test("the key tables match the ones ArdiaLaunchConfig.mm reads", () => {
  const source = readFileSync(new URL("../../packages/ardiacore/ios/ArdiaLaunchConfig.mm", import.meta.url), "utf8");
  const keysOf = (fn) => {
    const body = source.match(new RegExp(`\\*${fn}\\(\\) \\{\\n  return @\\[([^\\]]*)\\]`))?.[1];
    assert.ok(body, `${fn}() not found in ArdiaLaunchConfig.mm`);
    return [...body.matchAll(/@"(\w+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(new Set(INSTANCE_KEYS), new Set(keysOf("InstanceKeys")));
  assert.deepEqual(new Set(TEST_KEYS), new Set([...keysOf("EngineTestKeys"), ...keysOf("AppTestKeys")]));
  assert.deepEqual(new Set(COMMA_KEYS), new Set(keysOf("KeysWhoseValuesHoldCommas")));
});

test("the Mac and Windows launch configs both read the services test key, hold commas in it, and no longer know the legacy migration keys", () => {
  const mac = readFileSync(new URL("../../packages/ardiacore/ios/ArdiaLaunchConfig.mm", import.meta.url), "utf8");
  const windows = readFileSync(new URL("../../apps/browser/windows/Ardia/LaunchConfig.h", import.meta.url), "utf8");
  const macKeys = (fn) => [...(mac.match(new RegExp(`\\*${fn}\\(\\) \\{\\n  return @\\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/@"(\w+)"/g)].map((m) => m[1]);
  const windowsKeys = (fn) => [...(windows.match(new RegExp(`&${fn}\\(\\) noexcept \\{\\n  static const std::vector<std::string_view> keys\\{([^}]*)\\}`))?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
  for (const [name, keys, commas] of [
    ["launchEnv.mjs", TEST_KEYS, COMMA_KEYS],
    ["ArdiaLaunchConfig.mm", macKeys("AppTestKeys"), macKeys("KeysWhoseValuesHoldCommas")],
    ["LaunchConfig.h", windowsKeys("TestKeys"), windowsKeys("KeysWhoseValuesHoldCommas")],
  ]) {
    assert.ok(keys.includes("services"), `${name} reads services`);
    assert.ok(commas.includes("services"), `${name} keeps commas in services`);
    for (const gone of ["legacySource", "legacyCrashAfter"]) assert.ok(!keys.includes(gone) && !commas.includes(gone), `${name} still knows ${gone}`);
  }
  assert.doesNotMatch(readFileSync(new URL("./launchEnv.mjs", import.meta.url), "utf8"), /ARDIA_LEGACY_/);
});

test("every Mac launch hands the engine --use-mock-keychain, so Chromium never opens a keychain item of its own", () => {
  const mac = readFileSync(new URL("../../packages/ardiacore/ios/ArdiaLaunchConfig.mm", import.meta.url), "utf8");
  const body = mac.slice(mac.indexOf("- (NSArray<NSString *> *)engineSwitches {"), mac.indexOf("- (NSDictionary<NSString *, id> *)snapshot {"));
  assert.match(body, /^  NSMutableArray<NSString \*> \*switches = \[NSMutableArray arrayWithObject:@"--use-mock-keychain"\];$/m);
});
