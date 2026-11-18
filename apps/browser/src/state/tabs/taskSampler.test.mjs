import assert from "node:assert/strict";
import { mock, test } from "node:test";

globalThis.__DEV__ = false;

const { sampleTasks, FIRST_SAMPLE_MS, SAMPLER_KEPT_MS } = await import("./taskSampler.ts");
const { engineCalls } = await import("../../test-native/index.ts");

const reads = () => engineCalls.filter((c) => c.domain === "engine" && c.verb === "tasks").length;
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
};

test("a cold sampler reads, waits for the first measurement and reads once more; a warm one reads once", async (t) => {
  mock.timers.enable({ apis: ["Date", "setTimeout"], now: 5_000_000 });
  let memory = 0;
  globalThis.acTestTasks = () => [{ id: 1, type: "renderer", title: "", killable: true, cpu: 0, processors: 8, memory, gpuMemory: 0, tabIds: ["a"], pid: 7 }];
  t.after(() => {
    mock.timers.reset();
    delete globalThis.acTestTasks;
  });
  engineCalls.length = 0;
  const cold = sampleTasks();
  await settle();
  assert.equal(reads(), 1);
  memory = 42;
  mock.timers.tick(FIRST_SAMPLE_MS);
  const first = await cold;
  assert.equal(reads(), 2);
  assert.equal(first.waited, true);
  assert.equal(first.tasks[0].memory, 42);

  mock.timers.tick(SAMPLER_KEPT_MS - 1);
  const warm = await sampleTasks();
  assert.equal(reads(), 3);
  assert.equal(warm.waited, false);

  mock.timers.tick(SAMPLER_KEPT_MS + 1);
  const again = sampleTasks();
  await settle();
  mock.timers.tick(FIRST_SAMPLE_MS);
  assert.equal((await again).waited, true);
  assert.equal(reads(), 5);
});
