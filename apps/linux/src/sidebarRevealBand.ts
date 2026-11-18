import { noteSidebarEdgeBandReturn } from "../../browser/src/state/telemetry/dockCounts";
import { inputRegions } from "./shellAbove";
import { emitNativeEvent } from "./shims/expo-modules-core";

export const NATIVE_EDGE_ZONE = 8;

export type RevealBandSide = { hold: number; right: boolean };
export type EdgePoint = [number, number];
export type EdgeReentry = { type: "sidebarEdge"; id: string; over: true; point: EdgePoint };

export type RevealBandDeps = {
  open: (side: RevealBandSide, entered: (point: EdgePoint) => void) => (() => void) | null;
  windowWidth: () => number;
  emit: (report: EdgeReentry) => void;
  noteReturn: () => void;
};

type EdgeReport = { type: "sidebarEdge"; id: string; over: boolean; point: EdgePoint };

const narrowerThanZone = (hold: number) => Number.isFinite(hold) && hold > 0 && hold < NATIVE_EDGE_ZONE;

function isEdgeReport(payload: unknown): payload is EdgeReport {
  if (!payload || typeof payload !== "object") return false;
  const report = payload as Partial<EdgeReport>;
  return report.type === "sidebarEdge" && typeof report.id === "string" && typeof report.over === "boolean" && Array.isArray(report.point) && report.point.length >= 2;
}

export function createRevealBands(deps: RevealBandDeps) {
  const sides = new Map<string, RevealBandSide>();
  const bands = new Map<string, () => void>();

  const close = (id: string) => {
    const release = bands.get(id);
    if (!release) return;
    bands.delete(id);
    release();
  };

  const open = (id: string, side: RevealBandSide) => {
    if (bands.has(id)) return;
    const release = deps.open(side, (point) => {
      if (bands.get(id) !== release) return;
      close(id);
      deps.noteReturn();
      deps.emit({ type: "sidebarEdge", id, over: true, point });
    });
    if (release) bands.set(id, release);
  };

  const outsideBand = ([x, y]: EdgePoint, { hold, right }: RevealBandSide) => {
    if (!(x >= 0 && y >= 0)) return false;
    const width = deps.windowWidth();
    return right ? x < width - hold : x >= hold;
  };

  return {
    watch(id: string, on: boolean, hold: number, right: boolean) {
      const before = sides.get(id);
      if (!on || !narrowerThanZone(hold)) {
        sides.delete(id);
        close(id);
        return;
      }
      if (before && (before.hold !== hold || before.right !== right)) close(id);
      sides.set(id, { hold, right });
    },
    reported(payload: unknown) {
      if (!isEdgeReport(payload)) return;
      const side = sides.get(payload.id);
      if (!side) return;
      if (payload.over && outsideBand(payload.point, side)) open(payload.id, side);
      else close(payload.id);
    },
    opened: (id: string) => bands.has(id),
  };
}

const REENTRY_EVENTS = ["pointerover", "pointermove", "pointerup"] as const;

function openDomBand({ hold, right }: RevealBandSide, entered: (point: EdgePoint) => void) {
  const regions = inputRegions();
  if (!regions || typeof document === "undefined") return null;
  const band = document.createElement("div");
  band.dataset.testid = "ardia-sidebar-reveal-band";
  Object.assign(band.style, {
    position: "fixed",
    top: "0",
    bottom: "0",
    [right ? "right" : "left"]: "0",
    width: `${hold}px`,
    zIndex: "2147483647",
    pointerEvents: "auto",
    background: "transparent",
  });
  const reached = (event: PointerEvent) => {
    if (event.buttons !== 0) return;
    entered([event.clientX, event.clientY]);
  };
  for (const type of REENTRY_EVENTS) band.addEventListener(type, reached);
  document.body.append(band);
  const unregister = regions.addOverlay(band, "box", false);
  return () => {
    for (const type of REENTRY_EVENTS) band.removeEventListener(type, reached);
    unregister();
    band.remove();
  };
}

const revealBands = createRevealBands({
  open: openDomBand,
  windowWidth: () => (typeof window === "undefined" ? 0 : window.innerWidth),
  emit: (report) => emitNativeEvent("ArdiaShell", "onWindowEvent", report),
  noteReturn: noteSidebarEdgeBandReturn,
});

export const sidebarEdgeReported = (payload: unknown) => revealBands.reported(payload);

export function watchingRevealBand(watch: unknown) {
  if (typeof watch !== "function") return watch;
  return (...args: unknown[]) => {
    const [id, on, hold, right] = args;
    if (typeof id === "string") revealBands.watch(id, on === true, typeof hold === "number" ? hold : 0, right === true);
    return (watch as (...args: unknown[]) => unknown)(...args);
  };
}
