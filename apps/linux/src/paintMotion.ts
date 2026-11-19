export const PAINT_MOTION_ATTRIBUTE = "data-nilla-paint-motion";
export const PAINT_MOTION = { nillaPaintMotion: "" };
export const PAINT_MOTION_SELECTOR = `[${PAINT_MOTION_ATTRIBUTE}]`;

export type Timing = { duration: number; easing: string };
export type Animatable = { animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation };

let compositorLoops = 0;

export function loopOnCompositor(target: Animatable, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  compositorLoops++;
  return target.animate(keyframes, options);
}

export function takeCompositorLoopCounts() {
  const counts = { linux_compositor_load_loops: compositorLoops };
  compositorLoops = 0;
  return counts;
}

export type SweepMotion = { travel: number; sweep: Timing; rest: number };
export type PillMotionSpec = SweepMotion & { show: Timing; hide: Timing; leaveScale: number };

const shifted = (x: number) => `translateX(${x}px)`;
const scaled = (scale: number) => `scale(${scale})`;

export const sweepCycle = ({ sweep, rest }: SweepMotion) => 2 * sweep.duration + rest;

export function sweepKeyframes(spec: SweepMotion): Keyframe[] {
  const cycle = sweepCycle(spec);
  const grown = spec.sweep.duration / cycle;
  return [
    { offset: 0, transform: shifted(-spec.travel), easing: spec.sweep.easing },
    { offset: grown, transform: shifted(0), easing: spec.sweep.easing },
    { offset: 2 * grown, transform: shifted(spec.travel) },
    { offset: 1, transform: shifted(spec.travel) },
  ];
}

export function growKeyframes(spec: SweepMotion): Keyframe[] {
  return [{ transform: shifted(-spec.travel) }, { transform: shifted(0) }];
}

export type BreatheSpec = { cycle: number; opacity: readonly [number, number]; scale: readonly [number, number]; easing: string };

export function breatheKeyframes({ opacity, scale, easing }: BreatheSpec): Keyframe[] {
  return [
    { opacity: opacity[0], transform: scaled(scale[0]), easing },
    { opacity: opacity[1], transform: scaled(scale[1]), easing },
    { opacity: opacity[0], transform: scaled(scale[0]) },
  ];
}

export const breatheTiming = ({ cycle }: BreatheSpec): KeyframeAnimationOptions => ({ duration: cycle, iterations: Infinity });

export type MotionPreference = {
  addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
};

export function onReduceMotion(preference: MotionPreference | null, reduce: () => void) {
  if (!preference) return () => {};
  const changed = (event: { matches: boolean }) => {
    if (event.matches) reduce();
  };
  preference.addEventListener("change", changed);
  return () => preference.removeEventListener("change", changed);
}

export type PillDeps = {
  plate: Animatable;
  fill: Animatable;
  opacity: () => number;
  timeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export function createPillMotion(deps: PillDeps, spec: PillMotionSpec) {
  const cycle = sweepCycle(spec);
  let sweep: Animation | null = null;
  let cyclic = false;
  let fade: Animation | null = null;
  let leaving: unknown = null;

  const fadeTo = (opacity: number, scale: number, timing: Timing) => {
    const from = deps.opacity();
    fade?.cancel();
    fade = deps.plate.animate([{ opacity: from, transform: scaled(1) }, { opacity, transform: scaled(scale) }], { ...timing, fill: "forwards" });
    return fade;
  };
  const cancelLeave = () => {
    if (leaving === null) return;
    deps.clearTimeout(leaving);
    leaving = null;
  };
  const growing = () => {
    if (!sweep || sweep.playState === "finished") return 0;
    const elapsed = Number(sweep.currentTime ?? 0);
    return spec.sweep.duration - (cyclic ? elapsed % cycle : elapsed);
  };

  return {
    show(reduced: boolean) {
      cancelLeave();
      fadeTo(1, 1, spec.show);
      sweep?.cancel();
      cyclic = !reduced;
      sweep = reduced
        ? deps.fill.animate(growKeyframes(spec), { ...spec.sweep, fill: "forwards" })
        : loopOnCompositor(deps.fill, sweepKeyframes(spec), { duration: cycle, iterations: Infinity });
    },
    leave(gone: () => void) {
      cancelLeave();
      leaving = deps.timeout(() => {
        leaving = null;
        if (sweep) {
          sweep.pause();
          sweep.currentTime = spec.sweep.duration;
        }
        const shrink = fadeTo(0, spec.leaveScale, spec.hide);
        shrink.finished.then(() => fade === shrink && gone(), () => {});
      }, Math.max(0, growing()));
    },
    endAfterThisCycle() {
      if (!sweep || !cyclic || sweep.playState !== "running") return;
      const cyclesBegun = Math.floor(Number(sweep.currentTime ?? 0) / cycle) + 1;
      sweep.effect?.updateTiming({ iterations: cyclesBegun, fill: "forwards" });
    },
    cancelLeave,
    stop() {
      cancelLeave();
      sweep?.cancel();
      fade?.cancel();
      sweep = null;
      fade = null;
    },
  };
}

export type PillMotion = ReturnType<typeof createPillMotion>;
