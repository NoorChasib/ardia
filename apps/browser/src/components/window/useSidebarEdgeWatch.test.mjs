import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
const { shellNativeModules, windows } = await import("../../test-native/shell.ts");
const { usePeek } = await import("./usePeek.ts");
const { useSidebarEdgeWatch } = await import("./useSidebarEdgeWatch.ts");
const { EDGE_ARMED, PEEK_EDGE_STRIP, edgeSeen, peekHoldWidth } = await import("./dockMotion.ts");
const { takeDockCounts } = await import("../../state/telemetry/dockCounts.ts");
const { EDGE_PROBE_IDLE_LIMIT, EDGE_PROBE_MS } = await import("./revealWait.ts");
const { AppState } = await import("react-native");
globalThis.fetch ??= async () => ({ status: 200 });
const client = await import("../../state/telemetry/client.ts");

const WIDTH = 1200;
const PROBE_IDLE_MS = EDGE_PROBE_IDLE_LIMIT * EDGE_PROBE_MS;
const LINUX_STRIP = 8;
const REACH = 24;
const WINDOWS_TICK_MS = 40;

function linuxWatcher() {
  const native = { x: 600, watching: false, over: false, hold: 0, right: false, calls: 0, band: false, bandReports: 0 };
  const inset = () => (native.right ? WIDTH - 1 - native.x : native.x);
  const within = () => inset() >= -REACH && inset() < Math.max(native.hold, LINUX_STRIP);
  const bandable = () => native.hold > 0 && native.hold < LINUX_STRIP;
  const send = (over) => {
    const point = [native.x, 300];
    setTimeout(() => windows.emit({ type: "sidebarEdge", id: "w", over, point }), 1);
  };
  const report = (fresh) => {
    if (native.band && inset() < native.hold) {
      native.band = false;
      native.bandReports++;
      send(true);
    }
    const over = within();
    if (!native.watching || (!fresh && over === native.over)) return;
    native.over = over;
    native.band = over && bandable() && inset() >= native.hold;
    send(over);
  };
  shellNativeModules.NillaAppWindows.watchSidebarEdge = (id, on, hold = 0, right = false) => {
    native.calls++;
    if (!on) Object.assign(native, { watching: false, over: false, band: false });
    else {
      if (hold !== native.hold || right !== native.right) native.band = false;
      Object.assign(native, { watching: true, hold, right });
      report(true);
    }
    return Promise.resolve();
  };
  native.move = (x) => {
    native.x = x;
    report(false);
  };
  return native;
}

function exactHoldWatcher({ answersOnTick }) {
  const native = { x: 600, watching: false, over: false, hold: 0, right: false, calls: 0, unanswered: false };
  const inset = () => (native.right ? WIDTH - 1 - native.x : native.x);
  const within = () => inset() >= -REACH && inset() < native.hold;
  const send = (over) => {
    const point = [native.x, 300];
    setTimeout(() => windows.emit({ type: "sidebarEdge", id: "w", over, point }), 1);
  };
  const report = (fresh) => {
    const over = within();
    if (!native.watching || (!fresh && over === native.over)) return;
    native.over = over;
    send(over);
  };
  if (answersOnTick)
    setInterval(() => {
      if (!native.watching) return;
      const fresh = native.unanswered;
      native.unanswered = false;
      report(fresh);
    }, WINDOWS_TICK_MS);
  shellNativeModules.NillaAppWindows.watchSidebarEdge = (id, on, hold = 0, right = false) => {
    native.calls++;
    if (!on) Object.assign(native, { watching: false, over: false });
    else {
      Object.assign(native, { watching: true, hold, right });
      if (answersOnTick) native.unanswered = true;
      else report(true);
    }
    return Promise.resolve();
  };
  native.move = (x) => {
    native.x = x;
    if (!answersOnTick) report(false);
  };
  return native;
}

const WATCHERS = {
  linux: linuxWatcher,
  mac: () => exactHoldWatcher({ answersOnTick: false }),
  windows: () => exactHoldWatcher({ answersOnTick: true }),
};

