import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLastingLoad } from "../../browser/src/state/tabs/lastingLoad";
import { notePageOverlay } from "../../browser/src/state/telemetry/usage";
import { capsule, curve, hairline, reduceMotion, useTheme } from "../../browser/src/components/ui";
import { cssEasing } from "../../browser/src/components/ui/cssMotion";
import { HudPlate } from "../../browser/src/components/window/Hud";
import { LOADING_PILL } from "../../browser/src/components/window/tokens";
import { createPillMotion, PAINT_MOTION, type PillMotion, type PillMotionSpec } from "./paintMotion";

const { width, height, top, track, motion } = LOADING_PILL;

const PILL_MOTION: PillMotionSpec = {
  travel: track.width,
  sweep: { duration: motion.sweep.duration, easing: cssEasing(curve.move) },
  rest: motion.rest,
  show: { duration: motion.show.duration, easing: cssEasing(curve.enter) },
  hide: { duration: motion.hide.duration, easing: cssEasing(curve.exit) },
  leaveScale: LOADING_PILL.leaveScale,
};

const domNode = (ref: { current: HTMLElement | null }) => (view: unknown) => void (ref.current = view as HTMLElement | null);

export function LoadingPill({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const loading = useLastingLoad(tabId);
  const [mounted, setMounted] = useState(loading);
  if (loading && !mounted) setMounted(true);
  const plate = useRef<HTMLElement | null>(null);
  const fill = useRef<HTMLElement | null>(null);
  const pill = useRef<PillMotion | null>(null);
  const plateRef = useRef(domNode(plate)).current;
  const fillRef = useRef(domNode(fill)).current;

  useEffect(() => {
    const plateNode = plate.current;
    const fillNode = fill.current;
    if (!mounted || !plateNode?.animate || !fillNode?.animate) return;
    const motionOf = (pill.current ??= createPillMotion(
      {
        plate: plateNode,
        fill: fillNode,
        opacity: () => Number(getComputedStyle(plateNode).opacity),
        timeout: (run, ms) => setTimeout(run, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      PILL_MOTION,
    ));
    if (loading) {
      notePageOverlay("loadingPill");
      const long = setTimeout(() => notePageOverlay("loadingPillLong"), LOADING_PILL.longShowMs);
      motionOf.show(!!reduceMotion());
      return () => clearTimeout(long);
    }
    motionOf.leave(() => {
      pill.current = null;
      setMounted(false);
    });
    return motionOf.cancelLeave;
  }, [loading, mounted]);

  useEffect(() => () => pill.current?.stop(), []);

  if (!mounted) return null;
  const ends = capsule(track.height);
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top, alignItems: "center" }} {...({ dataSet: PAINT_MOTION } as object)}>
      <View ref={plateRef} style={{ opacity: 0, transform: [{ scale: 1 }] }}>
        <HudPlate
          shape="capsule"
          height={height}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading page"
          style={{ width: width + 2 * hairline.panel, height: height + 2 * hairline.panel, alignItems: "center", justifyContent: "center" }}
        >
          <View style={{ width: track.width, height: track.height, borderRadius: ends, backgroundColor: theme.progressTrack, opacity: track.opacity, overflow: "hidden" }} />
          <View style={{ position: "absolute", width: track.width, height: track.height, borderRadius: ends, overflow: "hidden" }}>
            <View
              ref={fillRef}
              style={{
                width: track.width,
                height: track.height,
                backgroundColor: theme.textPrimary,
                opacity: track.fillOpacity,
                transform: [{ translateX: -track.width }],
              }}
            />
          </View>
        </HudPlate>
      </View>
    </View>
  );
}
