import { useCallback, useEffect, useRef, type RefCallback } from "react";
import { curve } from "../../browser/src/components/ui/motion";
import { cssEasing } from "../../browser/src/components/ui/cssMotion";
import { RELOAD_BUTTON_MOTION } from "../../browser/src/components/toolbar/tokens";
import { breatheKeyframes, breatheTiming, loopOnCompositor, PAINT_MOTION_ATTRIBUTE, type BreatheSpec } from "./paintMotion";

const BREATHE: BreatheSpec = {
  cycle: RELOAD_BUTTON_MOTION.breatheCycle,
  opacity: RELOAD_BUTTON_MOTION.breatheOpacity,
  scale: RELOAD_BUTTON_MOTION.breatheScale,
  easing: cssEasing(curve.pulse),
};
const KEYFRAMES = breatheKeyframes(BREATHE);
const TIMING = breatheTiming(BREATHE);
const RESTING = { opacity: BREATHE.opacity[0], transform: [{ scale: BREATHE.scale[0] }] };

export function useReloadBreathe(breathing: boolean): { style: object; ref?: RefCallback<unknown> } {
  const node = useRef<HTMLElement | null>(null);
  const ref = useCallback((view: unknown) => {
    node.current = view as HTMLElement | null;
    node.current?.setAttribute?.(PAINT_MOTION_ATTRIBUTE, "");
  }, []);
  useEffect(() => {
    const element = node.current;
    if (!breathing || !element?.animate) return;
    const loop = loopOnCompositor(element, KEYFRAMES, TIMING);
    return () => loop.cancel();
  }, [breathing]);
  return { style: RESTING, ref };
}
