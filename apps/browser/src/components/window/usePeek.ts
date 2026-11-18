import { useEffect, useRef, useState } from "react";
import { Animated, AppState } from "react-native";
import { easeInOutCubic, PEEK_CLOSE_DELAY_MS, revealWaitMs } from "./dockMotion";
import { curve, duration, spring } from "../ui/motion";
import { ARC_PEEK_OUT_MS, SIDEBAR_REVEAL } from "./tokens";
import { revealWait } from "./revealWait";
import { backgroundInstance } from "../../state/app/appSettings";
import { noteSidebarPeekRevealWait, noteSidebarPeekRevealWaitAbandoned } from "../../state/telemetry/dockCounts";
import type { SidebarRevealSpeed } from "../../state/settings/settings";

const SLIDE_MS = duration.base;
const ARC_IN = {
  faster: spring(SIDEBAR_REVEAL.faster.arcSpring),
  default: spring(SIDEBAR_REVEAL.default.arcSpring),
  slower: spring(SIDEBAR_REVEAL.slower.arcSpring),
} as const;
const appInFront = () => backgroundInstance || AppState.currentState === "active";

export function usePeek(
  enabled: boolean,
  arc = false,
  held: () => boolean = () => false,
  onSlideOut: () => void = () => {},
  onOpen: (bounce: boolean) => void = () => {},
  speed: SidebarRevealSpeed = "default",
) {
  const slide = useRef(new Animated.Value(0)).current;
  const [live, setLive] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heldBack = useRef(false);
  const out = useRef(false);
  const waitingForFocus = useRef(false);
  const [wait] = useState(revealWait);
  const animate = (to: number, done?: () => void) =>
    (arc
      ? to > 0
        ? Animated.spring(slide, { toValue: to, ...ARC_IN[speed], restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01, useNativeDriver: true })
        : Animated.timing(slide, { toValue: to, duration: ARC_PEEK_OUT_MS, easing: easeInOutCubic, useNativeDriver: true })
      : Animated.timing(slide, { toValue: to, duration: to > 0 ? SIDEBAR_REVEAL[speed].slideMs : SLIDE_MS, easing: curve.enter, useNativeDriver: true })
    ).start(({ finished }) => finished && done?.());
  const slideOut = () => {
    out.current = false;
    setLeaving(true);
    onSlideOut();
    animate(0, () => {
      setLive(false);
      setLeaving(false);
    });
  };
  const show = () => {
    clearTimeout(hideTimer.current);
    wait.cancel();
    heldBack.current = false;
    if (!enabled) return;
    if (!out.current && !appInFront()) {
      waitingForFocus.current = true;
      return;
    }
    waitingForFocus.current = false;
    if (!out.current) onOpen(live);
    out.current = true;
    setLeaving(false);
    setLive(true);
    animate(1);
  };
  const showAfterWait = () => {
    const ms = revealWaitMs(speed, out.current || live);
    if (!ms) return show();
    if (wait.pending()) return;
    noteSidebarPeekRevealWait();
    wait.start(ms, () => latestShow.current());
  };
  const dropWait = (pointerStillAtEdge: boolean) => {
    if (!pointerStillAtEdge && wait.cancel()) noteSidebarPeekRevealWaitAbandoned();
  };
  const cancelPending = (pointerStillAtEdge = false) => {
    waitingForFocus.current &&= pointerStillAtEdge;
    dropWait(pointerStillAtEdge);
  };
  const hide = (pointerStillAtEdge = false) => {
    clearTimeout(hideTimer.current);
    dropWait(pointerStillAtEdge);
    if (!out.current) {
      waitingForFocus.current = false;
      return;
    }
    hideTimer.current = setTimeout(() => {
      heldBack.current = held();
      if (!heldBack.current) slideOut();
    }, PEEK_CLOSE_DELAY_MS);
  };
  const recheck = () => {
    if (!heldBack.current || held()) return;
    heldBack.current = false;
    hide();
  };
  const reset = () => {
    clearTimeout(hideTimer.current);
    slide.stopAnimation();
    slide.setValue(0);
    out.current = false;
    heldBack.current = false;
    waitingForFocus.current = false;
    wait.cancel();
    setLive(false);
    setLeaving(false);
  };
  const latestShow = useRef(show);
  latestShow.current = show;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => state === "active" && waitingForFocus.current && latestShow.current());
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (enabled) return;
    waitingForFocus.current = false;
    wait.cancel();
    clearTimeout(hideTimer.current);
    if (live) slideOut();
  }, [enabled]);
  useEffect(
    () => () => {
      clearTimeout(hideTimer.current);
      wait.cancel();
    },
    [],
  );
  return { slide, live, leaving, show, showAfterWait, hide, recheck, cancelPending, reset };
}
