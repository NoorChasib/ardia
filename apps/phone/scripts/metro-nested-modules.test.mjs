import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { mapSources, strayModules } from "./bundle-embed-check.ts";

const require = createRequire(import.meta.url);
const { nestedModuleFolders, withNestedPhoneModules } = require("../metro-nested-modules.js");

const root = "/repo";
const phone = path.join(root, "apps/phone");
const modules = path.join(phone, "node_modules");

test("a package inside the phone's install looks in its own nested node_modules first, up to the install", () => {
  const origin = path.join(modules, "react-native-reanimated/scripts/validate-worklets-version.js");
  assert.deepEqual(nestedModuleFolders(origin, [modules]), [
    path.join(modules, "react-native-reanimated/scripts/node_modules"),
    path.join(modules, "react-native-reanimated/node_modules"),
  ]);
  const deeper = path.join(modules, "a/node_modules/@scope/b/index.js");
  assert.deepEqual(nestedModuleFolders(deeper, [modules]), [
    path.join(modules, "a/node_modules/@scope/b/node_modules"),
    path.join(modules, "a/node_modules/@scope/node_modules"),
    path.join(modules, "a/node_modules"),
  ]);
});

test("files outside the phone's install get no nested folders, so nothing above it is searched", () => {
  assert.deepEqual(nestedModuleFolders(path.join(phone, "src/app.tsx"), [modules]), []);
  assert.deepEqual(nestedModuleFolders(path.join(root, "packages/phone/src/index.ts"), [modules]), []);
  assert.deepEqual(nestedModuleFolders(path.join(root, "node_modules/react/index.js"), [modules]), []);
  assert.deepEqual(nestedModuleFolders(path.join(modules + "-other", "x/index.js"), [modules]), []);
});

test("the resolver hands the nested folders before the configured ones to the upstream resolver", () => {
  const seen = [];
  const config = { resolver: { resolveRequest: (context, name) => (seen.push([name, context.nodeModulesPaths, context.disableHierarchicalLookup]), { type: "empty" }) } };
  withNestedPhoneModules(config, phone);
  const base = { nodeModulesPaths: [modules], disableHierarchicalLookup: true };
  config.resolver.resolveRequest({ ...base, originModulePath: path.join(modules, "pkg/index.js") }, "semver", "android");
  config.resolver.resolveRequest({ ...base, originModulePath: path.join(phone, "index.js") }, "react", "android");
  assert.deepEqual(seen, [
    ["semver", [path.join(modules, "pkg/node_modules"), modules], true],
    ["react", [modules], true],
  ]);
});

test("without an upstream resolver it calls Metro's default with the scoped context", () => {
  const config = { resolver: {} };
  withNestedPhoneModules(config, phone);
  const result = config.resolver.resolveRequest(
    { nodeModulesPaths: [modules], originModulePath: path.join(modules, "pkg/index.js"), resolveRequest: (context) => context.nodeModulesPaths },
    "semver",
    "ios",
  );
  assert.deepEqual(result, [path.join(modules, "pkg/node_modules"), modules]);
});

test("the embed check reads Expo's sectioned maps relative to the phone and flags modules from other installs", () => {
  const sources = mapSources(
    { sections: [{ map: { sources: ["__prelude__", "/src/app.tsx"] } }, { map: { sources: ["/node_modules/react/index.js", "/../../packages/core/src/a.ts"] } }] },
    phone,
  );
  assert.deepEqual(sources, [path.join(phone, "src/app.tsx"), path.join(modules, "react/index.js"), path.join(root, "packages/core/src/a.ts")]);
  assert.deepEqual(strayModules(sources, root), []);
  const stray = [path.join(root, "node_modules/react/index.js"), path.join(root, "packages/core/node_modules/x/index.js"), path.join(root, "apps/browser/src/a.ts")];
  assert.deepEqual(strayModules([...sources, ...stray], root), stray);
});
