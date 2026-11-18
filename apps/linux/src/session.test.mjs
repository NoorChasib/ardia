import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createUtilitySessionSnapshot, initialLinuxSession } from "./session.ts";
import { STRUCTURAL_SAVE_MS, VOLATILE_SAVE_MS, linuxSessionShape, snapshotHostSession, startHostPersistence, volatileSessionChange } from "./hostSession.ts";
import { sessionStatePatch } from "./hostSessionState.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { cloneSessionValue, mergeSession } from "./hostSessionMerge.ts";
import { SESSION_VERSION } from "../../browser/src/state/session/persist.ts";
import { takeSessionWrites } from "../../browser/src/state/telemetry/sessionWrites.ts";
import { save as saveTelemetryChoice } from "../../browser/src/state/telemetry/choice.ts";

before(() => saveTelemetryChoice({ sharing: true, installId: "session-test" }));
after(() => saveTelemetryChoice({ sharing: false, installId: null }));

const host = (windowId = "main") => ({ bootstrap: { windowId, profileId: "default", startup: false } });

function browserSession() {
  const saved = initialLinuxSession(host(), null);
  saved.settings = { restoreSession: false, sidebarWidth: 256, autoHideTabs: false };
  const tab = Object.values(saved.tabs)[0];
  tab.url = "https://example.test/playing";
  tab.title = "Playing page";
  tab.lastActiveAt = 123;
  saved.version = SESSION_VERSION;
  return saved;
}

test("utility startup retains browser windows and active page without inventing utility tabs or applying launch restore policy", () => {
  const saved = browserSession();
  for (const id of ["settings", "import"]) {
    const initial = initialLinuxSession(host(id), saved);
    assert.equal(initial, saved);
    useBrowser.getState().hydrate(initial);
    assert.deepEqual(useBrowser.getState().windowOrder, ["main"]);
    assert.equal(useBrowser.getState().windows[id], undefined);
    assert.equal(Object.values(useBrowser.getState().tabs).length, 1);
    assert.equal(Object.values(useBrowser.getState().tabs)[0].url, "https://example.test/playing");
  }
  assert.deepEqual(initialLinuxSession(host("settings"), null), {});
});

test("sessions saved with numeric pin choices start with clock stamps", () => {
  const saved = browserSession();
  const key = Object.keys(saved.tabs)[0];
  saved.pinChoices = { default: { [key]: 1792984216515, [`place:${key}`]: 1792984216516 } };
  const initial = initialLinuxSession(host(), saved);
  useBrowser.getState().hydrate(initial);
  const choices = initial.pinChoices.default;
  assert.ok(Object.values(choices).every((choice) => typeof choice === "string"));
  assert.ok(choices[`place:${key}`] > choices[key]);
  assert.deepEqual(initialLinuxSession(host("settings"), saved).pinChoices, initial.pinChoices);
});

test("a session saved before auto-hide tabs existed starts it on only when every saved window hid its tabs", () => {
  const saved = browserSession();
  const windowIds = Object.keys(saved.windows);
  const { autoHideTabs: _, ...olderSettings } = saved.settings;
  const withSidebars = (open) => ({ ...saved, settings: { ...olderSettings }, windows: Object.fromEntries(windowIds.map((id) => [id, { ...saved.windows[id], sidebarOpen: open }])) });
  assert.equal(linuxSessionShape(withSidebars(false)).settings.autoHideTabs, true);
  assert.equal(linuxSessionShape(withSidebars(true)).settings.autoHideTabs, false);
  const chosen = withSidebars(false);
  chosen.settings.autoHideTabs = false;
  assert.equal(linuxSessionShape(chosen).settings.autoHideTabs, false);
});

test("a new Linux window keeps no copy of whether its tabs show, so the auto-hide tabs setting decides", () => {
  const saved = browserSession();
  for (const autoHideTabs of [true, false]) {
    saved.settings.autoHideTabs = autoHideTabs;
    assert.equal(Object.hasOwn(initialLinuxSession(host("window-2"), saved).windows["window-2"], "sidebarOpen"), false);
  }
});

test("saved and closed windows lose their per-window tabs-shown copy once the setting has read it", () => {
  const saved = browserSession();
  const windowIds = Object.keys(saved.windows);
  const { autoHideTabs: _, ...olderSettings } = saved.settings;
  const closedWindows = [{ kind: "window", id: "cw", window: { profileId: "default", sidebarOpen: false, frame: null }, tabs: [], groups: [], closedAt: 1 }];
  const shaped = linuxSessionShape({ ...saved, settings: olderSettings, closedWindows, windows: Object.fromEntries(windowIds.map((id) => [id, { ...saved.windows[id], sidebarOpen: false }])) });
  assert.equal(shaped.settings.autoHideTabs, true);
  assert.ok(Object.values(shaped.windows).every((w) => !Object.hasOwn(w, "sidebarOpen")));
  assert.equal(Object.hasOwn(shaped.closedWindows[0].window, "sidebarOpen"), false);
});

