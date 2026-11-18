import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { mount } from "../../test-hooks.mjs";

Bun.plugin({ name: "png", setup: (build) => build.onLoad({ filter: /\.png$/ }, ({ path }) => ({ exports: { default: { uri: path } }, loader: "object" })) });

const { useBrowser } = await import("../../state/browser/store.ts");
const { useSelectedRowAway } = await import("./SelectedRowPill.tsx");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function countingSets(render) {
  const sets = [];
  const mounted = mount(() => {
    const dispatcher = internals.H;
    if (!dispatcher.counted) {
      const useState = dispatcher.useState;
      dispatcher.useState = (initial) => {
        const [value, set] = useState(initial);
        return [value, (next) => (sets.push(next), set(next))];
      };
      dispatcher.counted = true;
    }
    return render();
  });
  return { mounted, sets };
}

test("judging the selected row again with the same answer queues no state update", (t) => {
  const { mounted, sets } = countingSets(() => useSelectedRowAway("w", undefined, { current: null }, () => 0));
  t.after(() => mounted.unmount());
  for (let i = 0; i < 977; i++) mounted.value.judge();
  assert.equal(mounted.value.away, null);
  assert.deepEqual(sets, [], "977 rows-moved judgements of a visible row queue nothing");
});

test("the pill still appears when the selected row scrolls out of the list and goes when it comes back, one update each way", (t) => {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const w = S().createWindow({ url: "https://one.ardia.test/" });
  S().setFocusedWindow(w);
  let scrollY = 0;
  const geometry = { current: { viewport: 500, regions: new Proxy({}, { get: () => 0 }), newTabAtTop: false, tilesFixed: false, edgeLift: 0 } };
  const frames = [];
  globalThis.requestAnimationFrame = (run) => frames.push(run);
  globalThis.cancelAnimationFrame = () => {};
  const { mounted, sets } = countingSets(() => useSelectedRowAway(w, geometry, { current: null }, () => scrollY));
  t.after(() => {
    mounted.unmount();
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });
  for (const run of frames.splice(0)) run();
  assert.equal(mounted.value.away, null, "the selected row is on screen");
  scrollY = 10_000;
  for (let i = 0; i < 20; i++) mounted.value.judge();
  assert.equal(mounted.value.away, "above");
  scrollY = 0;
  for (let i = 0; i < 20; i++) mounted.value.judge();
  assert.equal(mounted.value.away, null);
  assert.deepEqual(sets, ["above", null]);
  for (let i = 0; i < 10; i++) {
    S().newTab(w, { url: `https://more-${i}.ardia.test/`, background: true });
    for (const run of frames.splice(0)) run();
  }
  assert.equal(mounted.value.away, null);
  assert.deepEqual(sets, ["above", null], "rows moving under a visible selected row queue nothing");
});
