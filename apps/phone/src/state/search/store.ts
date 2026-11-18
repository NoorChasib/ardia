import { create } from "zustand";
import { beginInteraction, INTERACTION_WINDOW_MS } from "../app/interactionPerf";
import { history } from "../history/store";
import { currentPreferences } from "../settings/store";
import { currentTabs, useTabs } from "../tabs/store";
import { idleMacTabs, macTabIndex, mergeSyncedHistory, syncedBookmarks } from "../sync/spaces";
import { selectedProfile, syncData, type SyncedProfile } from "../sync/store";
import type { SyncedDevice } from "../../platform/sync";
import { idleRows, remoteSuggestions, setSearchEngine, setSources, setSyncedSearch, suggest, type SuggestContext, type TrayRow } from "./omnibox";
import { withPasteRow, type PasteOffer } from "./pasteRow";
import { copy } from "../../lib/platformCopy";
import { clipboardOffer } from "../../platform/system";
import { settled } from "../pages/store";
import { NO_SOURCE_BOOKMARKS, recentSearches, sourceTabs, type Sources } from "./sources";
import { spaceTabs } from "../tabs/tabsState";

export type SearchOrigin = "home" | "start" | "page";

export type SearchEnding = "submitted" | "cancelled";

export type TrayArrival = "rises" | "atRest";

type SearchState = {
  open: boolean;
  ending: SearchEnding;
  origin: SearchOrigin;
  initialText: string;
  text: string;
  rows: TrayRow[];
  completion: string;
  completedFor: string;
  session: number;
  fieldVersion: number;
  incognitoOnCancel: boolean | null;
  arrival: TrayArrival;
};

export const useSearch = create<SearchState>()(() => ({
  open: false,
  ending: "cancelled",
  origin: "home",
  initialText: "",
  text: "",
  rows: [],
  completion: "",
  completedFor: "",
  session: 0,
  fieldVersion: 0,
  incognitoOnCancel: null,
  arrival: "rises",
}));

let remote: { text: string; values: string[] } = { text: "", values: [] };
let inFlight: AbortController | null = null;
let fed: (Sources & { listing: number; space: string | null; profile: SyncedProfile | null; devices: readonly SyncedDevice[] }) | null = null;
let context: SuggestContext = { currentUrl: null, currentTabId: null };
let paste: PasteOffer | null = null;

export function feedSources() {
  const { listing, spaces } = useTabs.getState();
  const profile = selectedProfile();
  const devices = syncData().view.devices;
  const local = history().summary();
  const historyRows = profile ? mergeSyncedHistory(local, profile.history) : local;
  const bookmarks = profile ? syncedBookmarks(profile) : NO_SOURCE_BOOKMARKS;
  const prior = fed;
  const sameTabs = prior !== null && prior.listing === listing && prior.space === spaces.current;
  const sameSources = sameTabs && prior.history === historyRows && prior.bookmarks === bookmarks;
  if (sameSources && prior.profile === profile && prior.devices === devices) return;
  const tabs = sameTabs ? prior.tabs : sourceTabs(spaceTabs(currentTabs()));
  fed = { tabs, history: historyRows, bookmarks, listing, space: spaces.current, profile, devices };
  if (!sameSources) setSources({ tabs, history: historyRows, bookmarks });
  const shown = useSearch.getState();
  if (shown.open && !shown.text.trim()) useSearch.setState({ rows: rowsFor(shown.text, []) });
}

export function sourcesMoved() {
  if (useSearch.getState().open) feedSources();
}

function suggestionsFor(text: string, remoteValues: readonly string[]): { rows: TrayRow[]; completion: string } {
  if (!text.trim()) return { rows: rowsFor(text, remoteValues), completion: "" };
  return suggest(text, remoteValues, context, macTabIndex(selectedProfile(), syncData().view.devices));
}

function rowsFor(text: string, remoteValues: readonly string[]): TrayRow[] {
  const profile = selectedProfile();
  if (text.trim()) return suggest(text, remoteValues, context, macTabIndex(profile, syncData().view.devices)).rows;
  const idle = useTabs.getState().incognito ? [] : idleRows(recentSearches(history().summary()), idleMacTabs(profile, syncData().view.devices));
  return withPasteRow(idle, text, paste);
}

