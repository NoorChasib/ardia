import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;

const { attributeTabMemory, measureTabMemory, tabMemoryReading, useTabMemoryLine, useTabMemorySnapshot, SNAPSHOT_KEPT_MS } = await import("./tabMemory.ts");
const { useLifecycle } = await import("./sleepingTabs.ts");
const { takeHoverCardCounts } = await import("../telemetry/hoverCardCounts.ts");
const { engineCalls } = await import("../../test-native/index.ts");

const MB = 1024 * 1024;
let nextId = 1;
const task = (type, pid, memory, tabIds = []) => ({ id: nextId++, type, title: "", killable: true, cpu: 0, processors: 8, memory, gpuMemory: 0, tabIds, pid });

test("one renderer of its own is exact", () => {
  assert.deepEqual(attributeTabMemory([task("renderer", 10, 182 * MB, ["a"]), task("gpu", 2, 900 * MB)], "a"), { kind: "exact", bytes: 182 * MB });
});

test("a main frame and an iframe in two processes of its own add up, still exact", () => {
  const tasks = [task("renderer", 10, 100 * MB, ["a"]), task("renderer", 11, 40 * MB, ["a"])];
  assert.deepEqual(attributeTabMemory(tasks, "a"), { kind: "exact", bytes: 140 * MB });
});

test("an iframe in another tab's process makes an estimate with that process split evenly", () => {
  const tasks = [task("renderer", 10, 100 * MB, ["a"]), task("renderer", 11, 80 * MB, ["b"]), task("renderer", 11, 80 * MB, ["a"])];
  assert.deepEqual(attributeTabMemory(tasks, "a"), { kind: "estimate", bytes: 140 * MB });
  assert.deepEqual(attributeTabMemory(tasks, "b"), { kind: "shared", bytes: 80 * MB, tabs: 2, unnamed: false });
});

test("three tabs in one process share it whole, counted once and not tripled", () => {
  const tasks = ["a", "b", "c"].map((id) => task("renderer", 10, 240 * MB, [id]));
  for (const id of ["a", "b", "c"]) assert.deepEqual(attributeTabMemory(tasks, id), { kind: "shared", bytes: 240 * MB, tabs: 3, unnamed: false });
});

test("a page with no tab in the same process is an unnamed sharer", () => {
  const tasks = [task("renderer", 10, 240 * MB, ["a"]), task("renderer", 10, 240 * MB, [])];
  assert.deepEqual(attributeTabMemory(tasks, "a"), { kind: "shared", bytes: 240 * MB, tabs: 1, unnamed: true });
  const extension = [task("renderer", 10, 240 * MB, ["a"]), task("extension", 10, 240 * MB, [])];
  assert.equal(attributeTabMemory(extension, "a").kind, "shared");
});

test("workers in the tab's process don't make it shared", () => {
  const tasks = [task("renderer", 10, 120 * MB, ["a"]), task("dedicatedWorker", 10, 120 * MB, []), task("serviceWorker", 10, 120 * MB, []), task("sharedWorker", 10, 120 * MB, [])];
  assert.deepEqual(attributeTabMemory(tasks, "a"), { kind: "exact", bytes: 120 * MB });
});

test("a process not measured yet reads measuring", () => {
  assert.deepEqual(attributeTabMemory([task("renderer", 10, 0, ["a"])], "a"), { kind: "measuring" });
  assert.deepEqual(attributeTabMemory([task("renderer", 10, Number.NaN, ["a"])], "a"), { kind: "measuring" });
});

test("a tab with no task, pid 0 or no pid is unavailable, and null tab ids are ignored", () => {
  assert.deepEqual(attributeTabMemory([task("renderer", 10, MB, ["b"])], "a"), { kind: "unavailable" });
  assert.deepEqual(attributeTabMemory([task("renderer", 0, MB, ["a"])], "a"), { kind: "unavailable" });
  assert.deepEqual(attributeTabMemory([{ ...task("renderer", 10, MB, ["a"]), pid: undefined }], "a"), { kind: "unavailable" });
  assert.deepEqual(attributeTabMemory([task("renderer", 10, 50 * MB, [null, "a"])], "a"), { kind: "exact", bytes: 50 * MB });
  assert.deepEqual(attributeTabMemory([task("renderer", 10, 50 * MB, ["a"]), task("renderer", 10, 50 * MB, [null])], "a"), { kind: "shared", bytes: 50 * MB, tabs: 1, unnamed: true });
});

