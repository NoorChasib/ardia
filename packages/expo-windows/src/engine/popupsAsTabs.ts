import type { OpenWindowRequest } from "@ardia/ardiacore";
import type { OpenWindowOptions, WindowEvent } from "@nilla/shell";
import { addNativeListener, type EventSubscription } from "../events";
import { requestHost, type RequestPage } from "./requestHosts";

const littleNillaWindows = new Set<string>();
let popupsOpenAsTabs = false;
let windowCloses: EventSubscription | null = null;

export function setPopupsOpenAsTabs(enabled: boolean) {
  popupsOpenAsTabs = enabled;
}

export function noteAppWindow(windowId: string, kind: OpenWindowOptions["kind"]) {
  if (kind !== "small") return void littleNillaWindows.delete(windowId);
  littleNillaWindows.add(windowId);
  windowCloses ??= addNativeListener("NillaAppWindows", "onWindowEvent", (payload) => {
    const event = payload as WindowEvent | null;
    if (event?.type === "close") littleNillaWindows.delete(event.id);
  });
}

const takesPopupsAsTabs = (page: RequestPage) => popupsOpenAsTabs && !littleNillaWindows.has(page.windowId);

export function handPopupAsTab<Candidate extends RequestPage>(opener: Candidate | undefined, request: OpenWindowRequest, all: Iterable<Candidate>): boolean {
  if (!opener || !takesPopupsAsTabs(opener)) return false;
  const host = requestHost(opener, request.profile ?? opener.profile, all);
  if (!host || !takesPopupsAsTabs(host)) return false;
  const asTab: OpenWindowRequest = { ...request, disposition: "foreground", popup: true, fromClick: false, point: undefined };
  for (const listener of [...host.listeners]) listener("openWindow", asTab);
  return true;
}
