import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryAmount, tabMemoryLabel } from "./tabMemoryLabel.ts";

const MB = 1024 * 1024;

test("every kind has its line", () => {
  assert.equal(tabMemoryLabel({ kind: "measuring" }), "Memory: measuring…");
  assert.equal(tabMemoryLabel({ kind: "exact", bytes: 182 * MB }), "Memory: 182 MB");
  assert.equal(tabMemoryLabel({ kind: "estimate", bytes: 190 * MB }), "Memory: about 190 MB, partly shared");
  assert.equal(tabMemoryLabel({ kind: "shared", bytes: 240 * MB, tabs: 3, unnamed: false }), "Memory: 240 MB, shared by 3 tabs");
  assert.equal(tabMemoryLabel({ kind: "shared", bytes: 240 * MB, tabs: 2, unnamed: false }), "Memory: 240 MB, shared by 2 tabs");
  assert.equal(tabMemoryLabel({ kind: "shared", bytes: 240 * MB, tabs: 3, unnamed: true }), "Memory: 240 MB, shared with other pages");
  assert.equal(tabMemoryLabel({ kind: "shared", bytes: 240 * MB, tabs: 1, unnamed: false }), "Memory: 240 MB, shared with other pages");
  assert.equal(tabMemoryLabel({ kind: "unavailable" }), "Memory: not available");
  assert.equal(tabMemoryLabel({ kind: "asleep" }), "Memory: freed while asleep");
});

test("amounts are whole MB below a GB and one-decimal GB from there, in base 1024", () => {
  assert.equal(memoryAmount(0.4 * MB), "<1 MB");
  assert.equal(memoryAmount(0), "<1 MB");
  assert.equal(memoryAmount(MB), "1 MB");
  assert.equal(memoryAmount(182.4 * MB), "182 MB");
  assert.equal(memoryAmount(1023 * MB), "1023 MB");
  assert.equal(memoryAmount(1023.6 * MB), "1.0 GB");
  assert.equal(memoryAmount(1536 * MB), "1.5 GB");
  assert.equal(memoryAmount(10.25 * 1024 * MB), "10.3 GB");
});
