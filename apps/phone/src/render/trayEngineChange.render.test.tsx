import { act } from "react-test-renderer";
import type { SyncedProfile, SyncedView } from "../platform/sync";
import { history } from "../state/history/store";
import { dismissSearch, presentSearch, useSearch } from "../state/search/store";
import { startSync } from "../state/sync/actions";
import { EMPTY_VIEW, OFF_STATUS, setSpacesDesign, useSync } from "../state/sync/store";

const profile = (syncId: string, name: string, isDefault: boolean): SyncedProfile =>
  ({ syncId, name, color: null, icon: null, isDefault, theme: null, deviceTabs: [], pinned: { tiles: [], sections: [] }, bookmarks: [], history: [], sendTargets: [] }) as unknown as SyncedProfile;

const view = (): SyncedView =>
  ({ ...EMPTY_VIEW, profiles: [profile("work", "Work", true), profile("home", "Home", false)], shownProfileId: "work", search: { engineId: "google", customURL: null, customEngines: [] } }) as unknown as SyncedView;

const publish = (next: SyncedView) => act(() => useSync.setState((state) => ({ revision: state.revision + 1, view: next })));

const withEngine = (engineId: string) => publish({ ...useSync.getState().view, search: { engineId, customURL: null, customEngines: [] } });

beforeAll(() => startSync());

beforeEach(() => {
  jest.useFakeTimers();
  act(() => dismissSearch());
  setSpacesDesign("redesigned");
  act(() => useSync.setState({ status: { ...OFF_STATUS, isEnabled: true, phase: "updated", selectedProfileId: "work" } as never, view: view() }));
});

afterEach(() => {
  act(() => dismissSearch());
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("the open empty tray's recent searches follow a synced search engine change", () => {
  history().record("https://www.google.com/search?q=engine+follows", "", "typed", "work", Date.now());
  const recent = () => useSearch.getState().rows.find((row) => row.title === "engine follows")?.url;
  act(() => presentSearch("home"));
  expect(recent()).toContain("google.com");
  withEngine("duckduckgo");
  expect(recent()).toContain("duckduckgo.com");
});