function dock({ speed, right, borderless }) {
  const edgeOver = React.useRef(false);
  const arm = React.useRef(EDGE_ARMED);
  const peek = usePeek(true, false, () => edgeOver.current, () => {}, () => {}, speed);
  const latestPeek = React.useRef(peek);
  latestPeek.current = peek;
  const at = React.useRef(null);
  at.current = { state: peek.live ? "peeking" : "away", right, windowWidth: WIDTH, band: PEEK_EDGE_STRIP };
  const hold = peek.live ? peekHoldWidth(240, 0) : borderless ? PEEK_EDGE_STRIP : 0;
  const watch = { windowId: "w", watching: true, hold, right, whilePressed: peek.live, peekLive: peek.live };
  const reveal = useSidebarEdgeWatch(watch, at, latestPeek, edgeOver, arm);
  const strip = (inside) => {
    arm.current = edgeSeen(arm.current, "strip", inside);
    if (inside) reveal();
    else latestPeek.current.abandonWait();
  };
  return { live: peek.live, strip };
}

function harness(t, { speed = "slower", right = false, borderless = true, platform = "linux" } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const native = WATCHERS[platform]();
  const h = mount(dock, { props: { speed, right, borderless } });
  const edge = (inset) => (right ? WIDTH - 1 - inset : inset);
  let clock = 0;
  const run = (ms) => {
    for (let i = 0; i < ms; i++) {
      t.mock.timers.tick(1);
      clock++;
      void h.value;
    }
  };
  const firstLive = (limit) => {
    const from = clock;
    while (!h.value.live && clock - from < limit) run(1);
    return h.value.live ? clock - from : null;
  };
  t.after(() => h.unmount());
  return { native, h, run, firstLive, at: (inset) => native.move(edge(inset)) };
}

