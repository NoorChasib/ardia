import type { TabViewport } from "./hostTab";
import { PAGE_STACK_ATTRIBUTE } from "./pageHoles.ts";
import { PAINT_MOTION_SELECTOR } from "./paintMotion.ts";

export type { TabViewport };

type Bounds = TabViewport["rect"];

const EXTENSION_POPUP_DISMISS = '[data-testid="ardia-extension-popup-dismiss"]';
export const STACKED_PAGE = `[${PAGE_STACK_ATTRIBUTE}] [data-ardia-native-tab]`;
const MOTION_EVENTS = ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"] as const;

export type OverlayCover = { overlayAt: (x: number, y: number) => boolean; overlayElements: () => readonly Element[]; overlayRects?: () => readonly Bounds[] };

type Watcher = { element: HTMLElement; visible: () => boolean; report: (viewport: TabViewport) => void; cover: OverlayCover; shown: boolean; measured?: Bounds };
type Listening = { mutations: MutationObserver; resizes: ResizeObserver; stop: () => void };

const watchers = new Set<Watcher>();
const dirty = new Set<Watcher>();
const frameTasks: (() => void)[] = [];
let frame = 0;
let measureAll = false;
let measureShown = false;
let listening: Listening | null = null;
const counts = { frames: 0, measures: 0 };

export const viewportCounts = () => ({ ...counts, watchers: watchers.size });

export function paintsOnly(target: Element) {
  return typeof target.closest === "function" && target.closest(PAINT_MOTION_SELECTOR) !== null;
}

export function movingTargets(): Element[] {
  const targets: Element[] = [];
  for (const animation of document.getAnimations?.() ?? []) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (animation.playState === "running" && target && !paintsOnly(target)) targets.push(target);
  }
  return targets;
}

export function tabViewport(rect: Bounds, viewport: { width: number; height: number }, visible: boolean): TabViewport {
  const finite = [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
  const intersects = finite && rect.width > 0 && rect.height > 0 && rect.x < viewport.width && rect.y < viewport.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
  return { rect: finite ? { x: rect.x, y: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) } : { x: 0, y: 0, width: 0, height: 0 }, visible: visible && intersects };
}

const inside = (rect: Bounds, x: number, y: number) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

function createPass() {
  let dismiss: HTMLElement | null | undefined;
  let moving: Element[] | undefined;
  const hits = new Map<OverlayCover, (x: number, y: number) => boolean>();
  const overlaysMoving = new Map<OverlayCover, boolean>();
  return {
    dismiss: () => (dismiss === undefined ? (dismiss = document.querySelector<HTMLElement>(EXTENSION_POPUP_DISMISS)) : dismiss),
    overlayAt(cover: OverlayCover, x: number, y: number) {
      let hit = hits.get(cover);
      if (!hit) {
        const rects = cover.overlayRects?.();
        hit = rects ? (px, py) => rects.some((rect) => inside(rect, px, py)) : (px, py) => cover.overlayAt(px, py);
        hits.set(cover, hit);
      }
      return hit(x, y);
    },
    moves(watcher: Watcher) {
      moving ??= movingTargets();
      if (!moving.length) return false;
      if (moving.some((target) => target.contains(watcher.element))) return true;
      let overlays = overlaysMoving.get(watcher.cover);
      if (overlays === undefined) {
        const elements = watcher.cover.overlayElements();
        overlays = moving.some((target) => elements.some((overlay) => overlay.contains(target)));
        overlaysMoving.set(watcher.cover, overlays);
      }
      return overlays;
    },
  };
}

type Pass = ReturnType<typeof createPass>;

function plainViewport(element: HTMLElement, rect: DOMRect, viewport: TabViewport, pass: Pass, cover: OverlayCover): TabViewport {
  if (!viewport.visible) return viewport;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return { ...viewport, visible: false };
  }
  const insetX = Math.min(16, rect.width / 4);
  const insetY = Math.min(16, rect.height / 4);
  const left = Math.max(0, rect.left) + insetX;
  const top = Math.max(0, rect.top) + insetY;
  const right = Math.min(window.innerWidth, rect.right) - insetX;
  const bottom = Math.min(window.innerHeight, rect.bottom) - insetY;
  const dismiss = pass.dismiss();
  const points = [[left, top], [right, top], [left, bottom], [right, bottom], [(left + right) / 2, (top + bottom) / 2]] as const;
  const seen = points.map(([x, y]): "shown" | "page" | "covered" => {
    if (pass.overlayAt(cover, x, y)) return "shown";
    const hit = document.elementFromPoint(x, y);
    if (!hit) return "covered";
    if (hit === element || element.contains(hit) || !!dismiss?.contains(hit)) return "shown";
    return hit.closest?.(STACKED_PAGE) ? "page" : "covered";
  });
  return seen.includes("shown") && !seen.includes("covered") ? viewport : { ...viewport, visible: false };
}

const rethrow = (error: unknown) => void setTimeout(() => {
  throw error;
});

