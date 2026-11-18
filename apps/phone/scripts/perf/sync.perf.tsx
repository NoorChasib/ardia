import { appendFileSync } from "node:fs";
import { act } from "react-test-renderer";
import { startTally, stopTally, totalRenders } from "./fiberCounter";
import { framesUntil, renderSurface, someTabs, unmount } from "../../test/render/harness";

type SyncListener = (event: Record<string, unknown>) => void;

const mockSyncPerf = { listeners: [] as SyncListener[], contextMenus: false };

jest.mock("@ardia/phone-native", () => {
  const actual = jest.requireActual("@ardia/phone-native");
  const { createElement } = require("react");
  return {
    ...actual,
    nativeMenusAvailable: () => ({ contextMenu: mockSyncPerf.contextMenus, actionSheet: mockSyncPerf.contextMenus }),
    ContextMenuView: function ContextMenuView({ children, ref: _ref, ...props }: { children?: unknown; ref?: unknown }) {
      return createElement("ContextMenuView", props, children);
    },
    sync: {
      ...actual.sync,
      addListener: (listener: SyncListener) => {
        mockSyncPerf.listeners.push(listener);
        return { remove: () => undefined };
      },
      status: async () => null,
      view: async () => null,
      inbox: async () => [],
      localDidChange: () => undefined,
    },
  };
});

const { Surfaces } = require("../../src/App") as typeof import("../../src/App");
const { showDeck, useBrowse } = require("../../src/state/browse/store") as typeof import("../../src/state/browse/store");
const { closeLibrary, openLibrary } = require("../../src/state/library/store") as typeof import("../../src/state/library/store");
const { history } = require("../../src/state/history/store") as typeof import("../../src/state/history/store");
const { startSyncSources } = require("../../src/state/sync/store") as typeof import("../../src/state/sync/store");
const { useTabs } = require("../../src/state/tabs/store") as typeof import("../../src/state/tabs/store");
const { launchTabs } = require("../../src/state/tabs/tabsState") as typeof import("../../src/state/tabs/tabsState");

const SIZES = (process.env.PERF_SIZES ?? "50,200,1000").split(",").map(Number);
const OUT = process.env.PERF_OUT ?? null;
const ONLY = process.env.PERF_ONLY ? new Set(process.env.PERF_ONLY.split(",")) : null;
const PLATFORM = require("react-native").Platform.OS as string;
const T = 1_790_000_000_000;
const TICK_MS = 15_000;
const TICKS = 4;

const round = (value: number) => Math.round(value * 10) / 10;