test("while a read runs the reading keeps a value under 20 s old, says measuring for an older one or a tab it doesn't hold, and says unavailable once a read settles on zero", () => {
  const tasks = [task("renderer", 10, 100 * MB, ["a"]), task("renderer", 11, 0, ["z"])];
  const at = (patch) => ({ at: 1000, tasks, reading: false, failed: false, ...patch });
  const now = 1000 + SNAPSHOT_KEPT_MS - 1;
  assert.deepEqual(tabMemoryReading(at({ reading: true }), false, "a", now), { memory: { kind: "exact", bytes: 100 * MB }, settled: false });
  assert.deepEqual(tabMemoryReading(at({ reading: true }), false, "a", now + 1), { memory: { kind: "measuring" }, settled: false });
  assert.deepEqual(tabMemoryReading(at({ reading: true }), false, "b", now), { memory: { kind: "measuring" }, settled: false });
  assert.deepEqual(tabMemoryReading(at({}), false, "a", now + 60_000), { memory: { kind: "exact", bytes: 100 * MB }, settled: true });
  assert.deepEqual(tabMemoryReading(at({}), false, "b", now), { memory: { kind: "unavailable" }, settled: true });
  assert.deepEqual(tabMemoryReading(at({}), false, "z", now), { memory: { kind: "unavailable" }, settled: true });
  assert.deepEqual(tabMemoryReading(at({ tasks: null }), false, "a", now), { memory: { kind: "measuring" }, settled: false });
  assert.deepEqual(tabMemoryReading(at({ tasks: [], failed: true }), false, "a", now), { memory: { kind: "unavailable" }, settled: true });
  assert.deepEqual(tabMemoryReading(at({ reading: true }), true, "a", now), { memory: { kind: "asleep" }, settled: true });
});

const reads = () => engineCalls.filter((c) => c.domain === "engine" && c.verb === "tasks").length;
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
};
let clock = 1_000_000_000;

function fresh(t, tasks = () => [task("renderer", 10, 100 * MB, ["a"]), task("renderer", 11, 60 * MB, ["b"])]) {
  clock += 10_000_000;
  mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  globalThis.acTestTasks = tasks;
  useTabMemorySnapshot.setState({ at: 0, tasks: null, reading: false, failed: false });
  useLifecycle.setState({ discarded: {} });
  engineCalls.length = 0;
  takeHoverCardCounts();
  t.after(() => {
    mock.timers.reset();
    delete globalThis.acTestTasks;
  });
}

async function coldRead(tabId) {
  measureTabMemory(tabId);
  await settle();
  mock.timers.tick(2200);
  await settle();
}

test("a cold first read makes exactly two engine reads 2.2 s apart, then none while the snapshot is kept", async (t) => {
  fresh(t);
  measureTabMemory("a");
  await settle();
  assert.equal(reads(), 1);
  assert.equal(useTabMemorySnapshot.getState().reading, true);
  mock.timers.tick(2199);
  await settle();
  assert.equal(reads(), 1);
  mock.timers.tick(1);
  await settle();
  assert.equal(reads(), 2);
  assert.equal(useTabMemorySnapshot.getState().reading, false);
  for (let s = 0; s < 19; s++) {
    mock.timers.tick(1000);
    measureTabMemory(s % 2 ? "a" : "b");
    await settle();
  }
  assert.equal(reads(), 2);
  const counts = takeHoverCardCounts();
  assert.equal(counts.tab_hover_card_memory_samples, 1);
  assert.equal(counts.tab_hover_card_memory_cold_waits, 1);
});

