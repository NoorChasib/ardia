import { Platform } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { renderSurface, someTabs, unmount } from "../../test/render/harness";
import { resetNativeMenus } from "./nativeMenusMock";

jest.mock("@ardia/phone-native", () => require("./nativeMenusMock").nativeMenusModule(jest.requireActual("@ardia/phone-native")));

const { TabDeck } = require("../components/tabs/TabDeck") as typeof import("../components/tabs/TabDeck");
const { DesignProvider } = require("../components/ui") as typeof import("../components/ui");
const perf = require("../state/app/interactionPerf") as typeof import("../state/app/interactionPerf");
const { useArchiveCard } = require("../state/browse/archiveCard") as typeof import("../state/browse/archiveCard");
const deckGrid = require("../state/browse/deckGrid") as typeof import("../state/browse/deckGrid");
const browse = require("../state/browse/store") as typeof import("../state/browse/store");
const { setRootSize } = require("../state/app/rootSize") as typeof import("../state/app/rootSize");
const { writePreference } = require("../state/store/browserDatabase") as typeof import("../state/store/browserDatabase");
const { browserDatabase } = require("../state/store/database") as typeof import("../state/store/database");
const { OFF_STATUS, useSync } = require("../state/sync/store") as typeof import("../state/sync/store");
const telemetry = require("../state/telemetry/telemetry") as typeof import("../state/telemetry/telemetry");
const tabStore = require("../state/tabs/store") as typeof import("../state/tabs/store");
const { launchTabs } = require("../state/tabs/tabsState") as typeof import("../state/tabs/tabsState");

type Root = ReturnType<typeof renderSurface>;

const onIPhone = Platform.OS === "ios" ? test : test.skip;

let renders: string[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  resetNativeMenus(true);
  writePreference(browserDatabase(), deckGrid.DECK_GRID_KEY, "true");
  act(() => deckGrid.forgetDeckGrid());
  act(() => {
    tabStore.useTabs.setState({ ...launchTabs(someTabs(200), 0), incognito: false, listing: 0 });
    useArchiveCard.setState({ showing: false });
    setRootSize(402, 874);
    browse.useBrowse.setState({ surface: "deck", sheet: null, deckEntrance: null, frozenOrder: null, opening: null, leaving: null });
    useSync.setState((state) => ({ ...state, status: OFF_STATUS, view: { devices: [], profiles: [], search: null, syncedAt: null, selectedProfileId: null, receivers: [] } }));
  });
  jest.spyOn(telemetry, "countUsage").mockImplementation(() => undefined);
  renders = [];
  jest.spyOn(perf, "countRender").mockImplementation((component: string) => {
    renders.push(component);
  });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  act(() => setRootSize(0, 0));
  writePreference(browserDatabase(), deckGrid.DECK_GRID_KEY, null);
  act(() => deckGrid.forgetDeckGrid());
  resetNativeMenus();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const deck = () =>
  renderSurface(
    <DesignProvider design="redesigned">
      <TabDeck />
    </DesignProvider>,
  );

const settle = () => act(() => jest.advanceTimersByTime(1000));
const count = (component: string) => renders.filter((name) => name === component).length;
const cellPlaces = (root: Root): ReactTestInstance[] => root.root.findAll((node) => node.props.testID === "tabGridCell" && typeof node.type !== "string" && node.props.layout !== undefined && node.parent?.props.testID !== "tabGridCell");
const layouts = (root: Root) => new Map(cellPlaces(root).map((cell) => [cell.props.layout, cell]));
const reconfigured = (root: Root, before: ReadonlyMap<unknown, unknown>) => cellPlaces(root).filter((cell) => !before.has(cell.props.layout)).length;
const labels = (root: Root) => root.root.findAll((node) => node.props.testID === "tabGridCard" && typeof node.type === "string").map((card) => card.props.accessibilityLabel);

onIPhone("a deck render that changes nothing in the grid renders no grid and reconfigures no cell's layout animation, on 200 tabs", () => {
  const root = deck();
  settle();
  expect(cellPlaces(root)).toHaveLength(200);
  const shown = labels(root);
  const before = layouts(root);
  renders = [];
  const header = root.root.findAll((node) => typeof node.props.onMenu === "function" && typeof node.props.onCloseAll === "function" && typeof node.type !== "string")[0]!;
  act(() => header.props.onMenu(true));
  settle();
  act(() => header.props.onMenu(false));
  settle();
  expect(count("TabDeck")).toBeGreaterThan(0);
  expect(reconfigured(root, before)).toBe(0);
  expect(count("TabGrid")).toBe(0);
  expect(labels(root)).toEqual(shown);
  unmount(root);
});

onIPhone("a renamed tab re-renders its own grid cell only, and the grid shows the new title in the same place", () => {
  const root = deck();
  settle();
  const before = layouts(root);
  const shown = labels(root);
  renders = [];
  act(() => tabStore.updateTabById("t42", { title: "Renamed" }));
  settle();
  expect(reconfigured(root, before)).toBe(0);
  expect(count("TabGridCell")).toBe(1);
  expect(labels(root)).toEqual(shown.map((label) => (label === "Site 42" ? "Renamed" : label)));
  unmount(root);
});

onIPhone("closing a tab from the grid removes its cell and keeps every other cell's layout animation", () => {
  jest.spyOn(browse, "closeTabFromDeck").mockImplementation((id) => tabStore.useTabs.setState((state) => ({ ...state, open: state.open.filter((tab) => tab.id !== id) })));
  const root = deck();
  settle();
  const before = layouts(root);
  const close = root.root.findAll((node) => node.props.testID === "tabGridClose" && typeof node.props.onPress === "function")[7]!;
  const closing = labels(root)[7];
  act(() => close.props.onPress());
  settle();
  expect(cellPlaces(root)).toHaveLength(199);
  expect(labels(root)).not.toContain(closing);
  expect(reconfigured(root, before)).toBe(0);
  unmount(root);
});
