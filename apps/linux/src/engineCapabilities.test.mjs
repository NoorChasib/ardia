import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const nativeSource = (path) => readFileSync(new URL(`../../../engine/ardiacore-linux/src/ardia/linux/${path}`, import.meta.url), "utf8");
const listed = (path, list) => {
  const source = nativeSource(path);
  const from = source.indexOf(`${list}[] = {`);
  assert.ok(from >= 0, `${path} declares ${list}`);
  return [...source.slice(from, source.indexOf("};", from)).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
};
const hostSource = nativeSource("ac_linux_host.cc");
const appended = (name) => {
  assert.ok(hostSource.includes(`capabilities.Append("${name}")`), `the bootstrap advertises ${name}`);
  return name;
};

const ENGINE = {
  system: listed("ac_linux_desktop_core.h", "kSystemCapabilities"),
  openUrls: listed("ac_linux_open_urls.h", "kOpenUrlCapabilities"),
  windowCommands: listed("ac_linux_window_commands.h", "kWindowCommandCapabilities"),
  notifications: listed("ac_linux_notifications_core.h", "kNotificationCapabilities"),
  hardware: listed("ac_linux_hardware.h", "kHardwareCapabilities"),
  linkTabs: listed("ac_linux_link_tabs.h", "kLinuxLinkTabRoutes"),
  pageCommits: listed("ac_linux_page_commits.h", "kLinuxPageCommitRoutes"),
  pageKeys: listed("ac_linux_page_keys.h", "kPageKeyCapabilities"),
  appActivation: listed("ac_linux_app_activation.h", "kAppActivationCapabilities"),
  smallWindows: listed("ac_linux_window_lifecycle.h", "kSmallWindowCapabilities"),
  report: listed("ac_linux_report_core.h", "kReportCapabilities"),
  hiddenElements: listed("ac_linux_site_controls.cc", "kBlockerCalls").filter((name) => /^contentBlocker\.(hiddenElements|hideElements|restoreElements)$/.test(name)),
  customFilterLists: listed("ac_linux_site_controls.cc", "kBlockerCalls").filter((name) => /^contentBlocker\.(addList|removeList)$/.test(name)),
  appendedByName: [appended("profiles.deleteData"), appended("ArdiaShell.fetchBangList")],
  wheelZoom: listed("ac_linux_page_messages.h", "kLinuxPageMessageRoutes").filter((route) => route === "webView.setCommandScrollZoom"),
  blockAutoplay: listed("ac_linux_page_messages.h", "kLinuxPageMessageRoutes").filter((route) => route === "webView.setBlockAutoplayEverywhere"),
};
const ALL = Object.values(ENGINE).flat();

const invoked = [];
const hostListeners = new Set();
const host = {
  bootstrap: { windowId: "main", profileId: "default", startup: false, capabilities: ALL },
  invoke: async (method, args) => { invoked.push([method, args]); return null; },
  call: async (name, profile, args) => { invoked.push([name, profile, args]); return "null"; },
  onEvent: (listener) => { hostListeners.add(listener); return () => hostListeners.delete(listener); },
};
const bare = { ...host, bootstrap: { ...host.bootstrap, capabilities: [] } };
globalThis.window = { __ardiaHost: host };
const settings = await import("./settingsIndex.ts");
const shim = await import("./shims/expo-modules-core.ts");
const { linuxCapabilities, unavailableCommands, unavailableSettingIds, FULL_SCREEN_ITEM } = await import("./hostCapabilities.ts");
const { linuxMenuShortcuts } = await import("./shortcuts.ts");
const { staticShortcutSources } = await import("./commandCatalog.ts");
const { sendsFromSheet } = await import("./reportProblem.ts");
delete globalThis.window;
const { appMenuItems } = await import("./appMenu.ts");
const { resolveHostModule, reachesNativeHostUnchecked } = await import("./hostModules.ts");
const { listenForOpenUrls } = await import("./openUrls.ts");
const { relaysSmallWindows } = await import("./hostSmallWindows.ts");
const { servesReportSheet } = await import("./hostReport.ts");
const { deliverPageEvent } = await import("../../../packages/ardiacore/src/pageEvents.ts");
const { isGated } = await import("./layer1Gate.ts");
const sharedSettings = await import("../../browser/src/components/settings/settingsIndex.ts");

const find = (items, id) => {
  for (const item of items) {
    if (item.id === id) return item;
    const nested = item.children && find(item.children, id);
    if (nested) return nested;
  }
};
const menuState = { checked: [], disabled: [], titles: {}, profiles: [], windows: [], bookmarkFolders: [], recentBookmarks: [], bookmarksBar: [], otherBookmarks: [], recentlyClosed: [], recentlyClosedGroups: [], warnBeforeQuitting: false, extensions: [] };

test("the engine advertises the names the shell gates on, spelled the same", () => {
  assert.deepEqual(ENGINE.system, ["ArdiaSystem.isDefaultBrowser", "ArdiaSystem.setAsDefaultBrowser", "ArdiaSystem.launchAtLoginStatus", "ArdiaSystem.setLaunchAtLogin", "ArdiaApp.openExternalURL"]);
  assert.deepEqual(ENGINE.openUrls, ["ArdiaShell.onOpenURLs", "ArdiaShell.listenForOpenURLs"]);
  assert.deepEqual(ENGINE.windowCommands, ["ArdiaShell.toggleFullScreen", "tab.edit", "ArdiaShell.readText"]);
  assert.deepEqual(ENGINE.notifications, ["ArdiaApp.notificationPermission", "ArdiaApp.requestNotificationPermission", "ArdiaApp.postNotification", "ArdiaApp.removeNotifications"]);
  assert.deepEqual(ENGINE.hardware, ["ArdiaApp.hardwareInfo", "ArdiaSystem.setThinScrollBars", "ArdiaShell.setAppearance"]);
  assert.deepEqual(ENGINE.linkTabs, ["webView.setPeekOtherSiteTabs", "webView.setLittleArdiaOpensNewTabLinks"]);
  assert.deepEqual(ENGINE.pageCommits, ["tabs.reportCommits"]);
  assert.deepEqual(ENGINE.pageKeys, ["tab.unhandledEscape"]);
  assert.deepEqual(ENGINE.appActivation, ["ArdiaShell.resignActive"]);
  assert.deepEqual(ENGINE.smallWindows, ["ArdiaShell.smallWindows"]);
  assert.deepEqual(ENGINE.report, ["report.files", "report.send"]);
  assert.deepEqual(ENGINE.hiddenElements, ["contentBlocker.hiddenElements", "contentBlocker.hideElements", "contentBlocker.restoreElements"]);
  assert.deepEqual(ENGINE.customFilterLists, ["contentBlocker.addList", "contentBlocker.removeList"]);
  assert.deepEqual(ENGINE.wheelZoom, ["webView.setCommandScrollZoom"]);
  assert.deepEqual(ENGINE.blockAutoplay, ["webView.setBlockAutoplayEverywhere"]);
});

const OFF_IN_LAYER_1 = { "general.defaultBrowser": "ArdiaSystem.setAsDefaultBrowser", "general.openAtLogin": "ArdiaSystem.setLaunchAtLogin" };

test("with every new capability on, each Settings row the engine unlocks is shown and searchable, except the rows the Layer 1 gate keeps off", () => {
  const capabilities = linuxCapabilities(host);
  assert.deepEqual(
    { defaultBrowser: capabilities.defaultBrowser, launchAtLogin: capabilities.launchAtLogin, thinScrollBars: capabilities.thinScrollBars, externalLinks: capabilities.externalLinks, commandScrollZoom: capabilities.commandScrollZoom, littleNillaNewTabLinks: capabilities.littleNillaNewTabLinks, peekOtherSites: capabilities.peekOtherSites, linksFromOtherApps: capabilities.linksFromOtherApps, fullScreen: capabilities.fullScreen, pageEdits: capabilities.pageEdits },
    { defaultBrowser: false, launchAtLogin: false, thinScrollBars: true, externalLinks: true, commandScrollZoom: true, littleNillaNewTabLinks: true, peekOtherSites: true, linksFromOtherApps: true, fullScreen: true, pageEdits: true },
  );
  for (const [id, method] of Object.entries(OFF_IN_LAYER_1)) {
    assert.ok(ALL.includes(method) && isGated(method), `${method} is advertised and gated`);
    assert.equal(settings.settingUnavailable(id), true, `${id} stays hidden in Layer 1`);
  }
  const unlocked = ["tabs.peekLinksToOtherSites", "tabs.openLinksInLittleNilla", "tabs.appLinksFirst", "automations.meetingAlertCondition"];
  const searchable = new Set(settings.SETTINGS_INDEX.map((item) => item.entry.id));
  const without = unavailableSettingIds(linuxCapabilities(bare), sharedSettings.SETTINGS.map((entry) => entry.id));
  for (const id of unlocked) {
    assert.ok(sharedSettings.SETTINGS.some((entry) => entry.id === id), `${id} is a shared row`);
    assert.equal(settings.settingUnavailable(id), false, id);
    assert.ok(searchable.has(id), `${id} is searchable`);
    if (id !== "automations.meetingAlertCondition") assert.ok(without.has(id), `${id} stays hidden on an engine without it`);
  }
  for (const id of ["tabs.videoUpscaling", "advanced.nillaCommand", "advanced.compactCliPill"]) assert.equal(settings.settingUnavailable(id), true, `${id} still waits for its own backend`);
  for (const id of ["advanced.pageEngine", "advanced.websiteEngines"]) assert.equal(searchable.has(id), false, id);
});

test("with every new capability on, each command, menu entry and shortcut row appears", () => {
  const capabilities = linuxCapabilities(host);
  const hidden = unavailableCommands(capabilities);
  for (const command of ["emailPageLocation", "toggleOpenLinksInLittleNilla", FULL_SCREEN_ITEM]) assert.equal(hidden.has(command), false, command);
  assert.deepEqual([...hidden].sort(), ["toggleJavaScriptFromAppleEvents", "togglePageEngine"]);
  for (const command of ["emailPageLocation", "toggleOpenLinksInLittleNilla", FULL_SCREEN_ITEM, "hideElement", "showHiddenElements"]) assert.equal(unavailableCommands(linuxCapabilities(bare)).has(command), true, `${command} is hidden without the engine`);
  const items = appMenuItems(menuState, new Map(), hidden);
  for (const id of ["emailPageLocation", "toggleOpenLinksInLittleNilla", FULL_SCREEN_ITEM, "reportProblem"]) assert.ok(find(items, id), `${id} is in the menu`);
  const bareItems = appMenuItems(menuState, new Map(), unavailableCommands(linuxCapabilities(bare)));
  for (const id of ["emailPageLocation", "toggleOpenLinksInLittleNilla", FULL_SCREEN_ITEM]) assert.equal(find(bareItems, id), undefined, id);
  assert.ok(linuxMenuShortcuts().some((row) => row.id === FULL_SCREEN_ITEM));
  assert.ok(staticShortcutSources().some((source) => source.id === FULL_SCREEN_ITEM));
});

test("with every new capability on, the module calls reach the engine instead of a local answer, and the Layer 1 gate's calls never do", async () => {
  invoked.length = 0;
  const offInLayer1 = [
    ["ArdiaSystem", "isDefaultBrowser", []], ["ArdiaSystem", "setAsDefaultBrowser", []], ["ArdiaSystem", "launchAtLoginStatus", []], ["ArdiaSystem", "setLaunchAtLogin", [true]],
    ["ArdiaReport", "post", ["https://example.com/api/feedback", "{}", {}]],
  ];
  for (const [module, method, args] of offInLayer1) {
    const resolved = resolveHostModule(host, module, method);
    assert.equal(reachesNativeHostUnchecked(resolved), false, `${module}.${method} is answered locally in Layer 1`);
    await Promise.resolve().then(() => resolved(...args)).catch(() => {});
    assert.deepEqual(invoked, [], `${module}.${method} never reaches the engine in Layer 1`);
  }
  const calls = [
    ["ArdiaSystem", "setThinScrollBars", [true]], ["ArdiaApp", "openExternalURL", ["mailto:a@b.c"]], ["ArdiaApp", "hardwareInfo", []],
    ["ArdiaApp", "notificationPermission", []], ["ArdiaApp", "requestNotificationPermission", []], ["ArdiaApp", "postNotification", [{ id: "n" }]], ["ArdiaApp", "removeNotifications", [["n"]]],
    ["ArdiaShell", "fetchBangList", [null]], ["ArdiaShell", "toggleFullScreen", ["main"]],
    ["ArdiaReport", "draftDirectory", []],
  ];
  for (const [module, method, args] of calls) {
    const resolved = resolveHostModule(host, module, method);
    assert.ok(reachesNativeHostUnchecked(resolved) || module === "ArdiaReport", `${module}.${method} is not answered locally`);
    await resolved(...args);
    assert.deepEqual(invoked.at(-1), [`${module}.${method}`, { args }], `${module}.${method}`);
    if (method !== "toggleFullScreen") assert.equal(reachesNativeHostUnchecked(resolveHostModule(bare, module, method)), false, `${module}.${method} is answered locally without the engine`);
  }
  const before = invoked.length;
  for (const [module, call, verb] of [["ArdiaWebView", "webView", "setCommandScrollZoom"], ["ArdiaWebView", "webView", "setPeekOtherSiteTabs"], ["ArdiaWebView", "webView", "setLittleArdiaOpensNewTabLinks"], ["ArdiaProfiles", "profiles", "deleteData"], ["ArdiaTabs", "tabs", "reportCommits"]]) {
    await resolveHostModule(host, module, "call")(verb, "default", "[]");
    assert.deepEqual(invoked.at(-1), [`${call}.${verb}`, "default", "[]"]);
  }
  assert.equal(invoked.length, before + 5);
  assert.equal(listenForOpenUrls(host), true);
  assert.deepEqual(invoked.at(-1), ["ArdiaShell.listenForOpenURLs", { args: [] }]);
  assert.equal(listenForOpenUrls(bare), false);
  assert.equal(relaysSmallWindows(host), true);
  assert.equal(relaysSmallWindows(bare), false);
  assert.ok(ALL.includes("report.send") && isGated("report.send"), "report.send is advertised and gated");
  assert.equal(servesReportSheet(host), false, "the report sheet doesn't send in Layer 1");
  assert.equal(sendsFromSheet(host), false);
  assert.equal(sendsFromSheet(bare), false);
});

test("the two event-only capabilities need no gate: the engine's events reach the shared listeners", () => {
  const seen = [];
  const subscription = shim.requireNativeModule("ArdiaAppWindows").addListener("onAppEvent", (event) => seen.push(event));
  for (const listener of hostListeners) listener("ArdiaShell", "onAppEvent", { type: "resignActive" });
  subscription.remove();
  assert.deepEqual(seen, [{ type: "resignActive" }]);
  const commands = [];
  deliverPageEvent({ onCommand: (event) => commands.push(event) }, { name: "command", data: { command: "escape", text: "" } });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, "escape");
});

test("an event only the Linux engine sends is declared apart from the Mac's, and the Linux engine does send it", () => {
  const api = readFileSync(new URL("../../../packages/ardiacore/src/engine/api.ts", import.meta.url), "utf8");
  const bodyOf = (name) => api.slice(api.indexOf(`export type ${name} = {`), api.indexOf("\n};", api.indexOf(`export type ${name} = {`)));
  const keysOf = (body) => [...body.matchAll(/^ {2}"([a-zA-Z]+\.[a-zA-Z]+)":/gm)].map((match) => match[1]);
  const linuxOnly = keysOf(bodyOf("LinuxHostEvents"));
  assert.ok(linuxOnly.length > 0);
  const mac = new Set(keysOf(bodyOf("EngineEvents")));
  const engine = new URL("../../../engine/chromium/src/chrome/browser/ardia/", import.meta.url);
  const sent = readdirSync(engine).filter((file) => /_linux\.cc$/.test(file)).map((file) => readFileSync(new URL(file, engine), "utf8")).join("\n");
  for (const name of linuxOnly) {
    assert.equal(mac.has(name), false, `${name} is also in the Mac's events`);
    assert.ok(sent.includes(`Emit("${name}"`), `the Linux engine never sends ${name}`);
  }
});
