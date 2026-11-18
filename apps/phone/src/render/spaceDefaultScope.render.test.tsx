import { Platform } from "react-native";
import { act } from "react-test-renderer";
import { ExpoLibrarySheet } from "../components/library/ExpoLibrary";
import type { SyncedProfile, SyncedView } from "../platform/sync";
import { history } from "../state/history/store";
import * as library from "../state/library/store";
import { dismissSearch, presentSearch, useSearch } from "../state/search/store";
import { startSync } from "../state/sync/actions";
import { EMPTY_VIEW, OFF_STATUS, setSpacesDesign, useSync } from "../state/sync/store";
import { openNewTab, useTabs } from "../state/tabs/store";
import { spaceTabs } from "../state/tabs/tabsState";
import { renderSurface, unmount } from "../../test/render/harness";

const onIos = Platform.OS === "ios" ? test : test.skip;

const profile = (syncId: string, name: string, isDefault: boolean): SyncedProfile =>
  ({ syncId, name, color: null, icon: null, isDefault, theme: null, deviceTabs: [], pinned: { tiles: [], sections: [] }, bookmarks: [], history: [], sendTargets: [] }) as unknown as SyncedProfile;

const view = (): SyncedView =>
  ({ ...EMPTY_VIEW, profiles: [profile("work", "Work", true), profile("home", "Home", false)], shownProfileId: "work", search: { engineId: "google", customURL: null, customEngines: [] } }) as unknown as SyncedView;

const publish = (next: SyncedView) => act(() => useSync.setState((state) => ({ revision: state.revision + 1, view: next })));

const withDefault = (defaultId: string) => {
  const shown = useSync.getState().view;
  publish({ ...shown, profiles: shown.profiles.map((known) => ({ ...known, isDefault: known.syncId === defaultId })) });
};

const libraryHas = (url: string) => library.useLibrary.getState().history.some((row) => row.url === url);

beforeAll(() => startSync());

beforeEach(() => {
  jest.useFakeTimers();
  act(() => dismissSearch());
  setSpacesDesign("redesigned");
  act(() => useSync.setState({ status: { ...OFF_STATUS, isEnabled: true, phase: "updated", selectedProfileId: "work" } as never, view: view() }));
});

afterEach(() => {
  act(() => dismissSearch());
  act(() => library.closeLibrary());
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("the tray stops offering Switch to Tab for an unassigned tab once the default Space moves away from the selected one", () => {
  const address = "https://unassigned-tab.example/";
  const tab = openNewTab({ url: address, title: "unassigned-tab", origin: "typed" });
  act(() => useTabs.setState((state) => ({ open: state.open.map((open) => (open.id === tab.id ? { ...open, profileSyncId: null } : open)), listing: state.listing + 1 })));
  const switches = () => useSearch.getState().rows.some((row) => row.url === address && "switchesTab" in row && row.switchesTab);
  act(() => presentSearch("home", "unassigned-tab"));
  expect(switches()).toBe(true);
  act(() => dismissSearch());
  const listing = useTabs.getState().listing;
  withDefault("home");
  expect(useTabs.getState().listing).toBe(listing);
  expect(useTabs.getState().spaces.current).toBe("work");
  expect(spaceTabs(useTabs.getState()).some((open) => open.id === tab.id)).toBe(false);
  act(() => presentSearch("home", "unassigned-tab"));
  expect(switches()).toBe(false);
});

onIos("open History drops unassigned visits once the default Space moves away from the selected one", () => {
  const url = "https://unassigned-visit.example/";
  history().record(url, "Unassigned", "typed", null, Date.now());
  const root = renderSurface(<ExpoLibrarySheet />);
  try {
    act(() => library.openLibrary("history"));
    expect(libraryHas(url)).toBe(true);
    withDefault("home");
    expect(useTabs.getState().spaces).toMatchObject({ current: "work", defaultId: "home" });
    expect(libraryHas(url)).toBe(false);
  } finally {
    unmount(root);
  }
});
