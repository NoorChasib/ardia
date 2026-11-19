import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const repo = new URL("../../../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, repo), "utf8");
const body = (text, start) => {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, start);
  const open = text.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(from, i + 1);
  }
  throw new Error(`${start} never closes`);
};

test("the Mac writes and clears its shared recovery kit inside the instance's own data folder", () => {
  const swift = source("packages/sync/ios/SyncModule.swift");
  const folder = swift.match(/private static let temporaryKitFolder = ([\s\S]*?)\n\n/)?.[1];
  assert.ok(folder, "temporaryKitFolder");
  assert.match(swift, /private static let dataDirectory = LaunchConfig\.shared\.dataDirectory\.map/);
  assert.match(folder, /^\(dataDirectory\s+\?\? FileManager\.default\.urls\(for: \.applicationSupportDirectory, in: \.userDomainMask\)\[0\]\s+\.appendingPathComponent\(Bundle\.main\.bundleIdentifier/);
  assert.match(folder, /\.appendingPathComponent\("Recovery Kit", isDirectory: true\)$/);
  assert.doesNotMatch(folder, /temporaryDirectory|NSTemporaryDirectory/);
  assert.deepEqual([...swift.matchAll(/appendingPathComponent\("([^"]*Recovery Kit[^"]*)"/g)].map((m) => m[1]), ["Recovery Kit"]);
  const cleanup = body(swift, "private static func removeTemporaryKits()");
  assert.deepEqual([...cleanup.matchAll(/removeItem\(at: ([^)]*)\)/g)].map((m) => m[1]), ["temporaryKitFolder"]);
  assert.match(swift, /OnCreate \{ Self\.work\.async \{ Self\.removeTemporaryKits\(\) \} \}/);
});

test("Windows writes and clears its shared recovery kit inside the instance's own data folder", () => {
  const system = source("apps/browser/windows/Ardia/SyncSystem.h");
  const module = source("apps/browser/windows/Ardia/SyncModule.h");
  const folder = body(system, "inline std::wstring KitFolder()");
  assert.match(folder, /return \(Paths::DataDirectory\(\) \/ L"Recovery Kit"\)\.wstring\(\);/);
  assert.doesNotMatch(folder, /GetTempPath|TEMP|TMP/);
  assert.deepEqual([...system.matchAll(/L"([^"]*Recovery Kit[^"]*)"/g)].map((m) => m[1]), ["Recovery Kit"]);
  const cleanup = body(module, "inline void RemoveTemporaryKits()");
  assert.match(cleanup, /std::wstring folder = SyncSystem::KitFolder\(\);/);
  assert.deepEqual([...cleanup.matchAll(/RemoveTree\(([^)]*)\)/g)].map((m) => m[1]), ["folder"]);
  const paths = source("apps/browser/windows/Ardia/Paths.h");
  assert.match(body(paths, "inline const std::filesystem::path &DataDirectory()"), /chosen\.empty\(\) \? UserFolder\(FOLDERID_LocalAppData, L"LOCALAPPDATA"\) \/ L"Nilla" : std::filesystem::path\(chosen\)/);
});
