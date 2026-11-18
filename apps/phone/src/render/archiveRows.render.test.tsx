import { act } from "react-test-renderer";
import { ArchiveView } from "../components/tabs/ArchiveView";
import * as perf from "../state/app/interactionPerf";
import * as tabStore from "../state/tabs/store";
import { renderSurface, someTabs, textOf, unmount, withTabs } from "../../test/render/harness";

const T = 1_790_000_000_000;

let renders: string[] = [];

beforeEach(() => {
  jest.useFakeTimers({ now: T });
  withTabs(2);
  const archived = someTabs(200).map((tab, i) => ({ ...tab, id: `a${i}`, title: `Archived ${i}`, archivedAt: T - i * 600_000 }));
  act(() => tabStore.useTabs.setState({ archive: archived, archivedCount: archived.length }));
  jest.spyOn(tabStore, "loadArchive").mockImplementation(() => undefined);
  jest.spyOn(tabStore, "searchArchive").mockImplementation((query: string) => (tabStore.useTabs.getState().archive ?? []).filter((tab) => tab.title.toLowerCase().includes(query.toLowerCase())));
  renders = [];
  jest.spyOn(perf, "countRender").mockImplementation((component: string) => {
    renders.push(component);
  });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Root = ReturnType<typeof renderSurface>;

const field = (root: Root) => root.root.findAll((node) => typeof node.props.onChangeText === "function" && typeof node.type === "string")[0]!;

function countTimes(work: () => void): number {
  const original = Date.prototype.toLocaleTimeString;
  let calls = 0;
  const spy = jest.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date, ...args: Parameters<typeof original>) {
    calls += 1;
    return original.apply(this, args);
  });
  try {
    work();
  } finally {
    spy.mockRestore();
  }
  return calls;
}

test("typing in the Archive's search re-renders no row before the search runs, and the rows it then shows are the matches", () => {
  const root = renderSurface(<ArchiveView />);
  act(() => jest.advanceTimersByTime(500));
  const before = textOf(root);
  expect(before).toContain("Archived 0");
  renders = [];
  const formatted = countTimes(() => act(() => field(root).props.onChangeText("Archived 1")));
  expect(formatted).toBe(0);
  expect(renders.filter((name) => name === "ArchiveRow")).toHaveLength(0);
  act(() => jest.advanceTimersByTime(500));
  expect(textOf(root)).toContain("Archived 1");
  expect(textOf(root)).toContain("Archived 10");
  expect(textOf(root)).not.toContain("Archived 20");
  act(() => field(root).props.onChangeText(""));
  act(() => jest.advanceTimersByTime(500));
  expect(textOf(root)).toContain("Archived 0");
  unmount(root);
});
