import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
const { shellNativeModules, windows } = await import("../../test-native/shell.ts");
const { usePeek } = await import("./usePeek.ts");
const { useSidebarEdgeWatch } = await import("./useSidebarEdgeWatch.ts");
const { EDGE_ARMED, PEEK_EDGE_STRIP, TAB_DRAG_EDGE_STRIP, edgeSeen, edgeWatchWidth, peekHoldWidth } = await import("./dockMotion.ts");
const { peekHeld, watchHolds } = await import("../../state/app/transientUi.ts");
const { useTabDrag } = await import("../../state/drag/tabDragStore.ts");

const WIDTH = 1200;
const SIDEBAR = 240;
const REACH = 24;
const HOLD = peekHoldWidth(SIDEBAR, 0);

function macWatcher() {
  const native = { x: 600, watching: false, over: false, hold: 0, whilePressed: false, buttonHeld: false, wasPressed: false, pressedInside: false, unreported: false };
  const inZone = () => native.x >= -REACH && native.x < native.hold;
  const check = () => {
    if (!native.watching) return;
    const pressed = native.buttonHeld;
    if (pressed && !native.wasPressed) native.pressedInside ||= native.over && native.whilePressed;
    native.wasPressed = pressed;
    if (!pressed) native.pressedInside = false;
    const now = (pressed && native.pressedInside) || ((native.whilePressed || !pressed) && inZone());
    const fresh = native.unreported;
    native.unreported = false;
    if (!fresh && now === native.over) return;
    native.over = now;
    const point = [native.x, 94];
    setTimeout(() => windows.emit({ type: "sidebarEdge", id: "w", over: now, point }), 1);
  };
  const button = (type) => {
    if (type === "down") {
      native.buttonHeld = true;
      native.pressedInside ||= native.over && native.whilePressed;
    } else if (type === "dragged") native.buttonHeld = true;
    else {
      native.buttonHeld = false;
      native.pressedInside = false;
    }
  };
  shellNativeModules.NillaAppWindows.watchSidebarEdge = (id, on, hold = 0, right = false, whilePressed = false) => {
    if (!on) Object.assign(native, { watching: false, over: false });
    else {
      Object.assign(native, { watching: true, hold, whilePressed, unreported: true });
      check();
    }
    return Promise.resolve();
  };
  return {
    native,
    point: (x) => {
      native.x = x;
      check();
    },
    mouse: (type, x = native.x) => {
      native.x = x;
      button(type);
      check();
    },
  };
}

function dock({ speed }) {
  const edgeOver = React.useRef(false);
  const arm = React.useRef(EDGE_ARMED);
  const draggingTab = useTabDrag((d) => d.phase === "tab" && d.windowId === "w");
  const peek = usePeek(true, false, () => edgeOver.current || peekHeld("w"), () => {}, () => {}, speed);
  const latestPeek = React.useRef(peek);
  latestPeek.current = peek;
  React.useEffect(() => (peek.live ? watchHolds("peek", () => latestPeek.current.recheck()) : undefined), [peek.live]);
  const holding = peek.live && !peek.leaving;
  const at = React.useRef(null);
  at.current = { state: holding ? "peeking" : peek.live ? "leaving" : "away", right: false, windowWidth: WIDTH, band: draggingTab ? TAB_DRAG_EDGE_STRIP : PEEK_EDGE_STRIP };
  const watch = { windowId: "w", watching: true, hold: edgeWatchWidth(holding, draggingTab, HOLD, 0), right: false, whilePressed: holding || draggingTab, peekLive: peek.live };
  const reveal = useSidebarEdgeWatch(watch, at, latestPeek, edgeOver, arm);
  const strip = (inside) => {
    arm.current = edgeSeen(arm.current, "strip", inside);
    if (inside) reveal();
  };
  return { live: peek.live, leaving: peek.leaving, strip };
}

function harness(t, speed) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const mac = macWatcher();
  const h = mount(dock, { props: { speed } });
  const run = (ms) => {
    for (let i = 0; i < ms; i++) {
      t.mock.timers.tick(1);
      void h.value;
    }
  };
  t.after(() => {
    useTabDrag.setState({ phase: "idle" }, true);
    h.unmount();
  });
  return { mac, h, run };
}

const startTabDrag = () =>
  useTabDrag.setState({ phase: "tab", tabId: "a", tabIds: ["a"], windowId: "w", x: -1, y: -1, lifted: null, onPage: false, target: null, outside: false, overWindow: null, overPoint: null, insert: null, session: {} }, true);
const endTabDrag = () => useTabDrag.setState({ phase: "idle" }, true);

function peekThenDragTabOff(s) {
  s.run(100);
  s.mac.point(1);
  s.h.value.strip(true);
  s.run(600);
  assert.equal(s.h.value.live, true, "the edge opens the peek");
  s.h.value.strip(false);
  s.mac.point(60);
  s.run(200);
  s.mac.mouse("down", 60);
  s.run(80);
  s.mac.mouse("dragged", 100);
  s.run(80);
  s.mac.mouse("dragged", 140);
  startTabDrag();
  s.run(50);
  s.mac.point(HOLD + 160);
  s.mac.mouse("dragged");
}

for (const speed of ["faster", "default", "slower"]) {
  test(`${speed}: a tab dragged off the peek keeps it out while the button is down, the pointer 160 pt past its hold, and it closes once the drag ends there (#1679)`, (t) => {
    const s = harness(t, speed);
    peekThenDragTabOff(s);
    s.run(700);
    assert.equal(s.h.value.live && !s.h.value.leaving, true, "out while the button is down");
    endTabDrag();
    s.mac.mouse("up");
    s.run(600);
    assert.equal(s.h.value.live, false, "closed once the button comes up away from it");
  });

  test(`${speed}: a tab drag off the peek keeps it out even when the edge watcher loses the press and reports the pointer gone (#1679)`, (t) => {
    const s = harness(t, speed);
    peekThenDragTabOff(s);
    s.mac.mouse("moved");
    s.mac.mouse("dragged");
    s.run(700);
    assert.equal(s.mac.native.over, false, "the watcher reported the pointer off its hold with the button still down");
    assert.equal(s.h.value.live && !s.h.value.leaving, true, "still out while the tab drag lasts");
    endTabDrag();
    s.mac.mouse("up");
    s.run(600);
    assert.equal(s.h.value.live, false, "closed once the drag ends away from it");
  });
}