for (const right of [false, true]) {
  const side = right ? "right" : "left";
  for (const borderless of [true, false]) {
    const layout = borderless ? "borderless or page full screen" : "framed";
    test(`Slower, ${side} side, ${layout}: resting in the 3 px band opens it after the wait`, (t) => {
      const s = harness(t, { right, borderless });
      s.run(100);
      s.at(1);
      const ms = s.firstLive(800);
      assert.ok(ms !== null && ms >= 250 && ms < 330, `opened after ${ms} ms`);
    });

    test(`Slower, ${side} side, ${layout}: stepping back to 5 px inside the 8 px native band never opens it`, (t) => {
      const s = harness(t, { right, borderless });
      s.run(100);
      takeDockCounts();
      s.at(1);
      s.run(120);
      s.at(5);
      assert.equal(s.firstLive(1000), null);
      assert.equal(s.native.over, true, "the native watcher still reports the pointer over its 8 px band and never sends an exit");
      const counted = takeDockCounts();
      assert.deepEqual([counted.sidebar_peek_reveal_waits, counted.sidebar_peek_reveal_waits_abandoned], [1, 1], "one wait, counted as abandoned once");
    });

    test(`Slower, ${side} side, ${layout}: a return to the edge after stepping back starts a fresh wait`, (t) => {
      const s = harness(t, { right, borderless });
      s.run(100);
      s.at(1);
      s.run(120);
      s.at(5);
      s.run(150);
      s.at(1);
      const ms = s.firstLive(800);
      assert.ok(ms !== null && ms >= 250 && ms < 330, `opened ${ms} ms after the return, not on the first deadline`);
    });
  }

  for (const borderless of [true, false]) {
    test(`Slower, ${side} side, ${borderless ? "borderless" : "framed"}: resting at 5 px stops asking the native watcher within a second, and a return through the strip starts a fresh wait`, (t) => {
      const s = harness(t, { right, borderless });
      s.run(100);
      s.at(1);
      s.run(120);
      s.at(5);
      s.run(PROBE_IDLE_MS + 4 * EDGE_PROBE_MS);
      const calls = s.native.calls;
      s.run(30_000);
      assert.equal(s.native.calls, calls, "no native call while the pointer rests inside the 8 px band with no wait running");
      assert.equal(s.h.value.live, false);
      s.at(1);
      s.h.value.strip(true);
      const ms = s.firstLive(800);
      assert.ok(ms !== null && ms >= 250 && ms < 330, `opened ${ms} ms after the return`);
    });
  }

  test(`Slower, ${side} side, borderless or page full screen: a return to the edge long after the asking stopped starts a fresh wait from Linux's reveal band, with no strip event and no polling`, (t) => {
    const s = harness(t, { right, borderless: true });
    s.run(100);
    s.at(1);
    s.run(120);
    s.at(5);
    s.run(PROBE_IDLE_MS + 4 * EDGE_PROBE_MS);
    const calls = s.native.calls;
    s.run(2000);
    assert.equal(s.native.calls, calls, "nothing asks the native watcher while the pointer rests at 5 px");
    assert.equal(s.native.band, true, "the reveal band waits for the pointer at the edge");
    takeDockCounts();
    s.at(1);
    const ms = s.firstLive(700);
    assert.ok(ms !== null && ms >= 250 && ms < 330, `opened ${ms} ms after the return`);
    assert.equal(s.native.bandReports, 1);
    assert.equal(takeDockCounts().sidebar_peek_reveal_waits, 1, "one fresh wait");
  });

  for (const speed of ["default", "faster"]) {
    test(`${speed}, ${side} side, borderless or page full screen: a slow approach that stops inside the native band opens it once the pointer reaches the edge`, (t) => {
      const s = harness(t, { speed, right, borderless: true });
      s.run(100);
      s.at(6);
      s.run(500);
      assert.equal(s.h.value.live, false, "6 px is not the edge");
      s.at(1);
      const ms = s.firstLive(50);
      assert.ok(ms !== null && ms <= 2, `opened after ${ms} ms`);
    });
  }

  test(`Slower, ${side} side: resting on the edge while the app is in the background makes one wait, then stops asking until the app comes forward`, (t) => {
    const s = harness(t, { right });
    AppState.currentState = "background";
    t.after(() => (AppState.currentState = "active"));
    s.run(100);
    takeDockCounts();
    s.at(1);
    s.run(250 + 4 * EDGE_PROBE_MS);
    const calls = s.native.calls;
    s.run(10_000);
    s.h.value.strip(true);
    s.run(1_000);
    assert.equal(s.h.value.live, false);
    assert.equal(s.native.calls, calls, "no native call while the wait is over and the peek waits for focus");
    const counted = takeDockCounts();
    assert.deepEqual([counted.sidebar_peek_reveal_waits, counted.sidebar_peek_reveal_waits_abandoned], [1, 0], "one wait, and no new one per probe or strip entry");
  });

  test(`Slower, ${side} side: a step back just before the deadline, between two probes, still never opens it`, (t) => {
    const s = harness(t, { right });
    s.run(100);
    s.at(1);
    s.run(245);
    s.at(5);
    assert.equal(s.firstLive(1000), null);
  });

  test(`Slower, ${side} side: arriving from past the window's edge still opens it after the wait`, (t) => {
    const s = harness(t, { right });
    s.run(100);
    s.at(-10);
    const ms = s.firstLive(800);
    assert.ok(ms !== null && ms >= 250 && ms < 330, `opened after ${ms} ms`);
  });

  test(`Slower, ${side} side: going on to 12 px, past the native band, never opens it`, (t) => {
    const s = harness(t, { right });
    s.run(100);
    s.at(1);
    s.run(120);
    s.at(12);
    assert.equal(s.firstLive(1000), null);
  });

  test(`Default, ${side} side: the edge opens it on the first report, with no probing, and a step back keeps it out`, (t) => {
    const s = harness(t, { speed: "default", right });
    s.run(100);
    const calls = s.native.calls;
    s.at(1);
    const ms = s.firstLive(50);
    assert.ok(ms !== null && ms <= 2, `opened after ${ms} ms`);
    s.run(10);
    s.at(5);
    s.run(600);
    assert.equal(s.h.value.live, true);
    assert.equal(s.native.calls - calls, 2, "only the hold-width change re-watches the edge: off, then on");
  });
}

