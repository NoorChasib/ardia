import { act } from "react-test-renderer";
import { BrowsingScreen } from "../components/browsing/BrowsingScreen";
import { DesignProvider } from "../components/ui";
import type { Design } from "../lib/design";
import * as perf from "../state/app/interactionPerf";
import { useBrowse } from "../state/browse/store";
import { openPageMenu } from "../state/page/actions";
import { usePageUi } from "../state/page/store";
import { storeNavigation, storeTone, usePages, type PageState } from "../state/pages/store";
import { rememberPageTones } from "../state/pages/toneMemory";
import * as browserDatabase from "../state/store/browserDatabase";
import { setPreference } from "../state/settings/store";
import { swipeOrder } from "../state/browse/store";
import { currentTabs, updateTabById } from "../state/tabs/store";
import * as tabModels from "../state/tabs/tabModels";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

let renders: string[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(9);
  usePages.setState({ navigation: {}, tones: {}, lastTones: {}, heldTones: {} });
  usePageUi.setState({ findOpen: false, menuOpen: false });
  useBrowse.setState({ surface: "browsing", sheet: null, deckEntrance: null, frozenOrder: null, opening: null });
  jest.spyOn(perf, "countRender").mockImplementation((component: string) => void renders.push(component));
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
  setPreference("collapsesBottomBar", false);
});

const front = () => currentTabs().open.find((tab) => tab.id === currentTabs().selectedId)!;

const state = (scrollDirection: "up" | "down", url = "https://site8.example/"): PageState => ({ url, title: "Site 8", progress: 1, isLoading: false, canGoBack: false, canGoForward: false, faviconUrl: null, themeColor: null, backgroundColor: null, security: "secure", failure: null, pageZoom: 1, isDesktopSite: false, scrollDirection, isScrolledToTop: false, blockedRequests: 0, isLive: true, isPrivate: false });

const settle = () => {
  for (let frame = 0; frame < 60; frame++) act(() => jest.advanceTimersByTime(16));
};

const page = async (design: Design = "redesigned") => {
  act(() => storeNavigation(front().id, state("up")));
  const root = renderSurface(
    <DesignProvider design={design}>
      <BrowsingScreen tab={front()} />
    </DesignProvider>,
  );
  settle();
  await act(async () => undefined);
  for (const direction of ["down", "up"] as const) {
    act(() => storeNavigation(front().id, state(direction)));
    settle();
  }
  renders = [];
  return root;
};

const screenRenders = () => renders.filter((component) => component === "BrowsingScreen").length;

const flip = (scrollDirection: "up" | "down", url?: string) => {
  renders = [];
  act(() => storeNavigation(front().id, state(scrollDirection, url)));
  return screenRenders();
};

test("a scroll direction flip renders the page chrome once when the bar collapses (twice when the iPhone pill mounts), and not at all when it doesn't", async () => {
  setPreference("collapsesBottomBar", true);
  const root = await page();
  expect([flip("down"), flip("up"), flip("down"), flip("down", "https://site8.example/next")]).toEqual([2, 1, 2, 1]);
  act(() => setPreference("collapsesBottomBar", false));
  settle();
  expect([flip("down"), flip("up"), flip("down", "https://site8.example/other")]).toEqual([0, 0, 0]);
  unmount(root);
});

test("on the original bar a scroll direction flip renders the page chrome once", async () => {
  setPreference("collapsesBottomBar", true);
  const root = await page("original");
  expect([flip("down"), flip("up"), flip("down"), flip("down", "https://site8.example/next")]).toEqual([1, 1, 1, 1]);
  unmount(root);
});

test("a page reporting the tone it already shows renders nothing and rewrites no remembered tones", async () => {
  const stopRemembering = rememberPageTones(() => new Set(currentTabs().open.map((tab) => tab.id)));
  const root = await page();
  act(() => storeTone(front().id, { top: "#112233", bottom: "#445566" }));
  act(() => jest.advanceTimersByTime(2000));
  const writes = jest.spyOn(browserDatabase, "writePreference");
  renders = [];
  act(() => storeTone(front().id, { top: "#112233", bottom: "#445566" }));
  act(() => jest.advanceTimersByTime(2000));
  expect({ renders: screenRenders(), toneWrites: writes.mock.calls.filter(([, key]) => key === "pageTones").length }).toEqual({ renders: 0, toneWrites: 0 });
  act(() => storeTone(front().id, { top: "#112233", bottom: "#778899" }));
  act(() => jest.advanceTimersByTime(2000));
  expect({ renders: screenRenders(), toneWrites: writes.mock.calls.filter(([, key]) => key === "pageTones").length }).toEqual({ renders: 1, toneWrites: 1 });
  stopRemembering();
  unmount(root);
});

test("a background tab's title change sorts the deck order once for the page chrome and its swipe neighbours, not once per reader", async () => {
  const root = await page();
  const sorts = jest.spyOn(tabModels, "recencyOrder");
  const before = swipeOrder();
  sorts.mockClear();
  act(() => updateTabById("t3", { title: "Renamed" }));
  const after = swipeOrder();
  expect(sorts).toHaveBeenCalledTimes(1);
  expect(after).toEqual(before);
  expect(currentTabs().open.find((tab) => tab.id === "t3")!.title).toBe("Renamed");
  unmount(root);
});

test("with the page menu open, a page's progress ticks and scroll flips render no menu, and a change the menu shows renders it", async () => {
  const root = await page();
  await act(async () => void (await openPageMenu()));
  settle();
  const menuRenders = () => renders.filter((component) => component === "PageMenu" || component === "NavigationCapsule").length;
  expect(root.root.findAll((node) => (node.type as { name?: string })?.name === "PageMenu").length).toBe(1);
  renders = [];
  for (let tick = 1; tick <= 10; tick++) act(() => storeNavigation(front().id, { ...state(tick % 2 ? "down" : "up"), progress: tick / 10, isScrolledToTop: tick % 3 === 0 }));
  expect(menuRenders()).toBe(0);
  act(() => storeNavigation(front().id, { ...state("up"), canGoBack: true }));
  expect(menuRenders()).toBeGreaterThan(0);
  unmount(root);
});
