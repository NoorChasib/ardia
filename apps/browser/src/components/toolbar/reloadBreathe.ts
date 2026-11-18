import { useEffect, useMemo, useRef, type RefCallback } from "react";
import { Animated } from "react-native";
import { curve } from "../ui";
import { RELOAD_BUTTON_MOTION } from "./tokens";

export function useReloadBreathe(breathing: boolean): { style: object; ref?: RefCallback<unknown> } {
  const breatheMotion = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!breathing) return;
    const halfCycle = RELOAD_BUTTON_MOTION.breatheCycle / 2;
    const breathe = Animated.loop(Animated.sequence([
      Animated.timing(breatheMotion, { toValue: 1, duration: halfCycle, easing: curve.pulse, useNativeDriver: true }),
      Animated.timing(breatheMotion, { toValue: 0, duration: halfCycle, easing: curve.pulse, useNativeDriver: true }),
    ]));
    breathe.start();
    return () => {
      breathe.stop();
      breatheMotion.stopAnimation();
      breatheMotion.setValue(0);
    };
  }, [breatheMotion, breathing]);
  const style = useMemo(() => ({
    opacity: breatheMotion.interpolate({ inputRange: [0, 1], outputRange: [...RELOAD_BUTTON_MOTION.breatheOpacity] }),
    transform: [{ scale: breatheMotion.interpolate({ inputRange: [0, 1], outputRange: [...RELOAD_BUTTON_MOTION.breatheScale] }) }],
  }), [breatheMotion]);
  return { style };
}
