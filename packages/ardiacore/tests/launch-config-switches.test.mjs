import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
  assert.match(launch, new RegExp(`static constexpr std::string_view kEngineSwitchPrefix = "${enginePrefix}";`));
  const chromiumSwitches = launch.slice(launch.indexOf('[config instance:@"chromiumSwitches"]'), launch.indexOf("std::vector<const char *> args"));
  assert.match(chromiumSwitches, /std::optional<std::string> forwarded = ForwardedCallerArgument\(full\.c_str\(\), workingDirectory, \*protectedRoots\);\s*if \(forwarded && !autoAccepts\(forwarded->c_str\(\)\)\) extra\.push_back\(\*forwarded\);/);
  const forwardedArguments = launch.slice(launch.indexOf("for (int i = 1; mockKeychain && i < argc; i++) {"), launch.indexOf("MergeFeatureLists(args)"));
  assert.match(forwardedArguments, /std::optional<std::string> forwarded = ForwardedCallerArgument\(arg, workingDirectory, \*protectedRoots\);\s*if \(forwarded && !autoAccepts\(forwarded->c_str\(\)\)\) extra\.push_back\(\*forwarded\);/);
  assert.doesNotMatch(forwardedArguments, /args\.push_back\(arg\)/);
  assert.doesNotMatch(launch, /hasPrefix:@"[a-z]+-"|strncmp\(arg, "--[a-z]+-", \d+\)/);
  assert.match(body("- (NSArray<NSString *> *)engineSwitches {"), new RegExp(`@"--${enginePrefix}data-dir="`));
});

