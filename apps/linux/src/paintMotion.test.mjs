import assert from "node:assert/strict";
import test from "node:test";
import { breatheKeyframes, breatheTiming, createPillMotion, growKeyframes, PAINT_MOTION, PAINT_MOTION_ATTRIBUTE, sweepCycle, sweepKeyframes } from "./paintMotion.ts";

const SPEC = {
  travel: 128,
  sweep: { duration: 330, easing: "linear(0, 0.5, 1)" },
  rest: 330,
  show: { duration: 150, easing: "ease-out" },
  hide: { duration: 250, easing: "ease-in" },
  leaveScale: 0.55,
};

function fakeElement(name, log) {
  return {
    animations: [],
    animate(keyframes, options) {
      let settle;
      const finished = new Promise((resolve, reject) => (settle = { resolve, reject }));
      finished.catch(() => {});
      const animation = {
        name,
        keyframes,
        options,
        currentTime: 0,
        playState: "running",
        finished,
        timing: { ...options },
        effect: {
          updateTiming(change) {
            animation.timing = { ...animation.timing, ...change };
            log.push(`${name}.updateTiming`);
          },
        },
        cancel() {
          if (this.playState === "idle") return;
          this.playState = "idle";
          settle.reject(new Error("cancelled"));
        },
        pause() {
          this.playState = "paused";
        },
        finish() {
          this.playState = "finished";
          settle.resolve(this);
        },
      };
      this.animations.push(animation);
      log.push(`${name}.animate`);
      return animation;
    },
  };
}

function stage() {
  const log = [];
  const timers = new Map();
  let nextTimer = 1;
  let opacity = 0;
  const plate = fakeElement("plate", log);
  const fill = fakeElement("fill", log);
  const motion = createPillMotion({
    plate,
    fill,
    opacity: () => opacity,
    timeout: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  }, SPEC);
  const fire = () => {
    const pending = [...timers.entries()];
    timers.clear();
    for (const [, timer] of pending) timer.run();
    return pending.map(([, timer]) => timer.ms);
  };
  return { log, timers, plate, fill, motion, fire, setOpacity: (value) => (opacity = value) };
}

const last = (element) => element.animations.at(-1);
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the sweep is one compositor loop of grow, wipe and rest with the token timing", () => {
  assert.equal(sweepCycle(SPEC), 990);
  assert.deepEqual(sweepKeyframes(SPEC), [
    { offset: 0, transform: "translateX(-128px)", easing: SPEC.sweep.easing },
    { offset: 1 / 3, transform: "translateX(0px)", easing: SPEC.sweep.easing },
    { offset: 2 / 3, transform: "translateX(128px)" },
    { offset: 1, transform: "translateX(128px)" },
  ]);
  assert.deepEqual(growKeyframes(SPEC), [{ transform: "translateX(-128px)" }, { transform: "translateX(0px)" }]);
});

test("a load starts one infinite sweep and a fade-in, and schedules no frame or timer work while it loops", () => {
  const { log, timers, plate, fill, motion } = stage();
  motion.show(false);
  assert.deepEqual(log, ["plate.animate", "fill.animate"]);
  assert.equal(timers.size, 0);
  assert.deepEqual(last(fill).options, { duration: 990, iterations: Infinity });
  assert.deepEqual(last(plate).keyframes, [{ opacity: 0, transform: "scale(1)" }, { opacity: 1, transform: "scale(1)" }]);
  assert.deepEqual(last(plate).options, { ...SPEC.show, fill: "forwards" });
  last(fill).currentTime = 50 * 990 + 400;
  assert.deepEqual(log, ["plate.animate", "fill.animate"]);
});

