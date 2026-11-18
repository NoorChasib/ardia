import { showInPlaceOf, type HostTab } from "./hostTab.ts";

export type SwitchView = { tab: () => HostTab | null; slot: Element; regions: { setPage(slot: Element, visible: boolean): void } };
type ActiveWindows = { windows: Record<string, { profileId: string; activeTabIds: Record<string, string> } | undefined> };
type ActiveStore = { subscribe(listener: (state: ActiveWindows, previous: ActiveWindows) => void): () => void };

const views = new Map<string, SwitchView>();
let switchedAhead = 0;
let regionsHeld = 0;
let reported = { switchedAhead: 0, regionsHeld: 0 };

const laidOut = (slot: Element) => {
  const rect = slot.getBoundingClientRect?.();
  return !rect || (rect.width > 0 && rect.height > 0);
};

export function registerSwitchView(tabId: string, view: SwitchView) {
  views.set(tabId, view);
  return () => {
    if (views.get(tabId) === view) views.delete(tabId);
  };
}

export const tabsSwitchedAhead = () => switchedAhead;

export function takeSwitchAheadCounts() {
  const counts = { linux_switch_aheads: switchedAhead - reported.switchedAhead, linux_switch_regions_held: regionsHeld - reported.regionsHeld };
  reported = { switchedAhead, regionsHeld };
  return counts;
}

function switchAhead(fromId: string, toId: string) {
  const from = views.get(fromId);
  const to = views.get(toId);
  const fromTab = from?.tab();
  const toTab = to?.tab();
  if (!from || !to || !fromTab || !toTab) return;
  for (const view of views.values()) if (view !== from && view.tab()?.shownViewport()) return;
  if (!showInPlaceOf(fromTab, toTab)) return;
  switchedAhead++;
  to.regions.setPage(to.slot, true);
  if (laidOut(to.slot)) from.regions.setPage(from.slot, false);
  else regionsHeld++;
}

export function watchTabSwitches(store: ActiveStore) {
  return store.subscribe((state, previous) => {
    if (state.windows === previous.windows) return;
    for (const [id, window] of Object.entries(state.windows)) {
      const before = previous.windows[id];
      if (!window || !before || before.profileId !== window.profileId) continue;
      const next = window.activeTabIds[window.profileId];
      const last = before.activeTabIds[window.profileId];
      if (next && last && next !== last) switchAhead(last, next);
    }
  });
}

export function forgetSwitchViews() {
  views.clear();
  switchedAhead = 0;
  regionsHeld = 0;
  reported = { switchedAhead: 0, regionsHeld: 0 };
}
