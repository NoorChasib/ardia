import { appendFileSync } from "node:fs";
import { act } from "react-test-renderer";
import { Surfaces } from "../../src/App";
import { sendDeckCommand } from "../../src/state/browse/deckCommands";
import { showDeck, useBrowse } from "../../src/state/browse/store";
import { closeLibrary, openLibrary, useLibrary } from "../../src/state/library/store";
import { dismissSearch, presentSearch, typeSearch } from "../../src/state/search/store";
import { useTabs } from "../../src/state/tabs/store";
import { launchTabs } from "../../src/state/tabs/tabsState";
import { framesUntil, landOpeningPage, renderSurface, someTabs, unmount } from "../../test/render/harness";

const OUT = process.env.PERF_OUT ?? null;
const ONLY = process.env.PERF_ONLY ? new Set(process.env.PERF_ONLY.split(",")) : null;
const PLATFORM = require("react-native").Platform.OS as string;
const T = 1_790_000_000_000;
const CYCLES = 20;

const collect = () => (globalThis as { gc?: () => void }).gc?.();

function heapAfterCollecting() {
  jest.clearAllMocks();
  for (let pass = 0; pass < 3; pass++) collect();
  return process.memoryUsage().heapUsed;
}

function report(scenario: string, size: number, perCycleBytes: number[]) {
  const sorted = [...perCycleBytes].sort((a, b) => a - b);
  const row = { scenario, size, platform: PLATFORM, commits: 0, renders: 0, mounts: 0, cpuMs: 0, wallMs: 0, timers: 0, frames: 0, top: [], timerSites: [], extra: { retainedKbPerCycle: Math.round(sorted[Math.floor(sorted.length / 2)]! / 102.4) / 10 } };
  if (OUT) appendFileSync(OUT, `${JSON.stringify(row)}\n`);
}

const run = (name: string) => (ONLY?.has(name) ? test : test.skip);

jest.setTimeout(900_000);

beforeEach(() => {
  jest.useFakeTimers({ now: T });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

async function retainedPerCycle(scenario: string, cycle: () => Promise<void>) {
  for (let warm = 0; warm < 3; warm++) await cycle();
  if (process.env.PERF_HEAP_SNAPSHOT && process.env.PERF_HEAP_SNAPSHOT_OF === scenario) {
    heapAfterCollecting();
    require("node:v8").writeHeapSnapshot(`${process.env.PERF_HEAP_SNAPSHOT}-a.heapsnapshot`);
    for (let i = 0; i < 10; i++) await cycle();
    heapAfterCollecting();
    require("node:v8").writeHeapSnapshot(`${process.env.PERF_HEAP_SNAPSHOT}-b.heapsnapshot`);
    process.env.PERF_HEAP_SNAPSHOT = "";
  }
  const marks: number[] = [heapAfterCollecting()];
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < CYCLES; i++) await cycle();
    marks.push(heapAfterCollecting());
  }
  return marks.slice(1).map((mark, i) => (mark - marks[i]!) / CYCLES);
}

run("heapCycles")("heap kept per open and close cycle of the deck, the tray, History and the archive", async () => {
  const size = 200;
  const tabs = someTabs(size + 200).map((tab, i) => (i >= size ? { ...tab, archivedAt: T - i * 1000 } : tab));
  useTabs.setState({ ...launchTabs(tabs, 0), incognito: false, listing: 0 });
  useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  const root = renderSurface(<Surfaces />);
  landOpeningPage(root);
  act(() => jest.advanceTimersByTime(2000));
  const history = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, url: `https://h${i}.example/`, title: `History ${i}`, visitedAt: T - i * 60_000, profileSyncId: null }));

  report(
    "heapDeckCycle",
    size,
    await retainedPerCycle("heapDeckCycle", async () => {
      await act(async () => {
        await showDeck();
      });
      framesUntil(() => useBrowse.getState().surface === "deck" && useBrowse.getState().deckEntrance === null, 200);
      act(() => sendDeckCommand({ kind: "openFocused" }));
      framesUntil(() => useBrowse.getState().opening !== null, 60);
      landOpeningPage(root);
      framesUntil(() => useBrowse.getState().surface === "browsing", 60);
      act(() => jest.advanceTimersByTime(1000));
    }),
  );
  report(
    "heapTrayCycle",
    size,
    await retainedPerCycle("heapTrayCycle", async () => {
      act(() => presentSearch("page"));
      act(() => jest.advanceTimersByTime(300));
      for (const text of ["s", "si", "sit", "site"]) {
        act(() => typeSearch(text));
        act(() => jest.advanceTimersByTime(16));
      }
      act(() => dismissSearch());
      act(() => jest.advanceTimersByTime(800));
    }),
  );
  report(
    "heapHistoryCycle",
    size,
    await retainedPerCycle("heapHistoryCycle", async () => {
      act(() => openLibrary("history"));
      act(() => useLibrary.setState({ history: history as never, historyLoaded: true }));
      act(() => jest.advanceTimersByTime(800));
      act(() => closeLibrary());
      act(() => jest.advanceTimersByTime(800));
    }),
  );
  report(
    "heapArchiveCycle",
    size,
    await retainedPerCycle("heapArchiveCycle", async () => {
      act(() => useBrowse.setState({ sheet: "archive" }));
      act(() => jest.advanceTimersByTime(800));
      act(() => useBrowse.setState({ sheet: null }));
      act(() => jest.advanceTimersByTime(800));
    }),
  );
  unmount(root);
});
