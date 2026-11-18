import { act } from "react-test-renderer";
import { deckShownIds, mountedDeckCards, TabDeck } from "../components/tabs/TabDeck";
import { DesignProvider } from "../components/ui";
import * as perf from "../state/app/interactionPerf";
import { sendDeckCommand } from "../state/browse/deckCommands";
import { useBrowse } from "../state/browse/store";
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

const deckRenders = () => renders.filter((component) => component === "TabDeck").length;
const cardTitles = (root: Root) =>
  root.root
    .findAll((node) => node.props.testID === "deckCard" && typeof node.type === "string")
    .map((card) => textOf({ root: card } as Root).split("\n")[0])
    .sort();

function countDeckIndexOfOn(length: number, work: () => void): number {
  const original = Array.prototype.indexOf;
  let calls = 0;
  const spy = jest.spyOn(Array.prototype, "indexOf").mockImplementation(function (this: unknown[], ...args: [unknown, number?]) {
    if (this.length === length && new Error().stack!.includes("TabDeck.tsx")) calls += 1;
    return original.apply(this, args);
  });
  try {
    work();
  } finally {
    spy.mockRestore();
  }
  return calls;
}

test("a deck render on 300 tabs walks only the cards it mounts and never scans the order for every tab's place", () => {
  withTabs(300);
  const root = deck();
  act(() => jest.advanceTimersByTime(600));
  renders = [];
  const lookups = countDeckIndexOfOn(300, () => {
    act(() => sendDeckCommand({ kind: "scroll", index: 150 }));
    act(() => jest.advanceTimersByTime(16));
  });
  expect(deckRenders()).toBeGreaterThan(0);
  expect(lookups).toBe(0);
  act(() => jest.advanceTimersByTime(1000));
  expect(cardTitles(root)).toEqual(Array.from({ length: 19 }, (_, i) => `Site ${141 + i}`).sort());
  unmount(root);
});

test("the deck mounts the same cards in the same order as checking every shown id, with cards flying off at any place, for random decks and anchors", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const tab = someTabs(1)[0]!;
  for (let round = 0; round < 3000; round++) {
    const order = Array.from({ length: Math.floor(random() * 60) }, (_, i) => `t${i}`);
    const leaving = Array.from({ length: Math.floor(random() * 4) }, (_, i) => ({ id: `gone${i}`, tab, at: Math.floor(random() * (order.length + 6)) - 2 }));
    const anchor = Math.floor(random() * (order.length + 20)) - 10;
    const shownIds = deckShownIds(order, leaving);
    const everyId = shownIds.flatMap((id) => {
      const flying = leaving.find((card) => card.id === id);
      const index = flying ? -1 : order.indexOf(id);
      return Math.abs((flying ? flying.at : index) - anchor) <= 9 ? [{ id, index, flying: flying ?? null }] : [];
    });
    const shownAt = leaving.length ? new Map(shownIds.map((id, at) => [id, at])) : null;
    expect(mountedDeckCards(order, leaving, shownAt, anchor).map(({ id, index, flying }) => ({ id, index, flying }))).toEqual(everyId);
  }
});
