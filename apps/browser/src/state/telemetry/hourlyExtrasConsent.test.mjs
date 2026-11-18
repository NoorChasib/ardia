import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { docs } = await import("../../test-native/index.ts");
const { reloadChoice, save, isSharing, sharingAgreed, useTelemetry } = await import("./choice.ts");
await import("./consentBoundary.ts");
const { setTelemetryRelay } = await import("./relay.ts");
const { USAGE_COUNTS_EVENT, takeHourlyExtras, withHourlyExtras } = await import("./hourlyExtras.ts");
const { consentedCount } = await import("./consentedCount.ts");
const { noteFind } = await import("./findCounts.ts");
const { notePagerSettle } = await import("./pagerCounts.ts");

const CHANNEL = "ardia-test-hourly-extras-consent";
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const EXTRA_KEYS = ["find_opens", "find_steps", "profile_pager_settles", "profile_pager_settles_without_switch"];

function leaderWindow() {
  const leader = { sharing: true, queue: [] };
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }) => {
    if (leader.sharing) leader.queue.push(data);
  };
  leader.extras = () => leader.queue.filter(({ event }) => event === USAGE_COUNTS_EVENT).map(({ props }) => Object.fromEntries(EXTRA_KEYS.filter((key) => props[key]).map((key) => [key, props[key]])));
  leader.close = () => channel.close();
  return leader;
}

function followerWindow() {
  const channel = new BroadcastChannel(CHANNEL);
  setTelemetryRelay({
    capture: (event, props) => channel.postMessage({ event, props }),
    log: () => {},
    resetId: async () => "id",
    change: () => {},
    installId: () => "id",
  });
  return {
    use: () => {
      noteFind("opened");
      noteFind("stepped");
      noteFind("stepped");
      notePagerSettle(false);
    },
    flushUsage: () => withHourlyExtras(() => {}),
    refreshConsent: (sharing) => save(sharing ? { sharing: true, installId: "id" } : { sharing: false, installId: null }),
    close: () => {
      setTelemetryRelay(null);
      channel.close();
    },
  };
}

async function withWindows(run) {
  const leader = leaderWindow();
  const follower = followerWindow();
  try {
    await run(leader, follower);
  } finally {
    follower.close();
    leader.close();
    save({ sharing: false, installId: null });
    takeHourlyExtras();
  }
}

const USED = { find_opens: 1, find_steps: 2, profile_pager_settles: 1, profile_pager_settles_without_switch: 1 };

test("a follower window whose sharing is still off relays none of its hourly extras to an opted-in leader", () =>
  withWindows(async (leader, follower) => {
    follower.refreshConsent(false);
    follower.use();
    assert.equal(isSharing(), false, "the follower hasn't applied the leader's opt-in yet");
    follower.flushUsage();
    await settle();
    assert.deepEqual(leader.extras().filter((extras) => Object.keys(extras).length), []);
  }));

test("an opted-in follower window still relays its hourly extras", () =>
  withWindows(async (leader, follower) => {
    follower.refreshConsent(true);
    follower.use();
    follower.flushUsage();
    await settle();
    assert.deepEqual(leader.extras().at(-1), USED);
  }));

test("turning sharing on drops the hourly extras counted while it was off", () =>
  withWindows(async (leader, follower) => {
    follower.refreshConsent(false);
    follower.use();
    follower.use();
    follower.refreshConsent(true);
    follower.use();
    follower.flushUsage();
    await settle();
    assert.deepEqual(leader.extras().at(-1), USED);
  }));

test("after an optimistic opt-out a follower relays no hourly extras, though its saved choice is still on", () =>
  withWindows(async (leader, follower) => {
    follower.refreshConsent(true);
    useTelemetry.setState({ sharing: false });
    assert.equal(isSharing(), true, "the saved choice hasn't followed the switch yet");
    follower.use();
    follower.flushUsage();
    await settle();
    assert.deepEqual(leader.extras().filter((extras) => Object.keys(extras).length), []);
  }));

test("a follower's hourly extras counted while its opt-in showed but wasn't saved are dropped when the saved choice catches up", () => {
  try {
    save({ sharing: false, installId: null });
    useTelemetry.setState({ sharing: true });
    noteFind("opened");
    save({ sharing: true, installId: "id" });
    assert.equal(takeHourlyExtras().find_opens, 0);
  } finally {
    save({ sharing: false, installId: null });
  }
});

test("a follower that reloads a choice which went off and on again while it was away drops the hourly extras from before", () => {
  try {
    save({ sharing: true, installId: "id" });
    takeHourlyExtras();
    noteFind("opened");
    const saved = JSON.parse(docs.get("telemetry.json"));
    docs.set("telemetry.json", JSON.stringify({ ...saved, consentEpoch: saved.consentEpoch + 2 }));
    reloadChoice();
    assert.deepEqual([isSharing(), useTelemetry.getState().sharing], [true, true]);
    assert.equal(takeHourlyExtras().find_opens, 0);
  } finally {
    save({ sharing: false, installId: null });
  }
});

test("a consented count counts only while the saved and the shown choice are both on", () => {
  const count = consentedCount();
  try {
    save({ sharing: true, installId: "id" });
    useTelemetry.setState({ sharing: false });
    assert.equal(sharingAgreed(), false);
    count.note();
    count.add(5);
    assert.equal(count.take(), 0, "the shown choice is off");

    save({ sharing: false, installId: null });
    useTelemetry.setState({ sharing: true });
    assert.equal(sharingAgreed(), false);
    count.note();
    count.add(5);
    assert.equal(count.take(), 0, "the saved choice is off");

    save({ sharing: true, installId: "id" });
    assert.equal(sharingAgreed(), true);
    count.note();
    count.add(5);
    assert.equal(count.take(), 6);
  } finally {
    save({ sharing: false, installId: null });
  }
});
