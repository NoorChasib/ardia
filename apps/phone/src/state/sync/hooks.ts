import { useMemo, useRef } from "react";
import { lookForApp, type PresetSpec, type ProfileLook } from "../../lib/profileLook";
import { usePreferences } from "../settings/store";
import { useTabs } from "../tabs/store";
import { isSyncableUrl, type BrowserTab } from "../tabs/tabModels";
import type { SyncedDevice, SyncedProfile } from "../../platform/sync";
import { isPinnedOnMac, pinsOnTheirWay } from "./spaces";
import { EMPTY_VIEW, OFF_STATUS, useSync } from "./store";
import { isSyncConnected, sendReceivers, shownProfile, syncBanner } from "./syncRules";

export const useSyncStatus = () => useSync((s) => s.status);

export const useSyncView = () => useSync((s) => s.view);

export const useSyncAvailable = () => useSync((s) => s.available);

export const useSyncEnabled = () => useSync((s) => s.status.isEnabled);

export const useSyncConnected = () => useSync((s) => isSyncConnected(s.status));

export function useSelectedProfile() {
  return useSync((s) => shownProfile(s.view, s.status));
}

export function useLook(presets: readonly PresetSpec[], fallback: string): ProfileLook {
  const choice = usePreferences((p) => p.colorChoice);
  const enabled = useSyncEnabled();
  const color = useSync((s) => shownProfile(s.view, s.status)?.color ?? null);
  const theme = useSync((s) => shownProfile(s.view, s.status)?.theme ?? null);
  return useMemo(() => lookForApp(choice, enabled, { color, theme }, presets, fallback), [choice, enabled, color, theme, presets, fallback]);
}

const NO_DEVICES: SyncedDevice[] = [];

function useTabOrId(tabOrId: string | BrowserTab): BrowserTab | null {
  const found = useTabs((s) => (typeof tabOrId === "string" ? (s.open.find((t) => t.id === tabOrId) ?? s.privates.find((t) => t.id === tabOrId) ?? null) : null));
  return typeof tabOrId === "string" ? found : tabOrId;
}

const sameItems = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, i) => item === b[i]);

export function useSameItems<T>(next: T[]): T[] {
  const kept = useRef(next);
  if (!sameItems(kept.current, next)) kept.current = next;
  return kept.current;
}

export function useSendTargets(tabOrId: string | BrowserTab) {
  const tab = useTabOrId(tabOrId);
  const sendable = Boolean(tab && !tab.isPrivate && isSyncableUrl(tab.url));
  const enabled = useSyncEnabled();
  const profileId = useSync((s) => tab?.profileSyncId ?? shownProfile(s.view, s.status)?.syncId ?? null);
  const profiles = useSync((s) => s.view.profiles);
  const devices = useSync((s) => s.view.devices);
  return useSameItems(useMemo(() => (sendable && enabled ? sendReceivers({ ...EMPTY_VIEW, profiles, devices }, profileId) : NO_DEVICES), [sendable, enabled, profiles, devices, profileId]));
}

const BOOKMARKS_ONLY: SyncedProfile = { syncId: "", name: "", color: null, icon: null, isDefault: false, theme: null, deviceTabs: [], pinned: { tiles: [], sections: [] }, bookmarks: [], history: [], sendTargets: null };

export function useIsPinned(tabOrId: string | BrowserTab) {
  const tab = useTabOrId(tabOrId);
  const syncId = useSync((s) => shownProfile(s.view, s.status)?.syncId ?? null);
  const bookmarks = useSync((s) => shownProfile(s.view, s.status)?.bookmarks ?? null);
  const sentHere = useSync((s) => s.pinsOnTheirWay);
  const pendingPins = useSync((s) => s.view.pendingPins);
  const url = tab?.url ?? null;
  return useMemo(
    () => (syncId !== null && bookmarks !== null && url !== null ? isPinnedOnMac({ ...BOOKMARKS_ONLY, syncId, bookmarks }, url, pinsOnTheirWay({ pendingPins }, sentHere)) : false),
    [syncId, bookmarks, url, pendingPins, sentHere],
  );
}

export const useSyncPhase = () => useSync((s) => s.status.phase);

export const useSyncProfiles = () => useSync((s) => s.view.profiles);

export function useSyncBanner() {
  const phase = useSyncPhase();
  const text = useSync((s) => syncBanner(s.status)?.text ?? null);
  return useMemo(() => syncBanner({ ...OFF_STATUS, phase, statusText: text ?? "" }), [phase, text]);
}
