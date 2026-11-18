import { appendFileSync } from "node:fs";
import { act } from "react-test-renderer";
import { startTally, stopTally, totalRenders, type RenderTally } from "./fiberCounter";
import { Surfaces } from "../../src/App";
import type { PageState } from "../../src/state/pages/store";
import { sendDeckCommand } from "../../src/state/browse/deckCommands";
import { pageStateChanged, showDeck, startBrowser, useBrowse } from "../../src/state/browse/store";
import { closeLibrary, openLibrary, useLibrary } from "../../src/state/library/store";
import { dismissSearch, presentSearch, typeSearch } from "../../src/state/search/store";
import { startSyncSources, useSync } from "../../src/state/sync/store";
import { currentTabs, useTabs } from "../../src/state/tabs/store";
import { launchTabs } from "../../src/state/tabs/tabsState";
import { setPreference } from "../../src/state/settings/store";
import { framesUntil, landOpeningPage, renderSurface, someTabs, unmount } from "../../test/render/harness";

type SyncListener = (event: Record<string, unknown>) => void;

const mockSync = { listeners: [] as SyncListener[], nativeCalls: 0 };

jest.mock("@ardia/phone-native", () => {
  const actual = jest.requireActual("@ardia/phone-native");
  return {
    ...actual,
    pages: {
      ...actual.pages,
      scrollPosition: async () => {
        mockSync.nativeCalls += 1;
        return { x: 0, y: 120 };
      },
      saveState: async () => {
        mockSync.nativeCalls += 1;
        return "saved-state";
      },
    },
    sync: {
      ...actual.sync,
      addListener: (listener: SyncListener) => {
        mockSync.listeners.push(listener);
        return { remove: () => undefined };
      },
      status: async () => null,
      view: async () => null,
      inbox: async () => [],
      localDidChange: () => {
        mockSync.nativeCalls += 1;
      },
    },
  };
});

const SIZES = (process.env.PERF_SIZES ?? "50,200,1000").split(",").map(Number);
const OUT = process.env.PERF_OUT ?? null;
const ONLY = process.env.PERF_ONLY ? new Set(process.env.PERF_ONLY.split(",")) : null;
const PLATFORM = require("react-native").Platform.OS as string;

type Result = { scenario: string; size: number; platform: string; commits: number; renders: number; mounts: number; cpuMs: number; wallMs: number; timers: number; top: [string, number][]; timerSites: [string, number][]; extra?: Record<string, number> };

const timerCalls = { count: 0, sites: new Map<string, number>() };
const TRACE_TIMERS = process.env.PERF_TIMER_SITES === "1";

