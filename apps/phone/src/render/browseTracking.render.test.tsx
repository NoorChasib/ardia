import { act } from "react-test-renderer";
import { pages } from "../platform/pages";
import * as browse from "../state/browse/store";
import * as positions from "../state/browse/positions";
import type { PageState } from "../state/pages/store";
import { closeTabById, currentTabs, updateTabById } from "../state/tabs/store";
import * as tabsState from "../state/tabs/tabsState";
import { withTabs } from "../../test/render/harness";

const state = (url: string, isLoading: boolean): PageState => ({ url, title: "", progress: isLoading ? 0.5 : 1, isLoading, canGoBack: false, canGoForward: false, faviconUrl: null, themeColor: null, backgroundColor: null, security: "secure", failure: null, pageZoom: 1, isDesktopSite: false, scrollDirection: "up", isScrolledToTop: true, blockedRequests: 0, isLive: true, isPrivate: false });

beforeAll(() => {
  jest.useFakeTimers({ now: 1_790_000_100_000 });
  jest.spyOn(pages, "addListener").mockImplementation(() => ({ remove: () => undefined }) as never);
  jest.spyOn(pages, "close").mockImplementation(async () => undefined as never);
  jest.spyOn(pages, "deleteSnapshots").mockImplementation(async () => undefined as never);
  jest.spyOn(pages, "saveState").mockImplementation(async () => null as never);
  browse.startBrowser();
});

afterAll(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("a tab update with thirty pages loaded this session looks up no tab per loaded page, and closing a loaded tab still forgets its page", () => {
  withTabs(300);
  const loaded = currentTabs().open.slice(0, 30).map((tab) => tab.id);
  for (const id of loaded) act(() => browse.pageStateChanged(id, state(`https://${id}.example/`, true)));
  const lookups = jest.spyOn(tabsState, "findTab");
  act(() => updateTabById("t200", { title: "Renamed" }));
  expect(lookups.mock.calls.length).toBeLessThanOrEqual(1);
  const forgotten = jest.spyOn(positions, "forgetPosition");
  act(() => closeTabById(loaded[0]!));
  expect(forgotten.mock.calls.map(([id]) => id)).toContain(loaded[0]);
  expect(forgotten.mock.calls.map(([id]) => id)).not.toContain(loaded[1]);
  lookups.mockRestore();
  forgotten.mockRestore();
});
