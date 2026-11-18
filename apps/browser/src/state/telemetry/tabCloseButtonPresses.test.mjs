import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const presses = await import("./tabPresses.ts");
const { noteTabCloseButtonPress } = await import("./hoverCardCounts.ts");
after(() => client.setSharing(false, "settings"));

async function sent() {
  await client.saveQueueNow();
  return JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}').events.filter((e) => e.event === "tab_presses").map((e) => e.properties);
}

test("a left press and a right press count two close button presses, one of them on the left", async () => {
  client.loadChoice();
  client.setSharing(true, "settings");
  noteTabCloseButtonPress(true);
  noteTabCloseButtonPress(false);
  presses.emitTabPresses();
  const last = (await sent()).at(-1);
  assert.deepEqual([last.tab_close_button_presses, last.tab_close_button_presses_left], [2, 1]);
  const before = (await sent()).length;
  presses.emitTabPresses();
  assert.equal((await sent()).length, before, "an hour without presses sends nothing");
});

test("close button presses counted before sharing changes are dropped", async () => {
  client.loadChoice();
  client.setSharing(true, "settings");
  noteTabCloseButtonPress(true);
  noteTabCloseButtonPress(true);
  client.setSharing(false, "settings");
  client.setSharing(true, "settings");
  const before = (await sent()).length;
  presses.emitTabPresses();
  assert.equal((await sent()).length, before);
  noteTabCloseButtonPress(false);
  presses.emitTabPresses();
  const last = (await sent()).at(-1);
  assert.deepEqual([last.tab_close_button_presses, last.tab_close_button_presses_left], [1, 0]);
});