test("Slower with the shell's strip and no native band (macOS framed): the strip alone confirms the wait, and leaving it ends the wait", (t) => {
  const s = harness(t, { borderless: false });
  shellNativeModules.NillaAppWindows.watchSidebarEdge = (id, on, hold = 0) => {
    if (on) setTimeout(() => windows.emit({ type: "sidebarEdge", id: "w", over: hold > PEEK_EDGE_STRIP && s.native.x < hold, point: [s.native.x, 300] }), 1);
    return Promise.resolve();
  };
  s.run(100);
  s.native.x = 1;
  s.h.value.strip(true);
  const ms = s.firstLive(800);
  assert.ok(ms !== null && ms >= 250 && ms < 330, `opened after ${ms} ms`);
});

test("Slower with the shell's strip on macOS framed: stepping back off the strip never opens it", (t) => {
  const s = harness(t, { borderless: false });
  shellNativeModules.NillaAppWindows.watchSidebarEdge = (id, on) => {
    if (on) setTimeout(() => windows.emit({ type: "sidebarEdge", id: "w", over: false, point: [s.native.x, 300] }), 1);
    return Promise.resolve();
  };
  s.run(100);
  s.native.x = 1;
  s.h.value.strip(true);
  s.run(120);
  s.native.x = 5;
  s.h.value.strip(false);
  assert.equal(s.firstLive(1000), null);
});

for (const late of [false, true]) {
  test(`a Slower wait that started before sharing turned on is never counted as abandoned ${late ? "at its deadline" : "on a step back"}`, (t) => {
    client.loadChoice();
    client.setSharing(false, "settings");
    t.after(() => client.setSharing(false, "settings"));
    const s = harness(t);
    s.run(100);
    s.at(1);
    s.run(late ? 245 : 120);
    client.setSharing(true, "settings");
    takeDockCounts();
    s.at(12);
    s.run(1000);
    assert.equal(s.h.value.live, false);
    assert.equal(takeDockCounts().sidebar_peek_reveal_waits_abandoned, 0);
  });
}

test("a Slower wait started while sharing still counts its abandon", (t) => {
  client.loadChoice();
  client.setSharing(true, "settings");
  t.after(() => client.setSharing(false, "settings"));
  const s = harness(t);
  s.run(100);
  takeDockCounts();
  s.at(1);
  s.run(120);
  s.at(12);
  s.run(1000);
  const counted = takeDockCounts();
  assert.deepEqual([counted.sidebar_peek_reveal_waits, counted.sidebar_peek_reveal_waits_abandoned], [1, 1]);
});

for (const platform of ["mac", "windows"])
  for (const right of [false, true])
    for (const borderless of [true, false]) {
      const name = `${platform === "mac" ? "macOS" : "Windows"}'s watcher, ${right ? "right" : "left"} side, ${borderless ? "strip off" : "strip on"}`;
      const enter = (s) => {
        s.at(1);
        if (!borderless) s.h.value.strip(true);
      };
      const stepBack = (s) => {
        s.at(5);
        if (!borderless) s.h.value.strip(false);
      };
      const latest = platform === "windows" ? 250 + 3 * WINDOWS_TICK_MS : 330;

      test(`${name}: Slower resting on the edge opens it after the wait`, (t) => {
        const s = harness(t, { platform, right, borderless });
        s.run(100);
        enter(s);
        const ms = s.firstLive(900);
        assert.ok(ms !== null && ms >= 250 && ms < latest, `opened after ${ms} ms`);
      });

      test(`${name}: Slower stepping back never opens it, the asking stops, and a late return starts a fresh wait`, (t) => {
        const s = harness(t, { platform, right, borderless });
        s.run(100);
        enter(s);
        s.run(120);
        stepBack(s);
        assert.equal(s.firstLive(1500), null);
        const calls = s.native.calls;
        s.run(5000);
        assert.equal(s.native.calls, calls, "no native call while the pointer rests off the edge");
        enter(s);
        const ms = s.firstLive(900);
        assert.ok(ms !== null && ms >= 250 && ms < latest, `the late return opened after ${ms} ms`);
      });

      test(`${name}: Default opens it at once`, (t) => {
        const s = harness(t, { platform, speed: "default", right, borderless });
        s.run(100);
        enter(s);
        const ms = s.firstLive(300);
        assert.ok(ms !== null && ms < 2 * WINDOWS_TICK_MS, `opened after ${ms} ms`);
      });
    }
