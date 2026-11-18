import { act } from "react-test-renderer";
import { history } from "../state/history/store";
import * as omnibox from "../state/search/omnibox";
import { dismissSearch, presentSearch, useSearch } from "../state/search/store";
import { startSync } from "../state/sync/actions";
import { OFF_STATUS, setStatus, useSync } from "../state/sync/store";
import { currentTabs, updateTabById, useTabs } from "../state/tabs/store";
import * as telemetry from "../state/telemetry/telemetry";
import type { SyncedProfile, SyncedView } from "../platform/sync";
import { withTabs } from "../../test/render/harness";

type Fed = Parameters<typeof omnibox.setSources>[0];

let fed: Fed[] = [];
let latest: Fed | null = null;
let rebuilds = 0;
let seededUntil = 0;

const NOW = Date.now();

function seedHistory(count: number) {
  for (let i = 0; i < count; i++) history().record(`https://visited${i}.example/page`, `Visited ${i}`, "link", null, NOW - 10_000_000 + i);
  seededUntil = NOW - 10_000_000 + count;
}

function syncedProfile(historyCount: number): SyncedProfile {
  return {
    syncId: "work",
    name: "Work",
    color: null,
    icon: null,
    isDefault: true,
    theme: null,
    deviceTabs: [{ deviceId: "mac", deviceName: "MacBook Pro", kind: "mac", tabs: [{ url: "https://remote.example/", title: "Remote" }] }],
    pinned: { tiles: [{ key: "tile", url: "https://tile.example/", title: "Tile", icon: null, folder: null }], sections: [] },
    bookmarks: [{ key: "b1", title: "Bookmark", url: "https://bookmark.example/", children: null }],
    history: Array.from({ length: historyCount }, (_, i) => ({ url: `https://synced${i}.example/`, title: `Synced ${i}`, visits: 2, lastVisit: NOW - i * 1000 })),
    sendTargets: null,
  } as unknown as SyncedProfile;
}

const syncedView = (syncedAt: number): SyncedView =>
  ({
    devices: [{ id: "mac", name: "MacBook Pro", kind: "mac", lastSeen: 1, isCurrent: false, canReceiveTabs: true }],
    profiles: [syncedProfile(2000)],
    search: null,
    syncedAt,
    selectedProfileId: "work",
    receivers: [],
  }) as unknown as SyncedView;

const publishView = (view: SyncedView) => act(() => useSync.setState((state) => ({ view, revision: state.revision + 1 })));

beforeAll(() => {
  seedHistory(5000);
  startSync();
});

beforeEach(() => {
  withTabs(20);
  fed = [];
  rebuilds = 0;
  jest.spyOn(omnibox, "setSources").mockImplementation((sources) => {
    fed.push(sources);
    latest = sources;
    return true;
  });
  jest.spyOn(telemetry, "countUsage").mockImplementation((field) => {
    if (field === "tray_sources_rebuilt") rebuilds += 1;
  });
  act(() => useSync.setState({ status: OFF_STATUS, view: { devices: [], profiles: [], search: null, syncedAt: null, selectedProfileId: null, receivers: [] } as never }));
});

afterEach(() => {
  act(() => dismissSearch());
  jest.restoreAllMocks();
});

const open = () => act(() => presentSearch("home"));
const close = () => act(() => dismissSearch());

test("a page visited between two tray opens feeds the omnibox the same row objects for every page but the visited one", () => {
  open();
  close();
  const first = latest!.history!;
  expect(first.length).toBe(5000);
  fed = [];
  seededUntil += 1;
  const visit = history().record("https://visited7.example/page", "", "link", null, seededUntil)!;
  history().amend(visit, { title: "Visited 7 again" });
  open();
  expect(fed).toHaveLength(1);
  const second = fed[0]!.history!;
  const kept = second.filter((row) => first.includes(row)).length;
  expect(kept).toBe(4999);
  expect(second[0]).toEqual({ url: "https://visited7.example/page", title: "Visited 7 again", favicon: null, visits: 2, lastVisit: seededUntil });
  expect(useSearch.getState().open).toBe(true);
});

test("a tab change between two tray opens passes the same history and bookmark arrays, so the omnibox keeps its pool", () => {
  open();
  close();
  const before = latest!;
  fed = [];
  act(() => updateTabById(currentTabs().open[3]!.id, { title: "Renamed" }));
  open();
  expect(fed).toHaveLength(1);
  expect(fed[0]!.history).toBe(before.history);
  expect(fed[0]!.bookmarks).toBe(before.bookmarks);
  expect(fed[0]!.tabs!.some((tab) => tab.title === "Renamed")).toBe(true);
});

test("reopening the tray with nothing changed feeds nothing and rebuilds nothing", () => {
  open();
  close();
  fed = [];
  rebuilds = 0;
  open();
  expect(fed).toHaveLength(0);
  expect(rebuilds).toBe(0);
});

test("sync ticks and repeated views while the tray is closed feed nothing, and the next open reuses the merged rows", () => {
  act(() => setStatus({ ...OFF_STATUS, isEnabled: true, phase: "updated", selectedProfileId: "work", lastSynced: NOW }));
  publishView(syncedView(1));
  open();
  close();
  const merged = latest!;
  expect(merged.history!.length).toBe(7000);
  expect(merged.bookmarks!.map((bookmark) => bookmark.url)).toEqual(["https://bookmark.example/", "https://tile.example/"]);
  fed = [];
  for (let tick = 1; tick <= 10; tick++) act(() => setStatus({ ...OFF_STATUS, isEnabled: true, phase: "updated", selectedProfileId: "work", lastSynced: NOW + tick * 15_000 }));
  for (let round = 2; round <= 4; round++) publishView(syncedView(round));
  expect(fed).toHaveLength(0);
  open();
  expect(fed).toHaveLength(0);
  expect(useSearch.getState().rows.some((row) => row.kind === "page" && row.fromMac === "MacBook Pro")).toBe(true);
});

test("history kept local rows when synced history merges into none of them", () => {
  act(() => setStatus({ ...OFF_STATUS, isEnabled: true, phase: "updated", selectedProfileId: "work", lastSynced: NOW }));
  publishView(syncedView(1));
  open();
  close();
  const local = history().summary();
  const merged = latest!.history!;
  expect(merged.slice(0, local.length).every((row, index) => row === local[index])).toBe(true);
});

test("the first tray open after launch counts one full rebuild, and a visit after it counts none", () => {
  history().pruneBefore(0);
  rebuilds = 0;
  open();
  close();
  expect(rebuilds).toBe(1);
  seededUntil += 1;
  history().record("https://visited9.example/page", "Visited 9", "link", null, seededUntil);
  open();
  expect(rebuilds).toBe(1);
});

test("a full rebuild while Incognito is on counts nothing", () => {
  history().pruneBefore(0);
  rebuilds = 0;
  act(() => useTabs.setState({ incognito: true }));
  open();
  close();
  expect(latest!.history!.length).toBeGreaterThan(0);
  expect(rebuilds).toBe(0);
  act(() => useTabs.setState({ incognito: false }));
  history().pruneBefore(0);
  open();
  expect(rebuilds).toBe(1);
});
