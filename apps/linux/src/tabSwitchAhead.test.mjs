import assert from "node:assert/strict";
import test from "node:test";
import { HostTab } from "./hostTab.ts";
import { forgetSwitchViews, registerSwitchView, takeSwitchAheadCounts, tabsSwitchedAhead, watchTabSwitches } from "./tabSwitchAhead.ts";

const RECT = { x: 240, y: 8, width: 1192, height: 884 };

function stage() {
  forgetSwitchViews();
  const sent = [];
  let nextId = 10;
  const host = {
    bootstrap: { windowId: "main", profileId: "default" },
    call: async () => "null",
    invoke: (method, args) => {
      sent.push({ method, args });
      if (method === "tab.create") { nextId++; return Promise.resolve({ browserId: nextId, chromeTabId: nextId }); }
      return Promise.resolve(null);
    },
    onEvent: () => () => {},
  };
  const listeners = new Set();
  let state = { windows: { main: { profileId: "default", activeTabIds: { default: "a" } } } };
  const store = {
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    activate: (id) => {
      const previous = state;
      state = { windows: { main: { ...state.windows.main, activeTabIds: { default: id } } } };
      for (const listener of listeners) listener(state, previous);
    },
  };
  const regions = new Map();
  const view = async (key) => {
    const tab = new HostTab(host, { key, url: `https://${key}.test/` }, () => {});
    await tab.ready;
    const slot = { key };
    registerSwitchView(key, { tab: () => tab, slot, regions: { setPage: (node, visible) => regions.set(node.key, visible) } });
    return tab;
  };
  return { host, sent, store, view, regions };
}

test("activating a tab shows it in the shown tab's place before the shell renders", async () => {
  const { sent, store, view, regions } = stage();
  const a = await view("a");
  const b = await view("b");
  await a.viewport({ rect: RECT, visible: true });
  await b.viewport({ rect: RECT, visible: false });
  const stop = watchTabSwitches(store);
  sent.length = 0;
  store.activate("b");
  assert.deepEqual(sent.map((call) => call.method), ["tab.presentations", "tab.viewport", "tab.viewport"]);
  assert.deepEqual(sent[0].args.tabs.map((tab) => [tab.id, tab.visible]), [[b.identity.browserId, true], [a.identity.browserId, false]]);
  assert.deepEqual({ id: sent[1].args.id, rect: sent[1].args.rect, visible: sent[1].args.visible }, { id: b.identity.browserId, rect: RECT, visible: true });
  assert.deepEqual({ id: sent[2].args.id, visible: sent[2].args.visible }, { id: a.identity.browserId, visible: false });
  assert.deepEqual([...regions], [["b", true], ["a", false]]);
  assert.equal(tabsSwitchedAhead(), 1);
  sent.length = 0;
  await b.viewport({ rect: RECT, visible: true });
  await a.viewport({ rect: RECT, visible: false });
  assert.deepEqual(sent, []);
  stop();
});

test("a split or an unshown source tab waits for the shell's own layout", async () => {
  const { sent, store, view } = stage();
  const a = await view("a");
  const b = await view("b");
  const c = await view("c");
  const stop = watchTabSwitches(store);
  sent.length = 0;
  store.activate("b");
  assert.deepEqual(sent, []);
  await a.viewport({ rect: RECT, visible: true });
  await c.viewport({ rect: { ...RECT, x: 800 }, visible: true });
  sent.length = 0;
  store.activate("a");
  store.activate("b");
  assert.deepEqual(sent, []);
  assert.equal(tabsSwitchedAhead(), 0);
  stop();
});

test("a switched-to slot still out of layout keeps the shown page's region until the shell lays it out", async () => {
  const { createInputRegions } = await import("./inputRegions.ts");
  const { sent, store, view } = stage();
  const a = await view("a");
  const b = await view("b");
  await a.viewport({ rect: RECT, visible: true });
  await b.viewport({ rect: RECT, visible: false });
  forgetSwitchViews();
  const EMPTY = { x: 0, y: 0, width: 0, height: 0 };
  const slot = (rect) => ({ rect, isConnected: true, children: [], contains: () => false, getBoundingClientRect: () => slotRects.get(rect) });
  const slotRects = new Map();
  const slotA = slot("a");
  const slotB = slot("b");
  slotRects.set("a", RECT).set("b", EMPTY);
  const microtasks = [];
  const regionsSent = [];
  const holes = [];
  const regions = createInputRegions({
    send: (next) => {
      regionsSent.push(next.pages);
      return Promise.resolve();
    },
    viewport: () => ({ width: 1600, height: 1000 }),
    rectOf: (element) => slotRects.get(element.rect),
    receivesPointer: () => true,
    watch: () => () => {},
    animating: () => false,
    conceal: () => {},
    microtask: (run) => microtasks.push(run),
    frame: () => {},
    frameTime: () => regionsSent.length,
    timeout: () => 0,
    clearTimeout: () => {},
    pagesChanged: (pages) => holes.push(pages.map((page) => page.rect)),
  });
  const flush = async () => {
    while (microtasks.length) microtasks.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  };
  registerSwitchView("a", { tab: () => a, slot: slotA, regions });
  registerSwitchView("b", { tab: () => b, slot: slotB, regions });
  regions.setPage(slotA, true);
  regions.setPage(slotB, false);
  await flush();
  const stop = watchTabSwitches(store);
  sent.length = 0;
  store.activate("b");
  assert.equal(tabsSwitchedAhead(), 1);
  assert.deepEqual(sent.map((call) => call.method), ["tab.presentations", "tab.viewport", "tab.viewport"]);
  await flush();
  slotRects.set("a", EMPTY).set("b", RECT);
  regions.refresh();
  await flush();
  regions.setPage(slotA, false);
  await flush();
  assert.ok(regionsSent.length > 0);
  for (const pages of regionsSent) assert.deepEqual(pages, [RECT]);
  for (const pages of holes) assert.deepEqual(pages, [RECT]);
  assert.deepEqual(takeSwitchAheadCounts(), { linux_switch_aheads: 1, linux_switch_regions_held: 1 });
  assert.deepEqual(takeSwitchAheadCounts(), { linux_switch_aheads: 0, linux_switch_regions_held: 0 });
  stop();
});

test("a switched-to slot already in layout takes over the page region at once", async () => {
  const { store, view, regions } = stage();
  const a = await view("a");
  forgetSwitchViews();
  const b = new HostTab((await view("b")).host, { key: "b2", url: "https://b2.test/" }, () => {});
  await b.ready;
  registerSwitchView("a", { tab: () => a, slot: { key: "a", getBoundingClientRect: () => RECT }, regions: { setPage: (node, visible) => regions.set(node.key, visible) } });
  registerSwitchView("b", { tab: () => b, slot: { key: "b", getBoundingClientRect: () => RECT }, regions: { setPage: (node, visible) => regions.set(node.key, visible) } });
  await a.viewport({ rect: RECT, visible: true });
  await b.viewport({ rect: RECT, visible: false });
  const stop = watchTabSwitches(store);
  regions.clear();
  store.activate("b");
  assert.deepEqual([...regions], [["b", true], ["a", false]]);
  assert.deepEqual(takeSwitchAheadCounts(), { linux_switch_aheads: 1, linux_switch_regions_held: 0 });
  stop();
});