test("one snapshot serves two tabs, and the first hover after 20 s reads again", async (t) => {
  fresh(t);
  await coldRead("a");
  mock.timers.tick(5000);
  measureTabMemory("b");
  await settle();
  assert.equal(reads(), 2);
  mock.timers.tick(SNAPSHOT_KEPT_MS);
  measureTabMemory("b");
  await settle();
  assert.equal(reads(), 3);
  mock.timers.tick(2200);
  await settle();
  assert.equal(reads(), 4);
  assert.equal(takeHoverCardCounts().tab_hover_card_memory_samples, 2);
});

test("a warm sampler answers with one read and no wait", async (t) => {
  fresh(t, () => [task("renderer", 10, 100 * MB, ["a"])]);
  await coldRead("a");
  mock.timers.tick(3000);
  measureTabMemory("c");
  await settle();
  assert.equal(reads(), 3);
  assert.equal(useTabMemorySnapshot.getState().reading, false);
  const counts = takeHoverCardCounts();
  assert.equal(counts.tab_hover_card_memory_samples, 2);
  assert.equal(counts.tab_hover_card_memory_cold_waits, 1);
});

test("a tab missing from a 5 s old snapshot gets one re-read, and a tab missing from a 1 s old one gets none", async (t) => {
  fresh(t);
  await coldRead("a");
  mock.timers.tick(1000);
  measureTabMemory("new");
  await settle();
  assert.equal(reads(), 2);
  mock.timers.tick(4000);
  measureTabMemory("new");
  measureTabMemory("new");
  await settle();
  assert.equal(reads(), 3);
});

test("an asleep tab reads nothing and concurrent hovers share one read", async (t) => {
  fresh(t);
  useLifecycle.setState({ discarded: { a: true } });
  measureTabMemory("a");
  await settle();
  assert.equal(reads(), 0);
  measureTabMemory("b");
  measureTabMemory("b");
  measureTabMemory("c");
  await settle();
  assert.equal(reads(), 1);
});

test("a failed read marks the snapshot failed, reads unavailable and counts a failure", async (t) => {
  fresh(t, () => {
    throw new Error("engine gone");
  });
  measureTabMemory("a");
  await settle();
  const snapshot = useTabMemorySnapshot.getState();
  assert.equal(snapshot.failed, true);
  assert.deepEqual(snapshot.tasks, []);
  assert.deepEqual(tabMemoryReading(snapshot, false, "a", Date.now()), { memory: { kind: "unavailable" }, settled: true });
  const counts = takeHoverCardCounts();
  assert.equal(counts.tab_hover_card_memory_samples, 1);
  assert.equal(counts.tab_hover_card_memory_failures, 1);
});

test("a hover card line measures on mount, shows measuring, then counts the kind it settles on once", async (t) => {
  fresh(t);
  const line = mount((props) => useTabMemoryLine(props.tabId), { props: { tabId: "a" } });
  await settle();
  assert.deepEqual(line.value, { kind: "measuring" });
  mock.timers.tick(2200);
  await settle();
  assert.deepEqual(line.value, { kind: "exact", bytes: 100 * MB });
  line.rerender({ tabId: "a" });
  assert.equal(takeHoverCardCounts().tab_hover_card_memory_exact, 1);
  line.rerender({ tabId: "b" });
  assert.deepEqual(line.value, { kind: "exact", bytes: 60 * MB });
  mock.timers.tick(SNAPSHOT_KEPT_MS);
  line.rerender({ tabId: "a" });
  await settle();
  assert.deepEqual(line.value, { kind: "measuring" });
  mock.timers.tick(2200);
  await settle();
  assert.deepEqual(line.value, { kind: "exact", bytes: 100 * MB });
  useLifecycle.setState({ discarded: { z: true } });
  line.rerender({ tabId: "z" });
  const counts = takeHoverCardCounts();
  assert.equal(counts.tab_hover_card_memory_exact, 2);
  assert.equal(counts.tab_hover_card_memory_asleep, 1);
  assert.equal(reads(), 4);
});