test("Chromium's user-data-dir is only ever the data dir the guard checked", () => {
  const switches = read("../ios/NillaChromiumSwitches.h");
  assert.match(switches, /kUserDataDir = "user-data-dir";/);
  assert.match(switches, /return !name\.empty\(\) && \(NamesUserDataDir\(arg, syntax\) \|\|/);
  const forwarding = launch.slice(launch.indexOf("static std::optional<std::string> ForwardedCallerArgument("), launch.indexOf("\n}\n", launch.indexOf("static std::optional<std::string> ForwardedCallerArgument(")));
  assert.match(forwarding, /nilla_switches::ForwardedArgument\(raw, kEngineSwitchPrefix/);
  assert.match(forwarding, /if \(forwarding\.refusal != nilla_switches::Refusal::none\) return std::nullopt;\s*return forwarding\.argument;/);
  const run = launch.slice(launch.indexOf("+ (int)runWithArgc:"));
  assert.equal(run.match(/user-data-dir/g).length, 1, "the launch names user-data-dir once, for the checked data dir");
  assert.match(run, /"--user-data-dir=" \+ std::string\(gDataDirectory\.UTF8String\)/);
  assert.ok(run.indexOf('"--user-data-dir="') > run.indexOf("gDataDirectory = dataDirectory;"), "the switch carries the data dir only after the guard took it");
  const extra = run.slice(run.indexOf("std::vector<std::string> extra"), run.indexOf("merged = MergeFeatureLists(args);"));
  const pushes = [...extra.matchAll(/(extra|args)\.push_back\(([^;]*)\);/g)].map((m) => m[2]);
  const fromCaller = pushes.filter((value) => /forwarded|full|arg\b|sw\.UTF8String/.test(value));
  assert.deepEqual(fromCaller, ["sw.UTF8String", "*forwarded", "*forwarded"]);
  assert.ok(body("- (NSArray<NSString *> *)engineSwitches {").includes(`[NSString stringWithFormat:@"--${enginePrefix}%@=%@", Kebab(key), value]`), "instance values reach the engine only under its own prefix");
  assert.match(pkg.scripts.test, /tests\/chromium-switches\.test\.cc/);
});

test("caller arguments are read the way Chromium 157's command line parser reads them before the launch filters them", () => {
  const switches = read("../ios/NillaChromiumSwitches.h");
  assert.match(switches, /kAsciiWhitespace = "\\t\\v\\f \\n\\r";/);
  assert.match(switches, /if \(arg\.starts_with\("--"\)\) return 2;\s*if \(arg\.starts_with\("-"\)\) return 1;\s*if \(syntax == Syntax::windows && arg\.starts_with\("\/"\)\) return 1;/);
  const parsed = switches.slice(switches.indexOf("inline std::optional<Switch> ParsedSwitch("), switches.indexOf("\n}\n", switches.indexOf("inline std::optional<Switch> ParsedSwitch(")));
  assert.match(parsed, /const std::string_view arg = Trimmed\(raw, syntax\);/);
  assert.match(parsed, /if \(prefix == 0 \|\| prefix == arg\.size\(\)\) return std::nullopt;/);
  const forwarded = switches.slice(switches.indexOf("inline Forwarding ForwardedArgument("), switches.indexOf("\n}\n", switches.indexOf("inline Forwarding ForwardedArgument(")));
  assert.match(forwarded, /Forwarding forwarding\{std::string\(Trimmed\(raw, syntax\)\)/);
  assert.equal((launch.match(/ForwardedCallerArgument\(/g) || []).length, 3, "one helper, used by chromiumSwitches and argv");
  assert.doesNotMatch(launch, /DropsReservedSwitch|nilla_switches::IsReserved\(/);
});

test("no caller argument that names a path leading into an installed Ardia's folders reaches Chromium", () => {
  const switches = read("../ios/NillaChromiumSwitches.h");
  const forwarded = switches.slice(switches.indexOf("inline Forwarding ForwardedArgument("), switches.indexOf("\n}\n", switches.indexOf("inline Forwarding ForwardedArgument(")));
  assert.match(forwarded, /for \(std::string_view candidate : PathCandidates\(forwarding\.argument\)\)\s*if \(nilla_upstream::ReachesProtected\(std::string\(candidate\), workingDirectory, protectedRoots\)\) \{/);
  assert.match(forwarded, /forwarding\.refusal = Refusal::protectedPath;/);
  const helper = launch.slice(launch.indexOf("static std::optional<std::string> ForwardedCallerArgument("), launch.indexOf("\n}\n", launch.indexOf("static std::optional<std::string> ForwardedCallerArgument(")));
  assert.match(helper, /nilla_switches::ForwardedArgument\(raw, kEngineSwitchPrefix, workingDirectory, protectedRoots\)/);
  assert.match(helper, /if \(forwarding\.refusal == nilla_switches::Refusal::protectedPath\)\s*fprintf\(stderr,/);
  const run = launch.slice(launch.indexOf("+ (int)runWithArgc:"));
  const roots = run.indexOf("const std::optional<std::vector<std::string>> protectedRoots = nilla_upstream::HomeProtectedRoots();");
  assert.ok(roots >= 0 && roots < run.indexOf('[config instance:@"chromiumSwitches"]'), "the roots are resolved before any caller argument is read");
  assert.match(run.slice(roots), /^[^\n]*\n\s*if \(!protectedRoots\) \{[^}]*return 1;\s*\}/);
  assert.match(run, /const std::string workingDirectory = getcwd\(cwd, sizeof cwd\) \? cwd : "";/);
  const native = read("../ios/NillaUpstreamFolders.h");
  const reaches = native.slice(native.indexOf("inline bool ReachesProtected("), native.indexOf("\n}\n", native.indexOf("inline bool ReachesProtected(")));
  assert.match(reaches, /Resolve\(path\[0\] == '\/' \? path : workingDirectory \+ "\/" \+ path, true\)/);
  assert.match(reaches, /if \(!resolved\) return true;/);
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

test("no profile or other entry of the data dir may lead into an installed Ardia's folders, at launch or when a profile loads", () => {
  const run = launch.slice(launch.indexOf("+ (int)runWithArgc:"), launch.indexOf("nilla_host::InstallTestCrashGuard("));
  const rootGuard = run.indexOf("!nilla_upstream::IsOwnFolder(dataDirectory)) {");
  const entryGuard = run.indexOf("if (NSString *entry = nilla_upstream::UnownedDataEntry(dataDirectory)) {");
  assert.ok(rootGuard >= 0 && entryGuard > rootGuard, "the entry guard follows the root guard");
  assert.match(run.slice(entryGuard), /^[^}]*return 1;\s*\}/);
  assert.ok(run.indexOf("gDataDirectory = dataDirectory;") > entryGuard, "the data dir is taken only after the entry guard");
  assert.ok(run.indexOf("createDirectoryAtPath:gDataDirectory") > entryGuard, "nothing is created before the entry guard");
  const native = read("../ios/NillaUpstreamFolders.h");
  const unowned = native.slice(native.indexOf("inline std::optional<std::string> UnownedEntry("), native.indexOf("\n}\n", native.indexOf("inline std::optional<std::string> UnownedEntry(")));
  assert.match(unowned, /LeadsIntoProtected\(dataDirectory \+ "\/" \+ kDefaultProfile, protection\)/);
  assert.match(unowned, /UnownedWithin\(dataDirectory, label, protection\)/);
  const within = native.slice(native.indexOf("inline std::optional<std::string> UnownedWithin("), native.indexOf("\n}\n", native.indexOf("inline std::optional<std::string> UnownedWithin(")));
  assert.match(within, /while \(!pending\.empty\(\) && !unowned\) \{/, "the whole tree is walked, not only the data dir's own entries");
  assert.match(within, /if \(S_ISLNK\(entry\.st_mode\)\) \{\s*const std::string linked = path \+ "\/" \+ name;\s*if \(LeadsIntoProtected\(linked, protection\)\) \{/, "every link at any depth is resolved");
  assert.match(within, /protection\.identities\.count\(IdentityOf\(info\)\)/, "a folder reached by any spelling is compared with the protected folders themselves");
  assert.match(within, /info\.st_nlink > 1/, "hard links are checked");
  const owned = native.slice(native.indexOf("inline bool IsOwnEntry("), native.indexOf("\n}\n", native.indexOf("inline bool IsOwnEntry(")));
  assert.match(owned, /UnownedWithin\(dataDirectory \+ "\/" \+ name, name, protection\)/, "a profile's whole folder is walked before it loads");
  assert.match(native, /inline constexpr const char \*kDefaultProfile = "Default";/);
  assert.match(launch, /"--profile-directory=Default",/);
  const profiles = read("../ios/ArdiaProfiles.mm");
  const withProfile = profiles.slice(profiles.indexOf("void WithProfile(NSString *name"), profiles.indexOf("\n}\n", profiles.indexOf("void WithProfile(NSString *name")));
  const check = withProfile.indexOf("if (!nilla_upstream::IsOwnProfileFolder(gDataDirectory, directory)) {");
  assert.ok(check >= 0 && check < withProfile.indexOf("[engine loadProfile:directory"), "a profile's folder is checked before it loads");
  assert.match(withProfile.slice(check), /^[^}]*return completion\(nil\);\s*\}/);
  assert.equal(profiles.match(/loadProfile:/g).length, 1, "WithProfile is the only place the host loads a profile");
  const host = read("../ios/ArdiaHost.mm");
  const deletion = host.slice(host.indexOf("+ (void)deleteProfileData:"), host.indexOf("\n}\n", host.indexOf("+ (void)deleteProfileData:")));
  const named = deletion.indexOf("if (!nilla_upstream::IsEntryName(directory.fileSystemRepresentation)) return completion(@[ @\"files\" ]);");
  assert.ok(named >= 0 && named < deletion.indexOf("removeItemAtPath:path"), "only a single folder name is ever removed");
  const loaders = readdirSync(new URL("../ios/", import.meta.url)).filter((file) => /\.(mm|m|swift)$/.test(file) && /\bloadProfile:/.test(read(`../ios/${file}`)));
  assert.deepEqual(loaders, ["ArdiaProfiles.mm"]);
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
