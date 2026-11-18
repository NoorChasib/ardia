import { act } from "react-test-renderer";
import { TabDeck } from "../components/tabs/TabDeck";
import { DesignProvider } from "../components/ui";
import * as perf from "../state/app/interactionPerf";
import { useBrowse } from "../state/browse/store";
import * as telemetry from "../state/telemetry/telemetry";
import { useTabs } from "../state/tabs/store";
import { launchTabs } from "../state/tabs/tabsState";
import { renderSurface, someTabs, textOf, unmount, withTabs } from "../../test/render/harness";

let renders: string[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  renders = [];
  jest.spyOn(perf, "countRender").mockImplementation((component: string) => {
    renders.push(component);
  });
  useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Root = ReturnType<typeof renderSurface>;

const deck = () =>
  renderSurface(
    <DesignProvider design="redesigned">
      <TabDeck />
    </DesignProvider>,
  );

const searchField = (root: Root) => root.root.findAll((node) => node.props.testID === "deckSearchField" && typeof node.props.onChangeText === "function")[0]!;
const type = (root: Root, text: string) => act(() => searchField(root).props.onChangeText(text));
const deckRenders = () => renders.filter((component) => component === "TabDeck").length;
const cardTitles = (root: Root) =>
  root.root
    .findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string")
    .map((card) => textOf({ root: card } as Root).split("\n")[0])
    .sort();

function countNormalize(work: () => void): number {
  const original = String.prototype.normalize;
  let calls = 0;
  const spy = jest.spyOn(String.prototype, "normalize").mockImplementation(function (this: string, form?: string) {
    calls += 1;
    return original.call(this, form);
  });
  try {
    work();
  } finally {
    spy.mockRestore();
  }
  return calls;
}

test("a Search Tabs keystroke on 200 tabs folds only what it typed, once, and filters and reorders the deck in a single TabDeck render", () => {
  withTabs(200);
  const root = deck();
  act(() => jest.advanceTimersByTime(600));
  type(root, "site 1");
  act(() => jest.advanceTimersByTime(600));
  renders = [];
  const folds = countNormalize(() => type(root, "site 19"));
  expect(folds).toBeLessThanOrEqual(1);
  expect(deckRenders()).toBe(1);
  act(() => jest.advanceTimersByTime(600));
  expect(cardTitles(root)).toEqual(["Site 190", "Site 191", "Site 192", "Site 193", "Site 194", "Site 195", "Site 196", "Site 197", "Site 198", "Site 199"]);
  renders = [];
  const clearFolds = countNormalize(() => type(root, ""));
  expect(clearFolds).toBe(0);
  expect(deckRenders()).toBe(1);
  act(() => jest.advanceTimersByTime(600));
  expect(cardTitles(root)).toEqual(["Site 190", "Site 191", "Site 192", "Site 193", "Site 194", "Site 195", "Site 196", "Site 197", "Site 198", "Site 199"]);
  expect(searchField(root).props.value).toBe("");
  unmount(root);
});

test("a tab whose title changes is folded again, so Search Tabs never matches a stale title", () => {
  withTabs(30);
  const root = deck();
  type(root, "renamed");
  act(() => jest.advanceTimersByTime(600));
  expect(cardTitles(root)).toEqual([]);
  type(root, "");
  act(() => jest.advanceTimersByTime(600));
  act(() => useTabs.setState((state) => ({ open: state.open.map((tab) => (tab.id === "t4" ? { ...tab, title: "Renamed Café" } : tab)) })));
  type(root, "renamed cafe");
  act(() => jest.advanceTimersByTime(600));
  expect(cardTitles(root)).toEqual(["Renamed Café"]);
  unmount(root);
});

test("a Search Tabs keystroke whose filter and order take longer than a frame counts deck_searches_late, a quick one doesn't, and incognito never counts", () => {
  const counted = jest.spyOn(telemetry, "countUsage").mockImplementation(() => undefined);
  const lateCounts = () => counted.mock.calls.filter(([field]) => field === "deck_searches_late").length;
  const original = String.prototype.normalize;
  let foldCostMs = 0;
  jest.spyOn(String.prototype, "normalize").mockImplementation(function (this: string, form?: string) {
    if (foldCostMs) jest.setSystemTime(Date.now() + foldCostMs);
    return original.call(this, form);
  });
  withTabs(20);
  const root = deck();
  type(root, "site 1");
  expect(lateCounts()).toBe(0);
  foldCostMs = 20;
  type(root, "site 12");
  expect(lateCounts()).toBe(1);
  foldCostMs = 0;
  unmount(root);
  counted.mockClear();
  act(() => useTabs.setState({ ...launchTabs(someTabs(20, true), 0), incognito: true, listing: 0 }));
  const privately = deck();
  foldCostMs = 20;
  type(privately, "site 1");
  expect(lateCounts()).toBe(0);
  foldCostMs = 0;
  unmount(privately);
});
