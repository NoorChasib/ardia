import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { gateHost } from "./layer1Gate.ts";
import { refuseUnisolatedLaunch, UNISOLATED_MESSAGE } from "./unisolatedLaunch.ts";

function fakeHost(launchConfig) {
  const dispatched = [];
  const raw = {
    bootstrap: Object.freeze({ windowId: "w1", profileId: "default", startup: true, capabilities: ["session.read", "session.write"], session: { windows: {} }, ...(launchConfig === undefined ? {} : { launchConfig }) }),
    invoke: async (method) => (dispatched.push(["invoke", method]), null),
    call: async (name) => (dispatched.push(["call", name]), "{}"),
    onEvent: () => () => {},
  };
  return { host: gateHost(Object.freeze(raw)), dispatched };
}

function fakeRoot() {
  const attributes = {};
  return { attributes, textContent: "", setAttribute(name, value) { attributes[name] = value; } };
}

for (const [label, launchConfig] of [["isolated: false", { isolated: false, configDirectory: "/home/me/.config/browser/config" }], ["no launch config", undefined], ["isolated: \"true\"", { isolated: "true" }]]) {
  test(`a host that reports ${label} gets the blocking page and no read or write`, async () => {
    const { host, dispatched } = fakeHost(launchConfig);
    const root = fakeRoot();
    assert.equal(refuseUnisolatedLaunch(host, root), true);
    assert.equal(root.attributes.role, "alert");
    assert.equal(root.textContent, UNISOLATED_MESSAGE);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(dispatched, []);
    assert.equal(refuseUnisolatedLaunch(host, null), true);
  });
}

test("an isolated host starts normally", () => {
  const { host, dispatched } = fakeHost({ isolated: true, configDirectory: "/scratch/config/profile/config" });
  const root = fakeRoot();
  assert.equal(refuseUnisolatedLaunch(host, root), false);
  assert.deepEqual(root.attributes, {});
  assert.equal(root.textContent, "");
  assert.deepEqual(dispatched, []);
});

test("the UI refuses before it reads config, hydrates the session or writes anything", () => {
  const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  const startAt = main.indexOf("async function start() {");
  assert.notEqual(startAt, -1);
  const moduleLevel = main.slice(0, startAt).split("\n").filter((line) => !line.startsWith("import ")).join("\n");
  assert.doesNotMatch(moduleLevel, /invokeHost\(|callHost\(|\.invoke\(|\.call\(|start[A-Z]\w*\(/);
  const start = main.slice(startAt);
  const refusal = start.search(/if \(refuseUnisolatedLaunch\(\w+, document\.getElementById\("root"\)\)\) return;/);
  assert.notEqual(refusal, -1);
  const before = start.slice(0, refusal).trim().split("\n").slice(1).map((line) => line.trim());
  assert.equal(before.length, 1);
  assert.match(before[0], /^if \(!\w+\) throw new Error\("[^"]*"\);$/);
  for (const step of ["startHostConfig(", "\"session.read\"", "hydrateLaunchSession(", "startHostPersistence(", "startConfigFiles(", "startHostTelemetry(", "startHostData(", "setSharedCommands("]) {
    const at = start.indexOf(step);
    assert.ok(at > refusal, `${step} runs after the refusal`);
  }
  assert.equal(main.match(/^void start\(\)/gm)?.length, 1);
});

test("the page loads only the refusal before anything that calls the host, and loads the app only when isolated", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((match) => match[1]), ["/src/entry.ts"]);
  const entry = readFileSync(new URL("./entry.ts", import.meta.url), "utf8");
  const runtimeImports = (source) => [...source.matchAll(/^import (?!type )[^;]*?from "([^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(runtimeImports(entry), ["./unisolatedLaunch"]);
  assert.deepEqual(runtimeImports(readFileSync(new URL("./unisolatedLaunch.ts", import.meta.url), "utf8")), ["./hostLaunchConfig"]);
  assert.deepEqual(runtimeImports(readFileSync(new URL("./hostLaunchConfig.ts", import.meta.url), "utf8")), []);
  assert.doesNotMatch(entry, /^import ["']/m);
  assert.match(entry, /if \(!\w+ \|\| !refuseUnisolatedLaunch\(\w+, document\.getElementById\("root"\)\)\) void import\("\.\/main"\);/);
  assert.equal(entry.match(/import\(/g)?.length, 1);
});

test("the page says the UI stopped and doesn't claim the engine read nothing", () => {
  assert.match(UNISOLATED_MESSAGE, /stopped/);
  assert.match(UNISOLATED_MESSAGE, /scripts\/linux\/nilla-dev-run/);
  assert.doesNotMatch(UNISOLATED_MESSAGE, /read and saved nothing|nothing was read/);
});
