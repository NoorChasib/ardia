import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRunnerArgs, planRuns } from "./bun-tests.mjs";

const cwd = "/repo/apps/browser";
const list = { node: ["--import", "./src/test-loader.mjs"], files: { "src/heap.test.mjs": "needs gc()" } };
const suite = ["--node-only=node-tests.json", "--default=./src", "--default=./scripts", "--preload", "./src/test-preload.mjs"];
const plan = (...args) => planRuns(parseRunnerArgs([...suite, ...args]), list, { execPath: "bun", cwd });
const bunPaths = (args) => args.filter((arg) => arg.startsWith("./src/state") || arg === "./src" || arg === "./scripts");

describe("bun-tests runner arguments", () => {
  test("a single file runs alone on bun test", () => {
    const { bun, node } = plan("./src/state/tabs/tabs.test.mjs");
    assert.deepEqual(bunPaths(bun), ["./src/state/tabs/tabs.test.mjs"]);
    assert.equal(node, null);
  });

  for (const flag of ["--bail", "--changed", "--parallel", "--isolate", "--coverage"]) {
    test(`${flag} right before a file keeps that file as the only target`, () => {
      const { bun, node } = plan(flag, "./src/state/tabs/tabs.test.mjs");
      assert.deepEqual(bunPaths(bun), ["./src/state/tabs/tabs.test.mjs"]);
      assert.ok(bun.includes(flag));
      assert.equal(node, null);
    });
  }

  test("optional values ride on the flag itself", () => {
    const { bun } = plan("--bail=3", "--changed=main", "./src/state/tabs/tabs.test.mjs");
    assert.ok(bun.includes("--bail=3") && bun.includes("--changed=main"));
    assert.deepEqual(bunPaths(bun), ["./src/state/tabs/tabs.test.mjs"]);
  });

  test("a flag that takes a value keeps its value and the preload", () => {
    const { bun } = plan("--timeout", "0", "./src/state/tabs/tabs.test.mjs");
    assert.deepEqual(bun.slice(bun.indexOf("--preload"), bun.indexOf("--preload") + 2), ["--preload", "./src/test-preload.mjs"]);
    assert.deepEqual(bun.slice(bun.indexOf("--timeout"), bun.indexOf("--timeout") + 2), ["--timeout", "0"]);
    assert.deepEqual(bunPaths(bun), ["./src/state/tabs/tabs.test.mjs"]);
  });

  test("no path runs the defaults on bun and the whole Node list", () => {
    const { bun, node } = plan();
    assert.deepEqual(bunPaths(bun), ["./src", "./scripts"]);
    assert.ok(bun.includes("--path-ignore-patterns=src/heap.test.mjs"));
    assert.deepEqual(node.slice(-2), ["--test", "src/heap.test.mjs"]);
  });

  test("a Node-only file named alone runs only on node", () => {
    const { bun, node } = plan("--bail", "./src/heap.test.mjs");
    assert.equal(bun, null);
    assert.deepEqual(node, ["node", "--import", "./src/test-loader.mjs", "--test", "src/heap.test.mjs"]);
  });

  test("a shard reaches both runners", () => {
    const { bun, node } = plan("--shard", "2/4");
    assert.ok(bun.includes("--shard=2/4"));
    assert.ok(node.includes("--test-shard=2/4"));
  });
});
