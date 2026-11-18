import { act } from "react-test-renderer";
import { TabDeck } from "../components/tabs/TabDeck";
import { DesignProvider } from "../components/ui";
import { openTab, useBrowse } from "../state/browse/store";
import * as telemetry from "../state/telemetry/telemetry";
import { openNewTab, useTabs } from "../state/tabs/store";
import { renderSurface, unmount } from "../../test/render/harness";

beforeEach(() => {
  jest.useFakeTimers({ now: 1790000000000 });
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Root = ReturnType<typeof renderSurface>;

const searchField = (root: Root) => root.root.findAll((node) => node.props.testID === "deckSearchField" && typeof node.props.onChangeText === "function")[0]!;
const type = (root: Root, text: string) => act(() => searchField(root).props.onChangeText(text));

test("a slow Search Tabs keystroke never counts deck_searches_late while a private tab is among the tabs it searches, even outside incognito and when the private tab doesn't match, and counts again once the private tab is closed", () => {
  const regular = openNewTab({ url: "https://regular.example/", title: "Regular", isPrivate: false, origin: "typed" });
  const privateTab = openNewTab({ url: "https://private.example/", title: "Private", isPrivate: true, origin: "typed" });
  openTab(privateTab.id);
  openTab(regular.id);
  expect(useTabs.getState().incognito).toBe(false);
  expect(useTabs.getState().privates).toHaveLength(1);
  useBrowse.setState({ surface: "deck", sheet: null, frozenOrder: null, deckEntrance: null, opening: null });
  const counted = jest.spyOn(telemetry, "countUsage").mockImplementation(() => undefined);
  const lateCounts = () => counted.mock.calls.filter(([field]) => field === "deck_searches_late").length;
  const original = String.prototype.normalize;
  jest.spyOn(String.prototype, "normalize").mockImplementation(function (this: string, form?: string) {
    jest.setSystemTime(Date.now() + 20);
    return original.call(this, form);
  });
  const root = renderSurface(
    <DesignProvider design="redesigned">
      <TabDeck />
    </DesignProvider>,
  );
  try {
    type(root, "private");
    expect(lateCounts()).toBe(0);
    type(root, "example");
    expect(lateCounts()).toBe(0);
    type(root, "regular");
    expect(lateCounts()).toBe(0);
    type(root, "");
    act(() => useTabs.setState({ privates: [] }));
    expect(useTabs.getState().privates).toHaveLength(0);
    type(root, "regular");
    expect(lateCounts()).toBe(1);
  } finally {
    unmount(root);
  }
});
