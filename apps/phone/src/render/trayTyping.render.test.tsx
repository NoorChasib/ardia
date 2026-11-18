import { act } from "react-test-renderer";
import { DesignProvider, appDesign } from "../components/ui";
import { SearchTray } from "../components/search/SearchTray";
import * as perf from "../state/app/interactionPerf";
import * as browse from "../state/browse/store";
import { history } from "../state/history/store";
import { dismissSearch, presentSearch, typeSearch, useSearch } from "../state/search/store";
import { OFF_STATUS, useSync } from "../state/sync/store";
import { renderSurface, unmount, withTabs } from "../../test/render/harness";

let rowRenders = 0;
const realFetch = global.fetch;

const NOW = Date.now();

beforeAll(() => {
  for (let i = 0; i < 40; i++) history().record(`https://otter${i}.example/`, `Otter page ${i}`, "link", null, NOW - 100_000 + i);
});

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(1);
  rowRenders = 0;
  jest.spyOn(perf, "countRender").mockImplementation((component: string) => {
    if (component === "SuggestionRow") rowRenders += 1;
  });
  act(() => browse.useBrowse.setState({ surface: "start" }));
});

afterEach(() => {
  act(() => dismissSearch());
  act(() => jest.runOnlyPendingTimers());
  global.fetch = realFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
  act(() => useSync.setState({ status: OFF_STATUS, view: { devices: [], profiles: [], search: null, syncedAt: null, selectedProfileId: null, receivers: [] } as never }));
});

const settle = async (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

function openTray() {
  act(() => presentSearch("start"));
  return renderSurface(
    <DesignProvider design={appDesign}>
      <SearchTray />
    </DesignProvider>,
  );
}

test("remote suggestions that fail to arrive draw no suggestion row again", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  const root = openTray();
  act(() => typeSearch("otter"));
  await settle(16);
  const shown = useSearch.getState().rows;
  expect(shown.length).toBeGreaterThan(2);
  rowRenders = 0;
  await settle(200);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(rowRenders).toBe(0);
  expect(useSearch.getState().rows).toBe(shown);
  unmount(root);
});

test("remote suggestions that arrive redraw only the rows they changed", async () => {
  global.fetch = jest.fn(async () => ({ status: 200, text: async () => JSON.stringify(["otter", ["otter facts", "otters"]]) })) as unknown as typeof fetch;
  const root = openTray();
  act(() => typeSearch("otter"));
  await settle(16);
  const before = useSearch.getState().rows;
  rowRenders = 0;
  await settle(200);
  const after = useSearch.getState().rows;
  expect(after.some((row) => row.kind === "query" && row.query === "otter facts")).toBe(true);
  const changed = after.filter((row, index) => row !== before[index]).length;
  expect(after.filter((row) => before.includes(row)).length).toBeGreaterThan(0);
  expect(rowRenders).toBe(changed);
  unmount(root);
});