test("legacy tab fields left beside current ones never override them, so a saved session settles", async () => {
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const saved = browserSession();
  const key = Object.keys(saved.tabs)[0];
  saved.tabs[key] = { ...saved.tabs[key], page: { kind: "idle" }, pin: { as: "tile" }, unloaded: true, pinned: true, pinnedAsRow: true, navigation: null };
  const shaped = linuxSessionShape(saved).tabs[key];
  assert.deepEqual(shaped.page, { kind: "idle" });
  assert.deepEqual(shaped.pin, { as: "tile" });
  assert.ok(!["unloaded", "pinned", "pinnedAsRow", "navigation"].some((field) => field in shaped));
  let canonical = saved;
  const writes = [];
  const native = {
    ...host(),
    async invoke(method, pair) {
      assert.equal(method, "session.write");
      writes.push(pair);
      canonical = mergeSession(pair.base, pair.session, canonical);
      return canonical;
    },
    onEvent() { return () => {}; },
    onBeforeClose() { return () => {}; },
  };
  useBrowser.getState().hydrate(initialLinuxSession(native, linuxSessionShape(saved)));
  const stop = startHostPersistence(native, useBrowser, saved);
  try {
    await stop.flush();
    assert.ok(writes.length <= 2, `${writes.length} writes`);
    assert.deepEqual(useBrowser.getState().tabs[key].pin, { as: "tile" });
  } finally {
    stop();
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
});

test("utility snapshots preserve canonical browser geometry, pages, groups and focus while saving live profile names and settings", () => {
  const saved = browserSession();
  useBrowser.getState().hydrate(saved);
  const snapshotUtilitySession = createUtilitySessionSnapshot(useBrowser.getState(), saved);
  useBrowser.getState().updateSettings({ sidebarWidth: 310 });
  useBrowser.setState((state) => ({ profiles: { ...state.profiles, default: { ...state.profiles.default, name: "Renamed Personal" } } }));
  const snapshot = snapshotUtilitySession(useBrowser.getState(), saved);
  for (const field of ["windows", "windowOrder", "tabs", "groups", "splits", "focusedWindowId", "lastProfileId"]) assert.deepEqual(snapshot[field], saved[field]);
  assert.equal(snapshot.settings.sidebarWidth, 310);
  assert.equal(snapshot.profiles.default.name, "Renamed Personal");
  assert.equal(Object.values(snapshot.tabs)[0].lastActiveAt, 123);
});

test("utility persistence rebases settings edits on canonical browser navigation without echoes or phantom native windows", async () => {
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const initial = browserSession();
  let canonical = initial;
  const writes = [];
  const listeners = new Set();
  let finalize;
  const native = {
    ...host("settings"),
    async invoke(method, pair) {
      assert.equal(method, "session.write");
      writes.push(pair);
      canonical = mergeSession(pair.base, pair.session, canonical);
      return canonical;
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onBeforeClose(listener) { finalize = listener; return () => {}; },
  };
  useBrowser.getState().hydrate(initial);
  const stop = startHostPersistence(native, useBrowser, initial, createUtilitySessionSnapshot(useBrowser.getState(), initial));
  try {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const before = canonical;
    const tabId = Object.keys(canonical.tabs)[0];
    canonical = { ...canonical, tabs: { ...canonical.tabs, [tabId]: { ...canonical.tabs[tabId], url: "https://example.test/next" } } };
    for (const listener of listeners) listener("ArdiaHost", "session", { base: before, session: canonical });
    const next = canonical;
    canonical = { ...canonical, tabs: { ...canonical.tabs, [tabId]: { ...canonical.tabs[tabId], url: "https://example.test/final" } } };
    for (const listener of listeners) listener("ArdiaHost", "session", { base: next, session: canonical });
    useBrowser.getState().updateSettings({ sidebarWidth: 330 });
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(canonical.settings.sidebarWidth, 330);
    assert.equal(canonical.tabs[tabId].url, "https://example.test/final");
    assert.equal(canonical.tabs[tabId].lastActiveAt, 123);
    assert.deepEqual(Object.keys(canonical.windows), ["main"]);
    const count = writes.length;
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(writes.length, count);
    finalize();
  } finally {
    stop();
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
});

test("utility readiness recovers navigation requested while loading and never replaces a newer live request with an older reply", async () => {
  const { startUtilityNavigation } = await import("./utilityNavigation.ts");
  for (const liveRequest of [false, true]) {
    const listeners = new Set();
    let reply;
    let requested;
    const places = [];
    const initial = { pane: "general", profileId: null, detail: null };
    const pending = { pane: "profiles", profileId: "work", detail: null };
    const latest = { pane: "appearance", profileId: null, detail: null };
    const native = {
      bootstrap: { ...host("settings").bootstrap, utility: initial },
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      invoke(method, args) {
        requested = [method, args];
        assert.equal(listeners.size, 1);
        return new Promise((resolve) => { reply = resolve; });
      },
    };
    const watcher = startUtilityNavigation(native, (place) => places.push(place));
    assert.deepEqual(requested, ["ArdiaShell.utilityReady", { args: ["settings"] }]);
    if (liveRequest) for (const listener of listeners) listener("ArdiaShell", "onUtilityNavigation", latest);
    reply(pending);
    await watcher.ready;
    assert.deepEqual(places.at(-1), liveRequest ? latest : pending);
    watcher.stop();
    assert.equal(listeners.size, 0);
  }
});

test("utility snapshots keep profile deletion and browser tabs created by Settings atomic", () => {
  const initial = browserSession();
  useBrowser.getState().hydrate(initial);
  const other = useBrowser.getState().createProfile({ name: "Work" });
  const saved = { ...initial, profiles: useBrowser.getState().profiles, profileOrder: useBrowser.getState().profileOrder };
  const snapshot = createUtilitySessionSnapshot(useBrowser.getState(), saved);
  useBrowser.getState().deleteProfile("default");
  const deleted = snapshot(useBrowser.getState(), saved);
  assert.equal(deleted.profiles.default, undefined);
  assert.equal(deleted.windows.main.profileId, other);
  assert.ok(Object.values(deleted.tabs).every((tab) => tab.profileId !== "default"));
  const afterDelete = createUtilitySessionSnapshot(useBrowser.getState(), deleted);
  const created = useBrowser.getState().newTab("main", { url: "https://chromewebstore.google.com/" });
  const opened = afterDelete(useBrowser.getState(), deleted);
  assert.equal(opened.tabs[created].url, "https://chromewebstore.google.com/");
  assert.ok(opened.windows.main.tabIds.includes(created));
});

test("a utility opened before the first browser save publishes no defaults and close-immediate saves only its edit", async () => {
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  let canonical = {};
  const writes = [];
  const listeners = new Set();
  let final;
  const native = {
    ...host("settings"),
    async invoke(method, pair) {
      assert.equal(method, "session.write");
      writes.push(pair);
      canonical = mergeSession(pair.base, pair.session, canonical);
      return canonical;
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onBeforeClose(listener) { final = listener; return () => {}; },
  };
  useBrowser.getState().hydrate({});
  const stop = startHostPersistence(native, useBrowser, {}, createUtilitySessionSnapshot(useBrowser.getState(), {}));
  try {
    await stop.flush();
    assert.equal(writes.length, 0);
    const source = browserSession();
    source.settings.sidebarWidth = 290;
    canonical = source;
    for (const listener of listeners) listener("ArdiaHost", "session", { base: {}, session: source });
    await stop.flush();
    assert.equal(writes.length, 0);
    assert.equal(useBrowser.getState().settings.sidebarWidth, 290);
    assert.ok(Array.isArray(useBrowser.getState().settings.customSearchEngines));
    const engine = useBrowser.getState().addCustomEngine({ name: "Utility search", keyword: "utility", url: "https://search.example/?q=%s" });
    assert.equal(typeof engine.id, "string");
    useBrowser.getState().updateSettings({ sidebarWidth: 340 });
    final();
    await new Promise(setImmediate);
    assert.equal(writes.length, 1);
    assert.equal(canonical.settings.sidebarWidth, 340);
    assert.equal(canonical.settings.customSearchEngines.length, 1);
    assert.deepEqual(canonical.windows, source.windows);
    assert.deepEqual(canonical.tabs, source.tabs);
    assert.equal(canonical.focusedWindowId, source.focusedWindowId);
  } finally {
    stop();
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
});

test("utility close waits for every save acknowledgement and deduplicates repeated close requests", async () => {
  const { createUtilityWindowCloser } = await import("./utilityClose.ts");
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const initial = browserSession();
  let canonical = initial;
  let live = true;
  const pendingWrites = [];
  const closed = [];
  const native = {
    ...host("settings"),
    invoke(method, pair) {
      assert.ok(live);
      assert.equal(method, "session.write");
      return new Promise((resolve) => pendingWrites.push(() => {
        assert.ok(live);
        canonical = mergeSession(pair.base, pair.session, canonical);
        resolve(canonical);
      }));
    },
    onEvent() { return () => {}; },
    onBeforeClose() { return () => {}; },
  };
  useBrowser.getState().hydrate(initial);
  const persistence = startHostPersistence(native, useBrowser, initial, createUtilitySessionSnapshot(useBrowser.getState(), initial));
  const close = createUtilityWindowCloser(persistence.flush, async (id) => { closed.push(id); live = false; });
  try {
    useBrowser.getState().updateSettings({ showFullUrl: true });
    useBrowser.getState().updateProfile("default", { name: "Work" });
    const closing = close("settings");
    assert.equal(close("settings"), closing);
    await new Promise(setImmediate);
    assert.equal(pendingWrites.length, 1);
    assert.deepEqual(closed, []);
    useBrowser.getState().updateSettings({ sidebarWidth: 360 });
    const concurrentSave = persistence.flush();
    pendingWrites.shift()();
    await new Promise(setImmediate);
    assert.equal(pendingWrites.length, 1);
    assert.deepEqual(closed, []);
    pendingWrites.shift()();
    await concurrentSave;
    await closing;
    assert.deepEqual(closed, ["settings"]);
    assert.equal(canonical.settings.showFullUrl, true);
    assert.equal(canonical.settings.sidebarWidth, 360);
    assert.equal(canonical.profiles.default.name, "Work");
    assert.deepEqual(canonical.tabs, initial.tabs);
    assert.equal(canonical.focusedWindowId, initial.focusedWindowId);
  } finally {
    persistence();
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
});

test("failed utility saves leave the window open and retrying close saves again", async () => {
  const { createUtilityWindowCloser } = await import("./utilityClose.ts");
  const { createSessionWriter } = await import("./hostSession.ts");
  const closed = [];
  let calls = 0;
  const writer = createSessionWriter({
    ...host("settings"),
    async invoke(_method, pair) {
      calls++;
      if (calls === 1) throw new Error("Save rejected");
      return pair.session;
    },
  }, {});
  writer.queue({ settings: { showFullUrl: true } });
  const close = createUtilityWindowCloser(writer.drain, async (id) => { closed.push(id); });
  await assert.rejects(close("settings"), /Save rejected/);
  assert.deepEqual(closed, []);
  await close("settings");
  assert.equal(calls, 2);
  assert.deepEqual(closed, ["settings"]);
  const browserClose = createUtilityWindowCloser(async () => { throw new Error("Unexpected utility save"); }, async (id) => { closed.push(id); });
  await browserClose("main");
  assert.deepEqual(closed, ["settings", "main"]);
});

test("utility close cannot acknowledge native teardown before persistence is ready", async () => {
  const { createUtilityWindowCloser } = await import("./utilityClose.ts");
  const { flushLinuxSession } = await import("./session.ts");
  const closed = [];
  const close = createUtilityWindowCloser(flushLinuxSession, async (id) => { closed.push(id); });
  await assert.rejects(close("settings"), /Session persistence is not ready/);
  assert.deepEqual(closed, []);
});

test("matching canonical state supersedes a settled save failure before retrying utility close", async () => {
  const { createUtilityWindowCloser } = await import("./utilityClose.ts");
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const initial = browserSession();
  const listeners = new Set();
  const closed = [];
  const writes = [];
  const native = {
    ...host("settings"),
    async invoke(method, pair) {
      assert.equal(method, "session.write");
      writes.push(pair);
      throw new Error("Save rejected before canonical event");
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onBeforeClose() { return () => {}; },
  };
  useBrowser.getState().hydrate(initial);
  const persistence = startHostPersistence(native, useBrowser, initial, createUtilitySessionSnapshot(useBrowser.getState(), initial));
  const close = createUtilityWindowCloser(persistence.flush, async (id) => { closed.push(id); });
  try {
    useBrowser.getState().updateSettings({ showFullUrl: true });
    useBrowser.getState().updateProfile("default", { name: "Work" });
    await assert.rejects(close("settings"), /Save rejected/);
    assert.deepEqual(closed, []);
    const saved = writes[0].session;
    for (const listener of listeners) listener("ArdiaHost", "session", { base: initial, session: saved });
    await close("settings");
    assert.equal(writes.length, 1);
    assert.deepEqual(closed, ["settings"]);
    assert.equal(useBrowser.getState().settings.showFullUrl, true);
    assert.equal(useBrowser.getState().profiles.default.name, "Work");
  } finally {
    persistence();
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
});

test("canonical satisfaction cannot bypass an in-flight save rejection", async () => {
  const { createUtilityWindowCloser } = await import("./utilityClose.ts");
  const { createSessionWriter } = await import("./hostSession.ts");
  const saved = { settings: { showFullUrl: true } };
  const closed = [];
  let rejectSave;
  let calls = 0;
  const writer = createSessionWriter({
    ...host("settings"),
    invoke() {
      calls++;
      return new Promise((_resolve, reject) => { rejectSave = reject; });
    },
  }, {});
  writer.queue(saved);
  const close = createUtilityWindowCloser(writer.drain, async (id) => { closed.push(id); });
  const closing = close("settings");
  await new Promise(setImmediate);
  writer.acceptCanonical(saved);
  writer.reconcile(saved, false);
  assert.equal(close("settings"), closing);
  assert.deepEqual(closed, []);
  rejectSave(new Error("In-flight save rejected"));
  await assert.rejects(closing, /In-flight save rejected/);
  assert.deepEqual(closed, []);
  await close("settings");
  assert.equal(calls, 1);
  assert.deepEqual(closed, ["settings"]);
});

test("a matching older canonical event cannot discard newer unsaved edits after failure", async () => {
  const { createUtilityWindowCloser } = await import("./utilityClose.ts");
  const { createSessionWriter } = await import("./hostSession.ts");
  const saved = { settings: { showFullUrl: true } };
  const newer = { settings: { showFullUrl: true, sidebarWidth: 360 } };
  const writes = [];
  const closed = [];
  let acknowledge;
  const writer = createSessionWriter({
    ...host("settings"),
    invoke(_method, pair) {
      writes.push(pair);
      if (writes.length === 1) return Promise.reject(new Error("Save rejected"));
      return new Promise((resolve) => { acknowledge = () => resolve(pair.session); });
    },
  }, {});
  writer.queue(saved);
  const close = createUtilityWindowCloser(writer.drain, async (id) => { closed.push(id); });
  await assert.rejects(close("settings"), /Save rejected/);
  writer.acceptCanonical(saved);
  writer.reconcile(newer, true);
  const closing = close("settings");
  await new Promise(setImmediate);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].session, newer);
  assert.deepEqual(closed, []);
  acknowledge();
  await closing;
  assert.deepEqual(closed, ["settings"]);
});

for (const peerInterleaving of [false, true]) for (const eventFirst of [true, false]) {
  test(`closing a tab during its pending creation save survives the source notification with ${eventFirst ? "event" : "ack"} first${peerInterleaving ? " and an intervening peer save" : ""}`, async () => {
    const savedWindow = globalThis.window;
    const savedDocument = globalThis.document;
    globalThis.window = new EventTarget();
    globalThis.document = Object.assign(new EventTarget(), { hidden: false });
    const initial = browserSession();
    let canonical = initial;
    let delaySave = false;
    let held;
    const listeners = new Set();
    const native = {
      ...host(),
      invoke(method, pair) {
        assert.equal(method, "session.write");
        let response;
        const commit = () => {
          if (!response) {
            canonical = mergeSession(pair.base, pair.session, canonical);
            response = canonical;
          }
          return response;
        };
        const emit = () => { const session = commit(); for (const listener of listeners) listener("ArdiaHost", "session", { base: pair.session, session, sourceWindowId: "main" }); };
        if (delaySave) {
          delaySave = false;
          return new Promise((resolve) => { held = { emit, resolve: () => resolve(commit()) }; });
        }
        emit();
        return Promise.resolve(commit());
      },
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      onBeforeClose() { return () => {}; },
    };
    useBrowser.getState().hydrate(initial);
    const persistence = startHostPersistence(native, useBrowser, initial);
    try {
      await persistence.flush();
      const created = useBrowser.getState().newTab("main");
      delaySave = true;
      const saving = persistence.flush();
      await new Promise(setImmediate);
      assert.ok(held);
      useBrowser.getState().closeTab(created);
      assert.equal(useBrowser.getState().tabs[created], undefined);
      if (peerInterleaving) {
        const base = canonical;
        canonical = { ...canonical, settings: { ...canonical.settings, sidebarWidth: 388 } };
        for (const listener of listeners) listener("ArdiaHost", "session", { base, session: canonical, sourceWindowId: "peer" });
      }
      if (eventFirst) held.emit();
      held.resolve();
      await new Promise(setImmediate);
      if (!eventFirst) held.emit();
      await saving;
      await persistence.flush();
      assert.equal(useBrowser.getState().tabs[created], undefined);
      assert.equal(canonical.tabs[created], undefined);
      assert.ok(!canonical.windows.main.tabIds.includes(created));
      if (peerInterleaving) assert.equal(canonical.settings.sidebarWidth, 388);
      const base = canonical;
      canonical = { ...canonical, settings: { ...canonical.settings, sidebarWidth: 377 } };
      for (const listener of listeners) listener("ArdiaHost", "session", { base, session: canonical, sourceWindowId: "peer" });
      assert.equal(useBrowser.getState().settings.sidebarWidth, 377);
    } finally {
      persistence();
      globalThis.window = savedWindow;
      globalThis.document = savedDocument;
    }
  });
}

async function closeSessionFixture({ failWrites = 0, endsSession = true } = {}) {
  const { quiesceLinuxSession, resumeLinuxSession } = await import("./sessionClose.ts");
  const { createWindowCloseBarrier } = await import("./utilityClose.ts");
  const { createWindowCloseCoordinator } = await import("./windowCloseCoordinator.ts");
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const initial = browserSession();
  initial.settings = { ...initial.settings, warnBeforeClosingWindow: true, warnBeforeClosingLastTab: true };
  useBrowser.getState().hydrate(initial);
  const state = { canonical: initial, failures: failWrites, log: [] };
  const native = {
    ...host(),
    async invoke(method, pair) {
      assert.equal(method, "session.write");
      if (state.failures > 0) { state.failures--; state.log.push(["write-failed"]); throw new Error("Save rejected"); }
      state.canonical = mergeSession(pair.base, pair.session, state.canonical);
      state.log.push(["write", state.canonical.settings.warnBeforeClosingWindow]);
      return state.canonical;
    },
    onEvent() { return () => {}; },
    onBeforeClose() { return () => {}; },
  };
  const persistence = startHostPersistence(native, useBrowser, initial);
  const token = (request) => JSON.stringify(request);
  let coordinator, answer;
  const barrier = createWindowCloseBarrier({
    quiesce: (request) => { state.log.push(["quiesce"]); quiesceLinuxSession(token(request)); },
    drain: async () => { await persistence.flush(); return 0; },
    acknowledge: async (request) => {
      state.departure = coordinator.departs(request) ? persistence.departure(request.windowId) : undefined;
      state.log.push(["seal", state.canonical.settings.warnBeforeClosingWindow, !!state.departure]);
    },
    reject: async () => {},
    resume: (request) => { coordinator.producersResumed(request); resumeLinuxSession(token(request)); },
  });
  coordinator = createWindowCloseCoordinator({
    windowId: "main",
    utility: false,
    decide: async () => answer,
    suppress: (reason) => useBrowser.getState().updateSettings(reason === "lastTab" ? { warnBeforeClosingLastTab: false } : { warnBeforeClosingWindow: false }),
    flush: () => persistence.flush(),
    request: async (id) => { state.log.push(["request", id]); return { windowId: id, rendererGeneration: "1", closeGeneration: "1" }; },
    beginDrain: async () => { state.log.push(["begin", state.canonical.settings.warnBeforeClosingWindow]); return { accepted: true, endsSession }; },
    reject: async (request) => { state.log.push(["reject", request.closeGeneration]); },
    barrier,
    cancelled: barrier.cancelled,
  });
  return {
    state, persistence, coordinator, quiesceLinuxSession, resumeLinuxSession,
    answer: (value) => { answer = value; },
    commit: () => { if (state.departure) state.canonical = mergeSession(state.departure.base, state.departure.session, state.canonical); state.departure = undefined; },
    restore() { resumeLinuxSession(token(closeRequest())); persistence(); globalThis.window = previousWindow; globalThis.document = previousDocument; },
  };
}

const closeRequest = () => ({ windowId: "main", rendererGeneration: "1", closeGeneration: "1" });

test("session close tokens freeze producers after draining what came before, and only the last resume unfreezes", async () => {
  const fixture = await closeSessionFixture();
  try {
    useBrowser.getState().updateSettings({ sidebarWidth: 301 });
    fixture.quiesceLinuxSession("one");
    fixture.quiesceLinuxSession("two");
    await fixture.persistence.flush();
    assert.equal(fixture.state.canonical.settings.sidebarWidth, 301);
    useBrowser.getState().updateSettings({ sidebarWidth: 302 });
    fixture.resumeLinuxSession("one");
    await fixture.persistence.flush();
    assert.equal(fixture.state.canonical.settings.sidebarWidth, 301);
    fixture.resumeLinuxSession("two");
    await fixture.persistence.flush();
    assert.equal(fixture.state.canonical.settings.sidebarWidth, 302);
  } finally {
    fixture.resumeLinuxSession("one"); fixture.resumeLinuxSession("two");
    fixture.restore();
  }
});

test("an allowed close saves the don't-ask choice before quiescence and seal; a cancelled one saves it and stays unfrozen", async () => {
  const fixture = await closeSessionFixture();
  try {
    fixture.answer({ decision: "allow", suppressWarning: true });
    await fixture.coordinator.accept(closeRequest());
    assert.deepEqual(fixture.state.log, [["begin", true], ["write", false], ["quiesce"], ["seal", false, false]]);
  } finally {
    fixture.restore();
  }
  const cancelled = await closeSessionFixture();
  try {
    cancelled.answer({ decision: "cancel", suppressWarning: true });
    await assert.rejects(cancelled.coordinator.close("window"), { code: "ERR_WINDOW_CLOSE_CANCELLED" });
    assert.deepEqual(cancelled.state.log, [["request", "main"], ["reject", "1"], ["write", false]]);
    useBrowser.getState().updateSettings({ sidebarWidth: 290 });
    await cancelled.persistence.flush();
    assert.equal(cancelled.state.canonical.settings.sidebarWidth, 290);
  } finally {
    cancelled.restore();
  }
});

test("a failed suppression save rejects the close before quiescence", async () => {
  const fixture = await closeSessionFixture({ failWrites: 1 });
  try {
    fixture.answer({ decision: "allow", suppressWarning: true });
    await assert.rejects(fixture.coordinator.accept(closeRequest()), /Save rejected/);
    assert.deepEqual(fixture.state.log, [["begin", true], ["write-failed"], ["reject", "1"]]);
  } finally {
    fixture.restore();
  }
});

for (const endsSession of [false, true]) {
  test(`a native window close ${endsSession ? "that ends the session keeps the window for restore" : "moves the window to closed windows only once native commits teardown"}`, async () => {
    const fixture = await closeSessionFixture({ endsSession });
    try {
      fixture.answer({ decision: "allow", suppressWarning: false });
      await fixture.coordinator.accept(closeRequest());
      assert.deepEqual(fixture.state.log.filter(([step]) => step !== "write"), [["begin", true], ["quiesce"], ["seal", true, !endsSession]]);
      assert.ok(fixture.state.canonical.windows.main);
      fixture.commit();
      assert.equal(!!fixture.state.canonical.windows.main, endsSession);
      if (!endsSession) assert.equal(initialLinuxSession(host("window-2"), structuredClone(fixture.state.canonical)).closedWindows.length, 1);
    } finally {
      fixture.restore();
    }
  });
}

test("the merged Top Apps circles survive a save and a canonical update from another window", () => {
  const state = { ...useBrowser.getState(), topAppsMerged: "default,work" };
  const local = snapshotHostSession(state);
  assert.equal(local.topAppsMerged, "default,work");
  assert.equal(sessionStatePatch(state, local, { ...local, topAppsMerged: "default,home" }).topAppsMerged, "default,home");
  assert.equal("topAppsMerged" in sessionStatePatch(state, local, local), false);
});

test("which settings the user chose survives a save and a canonical update from another window", () => {
  const state = { ...useBrowser.getState(), settingsMeta: { chosen: ["theme"], inferred: [] } };
  const local = snapshotHostSession(state);
  assert.deepEqual(local.settingsMeta, { chosen: ["theme"], inferred: [] });
  assert.deepEqual(sessionStatePatch(state, local, { ...local, settingsMeta: { chosen: ["theme", "tabLayout"], inferred: [] } }).settingsMeta, { chosen: ["theme", "tabLayout"], inferred: [] });
  assert.equal("settingsMeta" in sessionStatePatch(state, local, local), false);
});

test("the Linux session snapshot saves every field the shared session saves, except the Mac's early launch tab", async () => {
  const { readFileSync } = await import("node:fs");
  const persist = readFileSync(new URL("../../browser/src/state/session/persist.ts", import.meta.url), "utf8");
  const body = persist.slice(persist.indexOf("const SESSION_FIELDS = {"), persist.indexOf("\n};", persist.indexOf("const SESSION_FIELDS = {")));
  const shared = [...body.matchAll(/^  (\w+): field\(/gm)].map((match) => match[1]);
  assert.ok(shared.length > 20, shared.join(", "));
  const linux = new Set([...Object.keys(snapshotHostSession(useBrowser.getState())), "focusedWindowId", "lastProfileId"]);
  assert.deepEqual(shared.filter((key) => !linux.has(key)), ["launchTab", "launchBackdrop", "linkProfile"]);
});

test("a launch that doesn't restore windows keeps each one as a closed window with its tab layout, and drops the Mac's last-window marks and empty entries", () => {
  const saved = browserSession();
  const windowId = Object.keys(saved.windows)[0];
  saved.windows[windowId] = { ...saved.windows[windowId], tabLayout: "top" };
  const tab = { url: "https://kept.example/", title: "Kept", profileId: "default", active: true };
  saved.closedWindows = [
    { kind: "window", id: "cw-last", window: { profileId: "default", sidebarOpen: true, frame: null }, tabs: [tab], groups: [], closedAt: 1, lastWindow: true, activePin: "pin:x" },
    { kind: "window", id: "cw-pins", window: { profileId: "default", sidebarOpen: true, frame: null }, tabs: [], groups: [], closedAt: 2, lastWindow: true },
  ];
  const launched = initialLinuxSession({ bootstrap: { windowId: "fresh", profileId: "default", startup: true } }, saved);
  const closed = launched.closedWindows;
  assert.deepEqual(closed.map((c) => c.id).slice(0, 1), ["cw-last"]);
  assert.equal(closed.some((c) => c.id === "cw-pins"), false);
  assert.ok(closed.every((c) => !("lastWindow" in c) && !("activePin" in c)));
  const fromLaunch = closed.at(-1);
  assert.equal(fromLaunch.window.tabLayout, "top");
  assert.equal(fromLaunch.tabs[0].url, "https://example.test/playing");
  assert.equal(launched.windows[windowId], undefined);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, deadline) {
  const until = Date.now() + deadline;
  while (!check() && Date.now() < until) await wait(10);
  return check();
}

async function persistedTabs({ count = 4, holdWrites = false, eventFirst = false } = {}) {
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  const initial = browserSession();
  initial.settings.restoreSession = true;
  useBrowser.getState().hydrate(initial);
  const ids = [Object.keys(initial.tabs)[0]];
  for (let index = 1; index < count; index++) ids.push(useBrowser.getState().newTab("main", { url: `https://example.test/${index}`, background: true }));
  const listeners = new Set();
  const state = { disk: cloneSessionValue(initial), writes: [], reads: 0, held: [], final: undefined, failures: 0 };
  const native = {
    ...host(),
    invoke(method, pair) {
      assert.equal(method, "session.write");
      state.writes.push(cloneSessionValue(pair));
      state.readsAtWrite = state.reads;
      if (state.failures > 0) {
        state.failures--;
        return Promise.reject(new Error("disk write rejected"));
      }
      const answer = () => {
        state.disk = mergeSession(pair.base, pair.session, state.disk);
        const session = cloneSessionValue(state.disk);
        const broadcast = () => { for (const listener of listeners) listener("ArdiaHost", "session", { base: cloneSessionValue(pair.session), session: cloneSessionValue(session), sourceWindowId: "main" }); };
        if (eventFirst) broadcast();
        else setTimeout(broadcast, 0);
        return session;
      };
      if (state.hold) return new Promise((resolve) => state.held.push(() => resolve(answer())));
      return Promise.resolve(answer());
    },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onBeforeClose(listener) { state.final = listener; return () => {}; },
  };
  const store = { getState: () => { state.reads++; return useBrowser.getState(); }, setState: (patch) => useBrowser.setState(patch), subscribe: (listener) => useBrowser.subscribe(listener) };
  const persistence = startHostPersistence(native, store, initial);
  await persistence.flush();
  await wait(5);
  state.writes.length = 0;
  state.hold = holdWrites;
  return {
    ids, state, persistence,
    S: () => useBrowser.getState(),
    hide: async () => { document.hidden = true; document.dispatchEvent(new Event("visibilitychange")); document.hidden = false; await wait(5); },
    restore() { persistence(); globalThis.window = previous.window; globalThis.document = previous.document; },
  };
}

test("tab switches, titles, icons and last-used times change only volatile fields; anything else is structural", () => {
  const saved = browserSession();
  useBrowser.getState().hydrate(saved);
  const S = () => useBrowser.getState();
  const second = S().newTab("main", { url: "https://example.test/second", background: true });
  const changed = (change) => {
    const before = S();
    change();
    return volatileSessionChange(before, S());
  };
  assert.equal(changed(() => S().activate(second)), true);
  assert.equal(changed(() => S().updateTab(second, { title: "Retitled" })), true);
  assert.equal(changed(() => S().updateTab(second, { favicon: "https://example.test/icon.png" })), true);
  assert.equal(changed(() => S().updateTab(second, { url: "https://example.test/moved" })), false);
  assert.equal(changed(() => S().updateTab(second, { pin: { as: "row" } })), false);
  assert.equal(changed(() => S().newTab("main", { url: "https://example.test/third", background: true })), false);
  assert.equal(changed(() => S().closeTab(second)), false);
  assert.equal(changed(() => S().updateSettings({ sidebarWidth: 301 })), false);
  const before = S();
  const window = before.windows.main;
  assert.equal(volatileSessionChange(before, { ...before, windows: { ...before.windows, main: { ...window, tabIds: [...window.tabIds].reverse() } } }), false);
  assert.equal(volatileSessionChange(before, { ...before, windows: { ...before.windows, main: { ...window, frame: { x: 1, y: 2, width: 3, height: 4 } } } }), false);
});

test("tab switches inside the volatile wait are saved together, once, with the last switch", async () => {
  const fixture = await persistedTabs();
  try {
    takeSessionWrites();
    const started = Date.now();
    for (let round = 0; round < 12; round++) {
      fixture.S().activate(fixture.ids[(round + 1) % 4]);
      await wait(100);
    }
    assert.ok(Date.now() - started < VOLATILE_SAVE_MS);
    assert.equal(fixture.state.writes.length, 0, "no write before the volatile wait ends");
    assert.ok(await waitFor(() => fixture.state.writes.length > 0, VOLATILE_SAVE_MS));
    const lastShown = fixture.ids[12 % 4];
    assert.equal(fixture.state.disk.windows.main.activeTabIds.default, lastShown);
    assert.equal(fixture.state.disk.tabs[lastShown].lastActiveAt, fixture.S().tabs[lastShown].lastActiveAt);
    await wait(STRUCTURAL_SAVE_MS + 100);
    assert.equal(fixture.state.writes.length, 1, "twelve switches in under two seconds make one write and no echo writes");
    const counted = takeSessionWrites();
    assert.deepEqual([counted.session_writes, counted.session_cosmetic_writes], [1, 1]);
    assert.ok(counted.session_kb_written >= 1);
  } finally {
    fixture.restore();
  }
});

test("a structural change during the volatile wait is written within the structural delay, with the switch", async () => {
  const fixture = await persistedTabs();
  try {
    takeSessionWrites();
    fixture.S().activate(fixture.ids[1]);
    await wait(150);
    const changedAt = Date.now();
    fixture.S().updateTab(fixture.ids[2], { url: "https://example.test/moved" });
    assert.ok(await waitFor(() => fixture.state.writes.length > 0, VOLATILE_SAVE_MS));
    assert.ok(Date.now() - changedAt < STRUCTURAL_SAVE_MS + 150, `${Date.now() - changedAt} ms`);
    assert.equal(fixture.state.disk.tabs[fixture.ids[2]].url, "https://example.test/moved");
    assert.equal(fixture.state.disk.windows.main.activeTabIds.default, fixture.ids[1]);
    const counted = takeSessionWrites();
    assert.deepEqual([counted.session_writes, counted.session_cosmetic_writes], [1, 0]);
  } finally {
    fixture.restore();
  }
});

for (const [name, trigger] of [
  ["hiding the window", (fixture) => fixture.hide()],
  ["quitting", async (fixture) => { fixture.state.final(); await wait(5); }],
  ["a flush before a window opens or closes", (fixture) => fixture.persistence.flush()],
  ["tearing persistence down", async (fixture) => { fixture.persistence(); await wait(5); }],
]) {
  test(`${name} writes a pending volatile change at once`, async () => {
    const fixture = await persistedTabs();
    try {
      fixture.S().activate(fixture.ids[3]);
      fixture.S().updateTab(fixture.ids[3], { title: "Shown last" });
      await trigger(fixture);
      assert.equal(fixture.state.writes.length, 1);
      assert.equal(fixture.state.writes[0].session.windows.main.activeTabIds.default, fixture.ids[3]);
      assert.equal(fixture.state.writes[0].session.tabs[fixture.ids[3]].title, "Shown last");
    } finally {
      fixture.restore();
    }
  });
}

test("a crash during a burst of switches restores every tab, window, group and pin of the last structural save", async () => {
  const fixture = await persistedTabs();
  try {
    const S = fixture.S;
    const added = S().newTab("main", { url: "https://example.test/added", background: true });
    S().updateTab(fixture.ids[1], { pin: { as: "row" } });
    S().activate(fixture.ids[2]);
    const group = S().createGroup([fixture.ids[3]], { name: "Kept" });
    assert.ok(group);
    assert.ok(await waitFor(() => fixture.state.writes.length > 0, STRUCTURAL_SAVE_MS + 300));
    await wait(20);
    const structural = cloneSessionValue(fixture.state.disk);
    for (const id of [fixture.ids[0], added, fixture.ids[3]]) {
      S().activate(id);
      S().updateTab(id, { title: `Burst ${id}` });
      await wait(50);
    }
    const crashed = cloneSessionValue(fixture.state.disk);
    assert.deepEqual(crashed, structural, "the burst is still inside its volatile wait");
    const relaunched = initialLinuxSession({ bootstrap: { windowId: "main", profileId: "default", startup: true } }, linuxSessionShape(crashed));
    useBrowser.getState().hydrate(relaunched);
    const restored = useBrowser.getState();
    for (const id of [...fixture.ids, added]) assert.ok(restored.tabs[id], `tab ${id} restored`);
    assert.deepEqual(restored.windows.main.tabIds.filter((id) => [...fixture.ids, added].includes(id)).sort(), [...fixture.ids, added].sort());
    assert.deepEqual(restored.tabs[fixture.ids[1]].pin, { as: "row" });
    assert.equal(restored.windows.main.activeTabIds.default, fixture.ids[2]);
    assert.ok(restored.groups[group]);
    assert.ok(restored.groups[group].tabIds.includes(fixture.ids[3]));
  } finally {
    fixture.restore();
  }
});

test("an echo of the session just written is settled without merging it again", async () => {
  const fixture = await persistedTabs();
  try {
    fixture.S().updateTab(fixture.ids[1], { url: "https://example.test/echo" });
    assert.ok(await waitFor(() => fixture.state.writes.length > 0, STRUCTURAL_SAVE_MS + 300));
    await wait(20);
    const reads = fixture.state.reads - fixture.state.readsAtWrite;
    assert.ok(reads <= 2, `${reads} store reads for the reply and its event`);
    await wait(STRUCTURAL_SAVE_MS + 100);
    assert.equal(fixture.state.writes.length, 1);
  } finally {
    fixture.restore();
  }
});

test("a reply that carries another window's change is still merged into this window", async () => {
  const fixture = await persistedTabs();
  try {
    fixture.state.disk = { ...fixture.state.disk, settings: { ...fixture.state.disk.settings, sidebarWidth: 444 } };
    fixture.S().activate(fixture.ids[2]);
    await fixture.hide();
    await wait(20);
    assert.equal(fixture.S().settings.sidebarWidth, 444);
    assert.equal(fixture.state.disk.windows.main.activeTabIds.default, fixture.ids[2]);
  } finally {
    fixture.restore();
  }
});

test("a switch made while its predecessor's write is in flight is saved after the reply that matches the earlier write", async () => {
  const fixture = await persistedTabs({ holdWrites: true });
  try {
    fixture.S().activate(fixture.ids[1]);
    await fixture.hide();
    assert.equal(fixture.state.held.length, 1);
    fixture.S().activate(fixture.ids[2]);
    fixture.state.held.shift()();
    await wait(20);
    assert.equal(fixture.state.disk.windows.main.activeTabIds.default, fixture.ids[1]);
    fixture.state.hold = false;
    assert.ok(await waitFor(() => fixture.state.disk.windows.main.activeTabIds.default === fixture.ids[2], VOLATILE_SAVE_MS + 300));
    assert.equal(fixture.state.writes.length, 2);
  } finally {
    fixture.restore();
  }
});

test("closing the window saves a switch still waiting in the volatile delay before the seal", async () => {
  const fixture = await closeSessionFixture();
  try {
    const second = useBrowser.getState().newTab("main", { url: "https://example.test/second", background: true });
    await fixture.persistence.flush();
    useBrowser.getState().activate(second);
    fixture.answer({ decision: "allow", suppressWarning: false });
    await fixture.coordinator.accept(closeRequest());
    assert.equal(fixture.state.canonical.windows.main.activeTabIds.default, second);
    assert.deepEqual(fixture.state.log.filter(([step]) => step !== "write").map(([step]) => step), ["begin", "quiesce", "seal"]);
  } finally {
    fixture.restore();
  }
});

for (const eventFirst of [false, true]) {
  test(`a switch made while a structural save is in flight keeps its volatile wait and label through that save's ${eventFirst ? "event and then its reply" : "reply and then its event"}`, async () => {
    const fixture = await persistedTabs({ holdWrites: true, eventFirst });
    try {
      takeSessionWrites();
      fixture.S().updateTab(fixture.ids[3], { url: "https://example.test/moved" });
      await fixture.hide();
      assert.equal(fixture.state.held.length, 1);
      fixture.state.hold = false;
      const switched = Date.now();
      fixture.S().activate(fixture.ids[1]);
      fixture.state.held.shift()();
      await wait(500);
      assert.equal(fixture.state.writes.length, 1, "the switch still waits after the structural save settles");
      fixture.S().activate(fixture.ids[2]);
      assert.ok(await waitFor(() => fixture.state.writes.length > 1, VOLATILE_SAVE_MS));
      const elapsed = Date.now() - switched;
      assert.ok(elapsed >= VOLATILE_SAVE_MS - 100 && elapsed < VOLATILE_SAVE_MS + 300, `the switches were written ${elapsed} ms after the first`);
      await wait(STRUCTURAL_SAVE_MS + 100);
      assert.equal(fixture.state.writes.length, 2, "both switches share one write");
      assert.equal(fixture.state.disk.windows.main.activeTabIds.default, fixture.ids[2]);
      assert.equal(fixture.state.disk.tabs[fixture.ids[3]].url, "https://example.test/moved");
      const counted = takeSessionWrites();
      assert.deepEqual([counted.session_writes, counted.session_cosmetic_writes], [2, 1]);
    } finally {
      fixture.restore();
    }
  });
}

for (const eventFirst of [false, true]) {
  test(`a new tab whose save is queued behind an in-flight save is written as soon as that save settles, even after a switch, with its ${eventFirst ? "event and then its reply" : "reply and then its event"}`, async () => {
    const fixture = await persistedTabs({ holdWrites: true, eventFirst });
    try {
      takeSessionWrites();
      fixture.S().updateSettings({ sidebarWidth: 299 });
      await fixture.hide();
      assert.equal(fixture.state.held.length, 1);
      const made = fixture.S().newTab("main", { url: "https://example.test/structural", background: true });
      await wait(STRUCTURAL_SAVE_MS + 70);
      assert.equal(fixture.state.writes.length, 1, "the new tab's save waits behind the held one");
      fixture.S().activate(fixture.ids[2]);
      fixture.state.hold = false;
      const released = Date.now();
      fixture.state.held.shift()();
      assert.ok(await waitFor(() => fixture.state.disk.tabs[made], STRUCTURAL_SAVE_MS), "the new tab reaches disk within the structural delay of the release");
      assert.ok(Date.now() - released < 150, `${Date.now() - released} ms after the release`);
      assert.equal(fixture.state.disk.windows.main.activeTabIds.default, fixture.ids[2]);
      await wait(VOLATILE_SAVE_MS + 100);
      assert.equal(fixture.state.writes.length, 2, "the settings save, then one save with the tab and the switch");
      const counted = takeSessionWrites();
      assert.deepEqual([counted.session_writes, counted.session_cosmetic_writes], [2, 0]);
    } finally {
      fixture.restore();
    }
  });
}

const utf8Kilobytes = (session) => Math.round(new TextEncoder().encode(JSON.stringify(session)).byteLength / 1024);

for (const final of [false, true]) {
  test(`session_kb_written counts the UTF-8 size of the merged session the native side acknowledged${final ? " at quit" : ""}`, async () => {
    const fixture = await persistedTabs();
    try {
      takeSessionWrites();
      fixture.state.disk = { ...fixture.state.disk, tabs: { ...fixture.state.disk.tabs, [fixture.ids[3]]: { ...fixture.state.disk.tabs[fixture.ids[3]], title: "界".repeat(4096) } } };
      fixture.S().updateTab(fixture.ids[1], { url: "https://example.test/acknowledged" });
      if (final) fixture.state.final();
      else await fixture.persistence.flush();
      await wait(10);
      assert.equal(fixture.state.writes.length, 1);
      const counted = takeSessionWrites();
      assert.equal(counted.session_writes, 1);
      assert.ok(utf8Kilobytes(fixture.state.disk) >= 12);
      assert.equal(counted.session_kb_written, utf8Kilobytes(fixture.state.disk));
    } finally {
      fixture.restore();
    }
  });
}

test("a rejected save counts as no write, and its successful retry counts once", async () => {
  const fixture = await persistedTabs();
  try {
    takeSessionWrites();
    fixture.state.failures = 1;
    fixture.S().updateTab(fixture.ids[2], { url: "https://example.test/retried" });
    await assert.rejects(fixture.persistence.flush(), /disk write rejected/);
    assert.deepEqual(takeSessionWrites(), { session_writes: 0, session_cosmetic_writes: 0, session_kb_written: 0 });
    await fixture.persistence.flush();
    assert.equal(fixture.state.writes.length, 2);
    assert.equal(fixture.state.disk.tabs[fixture.ids[2]].url, "https://example.test/retried");
    const counted = takeSessionWrites();
    assert.deepEqual([counted.session_writes, counted.session_cosmetic_writes], [1, 0]);
    assert.ok(counted.session_kb_written >= 1);
  } finally {
    fixture.restore();
  }
});

for (const rejected of [false, true]) {
  test(`the final save at quit counts ${rejected ? "nothing when it is rejected" : "once when it is acknowledged"}`, async () => {
    const fixture = await persistedTabs();
    try {
      takeSessionWrites();
      fixture.state.failures = rejected ? 1 : 0;
      fixture.S().activate(fixture.ids[2]);
      fixture.state.final();
      await wait(20);
      assert.equal(fixture.state.writes.length, 1);
      const counted = takeSessionWrites();
      assert.deepEqual([counted.session_writes, counted.session_cosmetic_writes], rejected ? [0, 0] : [1, 1]);
    } finally {
      fixture.restore();
    }
  });
}