const active = (watcher: Watcher) => watcher.shown || dirty.has(watcher) || watcher.visible();

const sameBounds = (rect: DOMRect, measured: Bounds | undefined) =>
  !!measured && rect.x === measured.x && rect.y === measured.y && rect.width === measured.width && rect.height === measured.height;

function measure(watcher: Watcher, pass: Pass, rect: DOMRect = watcher.element.getBoundingClientRect()) {
  const { element } = watcher;
  watcher.measured = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const viewport = plainViewport(element, rect, tabViewport(rect, { width: window.innerWidth, height: window.innerHeight }, watcher.visible() && !document.hidden && element.isConnected), pass, watcher.cover);
  watcher.shown = viewport.visible;
  counts.measures++;
  watcher.report(viewport);
}

function measureWhere(chosen: (watcher: Watcher) => boolean, rects?: ReadonlyMap<Watcher, DOMRect>) {
  const pass = createPass();
  let follow = false;
  for (const watcher of watchers) {
    if (!chosen(watcher)) continue;
    dirty.delete(watcher);
    try {
      measure(watcher, pass, rects?.get(watcher));
      if (!follow && pass.moves(watcher)) follow = true;
    } catch (error) {
      rethrow(error);
    }
  }
  if (follow) requestMeasure();
}

function runFrame() {
  frame = 0;
  counts.frames++;
  const all = measureAll;
  const shown = measureShown;
  measureAll = false;
  measureShown = false;
  const tasks = frameTasks.splice(0);
  if (all) measureWhere(() => true);
  else if (shown) measureWhere(active);
  for (const task of tasks) {
    try {
      task();
    } catch (error) {
      rethrow(error);
    }
  }
}

function ensureFrame() {
  if (!frame) frame = requestAnimationFrame(runFrame);
}

function requestMeasure(all = false) {
  if (all) measureAll = true;
  measureShown = true;
  ensureFrame();
}

export function requestViewportFrame(run: () => void) {
  frameTasks.push(run);
  ensureFrame();
}

export function refreshTabViewports(element?: Element) {
  if (!element) return requestMeasure(true);
  for (const watcher of watchers) if (watcher.element === element) dirty.add(watcher);
  requestMeasure();
}

function scrolled(event: Event) {
  const scroller = event.target as { contains?: (node: Node) => boolean } | null;
  if (!scroller || typeof scroller.contains !== "function") return measureWhere(active);
  const holding = (watcher: Watcher) => active(watcher) && scroller.contains!(watcher.element);
  for (const watcher of watchers) if (holding(watcher)) return measureWhere(holding);
  requestMeasure();
}

function motion(event: Event) {
  const target = event.target as Element | null;
  if (target && paintsOnly(target)) return;
  requestMeasure();
}

function listen(): Listening {
  const mutated = () => requestMeasure();
  const resized = () => measureWhere(active);
  const shownChanged = () => measureWhere(() => true);
  const mutations = new MutationObserver(mutated);
  mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const resizes = new ResizeObserver((entries) => {
    const targets = new Set(entries.map((entry) => entry.target));
    const changed = new Map<Watcher, DOMRect>();
    for (const watcher of watchers) {
      if (!targets.has(watcher.element)) continue;
      const rect = watcher.element.getBoundingClientRect();
      if (dirty.has(watcher) || !sameBounds(rect, watcher.measured)) changed.set(watcher, rect);
    }
    if (changed.size) measureWhere((watcher) => changed.has(watcher), changed);
  });
  window.addEventListener("resize", resized);
  window.addEventListener("scroll", scrolled, true);
  document.addEventListener("visibilitychange", shownChanged);
  for (const type of MOTION_EVENTS) document.addEventListener(type, motion, true);
  window.visualViewport?.addEventListener("resize", resized);
  window.visualViewport?.addEventListener("scroll", resized);
  return {
    mutations,
    resizes,
    stop: () => {
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener("resize", resized);
      window.removeEventListener("scroll", scrolled, true);
      document.removeEventListener("visibilitychange", shownChanged);
      for (const type of MOTION_EVENTS) document.removeEventListener(type, motion, true);
      window.visualViewport?.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("scroll", resized);
    },
  };
}

export function watchTabViewport(element: HTMLElement, visible: () => boolean, report: (viewport: TabViewport) => void, cover: OverlayCover) {
  const watcher: Watcher = { element, visible, report, cover, shown: false };
  listening ??= listen();
  watchers.add(watcher);
  listening.resizes.observe(element);
  measureWhere((candidate) => candidate === watcher);
  return () => {
    if (!watchers.delete(watcher)) return;
    dirty.delete(watcher);
    if (watchers.size) {
      if (![...watchers].some((other) => other.element === element)) listening?.resizes.unobserve(element);
      return;
    }
    listening?.stop();
    listening = null;
    measureAll = false;
    measureShown = false;
    if (frame && !frameTasks.length) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}
