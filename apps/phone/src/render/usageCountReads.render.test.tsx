import * as browserDatabase from "../state/store/browserDatabase";
import { browserDatabase as database } from "../state/store/database";
import { countUsage, startTelemetry, usageToday } from "../state/telemetry/telemetry";

beforeAll(() => {
  jest.useFakeTimers({ now: 1_790_000_100_000 });
  const db = database();
  browserDatabase.writePreference(db, "telemetry.installId", "0b6f2b0e-3c1d-4e5f-8a7b-9c0d1e2f3a4b");
  browserDatabase.writePreference(db, "telemetry.sharing", "on");
  const tones = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`tab-${i}`, { top: "#112233", bottom: "#445566" }]));
  browserDatabase.writePreference(db, "pageTones", JSON.stringify(tones));
  startTelemetry();
});

afterAll(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("counting a use reads only the day's counts, never the whole preferences table with every page tone", () => {
  const before = usageToday().counts.tabs_opened ?? 0;
  const wholeTable = jest.spyOn(browserDatabase, "readPreferences");
  for (let use = 0; use < 3; use++) countUsage("tabs_opened");
  expect(wholeTable).toHaveBeenCalledTimes(0);
  wholeTable.mockRestore();
  expect(usageToday()).toMatchObject({ sharing: true, counts: { tabs_opened: before + 3 } });
});