test("a load that ends mid-grow finishes the grow, holds the full bar, then shrinks and unmounts", async () => {
  const { timers, plate, fill, motion, fire, setOpacity } = stage();
  motion.show(false);
  const sweep = last(fill);
  sweep.currentTime = 3 * 990 + 100;
  let gone = 0;
  motion.leave(() => gone++);
  assert.deepEqual([...timers.values()].map((timer) => timer.ms), [230]);
  setOpacity(1);
  fire();
  assert.equal(sweep.playState, "paused");
  assert.equal(sweep.currentTime, 330);
  const shrink = last(plate);
  assert.deepEqual(shrink.keyframes, [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.55)" }]);
  assert.deepEqual(shrink.options, { ...SPEC.hide, fill: "forwards" });
  assert.equal(gone, 0);
  shrink.finish();
  await settled();
  assert.equal(gone, 1);
});

test("a load that ends after the grow shrinks at once from the full bar", () => {
  const { timers, fill, motion } = stage();
  motion.show(false);
  last(fill).currentTime = 990 + 500;
  motion.leave(() => {});
  assert.deepEqual([...timers.values()].map((timer) => timer.ms), [0]);
});

test("a new load during the shrink cancels the unmount and fades back in from the current opacity", async () => {
  const { plate, fill, motion, fire, setOpacity } = stage();
  motion.show(false);
  last(fill).currentTime = 700;
  let gone = 0;
  motion.leave(() => gone++);
  fire();
  const shrink = last(plate);
  setOpacity(0.4);
  motion.cancelLeave();
  motion.show(false);
  assert.equal(shrink.playState, "idle");
  assert.deepEqual(last(plate).keyframes[0], { opacity: 0.4, transform: "scale(1)" });
  assert.equal(fill.animations.length, 2);
  assert.equal(fill.animations[0].playState, "idle");
  await settled();
  assert.equal(gone, 0);
});

test("a new load before the grow finishes keeps the pill and restarts the sweep", () => {
  const { timers, fill, motion } = stage();
  motion.show(false);
  last(fill).currentTime = 100;
  motion.leave(() => {});
  motion.cancelLeave();
  assert.equal(timers.size, 0);
  motion.show(false);
  assert.equal(last(fill).currentTime, 0);
  assert.equal(fill.animations[0].playState, "idle");
});

test("reduced motion grows once and keeps the full bar", () => {
  const { timers, fill, motion } = stage();
  motion.show(true);
  assert.deepEqual(last(fill).keyframes, growKeyframes(SPEC));
  assert.deepEqual(last(fill).options, { ...SPEC.sweep, fill: "forwards" });
  last(fill).currentTime = 2000;
  motion.leave(() => {});
  assert.deepEqual([...timers.values()].map((timer) => timer.ms), [0]);
});

test("Reduce Motion turned on mid-load ends the sweep after the cycle it is in and holds, with no timer or frame work", () => {
  const { log, timers, fill, motion } = stage();
  motion.show(false);
  const sweep = last(fill);
  sweep.currentTime = 4 * 990 + 600;
  motion.endAfterThisCycle();
  assert.deepEqual(sweep.timing, { duration: 990, iterations: 5, fill: "forwards" });
  assert.equal(fill.animations.length, 1);
  assert.equal(sweep.playState, "running");
  assert.deepEqual(log, ["plate.animate", "fill.animate", "fill.updateTiming"]);
  assert.equal(timers.size, 0);
});

test("a load that ends after the held sweep shrinks at once from the full bar", () => {
  const { timers, fill, motion, fire } = stage();
  motion.show(false);
  const sweep = last(fill);
  sweep.currentTime = 990 + 100;
  motion.endAfterThisCycle();
  sweep.finish();
  sweep.currentTime = 9000;
  motion.leave(() => {});
  assert.deepEqual([...timers.values()].map((timer) => timer.ms), [0]);
  fire();
  assert.equal(sweep.currentTime, 330);
});

test("Reduce Motion leaves a reduced grow and a leaving pill alone", () => {
  const reducedFromStart = stage();
  reducedFromStart.motion.show(true);
  reducedFromStart.motion.endAfterThisCycle();
  assert.ok(!reducedFromStart.log.includes("fill.updateTiming"));
  const leaving = stage();
  leaving.motion.show(false);
  leaving.motion.leave(() => {});
  leaving.fire();
  leaving.motion.endAfterThisCycle();
  assert.ok(!leaving.log.includes("fill.updateTiming"));
});

test("stop cancels every animation and the pending leave", () => {
  const { timers, plate, fill, motion } = stage();
  motion.show(false);
  motion.leave(() => {});
  motion.stop();
  assert.equal(timers.size, 0);
  assert.equal(last(fill).playState, "idle");
  assert.equal(last(plate).playState, "idle");
});

test("the reload breathe is one infinite loop between the token bounds", () => {
  const spec = { cycle: 1420, opacity: [0.86, 1], scale: [0.96, 1.06], easing: "linear(0, 1)" };
  assert.deepEqual(breatheKeyframes(spec), [
    { opacity: 0.86, transform: "scale(0.96)", easing: "linear(0, 1)" },
    { opacity: 1, transform: "scale(1.06)", easing: "linear(0, 1)" },
    { opacity: 0.86, transform: "scale(0.96)" },
  ]);
  assert.deepEqual(breatheTiming(spec), { duration: 1420, iterations: Infinity });
});

test("the paint-motion data set renders as the attribute the viewport watchers ignore", () => {
  const [key] = Object.keys(PAINT_MOTION);
  assert.equal(`data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, PAINT_MOTION_ATTRIBUTE);
});
