import { act } from "react-test-renderer";
import { pages } from "../platform/pages";
import * as browse from "../state/browse/store";
import { useOnboarding } from "../state/onboarding/store";
import { currentTabs, openNewTab, tabSavedState } from "../state/tabs/store";
import { withTabs } from "../../test/render/harness";

type Listener = (event: { name: string; [key: string]: unknown }) => void;

const listeners: Listener[] = [];
let scrollY = 120;
let url = "https://example.com/#first";
let finishHeldSave: (state: null) => void = () => undefined;


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
