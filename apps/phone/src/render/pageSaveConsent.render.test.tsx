jest.mock("../platform/telemetry", () => ({
  ...jest.requireActual("../platform/telemetry"),
  canPostTelemetry: () => false,
  setUsageConsent: () => undefined,
  takePendingCounts: () => ({}),
}));

import { pages } from "../platform/pages";
import { saveTabPosition } from "../state/browse/positions";
import { openNewTab } from "../state/tabs/store";
import { setUsageSharing, startTelemetry, usageToday } from "../state/telemetry/telemetry";

beforeAll(() => {
  jest.useFakeTimers({ now: 1_790_000_100_000 });
  startTelemetry();
});

afterAll(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function holdSave() {
  let finish: (state: string) => void = () => undefined;
  jest.spyOn(pages, "saveState").mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)) as never);
  return (state: string) => finish(state);
}

test("a page save that began before the reader opted in to usage sharing is not counted when it lands after", async () => {
  setUsageSharing(false, "settings");
  const tab = openNewTab({ url: "https://save.example/", origin: "typed" });
  const finish = holdSave();
  const saving = saveTabPosition(tab.id, { x: 0, y: 100 } as never);
  await Promise.resolve();
  setUsageSharing(true, "settings");
  finish("state");
  await saving;
  expect(usageToday().counts.page_states_saved).toBeUndefined();

  const counted = holdSave();
  const next = saveTabPosition(tab.id, { x: 0, y: 200 } as never);
  await Promise.resolve();
  counted("state");
  await next;
  expect(usageToday().counts.page_states_saved).toBe(1);
  setUsageSharing(false, "settings");
});
