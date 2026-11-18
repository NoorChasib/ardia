import { act } from "react-test-renderer";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";
import { resetNativeMenus } from "./nativeMenusMock";

type SyncListener = (event: unknown) => void;

const mockSyncListeners: SyncListener[] = [];

jest.mock("@ardia/phone-native", () => {
  const actual = jest.requireActual("@ardia/phone-native");
  const menus = require("./nativeMenusMock").nativeMenusModule(actual);
  return {
    ...menus,
    sync: {
      ...actual.sync,
      addListener: (listener: SyncListener) => {
        mockSyncListeners.push(listener);
        return { remove: () => undefined };
      },
      status: async () => null,
      view: async () => null,
      inbox: async () => [],
      localDidChange: () => undefined,
    },
  };
});

const { TabDeck } = require("../components/tabs/TabDeck") as typeof import("../components/tabs/TabDeck");
const perf = require("../state/app/interactionPerf") as typeof import("../state/app/interactionPerf");
const { useBrowse } = require("../state/browse/store") as typeof import("../state/browse/store");
const { notePinSent, startSyncSources, useSync } = require("../state/sync/store") as typeof import("../state/sync/store");
const telemetry = require("../state/telemetry/telemetry") as typeof import("../state/telemetry/telemetry");

const T = 1_790_000_000_000;

let renders: string[] = [];

const status = (phase: string, lastSynced: number, pendingDownloads = 0) => ({
  phase,
  statusText: phase,
  stalledMessage: null,
  attention: "none",
  isEnabled: true,
  isSyncing: phase === "updating",
  isDemo: false,
  pendingDownloads,
  lastSynced,
  folderName: "Ardia",
  deviceName: "Phone",
  selectedProfileId: "work",
  showsResetNotice: false,
  inboxProblem: null,
});

const view = ({ color = "blue", macTabs = 3, bookmarks = 50 } = {}) => ({
  devices: [
    { id: "mac", name: "Studio", kind: "mac", lastSeen: T, isCurrent: false, canReceiveTabs: true },
    { id: "this-phone", name: "Phone", kind: "phone", lastSeen: T, isCurrent: true, canReceiveTabs: false },
  ],
  profiles: ["work", "home"].map((syncId) => ({
    syncId,
    name: syncId === "work" ? "Work" : "Home",
    color: syncId === "work" ? color : "green",
    icon: null,
    isDefault: syncId === "work",
    theme: syncId === "work" ? { colors: ["#3366CC", "#6699FF"], darkColors: ["#112244", "#223366"] } : null,
    deviceTabs: [{ deviceId: "mac", deviceName: "Studio", kind: "mac", tabs: Array.from({ length: syncId === "work" ? macTabs : 3 }, (_, i) => ({ url: `https://mac${i}.example/`, title: `Mac ${i}` })) }],
    pinned: { tiles: [], sections: [] },
    bookmarks: Array.from({ length: bookmarks }, (_, i) => ({ key: `b${i}`, title: `Bookmark ${i}`, url: `https://bookmark${i}.example/`, added: T, root: null, children: null })),
    history: Array.from({ length: 200 }, (_, i) => ({ url: `https://h${i}.example/`, title: `History ${i}`, visits: 1, lastVisit: T - i })),
    sendTargets: ["mac"],
  })),
  search: null,
  look: { interfaceStyle: "glass", appearance: "auto" },
  syncedAt: T,
  selectedProfileId: "work",
  shownProfileId: "work",
  receivers: [],
});

const emit = (event: unknown) => act(() => mockSyncListeners.forEach((listener) => listener(event)));
const emitStatus = (next: ReturnType<typeof status>) => emit({ name: "sync.status", status: next });
const emitView = (next: ReturnType<typeof view>) => emit({ name: "sync.view", view: next });
const count = (component: string) => renders.filter((name) => name === component).length;

beforeAll(() => {
  startSyncSources(() => undefined);
});

beforeEach(() => {
  jest.useFakeTimers({ now: T });
  resetNativeMenus(true);
  withTabs(9);
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  emitStatus(status("updated", T));
  emitView(view());
  renders = [];
  jest.spyOn(perf, "countRender").mockImplementation((component: string) => {
    renders.push(component);
  });
  jest.spyOn(telemetry, "countUsage").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("a sync view equal to the one the store holds renders no deck card, keeps the store's state and counts the dropped update", () => {
  const root = renderSurface(<TabDeck />);
  expect(count("DeckCard")).toBeGreaterThan(0);
  renders = [];
  const before = useSync.getState();
  let notified = 0;
  const unsubscribe = useSync.subscribe(() => void (notified += 1));
  emitView(view());
  unsubscribe();
  expect(count("DeckCard")).toBe(0);
  expect(notified).toBe(0);
  expect(useSync.getState()).toBe(before);
  expect(telemetry.countUsage).toHaveBeenCalledWith("sync_updates_unchanged");
  unmount(root);
});

test("a sync status equal to the one the store holds notifies nobody and keeps the revision", () => {
  const root = renderSurface(<TabDeck />);
  renders = [];
  const before = useSync.getState();
  let notified = 0;
  const unsubscribe = useSync.subscribe(() => void (notified += 1));
  emitStatus(status("updated", T));
  unsubscribe();
  expect(notified).toBe(0);
  expect(useSync.getState().revision).toBe(before.revision);
  expect(useSync.getState().status).toBe(before.status);
  expect(renders).toEqual([]);
  expect(telemetry.countUsage).toHaveBeenCalledWith("sync_updates_unchanged");
  unmount(root);
});

test("a changed view still lands: new values in, and the parts that did not change keep their identity", () => {
  const before = useSync.getState();
  emitView(view({ color: "red", macTabs: 4 }));
  const after = useSync.getState();
  expect(after.revision).toBe(before.revision + 1);
  expect(after.view.profiles[0]!.color).toBe("red");
  expect(after.view.profiles[0]!.deviceTabs[0]!.tabs).toHaveLength(4);
  expect(after.view.devices).toBe(before.view.devices);
  expect(after.view.profiles[1]).toBe(before.view.profiles[1]);
  expect(after.view.profiles[0]!.history).toBe(before.view.profiles[0]!.history);
  expect(after.view.look).toBe(before.view.look);
  expect(telemetry.countUsage).not.toHaveBeenCalledWith("sync_updates_unchanged");
});

test("a changed status still lands and moves the revision", () => {
  const before = useSync.getState();
  emitStatus(status("updated", T + 15_000));
  expect(useSync.getState().status.lastSynced).toBe(T + 15_000);
  expect(useSync.getState().revision).toBe(before.revision + 1);
  expect(telemetry.countUsage).not.toHaveBeenCalledWith("sync_updates_unchanged");
});

test("a pin sent from here leaves the list once the Mac's bookmarks show it, also when the view is otherwise unchanged", () => {
  act(() => notePinSent("work", "https://bookmark3.example/"));
  act(() => notePinSent("work", "https://elsewhere.example/"));
  expect(useSync.getState().pinsOnTheirWay).toHaveLength(2);
  emitView(view());
  expect(useSync.getState().pinsOnTheirWay).toEqual(["work|elsewhere.example"]);
  const kept = useSync.getState().pinsOnTheirWay;
  emitView(view());
  expect(useSync.getState().pinsOnTheirWay).toBe(kept);
});