function offerPaste(session: number) {
  paste = null;
  if (!copy().offersPasteAndGo) return;
  void settled(() => clipboardOffer(), null).then((offer) => {
    const state = useSearch.getState();
    if (!offer || !state.open || state.session !== session) return;
    paste = offer;
    if (!state.text.trim()) useSearch.setState({ rows: rowsFor(state.text, []) });
  });
}

export const refreshSearchRows = () => useSearch.setState((state) => ({ rows: rowsFor(state.text, []) }));

export function applySearchEngine() {
  const { status, view } = syncData();
  if (status.isEnabled && view.search) setSyncedSearch(view.search);
  else setSearchEngine(currentPreferences().searchEngineId);
}

export function presentSearch(origin: SearchOrigin, text = "", incognitoOnCancel: boolean | null = null, page: SuggestContext | null = null, arrival: TrayArrival = "rises") {
  beginInteraction("tray open", INTERACTION_WINDOW_MS.trayOpen);
  inFlight?.abort();
  remote = { text: "", values: [] };
  context = page ?? { currentUrl: null, currentTabId: null };
  feedSources();
  useSearch.setState((state) => ({
    open: true,
    ending: "cancelled",
    origin,
    initialText: text,
    text,
    rows: rowsFor(text, []),
    completion: "",
    completedFor: "",
    session: state.session + 1,
    fieldVersion: 0,
    incognitoOnCancel,
    arrival,
  }));
  offerPaste(useSearch.getState().session);
}

export function dismissSearch(ending: SearchEnding = "cancelled") {
  inFlight?.abort();
  useSearch.setState({ open: false, ending, incognitoOnCancel: null });
}

const REMOTE_DELAY_MS = 150;

let typed: string | null = null;
let frame: ReturnType<typeof requestAnimationFrame> | null = null;
let remoteTimer: ReturnType<typeof setTimeout> | null = null;

const sameRow = (shown: TrayRow, next: TrayRow) => {
  const a = shown as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

function keptRows(shown: readonly TrayRow[], next: readonly TrayRow[]): TrayRow[] {
  const byKey = new Map(shown.map((row) => [row.key, row]));
  let unchanged = shown.length === next.length;
  const kept = next.map((row, index) => {
    const known = byKey.get(row.key);
    const reused = known && sameRow(known, row) ? known : row;
    if (reused !== shown[index]) unchanged = false;
    return reused;
  });
  return unchanged ? (shown as TrayRow[]) : kept;
}

function showRows(text: string) {
  const carried = remote.text && text.startsWith(remote.text) ? remote.values : [];
  const suggested = suggestionsFor(text, carried);
  useSearch.setState((state) => ({ text, rows: keptRows(state.rows, suggested.rows), completion: suggested.completion, completedFor: text }));
  inFlight?.abort();
  if (remoteTimer) clearTimeout(remoteTimer);
  if (!text.trim() || !currentPreferences().searchSuggestions) return;
  remoteTimer = setTimeout(() => {
    remoteTimer = null;
    const controller = new AbortController();
    inFlight = controller;
    void remoteSuggestions(text, controller.signal).then((outcome) => {
      if (controller.signal.aborted || useSearch.getState().text !== text) return;
      remote = { text, values: outcome.values };
      const merged = suggestionsFor(text, outcome.values);
      const shown = useSearch.getState();
      const rows = keptRows(shown.rows, merged.rows);
      if (rows === shown.rows && merged.completion === shown.completion && shown.completedFor === text) return;
      useSearch.setState({ rows, completion: merged.completion, completedFor: text });
    });
  }, REMOTE_DELAY_MS);
}

export function typeSearch(text: string) {
  typed = text;
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    const next = typed;
    typed = null;
    if (next !== null) showRows(next);
  });
}

export function setSearchText(text: string) {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  typed = null;
  useSearch.setState((state) => ({ fieldVersion: state.fieldVersion + 1 }));
  showRows(text);
}

export const searchState = () => useSearch.getState();