function callSite() {
  const frames = (new Error().stack ?? "").split("\n").slice(3);
  if (frames.some((frame) => frame.includes("react-native-worklets/src/runLoop"))) return "ui-runtime frame (Reanimated on the UI thread on a phone)";
  const own = frames.find((frame) => /\/(src|packages\/phone\/src)\//.test(frame) && !frame.includes("scripts/perf")) ?? frames.find((frame) => !frame.includes("scripts/perf") && !frame.includes("jest-")) ?? "unknown";
  return own.trim().replace(/^at /, "").replace(/\(.*\/(apps|packages)\//, "(");
}

function wrapTimers() {
  const wrap = <F extends (...args: never[]) => unknown>(original: F) =>
    ((callback: (...inner: unknown[]) => unknown, ...rest: unknown[]) => {
      const site = TRACE_TIMERS ? callSite() : "";
      const fired = (...inner: unknown[]) => {
        timerCalls.count += 1;
        if (TRACE_TIMERS) timerCalls.sites.set(site, (timerCalls.sites.get(site) ?? 0) + 1);
        return callback(...inner);
      };
      return (original as unknown as (...args: unknown[]) => unknown)(fired, ...rest);
    }) as unknown as F;
  globalThis.setTimeout = wrap(globalThis.setTimeout);
  globalThis.setInterval = wrap(globalThis.setInterval);
  globalThis.requestAnimationFrame = wrap(globalThis.requestAnimationFrame);
}

const round = (value: number) => Math.round(value * 10) / 10;

function record(scenario: string, size: number, tally: RenderTally, cpuMs: number, wallMs: number, extra?: Record<string, number>): Result {
  const top = [...tally.renders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const timerSites = [...timerCalls.sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const result: Result = { scenario, size, platform: PLATFORM, commits: tally.commits, renders: totalRenders(tally), mounts: tally.mounts, cpuMs: round(cpuMs), wallMs: round(wallMs), timers: timerCalls.count, top, timerSites, extra };
  if (OUT) appendFileSync(OUT, `${JSON.stringify(result)}\n`);
  return result;
}

function measure(scenario: string, size: number, work: () => Record<string, number> | void) {
  timerCalls.count = 0;
  timerCalls.sites = new Map();
  startTally();
  const cpu = process.cpuUsage();
  const began = process.hrtime.bigint();
  const extra = work() ?? undefined;
  const wallMs = Number(process.hrtime.bigint() - began) / 1e6;
  const used = process.cpuUsage(cpu);
  return record(scenario, size, stopTally(), (used.user + used.system) / 1000, wallMs, extra);
}

async function measureAsync(scenario: string, size: number, work: () => Promise<void>) {
  timerCalls.count = 0;
  timerCalls.sites = new Map();
  startTally();
  const cpu = process.cpuUsage();
  const began = process.hrtime.bigint();
  await work();
  const wallMs = Number(process.hrtime.bigint() - began) / 1e6;
  const used = process.cpuUsage(cpu);
  return record(scenario, size, stopTally(), (used.user + used.system) / 1000, wallMs);
}

const T = 1_790_000_000_000;

function seedTabs(count: number) {
  useTabs.setState({ ...launchTabs(someTabs(count), 0), incognito: false, listing: 0 });
}

function remoteProfiles(tabCount: number) {
  const devices = 2;
  const per = Math.ceil(tabCount / devices);
  return ["work", "home"].map((syncId, profileIndex) => ({
    syncId,
    name: syncId === "work" ? "Work" : "Home",
    color: null,
    icon: null,
    isDefault: syncId === "work",
    theme: null,
    deviceTabs: Array.from({ length: devices }, (_, d) => ({
      deviceId: `mac${d}`,
      deviceName: `Mac ${d}`,
      kind: "mac",
      tabs: Array.from({ length: per }, (_, i) => ({ title: `Remote ${profileIndex}-${d}-${i}`, url: `https://remote${profileIndex}-${d}-${i}.example/` })),
    })),
    pinned: { tiles: [], sections: [] },
    bookmarks: [],
    history: Array.from({ length: Math.min(tabCount, 500) }, (_, i) => ({ url: `https://h${i}.example/`, title: `History ${i}`, visits: 1, lastVisit: T - i * 1000 })),
    sendTargets: null,
  }));
}

function viewEvent(tabCount: number, syncedAt: number) {
  const profiles = remoteProfiles(tabCount);
  return {
    name: "sync.view",
    view: {
      devices: [
        { id: "mac0", name: "Mac 0", kind: "mac", lastSeen: syncedAt, isCurrent: false, canReceiveTabs: true },
        { id: "this-phone", name: "Phone", kind: "phone", lastSeen: syncedAt, isCurrent: true, canReceiveTabs: false },
      ],
      profiles,
      search: null,
      syncedAt,
      selectedProfileId: "work",
      shownProfileId: "work",
      receivers: [],
    },
  };
}

function statusEvent(phase: string, syncedAt: number, pending = 0) {
  return {
    name: "sync.status",
    status: { phase, statusText: phase, stalledMessage: null, attention: "none", isEnabled: true, isSyncing: phase === "updating", isDemo: false, pendingDownloads: pending, lastSynced: syncedAt, folderName: "Ardia", deviceName: "Phone", selectedProfileId: "work", showsResetNotice: false, inboxProblem: null },
  };
}

const emit = (event: Record<string, unknown>) => act(() => mockSync.listeners.forEach((listener) => listener(event)));

const run = (name: string) => (ONLY && !ONLY.has(name) ? test.skip : test);

jest.setTimeout(900_000);

beforeAll(() => {
  startSyncSources(() => undefined);
});

beforeEach(() => {
  jest.useFakeTimers({ now: T });
  wrapTimers();
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

describe.each(SIZES)("%i items", (size) => {
  run("deckMount")("deck mount", () => {
    seedTabs(size);
    useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    let root: ReturnType<typeof renderSurface> | null = null;
    measure("deckMount", size, () => {
      root = renderSurface(<Surfaces />);
    });
    unmount(root!);
  });

  run("openAndBack")("open a card and go back to the deck, five times", async () => {
    seedTabs(size);
    useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    const root = renderSurface(<Surfaces />);
    await measureAsync("openAndBack", size, async () => {
      for (let cycle = 0; cycle < 5; cycle++) {
        act(() => sendDeckCommand({ kind: "openFocused" }));
        framesUntil(() => useBrowse.getState().opening !== null, 60);
        landOpeningPage(root);
        framesUntil(() => useBrowse.getState().surface === "browsing", 60);
        act(() => jest.advanceTimersByTime(1000));
        await act(async () => {
          await showDeck();
        });
        framesUntil(() => useBrowse.getState().surface === "deck" && useBrowse.getState().deckEntrance === null, 200);
        act(() => jest.advanceTimersByTime(1000));
      }
    });
    unmount(root);
  });

  run("pageEvents")("a page load's state events on the browsing surface", () => {
    seedTabs(size);
    useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    const root = renderSurface(<Surfaces />);
    landOpeningPage(root);
    act(() => jest.advanceTimersByTime(2000));
    const id = currentTabs().selectedId!;
    const base: PageState = { url: "https://site0.example/next", title: "", progress: 0, isLoading: true, canGoBack: true, canGoForward: false, faviconUrl: null, themeColor: null, backgroundColor: null, security: "secure", failure: null, pageZoom: 1, isDesktopSite: false, scrollDirection: "up", isScrolledToTop: true, blockedRequests: 0, isLive: true, isPrivate: false };
    measure("pageEvents", size, () => {
      for (let step = 0; step <= 20; step++) {
        act(() => pageStateChanged(id, { ...base, progress: step / 20, isLoading: step < 20, title: step >= 10 ? "Next page" : "" }));
        act(() => jest.advanceTimersByTime(50));
      }
    });
    unmount(root);
  });

  run("searchTyping")("open the tray, type twelve characters, dismiss", () => {
    seedTabs(size);
    useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    const root = renderSurface(<Surfaces />);
    act(() => jest.advanceTimersByTime(2000));
    measure("searchTyping", size, () => {
      act(() => presentSearch("page"));
      act(() => jest.advanceTimersByTime(500));
      const word = "site1 exampl";
      for (let i = 1; i <= word.length; i++) {
        act(() => typeSearch(word.slice(0, i)));
        act(() => jest.advanceTimersByTime(16));
      }
      act(() => dismissSearch());
      act(() => jest.advanceTimersByTime(800));
    });
    unmount(root);
  });

  run("syncRound")("a sync round: updating, a new view, updated", () => {
    seedTabs(Math.min(size, 50));
    useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    emit(statusEvent("updated", T - 60_000));
    emit(viewEvent(size, T - 60_000));
    const root = renderSurface(<Surfaces />);
    act(() => jest.advanceTimersByTime(2000));
    measure("syncRound", size, () => {
      emit(statusEvent("updating", T - 60_000, 2));
      emit(statusEvent("updating", T - 60_000, 1));
      emit(viewEvent(size, T));
      emit(statusEvent("updated", T));
      act(() => jest.advanceTimersByTime(1000));
    });
    measure("syncRoundUnchanged", size, () => {
      emit(statusEvent("updating", T, 0));
      emit(viewEvent(size, T));
      emit(statusEvent("updated", T));
      act(() => jest.advanceTimersByTime(1000));
    });
    unmount(root);
  });

  run("spacesSheet")("open and close Spaces three times with synced tabs", () => {
    seedTabs(Math.min(size, 50));
    emit(statusEvent("updated", T));
    emit(viewEvent(size, T));
    useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    const root = renderSurface(<Surfaces />);
    act(() => jest.advanceTimersByTime(2000));
    measure("spacesSheet", size, () => {
      for (let cycle = 0; cycle < 3; cycle++) {
        act(() => useBrowse.setState({ sheet: "spaces" }));
        act(() => jest.advanceTimersByTime(800));
        act(() => useBrowse.setState({ sheet: null }));
        act(() => jest.advanceTimersByTime(800));
      }
    });
    unmount(root);
  });

  run("librarySheet")("open and close History three times", () => {
    seedTabs(Math.min(size, 50));
    useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    const root = renderSurface(<Surfaces />);
    act(() => jest.advanceTimersByTime(2000));
    const entries = Array.from({ length: size }, (_, i) => ({ id: i + 1, url: `https://h${i}.example/`, title: `History ${i}`, visitedAt: T - i * 60_000, profileSyncId: null }));
    measure("librarySheet", size, () => {
      for (let cycle = 0; cycle < 3; cycle++) {
        act(() => openLibrary("history"));
        act(() => useLibrary.setState({ history: entries as never, historyLoaded: true }));
        act(() => jest.advanceTimersByTime(800));
        act(() => closeLibrary());
        act(() => jest.advanceTimersByTime(800));
      }
    });
    unmount(root);
  });

  run("archiveSheet")("open and close the archive three times", () => {
    const tabs = someTabs(size).map((tab, i) => (i < size - 5 ? { ...tab, archivedAt: T - i * 1000 } : tab));
    useTabs.setState({ ...launchTabs(tabs, 0), incognito: false, listing: 0 });
    useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    const root = renderSurface(<Surfaces />);
    act(() => jest.advanceTimersByTime(2000));
    measure("archiveSheet", size, () => {
      for (let cycle = 0; cycle < 3; cycle++) {
        act(() => useBrowse.setState({ sheet: "archive" }));
        act(() => jest.advanceTimersByTime(800));
        act(() => useBrowse.setState({ sheet: null }));
        act(() => jest.advanceTimersByTime(800));
      }
    });
    unmount(root);
  });

  run("idle")("sixty idle seconds on a page and on the deck", async () => {
    seedTabs(size);
    useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    const root = renderSurface(<Surfaces />);
    landOpeningPage(root);
    act(() => jest.advanceTimersByTime(5000));
    measure("idlePage", size, () => {
      for (let second = 0; second < 60; second++) act(() => jest.advanceTimersByTime(1000));
      return { pending: jest.getTimerCount() };
    });
    await act(async () => {
      await showDeck();
    });
    framesUntil(() => useBrowse.getState().surface === "deck" && useBrowse.getState().deckEntrance === null, 400);
    act(() => jest.advanceTimersByTime(5000));
    measure("idleDeck", size, () => {
      for (let second = 0; second < 60; second++) act(() => jest.advanceTimersByTime(1000));
      return { pending: jest.getTimerCount() };
    });
    unmount(root);
  });
});

describe("the started app", () => {
  run("idleStarted")("sixty idle seconds on a page and on the deck, with the browser's own timers running", async () => {
    setPreference("hasFinishedOnboarding", true);
    setPreference("autoOpensKeyboard", false);
    startBrowser();
    seedTabs(50);
    useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
    const root = renderSurface(<Surfaces />);
    landOpeningPage(root);
    await act(async () => void jest.advanceTimersByTime(5000));
    mockSync.nativeCalls = 0;
    measure("idleStartedPage", 50, () => {
      for (let second = 0; second < 60; second++) act(() => jest.advanceTimersByTime(1000));
      return { nativeCalls: mockSync.nativeCalls };
    });
    await act(async () => {
      await showDeck();
    });
    framesUntil(() => useBrowse.getState().surface === "deck" && useBrowse.getState().deckEntrance === null, 400);
    act(() => jest.advanceTimersByTime(5000));
    mockSync.nativeCalls = 0;
    measure("idleStartedDeck", 50, () => {
      for (let second = 0; second < 60; second++) act(() => jest.advanceTimersByTime(1000));
      return { nativeCalls: mockSync.nativeCalls };
    });
    unmount(root);
  });
});
