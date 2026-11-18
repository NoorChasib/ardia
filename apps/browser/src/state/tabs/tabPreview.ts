import { useMemo, useSyncExternalStore } from "react";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { splitOf, splitTabIdsOf } from "../splits/splits";
import { noteTabHoverPreview } from "../telemetry/hoverCardCounts";
import { isBlankAddress } from "./pendingAddress";
import { usePage } from "./pageState";
import { lastPicture, onPicturesChanged, tabNeverCaptured, type Picture } from "./tabPictures";

export type PreviewState = "shown" | "none" | "stale" | "hidden";

export type PreviewInput = {
  picture: Pick<Picture, "url" | "settled"> | null;
  tabUrl: string;
  onScreen: boolean;
  crashed: boolean;
  neverCaptured: boolean;
};

export function previewState({ picture, tabUrl, onScreen, crashed, neverCaptured }: PreviewInput): PreviewState {
  if (onScreen || crashed || neverCaptured || isBlankAddress(tabUrl)) return "hidden";
  if (!picture) return "none";
  return picture.url === tabUrl && picture.settled ? "shown" : "stale";
}

export function tabOnScreen(s: BrowserState, windowId: string, tabId: string): boolean {
  const active = activeTabId(s, windowId);
  return active === tabId || !!splitTabIdsOf(splitOf(s, active))?.includes(tabId);
}

export function previewAspect(frame: Picture["frame"], fallback: number): number {
  const [, , width, height] = frame;
  return width > 0 && height > 0 ? width / height : fallback;
}

export function useTabPreview(windowId: string, tabId: string) {
  const picture = useSyncExternalStore(onPicturesChanged, () => lastPicture(tabId));
  const tabUrl = useBrowser((s) => s.tabs[tabId]?.url ?? "");
  const onScreen = useBrowser((s) => tabOnScreen(s, windowId, tabId));
  const neverCaptured = useBrowser((s) => tabNeverCaptured(s, tabId));
  const crashed = usePage(tabId, (p) => !!p.crashed);
  const state = previewState({ picture, tabUrl, onScreen, crashed, neverCaptured });
  const shown = state === "shown" ? picture : null;
  const uri = useMemo(() => (shown ? `data:image/jpeg;base64,${shown.data}` : null), [shown]);
  return { state, picture: shown, uri };
}

export function noteTabPreviewDrawn(state: PreviewState) {
  if (state !== "hidden") noteTabHoverPreview(state);
}
