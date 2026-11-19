import assert from "node:assert/strict";
import { test } from "node:test";
import { turboModules } from "../../test-native/reactNative.ts";

const { NATIVE_SYNC, windowsSync } = await import("../../../../../packages/expo-windows/src/sync/index.ts");

function fakeNative(constants) {
  const touched = [];
  const record = (name) => (...args) => {
    touched.push([name, ...args]);
    return Promise.resolve({ exists: false, writable: false, hasSyncData: false });
  };
  turboModules[NATIVE_SYNC] = new Proxy({ getConstants: () => constants }, {
    get: (target, key) => (key in target ? target[key] : record(String(key))),
  });
  return touched;
}

for (const [where, constants, expected] of [
  ["OneDrive", { oneDriveFolder: "C:\\Users\\me\\OneDrive", documentsFolder: "C:\\Users\\me\\Documents", computerName: "PC" }, "C:\\Users\\me\\OneDrive\\Nilla Sync"],
  ["Documents", { oneDriveFolder: "", documentsFolder: "C:\\Users\\me\\Documents\\", computerName: "PC" }, "C:\\Users\\me\\Documents\\Nilla Sync"],
]) {
  test(`with ${where}, Windows offers and reads only Nilla's own Sync folder`, async () => {
    const touched = fakeNative(constants);
    const sync = windowsSync();
    assert.ok(sync);
    const info = await sync.folderInfo(null);
    assert.equal(info.defaultPath, expected);
    assert.equal(info.path, expected);
    await sync.chainStatus(info.defaultPath).catch(() => {});
    assert.ok(touched.length > 0);
    for (const [, ...args] of touched) {
      for (const arg of args.filter((value) => typeof value === "string" && /\\Users\\me\\/.test(value))) {
        assert.ok(arg === expected || arg.startsWith(`${expected}\\`), `${arg} is outside ${expected}`);
      }
    }
  });
}
