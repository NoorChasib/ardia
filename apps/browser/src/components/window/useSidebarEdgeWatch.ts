import { useEffect, useRef, useState } from "react";
import { onWindowEvent, watchSidebarEdge } from "../../state/windows/nativeWindow";
import { noteSidebarPeekRevealHeldBack, noteSidebarPeekRevealWaitAbandoned, noteSidebarScreenEdge } from "../../state/telemetry/dockCounts";
import { atRevealEdge, edgeEventReveals, edgeSeen, type DockState, type EdgeArm } from "./dockMotion";
import { edgeProbe } from "./revealWait";

type Ref<T> = { current: T };
type EdgePeek = { showAfterWait(confirm?: (go: () => void) => void): void; waiting(): boolean; abandonWait(): void; hide(atEdge: boolean): void };
type EdgeAt = { state: DockState; right: boolean; windowWidth: number; band: number };
export type EdgeWatch = { windowId: string; watching: boolean; hold: number; right: boolean; whilePressed: boolean; peekLive: boolean };

export function useSidebarEdgeWatch(watch: EdgeWatch, at: Ref<EdgeAt>, peek: Ref<EdgePeek>, edgeOver: Ref<boolean>, arm: Ref<EdgeArm>) {
  const { windowId, watching, hold, right, whilePressed, peekLive } = watch;
  const latest = useRef(watch);
  latest.current = watch;
  const [probe] = useState(() =>
    edgeProbe(() => {
      const w = latest.current;
      if (w.watching) watchSidebarEdge(w.windowId, true, w.hold, w.right, w.whilePressed);
      return w.watching;
    }),
  );
  const confirmAtEdge = (go: () => void) => {
    if (!probe.confirm(go)) noteSidebarPeekRevealWaitAbandoned();
  };
  const reveal = () => {
    if (!arm.current.armed) return noteSidebarPeekRevealHeldBack();
    peek.current.showAfterWait(confirmAtEdge);
    if (peek.current.waiting()) probe.track();
  };
  const reply = {
    reveal: () => arm.current.armed && peek.current.showAfterWait(confirmAtEdge),
    retreat: (waitEnded: boolean) => (waitEnded ? noteSidebarPeekRevealWaitAbandoned() : peek.current.abandonWait()),
    waiting: () => peek.current.waiting(),
  };
  const latestReveal = useRef(reveal);
  latestReveal.current = reveal;
  const latestReply = useRef(reply);
  latestReply.current = reply;
  useEffect(() => {
    if (!watching || peekLive) probe.stop();
  }, [watching, peekLive]);
  useEffect(() => () => probe.stop(), []);
  useEffect(() => {
    if (!watching) return;
    const sub = onWindowEvent((e) => {
      if (e.type !== "sidebarEdge" || e.id !== windowId) return;
      if (e.screenEdge) noteSidebarScreenEdge(e.screenEdge);
      const now = at.current;
      const atEdge = e.over || arm.current.strip;
      const inBand = atEdge && atRevealEdge(e.point[0], now.right, now.windowWidth, now.band);
      const answered = probe.answer(inBand, atEdge, latestReply.current);
      if (e.over && !edgeEventReveals(now.state, e.point[0], now.right, now.windowWidth, now.band)) return;
      edgeOver.current = e.over;
      arm.current = edgeSeen(arm.current, "native", e.over);
      if (answered) return void (!e.over && !inBand && peek.current.hide(arm.current.strip));
      if (e.over) latestReveal.current();
      else peek.current.hide(arm.current.strip);
    });
    watchSidebarEdge(windowId, true, hold, right, whilePressed);
    return () => {
      sub.remove();
      watchSidebarEdge(windowId, false);
      edgeOver.current = false;
    };
  }, [windowId, watching, hold, right, whilePressed]);
  return reveal;
}
