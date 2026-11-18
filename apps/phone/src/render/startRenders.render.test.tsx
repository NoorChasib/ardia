import { act } from "react-test-renderer";
import { StartScreen } from "../components/search/StartScreen";
import { DesignProvider } from "../components/ui";
import * as perf from "../state/app/interactionPerf";
import { useBrowse } from "../state/browse/store";
import { dismissSearch, presentSearch } from "../state/search/store";
import { OFF_STATUS, useSync, type PinnedTile, type SyncedProfile } from "../state/sync/store";
import { renderSurface, textOf, unmount, withTabs } from "../../test/render/harness";

const safeArea = require("react-native-safe-area-context") as { useSafeAreaInsets: () => { top: number; bottom: number; left: number; right: number } };

const tiles = (space: string, count: number): PinnedTile[] => Array.from({ length: count }, (_, i) => ({ key: `${space}-k${i}`, title: `Pin ${space} ${i}`, url: `https://${space}${i}.example/`, icon: null, folder: null }));

const profile = (syncId: string, name: string): SyncedProfile => ({
  syncId,
  name,
  color: null,
  icon: null,
  isDefault: syncId === "work",
  theme: null,
  deviceTabs: [],
  pinned: { tiles: tiles(syncId, 8), sections: [] },
  bookmarks: [],
  history: [],
  sendTargets: null,
});

const view = (syncedAt: number, profiles = [profile("work", "Work"), profile("home", "Home"), profile("play", "Play")]) =>
  ({ devices: [], profiles, search: null, syncedAt, selectedProfileId: "work", shownProfileId: "work", receivers: [] }) as never;

const status = (lastSynced: number) => ({ ...OFF_STATUS, isEnabled: true, phase: "updated" as const, lastSynced });

let counts: Record<string, number> = {};

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(2);
  useBrowse.setState({ surface: "start", sheet: null });
  act(() => useSync.setState((state) => ({ ...state, status: status(1), view: view(1) })));
  jest.spyOn(safeArea, "useSafeAreaInsets").mockImplementation(() => ({ top: 47, bottom: 34, left: 0, right: 0 }));
  counts = {};
  jest.spyOn(perf, "countRender").mockImplementation((component: string) => {
    counts[component] = (counts[component] ?? 0) + 1;
  });
});

afterEach(() => {
  act(() => dismissSearch());
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const start = () =>
  renderSurface(
    <DesignProvider design="redesigned">
      <StartScreen />
    </DesignProvider>,
  );

const pageAndTileRenders = () => ({ pages: counts.StartSpacePage ?? 0, tiles: counts.PinnedTileButton ?? 0 });

test("opening and closing the tray over the start page draws no space page and no pinned tile again", () => {
  const root = start();
  expect(pageAndTileRenders().tiles).toBeGreaterThanOrEqual(8);
  counts = {};
  act(() => presentSearch("start"));
  act(() => jest.advanceTimersByTime(500));
  expect(pageAndTileRenders()).toEqual({ pages: 0, tiles: 0 });
  act(() => dismissSearch());
  act(() => jest.advanceTimersByTime(500));
  expect(pageAndTileRenders()).toEqual({ pages: 0, tiles: 0 });
  unmount(root);
});

test("a sync status tick and a re-sent view with the same spaces draw no space page and no pinned tile again", () => {
  const root = start();
  counts = {};
  act(() => useSync.setState({ status: status(15_000) }));
  act(() => useSync.setState({ view: view(2) }));
  expect(pageAndTileRenders()).toEqual({ pages: 0, tiles: 0 });
  unmount(root);
});

test("a renamed pin redraws its own tile and keeps its new name", () => {
  const root = start();
  const renamed = [profile("work", "Work"), profile("home", "Home"), profile("play", "Play")];
  renamed[0]!.pinned.tiles[2] = { ...renamed[0]!.pinned.tiles[2]!, title: "Renamed pin" };
  counts = {};
  act(() => useSync.setState({ view: view(3, renamed) }));
  expect(pageAndTileRenders().tiles).toBe(1);
  expect(root.root.findAll((node) => node.props.accessibilityLabel === "Renamed pin").length).toBeGreaterThan(0);
  expect(textOf(root)).toContain("Work");
  unmount(root);
});
