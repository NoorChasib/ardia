import { archiveDueTabs, currentTabs, updateTabById, useTabs } from "../state/tabs/store";
import { withTabs } from "../../test/render/harness";

let notifications = 0;
let unsubscribe: () => void = () => undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: 1_790_000_100_000 });
  withTabs(5);
  notifications = 0;
  unsubscribe = useTabs.subscribe(() => void (notifications += 1));
});

afterEach(() => {
  unsubscribe();
  jest.useRealTimers();
});

const selected = () => currentTabs().open.find((tab) => tab.id === currentTabs().selectedId)!;

test("a tab update that changes nothing, a missing tab and an auto-archive with nothing due notify no tabs subscriber and leave the listing alone", () => {
  const before = useTabs.getState();
  updateTabById(selected().id, { title: selected().title, url: selected().url });
  updateTabById("gone", { title: "Gone" });
  archiveDueTabs();
  expect(notifications).toBe(0);
  expect(useTabs.getState()).toBe(before);
});

test("a real tab update still notifies once and moves the listing", () => {
  const listing = useTabs.getState().listing;
  updateTabById(selected().id, { title: "Renamed" });
  expect(notifications).toBe(1);
  expect(selected().title).toBe("Renamed");
  expect(useTabs.getState().listing).toBe(listing + 1);
});
