import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { engineCallName, engineModuleName } from "./engineModuleNames.ts";

const wire = [];
const listeners = new Set();
const host = {
  bootstrap: { windowId: "main", profileId: "default", capabilities: ["ArdiaShell.quit", "passwords.list", "ArdiaSync.status"] },
  invoke: async (method) => { wire.push(method); return null; },
  call: async (name, profile) => { wire.push(`${name} ${profile}`); return JSON.stringify({ passwords: [] }); },
  onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
};
globalThis.window = { __ardiaHost: host };
const shim = await import("./shims/expo-modules-core.ts");
const { callHost, hostSupports, invokeHost } = await import("./host.ts");
const { isGatedForAnyHost } = await import("./layer1Gate.ts");
delete globalThis.window;

const requested = [];
globalThis.acTestNativeModules = new Proxy({}, { get: (_target, name) => (typeof name === "string" ? (requested.push(name), shim.requireNativeModule(name)) : undefined) });
const { domainModule } = await import("../../../packages/ardiacore/src/engine/call.ts");

test("Nilla module names map back to the frozen engine's Ardia names, and nothing else changes", () => {
  assert.equal(engineModuleName("NillaPasswords"), "ArdiaPasswords");
  assert.equal(engineModuleName("NillaShell"), "ArdiaShell");
  assert.equal(engineModuleName("ArdiaShell"), "ArdiaShell");
  assert.equal(engineModuleName("Nillas"), "Nillas");
  assert.equal(engineCallName("NillaConfig.readFile"), "ArdiaConfig.readFile");
  assert.equal(engineCallName("NillaDocuments.readDocument"), "ArdiaDocuments.readDocument");
  assert.equal(engineCallName("passwords.list"), "passwords.list");
  assert.equal(engineCallName("shell.inputRegions"), "shell.inputRegions");
  assert.equal(engineCallName("NillaShell"), "ArdiaShell");
});

test("the Linux shim's module lookups keep the asserted shell and app parts", () => {
  assert.equal(shim.hostModuleName("NillaDialogs"), "ArdiaShell");
  assert.equal(shim.hostModuleName("NillaNotifications"), "ArdiaApp");
  assert.equal(shim.hostModuleName("NillaDocuments", "readDocument"), "ArdiaShell");
  assert.equal(shim.hostModuleName("NillaDocuments", "call"), "ArdiaDocuments");
  assert.equal(shim.hostModuleName("NillaPasswords"), "ArdiaPasswords");
  assert.equal(shim.hostModuleName("ArdiaNotifications"), "ArdiaApp");
});

test("whole <Module>.<method> names reach the host as the engine's names, and the gate sees through the app's names", async () => {
  wire.length = 0;
  await invokeHost("NillaShell.quit", { args: [] }, host);
  await callHost("passwords.list", "", "{}", host);
  assert.deepEqual(wire, ["ArdiaShell.quit", "passwords.list default"]);
  assert.equal(hostSupports("NillaShell.quit", host), true);
  assert.equal(isGatedForAnyHost("NillaSync.status"), true);
  assert.equal(isGatedForAnyHost("NillaTelemetry.post"), true);
  await assert.rejects(invokeHost("NillaSync.status", { args: [] }, host), { code: "ERR_UNSUPPORTED" });
  assert.deepEqual(wire, ["ArdiaShell.quit", "passwords.list default"]);
});

test("the shared engine bridge asks for Nilla${Domain} modules and the host receives the engine's names", async () => {
  assert.match(readFileSync(new URL("../../../packages/ardiacore/src/engine/call.ts", import.meta.url), "utf8"), /requireNativeModule<DomainModule>\(`Nilla\$\{/);
  wire.length = 0;
  requested.length = 0;
  await domainModule("passwords").call("list", "", "{}");
  assert.deepEqual(requested, ["NillaPasswords"]);
  assert.deepEqual(wire, ["passwords.list default"]);
  await shim.requireNativeModule("NillaShell").quit();
  assert.deepEqual(wire, ["passwords.list default", "ArdiaShell.quit"]);
  assert.equal(shim.requireOptionalNativeModule("NillaSync"), null);
  assert.notEqual(shim.requireOptionalNativeModule("NillaShell"), null);
});

test("engine events keyed by Ardia module names reach listeners that asked for the Nilla module", () => {
  const seen = [];
  const subscription = shim.requireNativeModule("NillaShell").addListener("onWindowEvent", (payload) => seen.push(payload));
  for (const listener of listeners) listener("ArdiaShell", "onWindowEvent", { type: "focus" });
  subscription.remove();
  for (const listener of listeners) listener("ArdiaShell", "onWindowEvent", { type: "blur" });
  assert.deepEqual(seen, [{ type: "focus" }]);
});
