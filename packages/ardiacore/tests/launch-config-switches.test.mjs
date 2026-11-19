import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const config = read("../ios/ArdiaLaunchConfig.mm");
const launch = read("../ios/ArdiaHost+Launch.mm");
const enginePrefix = /const std::string name = "([a-z]+-)" \+ std::string\(key\);/.exec(read("../../../engine/ardiacore/src/ardia/core/ac_launch_switches.cc"))?.[1];
const pkg = JSON.parse(read("../package.json"));
const body = (signature) => {
  const start = config.indexOf(signature);
  assert.ok(start >= 0, signature);
  return config.slice(start, config.indexOf("\n}\n", start));
};

test("switchOn trusts cached remote switches only while a validated services snapshot names a switches URL", () => {
  const switchOn = body("- (BOOL)switchOn:(NSString *)name {");
  assert.match(switchOn, /_switches\[name\][\s\S]*if \(self\.remoteSwitchesConfigured\)\s*if \(NSNumber \*cached = self\.cachedSwitches\[name\]\)/);
  assert.equal(config.match(/self\.cachedSwitches\b/g).length, 1);
  const configured = body("- (BOOL)remoteSwitchesConfigured {");
  assert.match(configured, /\[self testValue:@"services"\]/);
  assert.match(configured, /ServicesSnapshotNamesSwitchesURL\(/);
});

test("the native snapshot check knows the same fields as ServicesSnapshot.swift and needs an https switches URL", () => {
  const swift = read("../../shell/ios/UpdaterCore/ServicesSnapshot.swift");
  const swiftFields = [...swift.slice(swift.indexOf("urlFields = ["), swift.indexOf("]", swift.indexOf("urlFields = ["))).matchAll(/"(\w+)"/g)].map((m) => m[1]);
  const objc = body("NSArray<NSString *> *ServiceURLFields() {");
  assert.deepEqual([...objc.matchAll(/@"(\w+)"/g)].map((m) => m[1]), swiftFields);
  assert.match(swift, /largestFileBytes = 64 \* 1024/);
  assert.match(config, /kLargestServicesSnapshotBytes = 64 \* 1024/);
  assert.match(body("BOOL ServicesSnapshotNamesSwitchesURL("), /return IsHttps\(fields\[@"switchesUrl"\]\);/);
});

test("both launch filters drop the switch prefix the engine reads instance values from", () => {
  assert.equal(enginePrefix, "ardia-");
  const chromiumSwitches = launch.slice(launch.indexOf('[config instance:@"chromiumSwitches"]'), launch.indexOf("std::vector<const char *> args"));
  assert.match(chromiumSwitches, new RegExp(`!\\[sw hasPrefix:@"${enginePrefix}"\\]\\) extra\\.push_back\\(full\\)`));
  const forwardedArguments = launch.slice(launch.indexOf("std::vector<const char *> args"), launch.indexOf("MergeFeatureLists(args)"));
  assert.match(forwardedArguments, new RegExp(`autoAccepts\\(arg\\) \\|\\| !strncmp\\(arg, "--${enginePrefix}", ${enginePrefix.length + 2}\\)\\) continue;`));
  for (const prefix of launch.matchAll(/hasPrefix:@"([a-z]+-)"/g)) assert.equal(prefix[1], enginePrefix);
  assert.match(body("- (NSArray<NSString *> *)engineSwitches {"), new RegExp(`@"--${enginePrefix}data-dir="`));
});

test("every launch passes the engine the mock keychain, and a team-signed build refuses to start before it", () => {
  assert.match(body("- (NSArray<NSString *> *)engineSwitches {"), /\[NSMutableArray arrayWithObject:@"--use-mock-keychain"\]/);
  const run = launch.slice(launch.indexOf("+ (int)runWithArgc:"), launch.indexOf("[NSFileManager.defaultManager createDirectoryAtPath:gDataDirectory"));
  assert.match(run, /if \(IsTeamSigned\(\)\) \{[^}]*return 1;\s*\}/);
  assert.ok(run.indexOf("IsTeamSigned()") < run.indexOf("gDataDirectory ="), "the refusal comes before the data dir is chosen");
});

test("the Mac test run builds and runs the seeded-cache switch test", () => {
  assert.match(pkg.scripts.test, /ios\/ArdiaLaunchConfig\.mm tests\/launch-config-switches\.test\.mm/);
  assert.match(pkg.scripts["test:portable"], /\.\/tests\/launch-config-switches\.test\.mjs/);
});
