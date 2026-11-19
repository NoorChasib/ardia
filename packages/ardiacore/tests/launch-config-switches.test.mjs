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

test("a build whose signing can't be read counts as team-signed, and only a readable signature without a team starts", () => {
  const signing = read("../ios/NillaTeamSigning.h");
  const host = read("../ios/ArdiaHost.mm");
  const isTeamSigned = host.slice(host.indexOf("bool IsTeamSigned() {"), host.indexOf("\n}\n", host.indexOf("bool IsTeamSigned() {")));
  assert.match(isTeamSigned, /return nilla_signing::RefusesToStart\(nilla_signing::ReadTeam\(\)\);/);
  assert.doesNotMatch(host, /SecCodeCopySelf|SecCodeCopySigningInformation/);
  assert.match(signing, /inline bool RefusesToStart\(Team team\) \{ return team != Team::absent; \}/);
  const readTeam = signing.slice(signing.indexOf("inline Team ReadTeam("), signing.indexOf("\n}\n", signing.indexOf("inline Team ReadTeam(")));
  assert.equal(readTeam.match(/return Team::absent/g), null);
  assert.equal(readTeam.match(/return Team::unknown;/g).length, 2);
  assert.match(readTeam, /\? Team::present : Team::absent/);
  assert.match(pkg.scripts.test, /tests\/team-signing\.test\.cc/);
});

test("the data dir and its Chromium folder must resolve outside an installed Ardia's folders before anything reads or writes them", () => {
  const run = launch.slice(launch.indexOf("+ (int)runWithArgc:"), launch.indexOf("nilla_host::InstallTestCrashGuard("));
  const refusal = run.indexOf("if (IsTeamSigned())");
  const guard = run.indexOf("if (!nilla_upstream::IsOwnFolder(dataDirectory.stringByDeletingLastPathComponent) || !nilla_upstream::IsOwnFolder(dataDirectory)) {");
  assert.ok(refusal >= 0 && guard > refusal, "the team-signing refusal comes first, then the data dir guard");
  assert.match(run.slice(guard), /^[^}]*return 1;\s*\}/);
  assert.ok(run.indexOf("gDataDirectory = dataDirectory;") > guard, "the data dir is taken only after the guard");
  assert.ok(run.indexOf("createDirectoryAtPath:gDataDirectory") > guard, "nothing is created before the guard");
  assert.equal(run.slice(0, guard).match(/gDataDirectory\s*=/g), null);
  assert.equal(run.slice(0, guard).match(/AppDataDirectory\(|readFrom:|dataWithContentsOf|createDirectory/g), null);
  const cached = body("- (NSDictionary<NSString *, NSNumber *> *)readCachedSwitches {");
  assert.ok(cached.indexOf("if (!nilla_upstream::IsOwnFolder(directory)) return @{};") >= 0);
  assert.ok(cached.indexOf("IsOwnFolder(directory)") < cached.indexOf("dataWithContentsOfFile"), "the switches cache is read only from an own folder");
});

test("the native data dir guard lists the same installed Ardia folders as the Mac config guard and the CLI", () => {
  const native = read("../ios/NillaUpstreamFolders.h");
  const listed = native.slice(native.indexOf("FolderSuffixes() {"), native.indexOf("return suffixes;"));
  const nativeFolders = [...listed.matchAll(/^\s+"([^"]+)",$/gm)].map((match) => match[1]);
  const swift = read("../../shell/ios/ConfigCore/UpstreamAppFolders.swift");
  const swiftListed = swift.slice(swift.indexOf("func folders"), swift.indexOf("func ownPath"));
  const swiftFolders = [...swiftListed.matchAll(/^\s+"([^"]+)",$/gm)].map((match) => match[1]);
  assert.ok(nativeFolders.length >= 7, nativeFolders.join(", "));
  assert.deepEqual(nativeFolders, swiftFolders);
  assert.match(native, /constexpr int kMaxLinkHops = 40;/);
  assert.match(swift, /static let maxLinkHops = 40/);
  assert.match(pkg.scripts.test, /tests\/upstream-folders\.test\.cc/);
});

test("the Mac test run builds and runs the seeded-cache switch test", () => {
  assert.match(pkg.scripts.test, /ios\/ArdiaLaunchConfig\.mm tests\/launch-config-switches\.test\.mm/);
  assert.match(pkg.scripts["test:portable"], /\.\/tests\/launch-config-switches\.test\.mjs/);
});
