import { useMemo } from "react";
import type { BrowserTab } from "./tabModels";
import { isSplit } from "./spaces";
import { archiveDays, type ArchivedDay } from "./tabsState";
import { deckOrderOf, useTabs } from "./store";

export const useSelectedTabId = () => useTabs((s) => s.selectedId);

export const useSelectedTab = () =>
  useTabs((s) => (s.selectedId === null ? null : s.open.find((t) => t.id === s.selectedId) ?? s.privates.find((t) => t.id === s.selectedId) ?? null));

export const useTab = (id: string) => useTabs((s) => s.open.find((t) => t.id === id) ?? s.privates.find((t) => t.id === id) ?? null);

export const useDeckOrder = (): BrowserTab[] => useTabs(deckOrderOf);

export const useShownSpace = () => useTabs((s) => (isSplit(s.spaces) ? s.spaces.current : null));

export const useTabSpaces = () => useTabs((s) => s.spaces);

export const useHasTabs = () => useTabs((s) => s.open.length + s.privates.length > 0);

export const usePrivateCount = () => useTabs((s) => s.privates.length);

export const useIncognito = () => useTabs((s) => s.incognito);

export const useCanReopen = () => useTabs((s) => s.undo.length > 0);

export const useHasArchivedTabs = () => useTabs((s) => s.archivedCount > 0);

export const useArchiveLoaded = () => useTabs((s) => s.archive !== null);

const dayFormat = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

export function useArchiveDays(): ArchivedDay[] {
  const archive = useTabs((s) => s.archive);
  return useMemo(() => archiveDays(archive ?? [], dayFormat), [archive]);
}
