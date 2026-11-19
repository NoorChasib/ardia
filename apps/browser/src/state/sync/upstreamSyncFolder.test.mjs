import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { turboModules } from "../../test-native/reactNative.ts";

const { NATIVE_SYNC, windowsSync } = await import("../../../../../packages/expo-windows/src/sync/index.ts");
const { UPSTREAM_SYNC_FOLDER, UPSTREAM_SYNC_REFUSAL, UpstreamSyncFolderError, isUpstreamSyncFolder, ownSyncFoldersOnly } = await import("../../../../../packages/sync/src/upstreamSyncFolder.ts");

const FOLDER_CALLS = [
  ["folderInfo", (folder) => [folder]],
  ["chainStatus", (folder) => [folder]],
  ["createChain", (folder) => [folder]],
  ["write", (folder) => [folder, "scope", "payload"]],
  ["read", (folder) => [folder, "scope", []]],
  ["remove", (folder) => [folder, "scope", ["id"]]],
  ["deleteChain", (folder) => [folder]],
  ["enterPhrase", (folder) => ["device", "words", folder]],
  ["revealFolder", (folder) => [folder]],
];

function windowsWithPicker(picked, { resolved = true } = {}) {
  const touched = [];
  turboModules[NATIVE_SYNC] = new Proxy({ getConstants: () => ({ oneDriveFolder: "C:\\Users\\me\\OneDrive", documentsFolder: "C:\\Users\\me\\Documents", computerName: "PC" }) }, {
    get: (target, key) => (key in target ? target[key] : (...args) => {
      touched.push([String(key), ...args]);
      return Promise.resolve(key === "folderState" ? { exists: true, writable: true, hasSyncData: true, resolved } : key === "readChain" ? { entries: [] } : null);
    }),
  });
  const seeds = [];
  turboModules.NillaDialogs = { ...turboModules.NillaDialogs, pickFolder: async (start) => (seeds.push(start), picked) };
  turboModules.NillaSystem = { ...turboModules.NillaSystem, revealFile: async (path) => void touched.push(["revealFile", path]) };
  const sync = ownSyncFoldersOnly(windowsSync());
  assert.ok(sync);
  return { sync, touched, seeds };
}

const touchedPaths = (touched, path) => touched.filter((call) => call.slice(1).some((arg) => typeof arg === "string" && arg.toLowerCase().startsWith(path.toLowerCase())));

for (const base of ["C:\\Users\\me\\OneDrive", "C:\\Users\\me\\Documents"]) {
  const upstream = `${base}\\${UPSTREAM_SYNC_FOLDER}`;

  test(`picking the upstream Sync folder in ${base} is refused before it is saved or probed`, async () => {
    const { sync, touched } = windowsWithPicker(upstream);
    await assert.rejects(sync.chooseFolder(null), (error) => error instanceof UpstreamSyncFolderError && error.message === UPSTREAM_SYNC_REFUSAL);
    assert.deepEqual(touchedPaths(touched, upstream), []);
  });

  for (const path of [upstream, `${upstream}\\`, `${base}\\${UPSTREAM_SYNC_FOLDER.toLowerCase()}\\chain`, `${upstream.replace(/\\/g, "/")}/tag`]) {
    test(`a saved ${path} reaches no native call`, async () => {
      const { sync, touched } = windowsWithPicker(null);
      for (const [name, args] of FOLDER_CALLS) {
        await assert.rejects(Promise.resolve().then(() => sync[name](...args(path))), UpstreamSyncFolderError, name);
      }
      assert.deepEqual(touched.filter((call) => call.slice(1).some((arg) => typeof arg === "string" && isUpstreamSyncFolder(arg))), []);
    });
  }
}

test("Nilla's own Sync folder and any other custom folder still work", async () => {
  const custom = "D:\\Shared\\Team Folder";
  const { sync, touched } = windowsWithPicker(custom);
  assert.equal(await sync.chooseFolder(null), custom);
  const info = await sync.folderInfo(custom);
  assert.equal(info.path, custom);
  const own = (await sync.folderInfo(null)).defaultPath;
  assert.equal(isUpstreamSyncFolder(own), false);
  await sync.chainStatus(own).catch(() => {});
  assert.ok(touched.some(([name, path]) => name === "folderState" && path === custom));
  assert.ok(touched.some((call) => call.includes(own)));
});

test("a folder the native side can't resolve to its real location is refused and never seeds the picker", async () => {
  const unresolved = "D:\\Shared\\Through A Link";
  const { sync, touched, seeds } = windowsWithPicker(unresolved, { resolved: false });
  await assert.rejects(sync.chooseFolder(null), (error) => error instanceof UpstreamSyncFolderError);
  await assert.rejects(sync.chooseFolder(unresolved), (error) => error instanceof UpstreamSyncFolderError);
  assert.deepEqual(seeds, [null, null]);
  assert.deepEqual(touched.filter(([name]) => name !== "folderState"), []);
  assert.deepEqual(touched.filter(([name]) => name === "folderState").map(([, path]) => path), [unresolved, unresolved, unresolved]);
});

test("the Mac's iCloud Drive and any other spelling of the upstream folder are refused, and nothing else is", () => {
  for (const path of [`/Users/me/Library/Mobile Documents/com~apple~CloudDocs/${UPSTREAM_SYNC_FOLDER}`, `/Users/me/Dropbox/${UPSTREAM_SYNC_FOLDER.toUpperCase()}/x`, `/Volumes/NAS/${UPSTREAM_SYNC_FOLDER}/`]) {
    assert.equal(isUpstreamSyncFolder(path), true, path);
  }
  for (const path of ["/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Nilla Sync", "/Users/me/Dropbox/Sync", `/Users/me/${UPSTREAM_SYNC_FOLDER} Archive`]) {
    assert.equal(isUpstreamSyncFolder(path), false, path);
  }
});

test("every platform's Sync module goes through the guard, and a saved upstream folder is dropped at load", () => {
  const native = readFileSync(new URL("../../../../../packages/sync/src/native.ts", import.meta.url), "utf8");
  assert.match(native, /export const SyncNative = ownSyncFoldersOnly\(requireOptionalNativeModule<SyncNative>\("\w+"\)\);/);
  const engine = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
  const load = engine.slice(engine.indexOf("function load() {"), engine.indexOf("\n}\n", engine.indexOf("function load() {")));
  assert.match(load, /isUpstreamSyncFolder\(loaded\.folder\) \? \{ \.\.\.emptyDoc\(\), types: loaded\.types \} : loaded/);
  const choose = engine.slice(engine.indexOf("export async function chooseSyncFolder"));
  assert.ok(choose.indexOf("UpstreamSyncFolderError") < choose.indexOf("setSyncFolder(picked)"));
});