function measure(scenario: string, size: number, work: () => Record<string, number> | void) {
  startTally();
  const cpu = process.cpuUsage();
  const began = process.hrtime.bigint();
  const extra = work() ?? undefined;
  const wallMs = Number(process.hrtime.bigint() - began) / 1e6;
  const used = process.cpuUsage(cpu);
  const tally = stopTally();
  const top = [...tally.renders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const result = { scenario, size, platform: PLATFORM, commits: tally.commits, renders: totalRenders(tally), mounts: tally.mounts, cpuMs: round((used.user + used.system) / 1000), wallMs: round(wallMs), timers: 0, top, timerSites: [], extra };
  if (OUT) appendFileSync(OUT, `${JSON.stringify(result)}\n`);
}

const statusEvent = (lastSynced: number, phase = "updated") => ({
  name: "sync.status",
  status: { phase, statusText: phase, stalledMessage: null, attention: "none", isEnabled: true, isSyncing: phase === "updating", isDemo: false, pendingDownloads: 0, lastSynced, folderName: "Ardia", deviceName: "Phone", selectedProfileId: "work", showsResetNotice: false, inboxProblem: null },
});

function viewEvent(tabCount: number, macTitle = "Mac") {
  const per = Math.ceil(tabCount / 2);
  return {
    name: "sync.view",
    view: {
      devices: [
        { id: "mac0", name: "Mac 0", kind: "mac", lastSeen: T, isCurrent: false, canReceiveTabs: true },
        { id: "this-phone", name: "Phone", kind: "phone", lastSeen: T, isCurrent: true, canReceiveTabs: false },
      ],
      profiles: ["work", "home"].map((syncId, p) => ({
        syncId,
        name: syncId === "work" ? "Work" : "Home",
        color: syncId === "work" ? "blue" : "green",
        icon: null,
        isDefault: syncId === "work",
        theme: syncId === "work" ? { colors: ["#3366CC", "#6699FF"], darkColors: null } : null,
        deviceTabs: [0, 1].map((d) => ({
          deviceId: `mac${d}`,
          deviceName: `Mac ${d}`,
          kind: "mac",
          tabs: Array.from({ length: per }, (_, i) => ({ title: d === 0 && i === 0 && syncId === "work" ? macTitle : `Remote ${p}-${d}-${i}`, url: `https://remote${p}-${d}-${i}.example/` })),
        })),
        pinned: { tiles: [], sections: [] },
        bookmarks: Array.from({ length: Math.min(tabCount, 300) }, (_, i) => ({ key: `b${p}-${i}`, title: `Bookmark ${i}`, url: `https://bookmark${p}-${i}.example/`, added: T, root: null, children: null })),
        history: Array.from({ length: Math.min(tabCount, 500) }, (_, i) => ({ url: `https://h${i}.example/`, title: `History ${i}`, visits: 1, lastVisit: T - i * 1000 })),
        sendTargets: ["mac0"],
      })),
      search: null,
      look: { interfaceStyle: "glass", appearance: "auto" },
      syncedAt: T,
      selectedProfileId: "work",
      shownProfileId: "work",
      receivers: [],
    },
  };
}

const emit = (event: Record<string, unknown>) => act(() => mockSyncPerf.listeners.forEach((listener) => listener(event)));

const run = (name: string) => (ONLY && !ONLY.has(name) ? test.skip : test);

function seed(size: number, surface: "browsing" | "deck") {
  useTabs.setState({ ...launchTabs(someTabs(Math.min(size, 50)), 0), incognito: false, listing: 0 });
  useBrowse.setState({ surface, sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  emit(statusEvent(T));
  emit(viewEvent(size));
}

function ticks(from: number) {
  for (let tick = 1; tick <= TICKS; tick++) {
    emit(statusEvent(from + tick * TICK_MS));
    act(() => jest.advanceTimersByTime(TICK_MS));
  }
}

jest.setTimeout(900_000);

beforeAll(() => {
  startSyncSources(() => undefined);
});

beforeEach(() => {
  jest.useFakeTimers({ now: T });
  mockSyncPerf.contextMenus = PLATFORM === "ios";
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

describe.each(SIZES)("%i items", (size) => {
  run("syncMacTabs")("three views that change one Mac tab's title, on a page", () => {
    seed(size, "browsing");
    const root = renderSurface(<Surfaces />);
    act(() => jest.advanceTimersByTime(2000));
    measure("syncMacTabs", size, () => {
      for (let change = 1; change <= 3; change++) emit(viewEvent(size, `Mac ${change}`));
      act(() => jest.advanceTimersByTime(1000));
    });
    unmount(root);
  });

  run("syncTicks")("four lastSynced ticks on a page and on the deck", async () => {
    seed(size, "browsing");
    const root = renderSurface(<Surfaces />);
    act(() => jest.advanceTimersByTime(2000));
    measure("syncTicksPage", size, () => ticks(T));
    await act(async () => {
      await showDeck();
    });
    framesUntil(() => useBrowse.getState().surface === "deck" && useBrowse.getState().deckEntrance === null, 400);
    act(() => jest.advanceTimersByTime(2000));
    measure("syncTicksDeck", size, () => ticks(T + TICKS * TICK_MS));
    unmount(root);
  });

  run("syncTicksSpaces")("four lastSynced ticks with the Spaces sheet open", () => {
    seed(size, "browsing");
    const root = renderSurface(<Surfaces />);
    act(() => jest.advanceTimersByTime(2000));
    act(() => useBrowse.setState({ sheet: "spaces" }));
    act(() => jest.advanceTimersByTime(800));
    measure("syncTicksSpaces", size, () => ticks(T));
    act(() => useBrowse.setState({ sheet: null }));
    unmount(root);
  });

  run("syncTicksLibrary")("four lastSynced ticks with History open", () => {
    seed(size, "browsing");
    const root = renderSurface(<Surfaces />);
    act(() => jest.advanceTimersByTime(2000));
    act(() => openLibrary("history"));
    act(() => jest.advanceTimersByTime(800));
    const search = jest.spyOn(history(), "search");
    measure("syncTicksLibrary", size, () => {
      ticks(T);
      return { historySearches: search.mock.calls.length };
    });
    search.mockRestore();
    act(() => closeLibrary());
    unmount(root);
  });
});
