import { appendFileSync } from "node:fs";
import { act } from "react-test-renderer";
import { startTally, stopTally, totalRenders, type RenderTally } from "./fiberCounter";
import { TabDeck } from "../../src/components/tabs/TabDeck";
import { DesignProvider } from "../../src/components/ui";
import { setRootSize } from "../../src/state/app/rootSize";
import { forgetDeckGrid, DECK_GRID_KEY } from "../../src/state/browse/deckGrid";
import { useBrowse } from "../../src/state/browse/store";
import { writePreference } from "../../src/state/store/browserDatabase";
import { browserDatabase } from "../../src/state/store/database";
import { updateTabById, useTabs } from "../../src/state/tabs/store";
import { launchTabs } from "../../src/state/tabs/tabsState";
import { renderSurface, someTabs, unmount } from "../../test/render/harness";

const SIZES = (process.env.PERF_SIZES ?? "50,200,1000").split(",").map(Number);
const OUT = process.env.PERF_OUT ?? null;
const ONLY = process.env.PERF_ONLY ? new Set(process.env.PERF_ONLY.split(",")) : null;
const PLATFORM = require("react-native").Platform.OS as string;

const round = (value: number) => Math.round(value * 10) / 10;

function measure(scenario: string, size: number, work: () => void) {
  startTally();
  const cpu = process.cpuUsage();
  const began = process.hrtime.bigint();
  work();
  const wallMs = Number(process.hrtime.bigint() - began) / 1e6;
  const used = process.cpuUsage(cpu);
  const tally: RenderTally = stopTally();
  const top = [...tally.renders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const result = { scenario, size, platform: PLATFORM, commits: tally.commits, renders: totalRenders(tally), mounts: tally.mounts, cpuMs: round((used.user + used.system) / 1000), wallMs: round(wallMs), timers: 0, frames: 0, top, timerSites: [] };
  if (OUT) appendFileSync(OUT, `${JSON.stringify(result)}\n`);
}

const run = (name: string) => (ONLY && !ONLY.has(name) ? test.skip : test);
const onIPhone = (name: string) => (PLATFORM === "ios" ? run(name) : test.skip);

const deck = () =>
  renderSurface(
    <DesignProvider design="redesigned">
      <TabDeck />
    </DesignProvider>,
  );

const settle = (ms = 1000) => act(() => jest.advanceTimersByTime(ms));

function seed(size: number, grid: boolean) {
  writePreference(browserDatabase(), DECK_GRID_KEY, grid ? "true" : null);
  act(() => forgetDeckGrid());
  act(() => {
    useTabs.setState({ ...launchTabs(someTabs(size), 0), incognito: false, listing: 0 });
    setRootSize(402, 874);
    useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null, leaving: null });
  });
}

jest.setTimeout(900_000);

beforeEach(() => {
  jest.useFakeTimers({ now: 1_790_000_000_000 });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  writePreference(browserDatabase(), DECK_GRID_KEY, null);
  act(() => forgetDeckGrid());
  act(() => setRootSize(0, 0));
  jest.useRealTimers();
});

describe.each(SIZES)("%i tabs", (size) => {
  run("deckSearch")("type eight characters into Search Tabs, then clear it", () => {
    seed(size, false);
    const root = deck();
    settle();
    const field = () => root.root.findAll((node) => node.props.testID === "deckSearchField" && typeof node.props.onChangeText === "function")[0]!;
    measure("deckSearch", size, () => {
      const word = "site 1 e";
      for (let i = 1; i <= word.length; i++) {
        act(() => field().props.onChangeText(word.slice(0, i)));
        settle(16);
      }
      act(() => field().props.onChangeText(""));
      settle(600);
    });
    unmount(root);
  });

  onIPhone("gridDeckRenders")("the grid on: open and close the header menu five times, then ten tabs change title", () => {
    seed(size, true);
    const root = deck();
    settle();
    const header = root.root.findAll((node) => typeof node.props.onMenu === "function" && typeof node.props.onCloseAll === "function" && typeof node.type !== "string")[0]!;
    measure("gridDeckRenders", size, () => {
      for (let cycle = 0; cycle < 5; cycle++) {
        act(() => header.props.onMenu(true));
        settle(100);
        act(() => header.props.onMenu(false));
        settle(100);
      }
      for (let i = 0; i < 10; i++) {
        act(() => updateTabById(`t${(i * 7) % size}`, { title: `Title ${i}` }));
        settle(50);
      }
    });
    unmount(root);
  });
});
