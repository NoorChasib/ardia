import assert from "node:assert/strict";
import test from "node:test";
import { createInputRegions } from "./inputRegions.ts";
import { PAINT_MOTION_SELECTOR } from "./paintMotion.ts";
import { STACKED_PAGE, refreshTabViewports, requestViewportFrame, tabViewport, viewportCounts, watchTabViewport } from "./hostViewport.ts";

const GLOBALS = ["window", "document", "getComputedStyle", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver"];
const box = (x, y, width, height) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });

function stage({ width = 1280, height = 800, elementFromPoint, querySelector = () => null, getAnimations }) {
  const previous = Object.fromEntries(GLOBALS.map((key) => [key, globalThis[key]]));
  const frames = [];
  const events = { window: new EventTarget(), document: new EventTarget(), visual: new EventTarget() };
  let mutated = () => {};
  let resized = () => {};
  let disconnected = false;
  globalThis.window = Object.assign(events.window, { innerWidth: width, innerHeight: height, visualViewport: events.visual });
  globalThis.document = Object.assign(events.document, { documentElement: {}, hidden: false, querySelector, elementFromPoint, ...(getAnimations ? { getAnimations } : {}) });
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  globalThis.ResizeObserver = class { constructor(callback) { resized = callback; } observe() {} unobserve() {} disconnect() { disconnected = true; } };
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.MutationObserver = class { constructor(callback) { mutated = callback; } observe() {} disconnect() {} };
  return {
    events,
    frames,
    disconnected: () => disconnected,
    resize: (targets) => resized(targets.map((target) => ({ target }))),
    notify: () => mutated([]),
    mutate: () => {
      mutated([]);
      frames.shift()?.();
    },
    restore: () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

const cover = (overlays = []) => ({
  overlayAt: (x, y) => overlays.some(({ rect }) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height),
  overlayElements: () => overlays.map(({ element }) => element),
});

test("a page viewport is a plain rect that follows scroll, visual zoom and document visibility", () => {
  let rect = box(200, 50, 800, 600);
  const element = { isConnected: true, parentElement: null, getBoundingClientRect: () => rect, contains: () => false };
  const s = stage({ elementFromPoint: () => element });
  try {
    const updates = [];
    const stop = watchTabViewport(element, () => true, (update) => updates.push(update), cover());
    assert.deepEqual(updates.at(-1), { rect: { x: 200, y: 50, width: 800, height: 600 }, visible: true });
    rect = box(250, 50, 800, 600);
    s.events.window.dispatchEvent(new Event("scroll"));
    assert.equal(updates.at(-1).rect.x, 250);
    rect = box(250, 50, 720, 600);
    s.events.visual.dispatchEvent(new Event("resize"));
    assert.equal(updates.at(-1).rect.width, 720);
    document.hidden = true;
    s.events.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(updates.at(-1).visible, false);
    document.hidden = false;
    s.events.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(updates.at(-1).visible, true);
    assert.ok(updates.every((update) => !("occlusions" in update)));
    stop();
    assert.equal(s.disconnected(), true);
    const count = updates.length;
    s.events.window.dispatchEvent(new Event("scroll"));
    assert.equal(updates.length, count);
  } finally {
    s.restore();
  }
});

test("a registered overlay over a page keeps it shown; anything else covering it, or a hidden ancestor, hides it", () => {
  const page = { isConnected: true, parentElement: null, getBoundingClientRect: () => box(190, 47, 1083, 846), contains: (node) => node === page };
  const menu = { element: {}, rect: { x: 180, y: 40, width: 260, height: 400 } };
  const sheet = {};
  let over = page;
  const s = stage({ elementFromPoint: (x, y) => (x < 440 && y < 440 ? sheet : over) });
  try {
    const overlays = [menu];
    const updates = [];
    const stop = watchTabViewport(page, () => true, (update) => updates.push(update), cover(overlays));
    assert.equal(updates.at(-1).visible, true);
    overlays.length = 0;
    s.mutate();
    assert.equal(updates.at(-1).visible, false);
    overlays.push(menu);
    over = sheet;
    s.mutate();
    assert.equal(updates.at(-1).visible, false);
    over = page;
    globalThis.getComputedStyle = () => ({ display: "block", visibility: "hidden", opacity: "1" });
    s.mutate();
    assert.equal(updates.at(-1).visible, false);
    stop();
  } finally {
    s.restore();
  }
});

test("a page partly under a page stacked above it stays shown, as the source under Peek's card does; one wholly under it is hidden", () => {
  const page = { isConnected: true, parentElement: null, getBoundingClientRect: () => box(190, 50, 1241, 841), contains: (node) => node === page };
  const peekPage = { closest: (selector) => (selector === STACKED_PAGE ? peekPage : null) };
  const sheet = { closest: () => null };
  const scrim = { element: {}, rect: { x: 190, y: 9, width: 1241, height: 882 } };
  let hit = () => peekPage;
  const s = stage({ width: 1440, height: 900, elementFromPoint: (x, y) => hit(x, y) });
  try {
    const overlays = [scrim];
    const updates = [];
    const coverage = { overlayAt: (x, y) => x < 267 || x >= 1354 || y < 96 || y >= 833 ? cover(overlays).overlayAt(x, y) : false, overlayElements: () => overlays.map(({ element }) => element) };
    const stop = watchTabViewport(page, () => true, (update) => updates.push(update), coverage);
    assert.equal(updates.at(-1).visible, true, "corners under the scrim and the middle under the peek page keep the source live");
    overlays.length = 0;
    s.mutate();
    assert.equal(updates.at(-1).visible, false, "with every point under another page, the page is hidden");
    hit = (x) => (x > 600 && x < 1000 ? peekPage : sheet);
    overlays.push(scrim);
    s.mutate();
    assert.equal(updates.at(-1).visible, true);
    overlays.length = 0;
    s.mutate();
    assert.equal(updates.at(-1).visible, false, "a plain shell element over a corner still hides it");
    stop();
  } finally {
    s.restore();
  }
});

test("an open extension popup's outside-click layer over the page keeps the page shown", () => {
  const page = { isConnected: true, parentElement: null, getBoundingClientRect: () => box(190, 47, 763, 1026), contains: (node) => node === page };
  const dismiss = { contains: (node) => node === dismiss };
  let open = true;
  const s = stage({ width: 953, height: 1080, elementFromPoint: () => (open ? dismiss : {}), querySelector: (selector) => (open && selector === '[data-testid="ardia-extension-popup-dismiss"]' ? dismiss : null) });
  try {
    const updates = [];
    const stop = watchTabViewport(page, () => true, (update) => updates.push(update), cover());
    assert.equal(updates.at(-1).visible, true);
    open = false;
    s.mutate();
    assert.equal(updates.at(-1).visible, false);
    stop();
  } finally {
    s.restore();
  }
});

test("an idle page is not measured again, and an animation on an ancestor or a registered overlay is followed once per frame until it ends", async () => {
  let x = 200;
  let measured = 0;
  const page = { isConnected: true, parentElement: null, getBoundingClientRect: () => { measured++; return box(x, 47, 763, 900); }, contains: (node) => node === page };
  const card = { contains: (node) => node === card };
  let running = null;
  const s = stage({ width: 1280, height: 1000, elementFromPoint: () => page, getAnimations: () => (running ? [{ playState: "running", effect: { target: running } }] : []) });
  try {
    const updates = [];
    const stop = watchTabViewport(page, () => true, (update) => updates.push(update), cover([{ element: card, rect: { x: 0, y: 0, width: 0, height: 0 } }]));
    assert.equal(measured, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(measured, 1);
    assert.equal(s.frames.length, 0);
    for (const target of [{ contains: (node) => node === page }, card]) {
      running = target;
      document.dispatchEvent(new Event("transitionrun"));
      assert.equal(s.frames.length, 1);
      for (const next of [180, 160, 140]) {
        x = next;
        s.frames.shift()();
        assert.equal(s.frames.length, 1);
        assert.equal(updates.at(-1).rect.x, next);
      }
      running = null;
      x = 120;
      s.frames.shift()();
      assert.equal(updates.at(-1).rect.x, 120);
      assert.equal(s.frames.length, 0);
    }
    const settled = measured;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(measured, settled);
    stop();
  } finally {
    s.restore();
  }
});

test("a page rect off the window or not finite is reported hidden", () => {
  const size = { width: 1280, height: 800 };
  assert.deepEqual(tabViewport({ x: 10, y: 10, width: 100, height: 100 }, size, true), { rect: { x: 10, y: 10, width: 100, height: 100 }, visible: true });
  assert.equal(tabViewport({ x: 1300, y: 10, width: 100, height: 100 }, size, true).visible, false);
  assert.deepEqual(tabViewport({ x: Number.NaN, y: 0, width: 1, height: 1 }, size, true), { rect: { x: 0, y: 0, width: 0, height: 0 }, visible: false });
  assert.equal(tabViewport({ x: 10, y: 10, width: 100, height: 100 }, size, false).visible, false);
});

function slot(x, counts) {
  const element = { isConnected: true, parentElement: null, closest: () => null };
  element.getBoundingClientRect = () => {
    counts.set(element, (counts.get(element) ?? 0) + 1);
    return box(x, 47, element.width ?? 1000, 800);
  };
  element.contains = (node) => node === element;
  return element;
}

const targeted = (type, target) => {
  const event = new Event(type);
  Object.defineProperty(event, "target", { value: target });
  return event;
};

test("a hundred watched tabs cost one frame, one measure of the shown tab and one region flush per mutation, sharing the frame the regions asked for", () => {
  const counts = new Map();
  const pages = Array.from({ length: 100 }, (_, index) => slot(200 + index, counts));
  const s = stage({ width: 1440, height: 900, elementFromPoint: () => pages[0] });
  const microtasks = [];
  const drain = () => { while (microtasks.length) microtasks.shift()(); };
  let stops = [];
  try {
    const menu = { getBoundingClientRect: () => box(10, 10, 150, 200), children: [], contains: (node) => node === menu };
    const regions = createInputRegions({
      send: null, viewport: () => ({ width: 1440, height: 900 }), rectOf: (element) => element.getBoundingClientRect(), receivesPointer: () => true,
      watch: () => () => {}, animating: () => false, conceal: () => {}, microtask: (run) => microtasks.push(run), frame: requestViewportFrame,
      frameTime: () => 0, timeout: () => 0, clearTimeout: () => {},
    });
    const reports = new Map();
    stops = pages.map((page, index) => watchTabViewport(page, () => index === 0, () => {
      reports.set(page, (reports.get(page) ?? 0) + 1);
      regions.refresh();
    }, regions));
    drain();
    regions.addOverlay(menu);
    drain();
    assert.equal(s.frames.length, 1, "the overlay's settle frame is pending");
    reports.clear();
    counts.clear();
    const before = regions.status().flushes;
    const measuresBefore = viewportCounts().measures;
    s.notify();
    s.notify();
    document.dispatchEvent(new Event("transitionrun"));
    assert.equal(s.frames.length, 1, "mutations and motion join the frame already asked for");
    s.frames.shift()();
    drain();
    assert.deepEqual([...reports.values()], [1]);
    assert.equal(reports.get(pages[0]), 1);
    assert.deepEqual([...counts.keys()], [pages[0]], "only the shown tab's slot was measured");
    assert.equal(viewportCounts().measures - measuresBefore, 1);
    assert.equal(regions.status().flushes - before, 1, "one flush for the watcher pass and the overlay's own frame together");
  } finally {
    for (const stop of stops) stop();
    while (s.frames.length) {
      s.frames.shift()();
      drain();
    }
    assert.equal(viewportCounts().watchers, 0);
    s.restore();
  }
});

test("a resize the frame's pass already measured neither reports nor flushes again; one it didn't see does both", () => {
  const counts = new Map();
  const pages = Array.from({ length: 20 }, (_, index) => slot(200 + index, counts));
  const s = stage({ width: 1440, height: 900, elementFromPoint: () => pages[0] });
  const microtasks = [];
  const drain = () => { while (microtasks.length) microtasks.shift()(); };
  let stops = [];
  try {
    const regions = createInputRegions({
      send: null, viewport: () => ({ width: 1440, height: 900 }), rectOf: (element) => element.getBoundingClientRect(), receivesPointer: () => true,
      watch: () => () => {}, animating: () => false, conceal: () => {}, microtask: (run) => microtasks.push(run), frame: requestViewportFrame,
      frameTime: () => 0, timeout: () => 0, clearTimeout: () => {},
    });
    const reports = [];
    stops = pages.map((page, index) => watchTabViewport(page, () => index === 0, (update) => {
      if (index === 0) reports.push(update);
      regions.refresh();
    }, regions));
    s.resize(pages);
    drain();
    const startReports = reports.length;
    const before = regions.status().flushes;
    assert.equal(startReports, 1, "the first resize report of every new watcher repeats its first measure, so it is skipped");
    pages[0].width = 960;
    s.notify();
    s.frames.shift()();
    drain();
    s.resize([pages[0]]);
    drain();
    assert.equal(reports.length - startReports, 1, "the frame's pass already saw the new width");
    assert.equal(regions.status().flushes - before, 1, "one flush at the frame time");
    pages[0].width = 920;
    s.resize([pages[0]]);
    drain();
    assert.equal(reports.at(-1).rect.width, 920, "a size the pass didn't see is reported before paint");
    assert.equal(regions.status().flushes - before, 2);
  } finally {
    for (const stop of stops) stop();
    while (s.frames.length) {
      s.frames.shift()();
      drain();
    }
    s.restore();
  }
});

test("a hidden tab isn't measured on a mutation, but is on a full refresh, its own refresh, its own resize and when it is shown", () => {
  const counts = new Map();
  const shown = slot(200, counts);
  const hidden = slot(200, counts);
  const other = slot(200, counts);
  let hiddenVisible = false;
  const s = stage({ width: 1440, height: 900, elementFromPoint: () => (hiddenVisible ? hidden : shown) });
  let stops = [];
  try {
    const reports = [];
    stops = [
      watchTabViewport(shown, () => true, () => {}, cover()),
      watchTabViewport(hidden, () => hiddenVisible, (update) => reports.push(update), cover()),
      watchTabViewport(other, () => false, () => {}, cover()),
    ];
    counts.clear();
    s.mutate();
    assert.equal(counts.get(hidden), undefined);
    assert.equal(counts.get(shown), 1);
    refreshTabViewports();
    s.frames.shift()();
    assert.equal(counts.get(hidden), 1);
    assert.equal(counts.get(other), 1);
    refreshTabViewports(hidden);
    s.frames.shift()();
    assert.equal(counts.get(hidden), 2);
    assert.equal(counts.get(other), 1, "a refresh for one tab leaves the other hidden tabs alone");
    hidden.width = 900;
    s.resize([hidden]);
    assert.equal(counts.get(hidden), 3);
    assert.equal(reports.at(-1).rect.width, 900);
    assert.equal(counts.get(other), 1);
    hiddenVisible = true;
    s.mutate();
    assert.equal(counts.get(hidden), 4);
    assert.equal(reports.at(-1).visible, true);
    hiddenVisible = false;
    s.mutate();
    assert.equal(reports.at(-1).visible, false, "a tab that was shown is measured once more to report it hidden");
    s.mutate();
    assert.equal(counts.get(hidden), 5);
  } finally {
    for (const stop of stops) stop();
    s.restore();
  }
});

test("a scroll in the sidebar waits for the next frame; a scroll in something holding a page measures it at once", () => {
  const counts = new Map();
  const page = slot(200, counts);
  const sidebar = { contains: () => false };
  const pageScroller = { contains: (node) => node === page };
  const s = stage({ width: 1440, height: 900, elementFromPoint: () => page });
  let stop = () => {};
  try {
    stop = watchTabViewport(page, () => true, () => {}, cover());
    counts.clear();
    s.events.window.dispatchEvent(targeted("scroll", sidebar));
    assert.equal(counts.get(page), undefined);
    assert.equal(s.frames.length, 1);
    s.frames.shift()();
    assert.equal(counts.get(page), 1);
    s.events.window.dispatchEvent(targeted("scroll", pageScroller));
    assert.equal(counts.get(page), 2);
    assert.equal(s.frames.length, 0);
  } finally {
    stop();
    s.restore();
  }
});

test("an animation inside [data-ardia-paint-motion] keeps no frames alive and its motion events ask for none", () => {
  const counts = new Map();
  const page = slot(200, counts);
  const painted = { closest: (selector) => (selector === PAINT_MOTION_SELECTOR ? painted : null), contains: () => true };
  let running = painted;
  const s = stage({ width: 1440, height: 900, elementFromPoint: () => page, getAnimations: () => (running ? [{ playState: "running", effect: { target: running } }] : []) });
  let stop = () => {};
  try {
    stop = watchTabViewport(page, () => true, () => {}, cover([{ element: { contains: () => true }, rect: { x: 0, y: 0, width: 0, height: 0 } }]));
    assert.equal(s.frames.length, 0);
    document.dispatchEvent(targeted("animationstart", painted));
    assert.equal(s.frames.length, 0);
    s.mutate();
    assert.equal(s.frames.length, 0, "the paint-only loop doesn't make the shown page follow it");
    running = { closest: () => null, contains: (node) => node === page };
    s.mutate();
    assert.equal(s.frames.length, 1, "a real ancestor animation still does");
    running = null;
    s.frames.shift()();
  } finally {
    stop();
    s.restore();
  }
});

test("one measuring pass reads the overlay rects once for every shown tab and every probe point", () => {
  const counts = new Map();
  const pages = [slot(200, counts), slot(220, counts), slot(240, counts)];
  const s = stage({ width: 1440, height: 900, elementFromPoint: (x) => pages.find((page) => page.getBoundingClientRect().x <= x) });
  let stops = [];
  try {
    let reads = 0;
    const regions = { overlayRects: () => (reads++, [{ x: 0, y: 0, width: 100, height: 100 }]), overlayAt: () => assert.fail("overlayAt re-measures"), overlayElements: () => [] };
    stops = pages.map((page) => watchTabViewport(page, () => true, () => {}, regions));
    reads = 0;
    s.mutate();
    assert.equal(reads, 1);
  } finally {
    for (const stop of stops) stop();
    s.restore();
  }
});
