import { useBrowser } from "../browser/store";
import { isIncognitoProfile } from "../browser/model";
import type { BrowserState } from "../browser/store";
import { webviews } from "../../platform/webviews";
import { noteTabHoverPreviewCapture } from "../telemetry/hoverCardCounts";

export type Picture = { data: string; frame: [number, number, number, number]; url: string; at: number };

const SETTLE_MS = 1500;
export const LOADED_SETTLE_MS = 500;
const KEEP = 40;
const pictures = new Map<string, Picture>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const loadTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let started = false;

export function lastPicture(tabId: string): Picture | null {
  return pictures.get(tabId) ?? null;
}

export function onPicturesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function changed() {
  for (const listener of listeners) listener();
}

export function rememberPicture(tabId: string): Promise<void> {
  return remember(tabId, false);
}

export const tabNeverCaptured = (s: Pick<BrowserState, "windows" | "tabs">, tabId: string) => {
  const tab = s.tabs[tabId];
  return !tab || s.windows[tab.windowId]?.kind === "private" || isIncognitoProfile(tab.profileId);
};

function remember(tabId: string, afterLoad: boolean): Promise<void> {
  const state = useBrowser.getState();
  if (tabNeverCaptured(state, tabId)) return Promise.resolve();
  const view = webviews.get(tabId);
  if (!view) return Promise.resolve();
  const url = state.tabs[tabId]!.url;
  return view
    .capturePicture(0.25)
    .then(
      (picture) => {
        if (afterLoad) noteTabHoverPreviewCapture(!picture);
        if (!picture || useBrowser.getState().tabs[tabId]?.url !== url) return;
        pictures.delete(tabId);
        pictures.set(tabId, { data: picture.data, frame: picture.frame, url, at: Date.now() });
        for (const old of pictures.keys()) {
          if (pictures.size <= KEEP) break;
          pictures.delete(old);
        }
        changed();
      },
      () => {
        if (afterLoad) noteTabHoverPreviewCapture(true);
      },
    )
    .catch(() => {});
}

function clearGone(s: BrowserState, from: Map<string, ReturnType<typeof setTimeout>>) {
  for (const [windowId, timer] of from)
    if (!s.windows[windowId]) {
      clearTimeout(timer);
      from.delete(windowId);
    }
}

function followActiveTabs(s: BrowserState, prev: BrowserState) {
  clearGone(s, timers);
  for (const w of Object.values(s.windows)) {
    const id = w.activeTabIds[w.profileId];
    if (!id || w.kind === "private") continue;
    const was = prev.windows[w.id];
    if (id === was?.activeTabIds[was.profileId] && s.tabs[id]?.url === prev.tabs[id]?.url) continue;
    if (isIncognitoProfile(s.tabs[id]?.profileId ?? "")) continue;
    clearTimeout(timers.get(w.id));
    timers.set(
      w.id,
      setTimeout(() => {
        timers.delete(w.id);
        const now = useBrowser.getState().windows[w.id];
        if (now?.activeTabIds[now.profileId] === id) void remember(id, false);
      }, SETTLE_MS),
    );
  }
}

function followFinishedLoads(s: BrowserState, prev: BrowserState) {
  clearGone(s, loadTimers);
  for (const w of Object.values(s.windows)) {
    const id = w.activeTabIds[w.profileId];
    if (!id || w.kind === "private" || s.live[id] === prev.live[id]) continue;
    const loading = !!s.live[id]?.isLoading;
    if (loading) {
      clearTimeout(loadTimers.get(w.id));
      loadTimers.delete(w.id);
      continue;
    }
    if (!prev.live[id]?.isLoading || tabNeverCaptured(s, id)) continue;
    const url = s.tabs[id]!.url;
    clearTimeout(loadTimers.get(w.id));
    loadTimers.set(
      w.id,
      setTimeout(() => {
        loadTimers.delete(w.id);
        const now = useBrowser.getState();
        const win = now.windows[w.id];
        if (now.settings.showPagePreviewInTabHoverMenu && win?.activeTabIds[win.profileId] === id && now.tabs[id]?.url === url && !now.live[id]?.isLoading) void remember(id, true);
      }, LOADED_SETTLE_MS),
    );
  }
}

export function startTabPictures() {
  if (started) return;
  started = true;
  useBrowser.subscribe((s, prev) => {
    const loads = s.live !== prev.live && s.settings.showPagePreviewInTabHoverMenu;
    if (s.windows === prev.windows && s.tabs === prev.tabs && !loads) return;
    if (s.windows !== prev.windows || s.tabs !== prev.tabs) followActiveTabs(s, prev);
    if (loads) followFinishedLoads(s, prev);
    if (s.tabs !== prev.tabs) {
      const before = pictures.size;
      for (const id of pictures.keys()) if (!s.tabs[id]) pictures.delete(id);
      if (pictures.size !== before) changed();
    }
  });
}
