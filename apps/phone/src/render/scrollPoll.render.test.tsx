import { act } from "react-test-renderer";
import { pages } from "../platform/pages";
import type { PageState } from "../state/pages/store";
import * as browse from "../state/browse/store";
import { useOnboarding } from "../state/onboarding/store";
import { usePageUi } from "../state/page/store";
import * as telemetry from "../state/telemetry/telemetry";
import { currentTabs, openNewTab, tabSavedState, useTabs } from "../state/tabs/store";
import { withTabs } from "../../test/render/harness";

type Listener = (event: { name: string; [key: string]: unknown }) => void;

const listeners: Listener[] = [];
const wakeUps = { count: 0 };
let scrollY = 120;
let scrollReads = 0;
let saved: string[] = [];
let counted: string[] = [];

function countTimerWakeUps() {
  const wrap = <F extends (...args: never[]) => unknown>(original: F) =>
    ((callback: (...inner: unknown[]) => unknown, ...rest: unknown[]) =>
      (original as unknown as (...args: unknown[]) => unknown)((...inner: unknown[]) => {
        wakeUps.count += 1;
        return callback(...inner);
      }, ...rest)) as unknown as F;
  globalThis.setTimeout = wrap(globalThis.setTimeout);
  globalThis.setInterval = wrap(globalThis.setInterval);
}

beforeAll(() => {
  jest.useFakeTimers({ now: 1_790_000_100_000 });
  countTimerWakeUps();
  jest.spyOn(pages, "addListener").mockImplementation((listener: unknown) => {
    listeners.push(listener as Listener);
    return { remove: () => undefined };
  });
  jest.spyOn(pages, "saveState").mockImplementation(async (id: string) => {
    saved.push(id);
    return `state of ${id} at ${scrollY}` as never;
  });
  jest.spyOn(pages, "scrollPosition").mockImplementation(async () => {
    scrollReads += 1;
    return { x: 0, y: scrollY } as never;
  });
  jest.spyOn(pages, "ids").mockImplementation(async () => [...currentTabs().open, ...currentTabs().privates].map((tab) => tab.id) as never);
  jest.spyOn(telemetry, "countUsage").mockImplementation((field) => void counted.push(field));
  jest.spyOn(telemetry, "usageCountingWindow").mockImplementation(() => (field) => void counted.push(field));
  browse.useBrowse.setState({ surface: "deck", sheet: null });
  browse.startBrowser();
  useOnboarding.setState({ showing: false });
  withTabs(5);
});

afterAll(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function settle() {
  for (let round = 0; round < 20; round++) await act(async () => undefined);
}

async function idle(seconds: number) {
  for (let second = 0; second < seconds; second++) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
}

async function resetCounts() {
  await settle();
  wakeUps.count = 0;
  scrollReads = 0;
  saved = [];
  counted = [];
}

async function cycleAppState() {
  await act(async () => browse.appWillResignActive());
  await settle();
  await act(async () => browse.appBecameActive());
  await settle();
}

const send = (event: { name: string; [key: string]: unknown }) => act(() => listeners.forEach((listener) => listener(event)));

const selected = () => currentTabs().selectedId!;

test("a minute on the deck, under the page menu, or with the app inactive wakes JS for no scroll poll at all", async () => {
  await act(async () => browse.useBrowse.setState({ surface: "deck" }));
  await resetCounts();
  await idle(60);
  expect({ wakeUps: wakeUps.count, scrollReads }).toEqual({ wakeUps: 0, scrollReads: 0 });

  await act(async () => browse.useBrowse.setState({ surface: "browsing" }));
  await act(async () => usePageUi.setState({ menuOpen: true }));
  await resetCounts();
  await idle(60);
  expect({ wakeUps: wakeUps.count, scrollReads }).toEqual({ wakeUps: 0, scrollReads: 0 });

  await act(async () => usePageUi.setState({ menuOpen: false }));
  await act(async () => browse.appWillResignActive());
  await resetCounts();
  await idle(60);
  expect({ wakeUps: wakeUps.count, scrollReads }).toEqual({ wakeUps: 0, scrollReads: 0 });
  await act(async () => browse.appBecameActive());
});

test("a page in front still polls its scroll and saves it once after the reader stops scrolling", async () => {
  await act(async () => browse.useBrowse.setState({ surface: "browsing" }));
  await idle(10);
  await resetCounts();
  scrollY = 900;
  await idle(40);
  expect(saved).toEqual([selected()]);
  expect(tabSavedState(selected())).toBe(`state of ${selected()} at 900`);
  expect(counted.filter((field) => field === "page_states_saved")).toHaveLength(1);
});

test("a still, saved page in front checks its scroll less and less often, and a scroll direction change brings the checks back at once", async () => {
  await act(async () => browse.useBrowse.setState({ surface: "browsing" }));
  await idle(60);
  await resetCounts();
  await idle(60);
  expect({ wakeUps: wakeUps.count, scrollReads, saved }).toEqual({ wakeUps: 3, scrollReads: 3, saved: [] });

  const state: PageState = { url: "https://site4.example/", title: "Site 4", progress: 1, isLoading: false, canGoBack: false, canGoForward: false, faviconUrl: null, themeColor: null, backgroundColor: null, security: "secure", failure: null, pageZoom: 1, isDesktopSite: false, scrollDirection: "up", isScrolledToTop: false, blockedRequests: 0, isLive: true, isPrivate: false };
  await act(async () => browse.pageStateChanged(selected(), state));
  await idle(60);
  await resetCounts();
  scrollY += 700;
  await act(async () => browse.pageStateChanged(selected(), { ...state, scrollDirection: "down" }));
  await idle(5);
  expect(saved).toEqual([selected()]);
});

test("going inactive saves only the pages that navigated or scrolled since their last save, not every live page", async () => {
  await act(async () => browse.useBrowse.setState({ surface: "browsing" }));
  await cycleAppState();
  await resetCounts();
  await cycleAppState();
  expect({ saved, scrollReads }).toEqual({ saved: [], scrollReads: 1 });

  const background = currentTabs().open.find((tab) => tab.id !== selected())!.id;
  send({ name: "page.visited", pageId: background, url: "https://example.com/next", title: "Next", kind: "link" });
  await resetCounts();
  await cycleAppState();
  expect(saved).toEqual([background]);

  await resetCounts();
  scrollY += 400;
  await cycleAppState();
  expect(saved).toEqual([selected()]);
  expect(counted.filter((field) => field === "page_states_saved")).toHaveLength(1);
});

test("a private page's state is kept for the session but never counted as saved", async () => {
  const privateTab = openNewTab({ url: "https://private.example/", origin: "typed", isPrivate: true });
  await act(async () => browse.useBrowse.setState({ surface: "browsing" }));
  send({ name: "page.visited", pageId: privateTab.id, url: "https://private.example/next", title: "Next", kind: "link" });
  await resetCounts();
  await act(async () => browse.appWillResignActive());
  await settle();
  expect(saved).toContain(privateTab.id);
  expect(tabSavedState(privateTab.id)).toBe(`state of ${privateTab.id} at ${scrollY}`);
  expect(counted).not.toContain("page_states_saved");
  await act(async () => browse.appBecameActive());
  await act(async () => useTabs.setState({ incognito: false }));
});
