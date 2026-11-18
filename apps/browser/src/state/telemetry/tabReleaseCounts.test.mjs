import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
globalThis.fetch = async () => ({ status: 200 });
const stub = await import("../../test-native/index.ts");
const client = await import("./client.ts");
const { setTelemetryRelay } = await import("./relay.ts");
const { emitWindowUsage } = await import("./usage.ts");
const { noteTabRelease, takeTabReleaseCounts } = await import("./tabReleaseCounts.ts");

after(() => {
  setTelemetryRelay(null);
  client.setSharing(false, "settings");
});

const queuedReleases = async () => {
  await client.saveQueueNow();
  const queue = stub.docs.get("telemetry-queue.json");
  const usage = queue ? JSON.parse(queue).events.filter((event) => event.event === "usage_counts") : [];
  return usage.map((event) => event.properties.host_tab_releases ?? 0);
};

test("releases a follower window counted while sharing was off never reach a leader that has since opted in", async () => {
  client.loadChoice();
  client.setSharing(false, "settings");
  takeTabReleaseCounts();
  const followerMessages = [];
  setTelemetryRelay({ capture: (...args) => followerMessages.push(args) });
  noteTabRelease("alreadyClosed");
  noteTabRelease("failed");
  emitWindowUsage();
  setTelemetryRelay(null);
  client.setSharing(true, "settings");
  for (const message of followerMessages) client.capture(...message);
  assert.ok((await queuedReleases()).every((count) => count === 0));
});

test("releases counted while sharing is on are sent once, then reset", () => {
  client.setSharing(true, "settings");
  takeTabReleaseCounts();
  noteTabRelease("released");
  noteTabRelease("alreadyClosed");
  noteTabRelease("failed");
  assert.deepEqual(takeTabReleaseCounts(), { host_tab_releases: 3, host_tab_releases_already_closed: 1, host_tab_releases_failed: 1 });
  assert.deepEqual(takeTabReleaseCounts(), { host_tab_releases: 0, host_tab_releases_already_closed: 0, host_tab_releases_failed: 0 });
});

test("turning sharing off drops releases counted before it", () => {
  client.setSharing(true, "settings");
  takeTabReleaseCounts();
  noteTabRelease("alreadyClosed");
  client.setSharing(false, "settings");
  client.setSharing(true, "settings");
  assert.deepEqual(takeTabReleaseCounts(), { host_tab_releases: 0, host_tab_releases_already_closed: 0, host_tab_releases_failed: 0 });
});
