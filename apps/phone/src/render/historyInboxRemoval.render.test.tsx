import { Platform } from "react-native";
import { act } from "react-test-renderer";
import { ExpoLibrarySheet } from "../components/library/ExpoLibrary";
import { sync, type SyncedProfile, type SyncedView } from "../platform/sync";
import { history } from "../state/history/store";
import * as library from "../state/library/store";
import { applyInbox, startSync } from "../state/sync/actions";
import { EMPTY_VIEW, OFF_STATUS, setSpacesDesign, useSync } from "../state/sync/store";
import { renderSurface, unmount } from "../../test/render/harness";

const onIos = Platform.OS === "ios" ? test : test.skip;

const profile = (syncId: string, name: string, isDefault: boolean): SyncedProfile =>
  ({ syncId, name, color: null, icon: null, isDefault, theme: null, deviceTabs: [], pinned: { tiles: [], sections: [] }, bookmarks: [], history: [], sendTargets: [] }) as unknown as SyncedProfile;

const view = (): SyncedView =>
  ({ ...EMPTY_VIEW, profiles: [profile("work", "Work", true), profile("home", "Home", false)], shownProfileId: "work", search: { engineId: "google", customURL: null, customEngines: [] } }) as unknown as SyncedView;

const libraryHas = (url: string) => library.useLibrary.getState().history.some((row) => row.url === url);

beforeAll(() => startSync());

beforeEach(() => {
  jest.useFakeTimers();
  setSpacesDesign("redesigned");
  act(() => useSync.setState({ status: { ...OFF_STATUS, isEnabled: true, phase: "updated", selectedProfileId: "work" } as never, view: view() }));
});

afterEach(() => {
  act(() => library.closeLibrary());
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

onIos("open History drops a visit an inbox removal deleted, without waiting for a sync tick", async () => {
  const url = "https://removed-elsewhere.example/";
  history().record(url, "Removed elsewhere", "typed", "work", Date.now());
  jest.spyOn(sync, "inbox").mockResolvedValue([{ id: 1, received: [], removals: [{ profileSyncId: "work", urls: [url], includesUnassigned: false }] }] as never);
  jest.spyOn(sync, "inboxApplied").mockResolvedValue(undefined as never);
  jest.spyOn(sync, "deviceId").mockReturnValue("phone");
  const root = renderSurface(<ExpoLibrarySheet />);
  try {
    act(() => library.openLibrary("history"));
    expect(libraryHas(url)).toBe(true);
    const loads = jest.spyOn(library, "loadHistory");
    await act(async () => {
      await applyInbox();
    });
    expect(history().search(url)).toHaveLength(0);
    expect(libraryHas(url)).toBe(false);
    expect(loads).toHaveBeenCalledTimes(1);
  } finally {
    unmount(root);
  }
});

onIos("deleting a History row reloads nothing, and an inbox batch that removes nothing reloads nothing", async () => {
  const url = "https://deleted-here.example/";
  history().record(url, "Deleted here", "typed", "work", Date.now());
  jest.spyOn(sync, "inbox").mockResolvedValue([{ id: 2, received: [], removals: [] }] as never);
  jest.spyOn(sync, "inboxApplied").mockResolvedValue(undefined as never);
  jest.spyOn(sync, "deviceId").mockReturnValue("phone");
  const root = renderSurface(<ExpoLibrarySheet />);
  try {
    act(() => library.openLibrary("history"));
    const entry = library.useLibrary.getState().history.find((row) => row.url === url)!;
    const loads = jest.spyOn(library, "loadHistory");
    act(() => library.deleteHistoryEntry(entry));
    expect(libraryHas(url)).toBe(false);
    await act(async () => {
      await applyInbox();
    });
    expect(loads).toHaveBeenCalledTimes(0);
  } finally {
    unmount(root);
  }
});
