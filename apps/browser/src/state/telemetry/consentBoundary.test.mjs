import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const track = await import("./track.ts");
const presses = await import("./tabPresses.ts");
const { noteFind } = await import("./findCounts.ts");
const { noteSessionWrite } = await import("./sessionWrites.ts");
after(() => client.setSharing(false, "settings"));

async function sent(event) {
  await client.saveQueueNow();
  return JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}').events.filter((e) => e.event === event).map((e) => e.properties);
}

function beWhileOff() {
  usage.noteImportedPins({ rows: 3, splits: 1 });
  stub.editKeyAcks.pending = { accepted: 4 };
  for (let i = 0; i < 20; i++) track.sampleOmniboxLatency(12);
  track.noteSearchSuggest("ok");
  presses.notePressStarted();
  presses.notePressEnded("click");
}

test("nothing counted while sharing was off is sent once sharing turns on, in usage_counts, perf_omnibox or tab_presses", async () => {
  client.loadChoice();
  client.setSharing(false, "settings");
  beWhileOff();
  client.setSharing(true, "settings");
  usage.sessionEnding();
  const counts = await sent("usage_counts");
  assert.ok(counts.every((p) => !p.imported_pinned_rows && !p.imported_splits && !p.edit_key_acks_accepted), JSON.stringify(counts));
  assert.deepEqual(await sent("perf_omnibox"), []);
  assert.deepEqual(await sent("tab_presses"), []);
});

test("what is counted after sharing turns on is sent", async () => {
  client.loadChoice();
  client.setSharing(true, "settings");
  usage.noteImportedPins({ rows: 2, splits: 0 });
  stub.editKeyAcks.pending = { accepted: 1 };
  presses.notePressStarted();
  presses.notePressEnded("click");
  usage.sessionEnding();
  const last = (await sent("usage_counts")).at(-1);
  assert.deepEqual([last.imported_pinned_rows, last.edit_key_acks_accepted], [2, 1]);
  assert.equal((await sent("tab_presses")).at(-1).presses, 1);
});

test("turning sharing off and on again drops what was counted before", async () => {
  client.loadChoice();
  client.setSharing(true, "settings");
  usage.noteImportedPins({ rows: 7, splits: 0 });
  stub.focusHandoffCounts.pending = { delivered: 3 };
  client.setSharing(false, "settings");
  client.setSharing(true, "settings");
  usage.sessionEnding();
  assert.ok((await sent("usage_counts")).every((p) => p.imported_pinned_rows !== 7 && !p.focus_handoffs_delivered));
});

test("in a single-context app the hourly extras reach the queue while sharing is on, and only the local copy while it is off", async () => {
  client.loadChoice();
  client.setSharing(false, "settings");
  noteFind("opened");
  noteSessionWrite(2048, false);
  usage.sessionEnding();
  assert.deepEqual(await sent("usage_counts"), []);
  const local = stub.telemetryLocal.records().filter((item) => item.event === "usage_counts").at(-1);
  assert.deepEqual([local.sent, local.properties.find_opens, local.properties.session_writes], [false, 1, 0]);

  client.setSharing(true, "settings");
  noteFind("opened");
  noteFind("stepped");
  noteSessionWrite(2048, false);
  usage.sessionEnding();
  const last = (await sent("usage_counts")).at(-1);
  assert.deepEqual([last.find_opens, last.find_steps, last.session_writes, last.session_kb_written], [1, 1, 1, 2]);
});
