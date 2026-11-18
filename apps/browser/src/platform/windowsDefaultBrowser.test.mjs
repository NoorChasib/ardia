import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { launchAddresses } from "../../../../packages/expo-windows/src/launchLinks/addresses.ts";
const { checkDefaultBrowserAtLaunch, noteDefaultBrowserPrompt, takeDefaultBrowserCounts } = await import("../state/telemetry/defaultBrowserCounts.ts");

const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const installer = read("scripts/windows/installer/Ardia.iss");
const native = read("apps/browser/windows/Ardia/SystemModule.h");
const app = read("apps/browser/windows/Ardia/Ardia.cpp");

const section = (name) => installer.match(new RegExp(`^\\[${name}\\]$`, "m"));

test("the development installer writes no registry entries, shortcuts, launches or Ardia folders", () => {
  for (const name of ["Registry", "Icons", "Run", "Dirs", "Tasks"]) assert.equal(section(name), null, `[${name}] is gone`);
  assert.doesNotMatch(installer, /^Root: |ArdiaHTM|StartMenuInternet|RegisteredApplications|\\Ardia\\User Data|^ChangesAssociations=/m);
  assert.doesNotMatch(installer, /47A92F18-32B0-4548-A1EF-72C217FE1836/, "Nilla has its own AppId, not Ardia's");
  assert.match(installer, /^AppId=\{\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/m);
  assert.match(installer, /^AppName=Nilla$/m);
  assert.match(installer, /^DefaultDirName=\{localappdata\}\\Programs\\Nilla$/m);
  assert.match(installer, /^OutputBaseFilename=Nilla-Setup-\{#Cpu\}$/m);
  assert.match(installer, /^LicenseFile=\.\.\\\.\.\\\.\.\\LICENSE$/m);
  assert.match(installer, /^AppSupportURL=https:\/\/github\.com\/NoorChasib\/nilla\/issues$/m);
});

test("setting the default browser and launch at login report unsupported, so the engine never registers Ardia's ProgID", () => {
  const method = (name) => native.slice(native.indexOf(`REACT_METHOD(${name})`), native.indexOf("REACT_", native.indexOf(`REACT_METHOD(${name})`) + 13));
  assert.match(method("setAsDefaultBrowser"), /isn't supported in this development build of Nilla[\s\S]*promise\.Resolve\(false\);/);
  assert.doesNotMatch(method("setAsDefaultBrowser"), /Execute\(/);
  assert.match(method("setLaunchAtLogin"), /promise\.Reject\("Launch at login isn't supported in this development build of Nilla"\);/);
  assert.doesNotMatch(method("setLaunchAtLogin"), /SystemShell::SetLaunchAtLogin/);
  assert.match(method("launchAtLoginStatus"), /promise\.Resolve\("notFound"\);/);
});

test("the default-browser status never reads Ardia's ProgID or any registry key", () => {
  assert.doesNotMatch(native, /ArdiaHTM|RegGetValueW|RegSetKeyValueW|RegDeleteKeyValueW|AssocQueryStringW|UrlAssociations|CurrentVersion\\\\Run/);
  const method = native.slice(native.indexOf("REACT_METHOD(isDefaultBrowser)"), native.indexOf("REACT_METHOD(setAsDefaultBrowser)"));
  assert.match(method, /promise\.Resolve\(false\);/);
  const state = native.slice(native.indexOf("REACT_SYNC_METHOD(defaultBrowserState)"), native.indexOf("REACT_METHOD(launchAtLoginStatus)"));
  assert.match(state, /state\["progId"\] = JSValue\{std::string\{\}\};/);
  assert.match(state, /state\["registeredHere"\] = JSValue\{false\};/);
  assert.match(state, /state\["isDefault"\] = JSValue\{false\};/);
});

test("the app refuses to start without ARDIA_DATA_DIR, before it writes anything", () => {
  for (const entry of ["ArdiaAppRun(void) {", "ArdiaAppStart(const ArdiaEngineApi *engine) {"]) {
    assert.ok(app.includes(`${entry}\n  if (!Ardia::Paths::HasCustomDataDirectory()) return RefuseWithoutDataDirectory();\n`), entry);
  }
  assert.match(app, /This development build of Nilla runs only with ARDIA_DATA_DIR set\./);
  const refusal = app.slice(app.indexOf("static int RefuseWithoutDataDirectory()"), app.indexOf("static int Prepare("));
  assert.doesNotMatch(refusal, /LaunchLog|Paths::DataDirectory\(\)/, "the refusal opens no log in the data folder");
});

test("the app's windows carry Nilla's AppUserModelID and its data folder is %LOCALAPPDATA%\\Nilla", () => {
  assert.match(read("apps/browser/windows/Ardia/AppIcon.h"), /kAppUserModelId\[\] = L"NillaDigital\.Nilla";/);
  assert.match(read("apps/browser/windows/Ardia/Paths.h"), /L"LOCALAPPDATA"\) \/ L"Nilla" : /);
  assert.match(read("apps/browser/windows/Ardia/EngineHostModule.h"), /L"LOCALAPPDATA"\) \/ L"Nilla" \/ L"User Data";/);
  const run = read("scripts/windows/nilla-dev-run.ps1");
  assert.match(run, /\$env:ARDIA_DATA_DIR = \$data/);
  assert.match(run, /Join-Path \$env:LOCALAPPDATA "Nilla"/);
  assert.match(run, /'\^\(--\?\|\/\)user-data-dir\(=\|\$\)'/);
});

test("a link Windows hands over through the ProgID's command reaches the app as one address", () => {
  const launch = { arguments: [], single: { text: "https://example.com/a b?q=1" } };
  assert.deepEqual(launchAddresses(launch), ["https://example.com/a%20b?q=1"]);
});

test("default browser counts: prompts opened and a launch as the default, once per launch", async () => {
  takeDefaultBrowserCounts();
  noteDefaultBrowserPrompt();
  noteDefaultBrowserPrompt();
  checkDefaultBrowserAtLaunch(() => Promise.resolve(true));
  checkDefaultBrowserAtLaunch(() => Promise.resolve(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(takeDefaultBrowserCounts(), { default_browser_prompts_opened: 2, launches_as_default_browser: 1 });
  assert.deepEqual(takeDefaultBrowserCounts(), { default_browser_prompts_opened: 0, launches_as_default_browser: 0 });
});
