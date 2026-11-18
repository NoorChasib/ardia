import { webviews } from "../../platform/webviews";
import { isSharing } from "./choice";
import { sameSharingPeriod } from "./sharingPeriod";

const SETTLE_MS = 2000;
const NONE = { bar_loads: 0, bar_loads_page_focused: 0, link_tab_loads: 0, link_tab_loads_page_focused: 0 };
let counts = { ...NONE };

type Count = keyof typeof NONE;

function noteLoad(tabId: string, loads: Count, focusedLoads: Count) {
  if (!tabId || !isSharing()) return;
  const stillSamePeriod = sameSharingPeriod();
  setTimeout(() => {
    if (!isSharing() || !stillSamePeriod()) return;
    void webviews.get(tabId)?.evaluate("document.hasFocus()").then(
      (focused) => {
        if (!stillSamePeriod()) return;
        counts[loads]++;
        if (focused === true) counts[focusedLoads]++;
      },
      () => {},
    );
  }, SETTLE_MS);
}

export const noteBarLoad = (tabId: string) => noteLoad(tabId, "bar_loads", "bar_loads_page_focused");

export const noteLinkTabLoad = (tabId: string) => noteLoad(tabId, "link_tab_loads", "link_tab_loads_page_focused");

export function takeBarLoadFocusCounts() {
  const taken = counts;
  counts = { ...NONE };
  return taken;
}
