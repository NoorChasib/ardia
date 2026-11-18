import { livePageIds, pageScrollPosition, savePageState, type PageScrollPosition } from "../pages/store";
import { currentTabs, saveTabState } from "../tabs/store";
import { findTab } from "../tabs/tabsState";
import { scrollAtRest, scrollMovedSinceSave, scrollSaveDecision, type ScrollWatch } from "../../lib/scrollSettle";
import { usageCountingWindow } from "../telemetry/telemetry";

const SCROLL_CHECK_MS = 2000;
const STILL_CHECK_MAX_MS = 16_000;

const watches = new Map<string, ScrollWatch>();
const navigatedSinceSave = new Map<string, number>();
const frontSinceCheck = new Set<string>();
let frontPage: () => string | null = () => null;
let polledPage: string | null = null;
let stillChecks = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let checking = false;

export async function saveTabPosition(id: string, known?: PageScrollPosition | null) {
  const count = usageCountingWindow();
  const navigations = navigatedSinceSave.get(id);
  const at = known === undefined ? await pageScrollPosition(id) : known;
  const saved = await savePageState(id);
  if (!saved || !findTab(currentTabs(), id)) return;
  if (saveTabState(id, saved)) count("page_states_saved");
  if (navigatedSinceSave.get(id) === navigations) navigatedSinceSave.delete(id);
  if (at) watches.set(id, { lastSeen: at.y, lastSaved: at.y });
}

export function notePageNavigated(id: string) {
  navigatedSinceSave.set(id, (navigatedSinceSave.get(id) ?? 0) + 1);
}

function scheduleCheck() {
  timer = setTimeout(() => {
    timer = null;
    void checkFront();
  }, Math.min(SCROLL_CHECK_MS * 2 ** stillChecks, STILL_CHECK_MAX_MS));
}

async function checkFront() {
  const id = frontPage();
  if (!id || checking) return;
  checking = true;
  try {
    const at = await pageScrollPosition(id);
    if (!at || frontPage() !== id) return;
    const watch = watches.get(id) ?? { lastSeen: null, lastSaved: null };
    stillChecks = scrollAtRest(watch, at.y) ? stillChecks + 1 : 0;
    const step = scrollSaveDecision(watch, at.y);
    watches.set(id, step.next);
    if (step.save) await saveTabPosition(id);
  } finally {
    checking = false;
    if (!timer && polledPage) scheduleCheck();
  }
}

export function noteFrontScrolled(id: string) {
  if (id !== polledPage || stillChecks === 0) return;
  stillChecks = 0;
  if (!timer) return;
  clearTimeout(timer);
  scheduleCheck();
}

export function watchFrontScroll(frontId: () => string | null) {
  frontPage = frontId;
  followFrontPage();
}

export function followFrontPage() {
  const id = frontPage();
  if (id) frontSinceCheck.add(id);
  if (id === polledPage) return;
  polledPage = id;
  stillChecks = 0;
  if (timer) clearTimeout(timer);
  timer = null;
  if (id && !checking) scheduleCheck();
}

async function changedSinceSave(id: string): Promise<{ changed: boolean; at?: PageScrollPosition | null }> {
  if (navigatedSinceSave.has(id)) return { changed: true };
  if (!frontSinceCheck.has(id)) return { changed: false };
  frontSinceCheck.delete(id);
  const at = await pageScrollPosition(id);
  return { changed: !at || scrollMovedSinceSave(watches.get(id), at.y), at };
}

export async function saveChangedPages() {
  const live = new Set(await livePageIds());
  const data = currentTabs();
  for (const tab of [...data.open, ...data.privates]) {
    if (!live.has(tab.id)) continue;
    const check = await changedSinceSave(tab.id);
    if (check.changed) await saveTabPosition(tab.id, check.at);
  }
}

export function forgetPosition(id: string) {
  watches.delete(id);
  navigatedSinceSave.delete(id);
  frontSinceCheck.delete(id);
}
