import assert from "node:assert/strict";
import { test } from "node:test";

const { revealWait } = await import("./revealWait.ts");

test("a reveal wait runs once its time is up, and not before", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const wait = revealWait();
  let runs = 0;
  assert.equal(wait.start(250, () => runs++), true);
  assert.equal(wait.pending(), true);
  t.mock.timers.tick(249);
  assert.equal(runs, 0);
  t.mock.timers.tick(1);
  assert.equal(runs, 1);
  assert.equal(wait.pending(), false);
  assert.equal(wait.cancel(), false, "nothing left to cancel once it ran");
});

test("cancelling a pending wait stops it and says one was pending; cancelling none says so", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const wait = revealWait();
  let runs = 0;
  assert.equal(wait.cancel(), false);
  wait.start(250, () => runs++);
  t.mock.timers.tick(100);
  assert.equal(wait.cancel(), true);
  assert.equal(wait.pending(), false);
  t.mock.timers.tick(500);
  assert.equal(runs, 0);
  assert.equal(wait.cancel(), false);
});

test("a second arrival while waiting keeps the first deadline and runs once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const wait = revealWait();
  const runs = [];
  wait.start(250, () => runs.push("first"));
  t.mock.timers.tick(200);
  assert.equal(wait.start(250, () => runs.push("second")), false);
  t.mock.timers.tick(50);
  assert.deepEqual(runs, ["first"]);
  t.mock.timers.tick(500);
  assert.deepEqual(runs, ["first"]);
});

test("no wait runs at once, with nothing left pending", () => {
  const wait = revealWait(() => assert.fail("nothing scheduled"));
  let runs = 0;
  assert.equal(wait.start(0, () => runs++), true);
  assert.equal(runs, 1);
  assert.equal(wait.pending(), false);
  assert.equal(wait.cancel(), false);
});

test("a wait can start again after it ran or was cancelled", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const wait = revealWait();
  let runs = 0;
  wait.start(250, () => runs++);
  wait.cancel();
  wait.start(250, () => runs++);
  t.mock.timers.tick(250);
  wait.start(250, () => runs++);
  t.mock.timers.tick(250);
  assert.equal(runs, 2);
});

const { EDGE_PROBE_IDLE_LIMIT, EDGE_PROBE_MS, edgeProbe } = await import("./revealWait.ts");

const probeWith = (watching = true) => {
  const asks = [];
  const replies = [];
  const probe = edgeProbe(() => (asks.push(Date.now()), watching));
  const wait = { pending: false };
  const reply = { reveal: () => replies.push("reveal"), retreat: (waitEnded) => replies.push(waitEnded ? "ended" : "retreat"), waiting: () => wait.pending };
  return { probe, asks, replies, reply, wait };
};

test("tracking asks the edge watcher for a fresh report every probe interval until it stops", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { probe, asks, reply } = probeWith();
  probe.track();
  probe.track();
  t.mock.timers.tick(EDGE_PROBE_MS * 3);
  assert.equal(asks.length, 3);
  assert.equal(probe.answer(true, false, reply), true);
  assert.equal(probe.tracking(), false, "a report from outside the edge zone ends the tracking");
  t.mock.timers.tick(EDGE_PROBE_MS * 3);
  assert.equal(asks.length, 3);
});

test("only a report that follows an ask is an answer, and a confirm takes it ahead of the poll", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { probe, replies, reply } = probeWith();
  assert.equal(probe.answer(true, true, reply), false, "no ask, no answer");
  let shown = 0;
  assert.equal(probe.confirm(() => shown++), true);
  assert.equal(probe.answer(true, true, reply), true);
  assert.equal(shown, 1);
  assert.deepEqual(replies, []);
  probe.confirm(() => shown++);
  probe.answer(false, true, reply);
  assert.equal(shown, 1);
  assert.deepEqual(replies, ["ended"], "a confirm that finds the pointer off the band ends the wait");
});

test("a confirm with no edge watch running fails at once instead of waiting for a report that never comes", () => {
  const { probe, replies, reply } = probeWith(false);
  let shown = 0;
  assert.equal(probe.confirm(() => shown++), false);
  assert.equal(probe.answer(true, true, reply), false);
  assert.equal(shown, 0);
  assert.deepEqual(replies, []);
});

test("with no wait pending, a lingering pointer gets a limited number of asks and then none", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { probe, asks, reply, wait } = probeWith();
  wait.pending = true;
  probe.track();
  for (let i = 0; i < 3 * EDGE_PROBE_IDLE_LIMIT; i++) {
    t.mock.timers.tick(EDGE_PROBE_MS);
    probe.answer(true, true, reply);
  }
  assert.equal(probe.tracking(), true, "a running wait keeps the probe going");
  wait.pending = false;
  const before = asks.length;
  for (let i = 0; i < 3 * EDGE_PROBE_IDLE_LIMIT; i++) {
    t.mock.timers.tick(EDGE_PROBE_MS);
    probe.answer(false, true, reply);
  }
  assert.equal(probe.tracking(), false);
  assert.ok(asks.length - before <= EDGE_PROBE_IDLE_LIMIT + 1, `${asks.length - before} asks after the wait ended`);
});

test("a probe whose reports never come stops asking on its own", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { probe, asks } = probeWith();
  probe.track();
  t.mock.timers.tick(EDGE_PROBE_MS * EDGE_PROBE_IDLE_LIMIT * 4);
  assert.equal(probe.tracking(), false);
  assert.equal(asks.length, EDGE_PROBE_IDLE_LIMIT);
});

test("a confirm answered on the band ends the tracking even while the pointer lingers, so a parked reveal isn't asked about again", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { probe, asks, reply } = probeWith();
  probe.track();
  let shown = 0;
  probe.confirm(() => shown++);
  probe.answer(true, true, reply);
  assert.equal(shown, 1);
  assert.equal(probe.tracking(), false);
  const before = asks.length;
  t.mock.timers.tick(EDGE_PROBE_MS * 10);
  assert.equal(asks.length, before);
});
