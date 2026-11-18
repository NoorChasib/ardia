import { act } from "react-test-renderer";
import { pages } from "../platform/pages";
import type { PageState } from "../state/pages/store";
import * as browse from "../state/browse/store";
import { useOnboarding } from "../state/onboarding/store";
import { currentTabs, openNewTab, tabSavedState } from "../state/tabs/store";
import { withTabs } from "../../test/render/harness";

type Listener = (event: { name: string; [key: string]: unknown }) => void;

const listeners: Listener[] = [];
let scrollY = 120;
let url = "https://example.com/#first";
let finishHeldSave: (state: null) => void = () => undefined;

const state: PageState = { url, title: "Example", progress: 1, isLoading: false, canGoBack: false, canGoForward: false, faviconUrl: null, themeColor: null, backgroundColor: null, security: "secure", failure: null, pageZoom: 1, isDesktopSite: false, scrollDirection: "up", isScrolledToTop: false, blockedRequests: 0, isLive: true, isPrivate: false };

const saveState = () => pages.saveState as unknown as jest.Mock;
const savesOf = (id: string) => saveState().mock.calls.filter(([saved]) => saved === id).length;

beforeAll(() => {
  jest.useFakeTimers({ now: 1_790_000_100_000 });
  jest.spyOn(pages, "addListener").mockImplementation((listener: unknown) => {
    listeners.push(listener as Listener);
    return { remove: () => undefined };
  });
  jest.spyOn(pages, "scrollPosition").mockImplementation(async () => ({ x: 0, y: scrollY }) as never);
  jest.spyOn(pages, "ids").mockImplementation(async () => [...currentTabs().open, ...currentTabs().privates].map((tab) => tab.id) as never);
  jest.spyOn(pages, "saveState").mockImplementation(async () => `${url} at ${scrollY}` as never);
  browse.useBrowse.setState({ surface: "deck", sheet: null });
  browse.startBrowser();
  useOnboarding.setState({ showing: false });
  withTabs(1);
});

afterEach(async () => {
  await act(async () => browse.appBecameActive());
  finishHeldSave(null);
  await settle();
  scrollY = 120;
});

afterAll(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function tick(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function settle() {
  await act(async () => {
    for (let round = 0; round < 30; round++) await Promise.resolve();
  });
}

async function cycleAppState() {
  await act(async () => browse.appWillResignActive());
  await settle();
  await act(async () => browse.appBecameActive());
  await settle();
}

const send = (event: { name: string; [key: string]: unknown }) => act(() => listeners.forEach((listener) => listener(event)));

test("a fragment-only navigation at the same scroll position is saved when the app goes inactive, in front or behind", async () => {
  await act(async () => browse.useBrowse.setState({ surface: "browsing" }));
  const tab = openNewTab({ url, origin: "typed" });
  act(() => browse.pageStateChanged(tab.id, { ...state, url }));
  await tick(5000);
  expect(tabSavedState(tab.id)).toBe(`${url} at ${scrollY}`);

  url = "https://example.com/#second";
  act(() => browse.pageStateChanged(tab.id, { ...state, url, canGoBack: true }));
  saveState().mockClear();
  await cycleAppState();
  expect(savesOf(tab.id)).toBe(1);
  expect(tabSavedState(tab.id)).toBe("https://example.com/#second at 120");

  saveState().mockClear();
  act(() => browse.pageStateChanged(tab.id, { ...state, url, canGoBack: true, title: "Retitled", progress: 0.5 }));
  await cycleAppState();
  expect(savesOf(tab.id)).toBe(0);

  const behind = openNewTab({ url: "https://behind.example/#a", origin: "typed" });
  act(() => browse.openTab(tab.id));
  send({ name: "page.state", pageId: behind.id, state: { ...state, url: "https://behind.example/#a" } });
  await cycleAppState();
  saveState().mockClear();
  url = "https://behind.example/#b";
  send({ name: "page.state", pageId: behind.id, state: { ...state, url, canGoBack: true } });
  await cycleAppState();
  expect(saveState().mock.calls.map(([id]) => id)).toEqual([behind.id]);
  expect(tabSavedState(behind.id)).toBe("https://behind.example/#b at 120");
});

test("a scroll save still in flight when the app goes inactive does not stop the inactive save", async () => {
  await act(async () => browse.useBrowse.setState({ surface: "browsing" }));
  url = "https://example.com/pending";
  const tab = openNewTab({ url, origin: "typed" });
  await tick(5000);
  expect(tabSavedState(tab.id)).toBe(`${url} at 120`);

  scrollY = 800;
  saveState().mockClear().mockImplementationOnce(() => new Promise((resolve) => (finishHeldSave = resolve)));
  await tick(10_000);
  expect(savesOf(tab.id)).toBe(1);
  await act(async () => browse.appWillResignActive());
  await settle();
  expect(savesOf(tab.id)).toBe(2);
  expect(tabSavedState(tab.id)).toBe(`${url} at 800`);
});

test("a failed scroll save is not retried by the poll but is retried when the app goes inactive", async () => {
  await act(async () => browse.useBrowse.setState({ surface: "browsing" }));
  url = "https://example.com/failing";
  const tab = openNewTab({ url, origin: "typed" });
  await tick(5000);
  expect(tabSavedState(tab.id)).toBe(`${url} at 120`);

  scrollY = 640;
  saveState().mockClear().mockImplementationOnce(async () => null as never);
  await tick(20_000);
  expect(savesOf(tab.id)).toBe(1);
  expect(tabSavedState(tab.id)).toBe(`${url} at 120`);
  await cycleAppState();
  expect(savesOf(tab.id)).toBe(2);
  expect(tabSavedState(tab.id)).toBe(`${url} at 640`);
});
