import assert from "node:assert/strict";
import { test } from "node:test";
import { mock } from "bun:test";
import { mount } from "../../test-hooks.mjs";

Bun.plugin({ name: "png", setup: (build) => build.onLoad({ filter: /\.png$/ }, ({ path }) => ({ exports: { default: { uri: path } }, loader: "object" })) });
mock.module("react-native/Libraries/Animated/useAnimatedProps", () => ({ default: () => [{}, () => {}] }));
const { useListMotion } = await import("./ListMotion.tsx");

function churn(t, cycles) {
  const dev = globalThis.__DEV__;
  globalThis.__DEV__ = true;
  t.after(() => {
    globalThis.__DEV__ = dev;
    delete globalThis.sidebarMotion;
  });
  const from = { pending: null };
  const kept = ["tab:a", "tab:b"];
  let entries = [...kept];
  const list = mount((props) => useListMotion("churn", "p", props.entries, from, true), { props: { entries } });
  t.after(() => list.unmount());
  const held = [];
  let peak = 0;
  for (let c = 0; c < cycles; c++) {
    const opened = Array.from({ length: 50 }, (_, i) => `tab:c${c}-${i}`);
    entries = [...kept, ...opened];
    list.rerender({ entries });
    list.value.slideBelow(kept[0], 34);
    list.rerender({ entries });
    for (const key of entries) {
      const motion = list.value.motion(key);
      if (!motion) continue;
      const stop = motion.clip.subscribe(() => {});
      if (key === opened[0]) held.push(stop);
      else stop();
    }
    peak = Math.max(peak, globalThis.sidebarMotion.churn.sources.size);
    entries = [...kept];
    list.rerender({ entries });
  }
  return { list, maps: globalThis.sidebarMotion.churn, held, peak };
}

test("closing rows drops their clip sources and empty watcher sets, so six churn cycles of 50 tabs keep only live rows", (t) => {
  const { list, maps, held, peak } = churn(t, 6);
  assert.ok(peak > 50, `the opened rows had clip sources while they slid (${peak})`);
  const kept = new Set(["tab:a", "tab:b", "~tail"]);
  const stray = [...maps.sources.keys()].filter((key) => !kept.has(key));
  assert.deepEqual(stray, [], "no source outlives its row");
  const leftover = [...maps.watchers.keys()].filter((key) => !kept.has(key));
  assert.equal(leftover.length, held.length, "only a row that is still subscribed keeps its watcher set");
  assert.ok(maps.sources.size <= 3);
  for (const stop of held) stop();
  list.rerender({ entries: ["tab:a"] });
  assert.deepEqual([...maps.watchers.keys()].filter((key) => !kept.has(key)), [], "a closed row's set goes at the next list change once its row has unsubscribed");
});

test("a closed row that comes back slides and clips again", (t) => {
  const { list, maps, held } = churn(t, 1);
  for (const stop of held) stop();
  const back = ["tab:a", "tab:b", "tab:c0-0", "tab:c0-1"];
  list.rerender({ entries: back });
  list.value.slideBelow("tab:b", 34);
  list.rerender({ entries: back });
  const motion = list.value.motion("tab:c0-0");
  assert.ok(motion, "the returning row moves");
  assert.equal(motion.clip, maps.sources.get("tab:c0-0"));
  assert.equal(motion.clip.clipped(), true, "and is clipped while the rows below it slide");
  const stop = motion.clip.subscribe(() => {});
  assert.equal(maps.watchers.get("tab:c0-0").size, 1);
  stop();
});
