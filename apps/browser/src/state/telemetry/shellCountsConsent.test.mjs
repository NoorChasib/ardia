import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
await import("../../test-native/index.ts");
const { save, isSharing, useTelemetry } = await import("./choice.ts");
await import("./consentBoundary.ts");
const { setTelemetryRelay } = await import("./relay.ts");
const { USAGE_COUNTS_EVENT, withHourlyExtras } = await import("./hourlyExtras.ts");
const { addShellCountSource } = await import("./shellCounts.ts");
const { noteSessionWrite } = await import("./sessionWrites.ts");

const CHANNEL = "ardia-test-shell-count-consent";
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function leaderWindow() {
  const leader = { sharing: false, queue: [] };
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }) => {
    if (leader.sharing) leader.queue.push(data);
  };
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
  const recorded = { frames: 0, longFrames: 0, longFrameMs: 0, switches: 0 };
  const removeFrames = addShellCountSource("frames", () => {
    const counts = { linux_viewport_frames: recorded.frames, linux_long_frames: recorded.longFrames, linux_long_frame_ms: recorded.longFrameMs };
    Object.assign(recorded, { frames: 0, longFrames: 0, longFrameMs: 0 });
    return counts;
  });
  const removeSwitches = addShellCountSource("switchAhead", () => {
    const counts = { linux_switch_aheads: recorded.switches };
    recorded.switches = 0;
    return counts;
  });
  return {
    frame: (longMs = 0) => {
      recorded.frames++;
      if (longMs) {
        recorded.longFrames++;
        recorded.longFrameMs += longMs;
      }
    },
    switchAhead: () => void recorded.switches++,
    flushUsage: () => withHourlyExtras(() => {}),
    refreshConsent: (sharing) => save(sharing ? { sharing: true, installId: "id" } : { sharing: false, installId: null }),
    close: () => {
      removeFrames();
      removeSwitches();
      setTelemetryRelay(null);
      channel.close();
    },
  };
}

const SESSION_KEYS = ["session_writes", "session_cosmetic_writes", "session_kb_written"];
const sessionCounts = (queue) => queue.filter(({ event }) => event === USAGE_COUNTS_EVENT).map(({ props }) => Object.fromEntries(SESSION_KEYS.map((key) => [key, props[key] ?? 0])));
const shellCounts = (queue) => queue.filter(({ event }) => event === USAGE_COUNTS_EVENT).map(({ props }) => Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("linux_"))));

test("a follower window's shell counts from before it applies opt-in never reach the leader's queue; its first eligible ones do", async () => {
  const leader = leaderWindow();
  const follower = followerWindow();
  try {
    follower.refreshConsent(false);
    for (let frame = 0; frame < 8; frame++) follower.frame();
    follower.frame(78);
    follower.switchAhead();
    leader.sharing = true;
    assert.equal(isSharing(), false, "the follower hasn't refreshed its choice yet");
    follower.flushUsage();
    await settle();
    assert.deepEqual(shellCounts(leader.queue).filter((counts) => Object.keys(counts).length), [], "the hourly flush or close before the refresh relays none of the off-window counts");

    follower.frame(40);
    follower.switchAhead();
    follower.refreshConsent(true);
    follower.frame(55);
    follower.switchAhead();
    follower.flushUsage();
    await settle();
    assert.deepEqual(shellCounts(leader.queue).at(-1), { linux_viewport_frames: 1, linux_long_frames: 1, linux_long_frame_ms: 55, linux_switch_aheads: 1 }, "only the frame and switch after the refresh are counted");
  } finally {
    follower.close();
    leader.close();
    save({ sharing: false, installId: null });
  }
});

test("a follower window's session writes from before it applies opt-in never reach the leader's queue; its first eligible ones do", async () => {
  const leader = leaderWindow();
  const follower = followerWindow();
  try {
    follower.refreshConsent(false);
    noteSessionWrite(17000, true);
    noteSessionWrite(17000, false);
    leader.sharing = true;
    follower.frame();
    follower.flushUsage();
    await settle();
    assert.ok(sessionCounts(leader.queue).every((counts) => SESSION_KEYS.every((key) => counts[key] === 0)), JSON.stringify(sessionCounts(leader.queue)));

    follower.refreshConsent(true);
    noteSessionWrite(3072, true);
    follower.flushUsage();
    await settle();
    assert.deepEqual(sessionCounts(leader.queue).at(-1), { session_writes: 1, session_cosmetic_writes: 1, session_kb_written: 3 });
  } finally {
    follower.close();
    leader.close();
    save({ sharing: false, installId: null });
  }
});

test("after an optimistic opt-out a follower relays no shell or session counts, though its saved choice is still on", async () => {
  const leader = leaderWindow();
  const follower = followerWindow();
  try {
    follower.refreshConsent(true);
    leader.sharing = true;
    useTelemetry.setState({ sharing: false });
    assert.equal(isSharing(), true, "the saved choice hasn't followed the switch yet");
    follower.frame(60);
    follower.switchAhead();
    noteSessionWrite(4096, false);
    follower.flushUsage();
    await settle();
    assert.deepEqual(shellCounts(leader.queue).filter((counts) => Object.keys(counts).length), []);
    assert.ok(sessionCounts(leader.queue).every((counts) => SESSION_KEYS.every((key) => counts[key] === 0)), JSON.stringify(sessionCounts(leader.queue)));
  } finally {
    follower.close();
    leader.close();
    save({ sharing: false, installId: null });
  }
});
