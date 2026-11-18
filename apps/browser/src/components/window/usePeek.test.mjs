import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
const { Animated } = await import("react-native");
const { usePeek } = await import("./usePeek.ts");
const { ARC_PEEK_SPRING, ARC_PEEK_OUT_MS, SIDEBAR_REVEAL } = await import("./tokens.ts");
const { easeInOutCubic, leftStripInward, PEEK_EDGE_STRIP } = await import("./dockMotion.ts");
const { curve, duration, spring } = await import("../ui/motion.ts");

function recordDriver(t) {
  const calls = [];
  const { spring: realSpring, timing: realTiming } = Animated;
  Animated.spring = (value, config) => (calls.push({ kind: "spring", ...config }), realSpring(value, config));
  Animated.timing = (value, config) => (calls.push({ kind: "timing", ...config }), realTiming(value, config));
  t.after(() => Object.assign(Animated, { spring: realSpring, timing: realTiming }));
  return calls;
}

const peekOf = (speed, arc) => mount((p) => usePeek(true, p.arc, () => false, () => {}, () => {}, p.speed), { props: { speed, arc } });

function revealAndHide(t, speed, arc) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = recordDriver(t);
  const h = peekOf(speed, arc);
  h.value.showAfterWait();
  t.mock.timers.tick(SIDEBAR_REVEAL[speed].waitMs);
  const shown = h.value.live;
  h.value.hide();
  t.mock.timers.tick(300);
  h.unmount();
  return { shown, reveal: calls[0], hide: calls[1], count: calls.length };
}

const TODAYS_ARC_IN = { kind: "spring", toValue: 1, ...spring(ARC_PEEK_SPRING), restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01, useNativeDriver: true };
const TODAYS_ARC_OUT = { kind: "timing", toValue: 0, duration: ARC_PEEK_OUT_MS, easing: easeInOutCubic, useNativeDriver: true };
const diaSlide = (toValue, ms) => ({ kind: "timing", toValue, duration: ms, easing: curve.enter, useNativeDriver: true });

test("Default hands the driver today's exact peek: Dia's 150 ms slide in and out, Arc's measured spring in and 150 ms out", (t) => {
  for (const [arc, reveal, hide] of [[false, diaSlide(1, 150), diaSlide(0, 150)], [true, TODAYS_ARC_IN, TODAYS_ARC_OUT]]) {
    const run = revealAndHide(t, "default", arc);
    assert.equal(run.shown, true);
    assert.equal(run.count, 2);
    assert.deepEqual(run.reveal, reveal, `${arc ? "Arc" : "Dia"} reveal`);
    assert.deepEqual(run.hide, hide, `${arc ? "Arc" : "Dia"} hide`);
    t.mock.timers.reset();
  }
  assert.equal(duration.base, 150);
});

test("Faster hands the driver a 100 ms slide in Dia's layout and the quicker 0.12/0.8 spring in Arc's; the slide out is unchanged", (t) => {
  const dia = revealAndHide(t, "faster", false);
  t.mock.timers.reset();
  const arc = revealAndHide(t, "faster", true);
  assert.deepEqual(dia.reveal, diaSlide(1, 100));
  assert.deepEqual(dia.hide, diaSlide(0, 150));
  assert.deepEqual(arc.reveal, { ...TODAYS_ARC_IN, ...spring({ response: 0.12, damping: 0.8 }) });
  assert.ok(arc.reveal.stiffness > TODAYS_ARC_IN.stiffness);
  assert.deepEqual(arc.hide, TODAYS_ARC_OUT);
});

test("Slower waits 250 ms before the driver starts, then slides exactly like Default", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = recordDriver(t);
  const h = peekOf("slower", false);
  h.value.showAfterWait();
  t.mock.timers.tick(249);
  assert.equal(calls.length, 0);
  assert.equal(h.value.live, false);
  t.mock.timers.tick(1);
  assert.equal(h.value.live, true);
  assert.deepEqual(calls, [diaSlide(1, 150)]);
  h.unmount();
});

test("abandoning the wait stops a pending Slower reveal, and a fresh arrival waits the full 250 ms again", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = recordDriver(t);
  const h = peekOf("slower", false);
  h.value.showAfterWait();
  t.mock.timers.tick(120);
  h.value.abandonWait();
  t.mock.timers.tick(500);
  assert.equal(h.value.live, false);
  assert.equal(calls.length, 0);
  h.value.showAfterWait();
  t.mock.timers.tick(249);
  assert.equal(h.value.live, false);
  t.mock.timers.tick(1);
  assert.equal(h.value.live, true);
  h.value.abandonWait();
  assert.equal(h.value.live, true, "nothing to abandon once it is out");
  h.unmount();
});

test("leaving the edge strip counts as inward only into the window, never out past its edge or along it", () => {
  const W = 1280;
  for (const x of [PEEK_EDGE_STRIP, 5, 12, 400]) assert.equal(leftStripInward(x, false, W), true, `left strip, left at ${x}`);
  for (const x of [-0.5, -30, 0, 2.9, -1e5]) assert.equal(leftStripInward(x, false, W), false, `left strip, left at ${x}`);
  for (const x of [-0.5, -2, -9, -400]) assert.equal(leftStripInward(x, true, W), true, `right strip, left at ${x}`);
  for (const x of [0, 2, PEEK_EDGE_STRIP, 30, -1e5]) assert.equal(leftStripInward(x, true, W), false, `right strip, left at ${x}`);
});
