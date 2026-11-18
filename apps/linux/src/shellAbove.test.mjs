import assert from "node:assert/strict";
import test from "node:test";
import { domRegionDeps, shellFrameCounts } from "./shellAbove.ts";

const host = { bootstrap: { windowId: "w", profileId: "default", capabilities: [] }, invoke: async () => null, onEvent: () => () => {} };

function tree() {
  const node = (parent) => {
    const self = { parentElement: parent, children: [], listeners: new Map() };
    self.contains = (other) => { for (let n = other; n; n = n.parentElement) if (n === self) return true; return false; };
    self.addEventListener = (type, run) => self.listeners.set(type, run);
    self.removeEventListener = (type) => self.listeners.delete(type);
    return self;
  };
  const body = node(null);
  const slider = node(body);
  const overlay = node(slider);
  const row = node(overlay);
  return { body, slider, overlay, row };
}

test("an overlay is watched for its own subtree and for style or class changes on every ancestor", () => {
  const previous = globalThis.MutationObserver;
  const observed = [];
  let fire = () => {};
  let disconnected = false;
  globalThis.MutationObserver = class {
    constructor(callback) { fire = callback; }
    observe(target, options) { observed.push({ target, options }); }
    disconnect() { disconnected = true; }
  };
  try {
    const { body, slider, overlay } = tree();
    let changes = 0;
    const stop = domRegionDeps(host).watch(overlay, () => changes++);
    assert.deepEqual(observed.map(({ target }) => target), [overlay, slider, body]);
    assert.deepEqual(observed[0].options, { subtree: true, childList: true, attributes: true });
    for (const { options } of observed.slice(1)) assert.deepEqual(options, { attributes: true, attributeFilter: ["style", "class"] });
    fire([]);
    assert.equal(changes, 1);
    assert.ok(overlay.listeners.has("transitionrun"));
    stop();
    assert.equal(disconnected, true);
    assert.equal(overlay.listeners.size, 0);
  } finally {
    globalThis.MutationObserver = previous;
  }
});

test("an animation on an overlay's ancestor or inside it counts as the overlay moving; one elsewhere doesn't", () => {
  const previous = globalThis.document;
  const { body, slider, overlay, row } = tree();
  const other = { contains: (n) => n === other };
  let target = null;
  globalThis.document = { getAnimations: () => (target ? [{ playState: "running", effect: { target } }] : []) };
  try {
    const animating = domRegionDeps(host).animating;
    for (const [moving, expected] of [[slider, true], [body, true], [row, true], [other, false], [null, false]]) {
      target = moving;
      assert.equal(animating([overlay]), expected);
    }
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("an animation inside [data-ardia-paint-motion] isn't the overlay moving", () => {
  const previous = globalThis.document;
  const { overlay, row } = tree();
  const pill = { ...row, closest: (selector) => (selector === "[data-ardia-paint-motion]" ? pill : null) };
  pill.parentElement = overlay;
  globalThis.document = { getAnimations: () => [{ playState: "running", effect: { target: pill } }] };
  try {
    assert.equal(domRegionDeps(host).animating([overlay]), false);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("the hourly frame counts are what happened since the last take", () => {
  let status = { flushes: 10, sequence: 2 };
  let viewport = { frames: 7, measures: 9 };
  const counts = shellFrameCounts({ status: () => status }, () => viewport);
  assert.deepEqual(counts.take(), { linux_viewport_frames: 7, linux_viewport_measures: 9, linux_region_flushes: 10, linux_region_sends: 2, linux_long_frames: 0, linux_long_frame_ms: 0 });
  status = { flushes: 13, sequence: 2 };
  viewport = { frames: 10, measures: 12 };
  assert.deepEqual(counts.take(), { linux_viewport_frames: 3, linux_viewport_measures: 3, linux_region_flushes: 3, linux_region_sends: 0, linux_long_frames: 0, linux_long_frame_ms: 0 });
  counts.stop();
});
