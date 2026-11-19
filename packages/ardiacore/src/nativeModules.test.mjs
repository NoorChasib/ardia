import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "bun:test";

const requested = [];
mock.module("expo-modules-core", () => ({
  requireNativeModule: (name) => (requested.push(name), { call: async () => "null", addListener: () => ({ remove() {} }) }),
}));
const { nativeModule } = await import("./nativeModules.ts");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every module the app names maps to its engine domain and back to the same module name", () => {
  const named = [...source("./nativeModules.ts").matchAll(/^  (Nilla[A-Z]\w*): /gm)].map((match) => match[1]);
  assert.deepEqual(named, ["NillaTabs", "NillaEngine", "NillaPasswords", "NillaAutofill", "NillaSwipe"]);
  for (const name of named) nativeModule(name);
  assert.deepEqual(requested, named);
});

test("the JS bridge, the Mac modules and the Windows tables build one Nilla${Domain} module name", () => {
  const jsName = /`Nilla\$\{domain\[0\]!\.toUpperCase\(\)\}\$\{domain\.slice\(1\)\}`/;
  assert.match(source("./engine/call.ts"), jsName);
  assert.match(source("../../expo-windows/src/engine/domains/tables.ts"), jsName);
  assert.match(source("../ios/EngineCall.swift"), /"Nilla\\\(domain\.prefix\(1\)\.uppercased\(\)\)\\\(domain\.dropFirst\(\)\)"/);
});
