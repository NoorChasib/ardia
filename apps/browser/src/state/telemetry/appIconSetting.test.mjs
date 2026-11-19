import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { appIconSetting } = await import("./settingsSnapshot.ts");

const pickerIds = [...readFileSync(new URL("../../../../../packages/shell/ios/AppIcons.swift", import.meta.url), "utf8").matchAll(/Variant\(id: "([^"]+)"/g)].map((match) => match[1]);

test("every app icon the picker offers is reported, hyphenated ids included", () => {
  assert.equal(pickerIds.length, 24);
  assert.ok(pickerIds.includes("forest-dusk") && pickerIds.includes("blue-hour"));
  for (const id of pickerIds) assert.deepEqual(appIconSetting(id), { setting_app_icon: id, default_app_icon: "default" }, id);
});

test("free text, a missing icon and over-long ids report nothing", () => {
  for (const text of [null, "", "Forest dusk", "forest dusk", "-forest", "forest-", "forest--dusk", "Blue-Hour", "https://x.example", "a".repeat(17), "blue_hour", "rose1"])
    assert.deepEqual(appIconSetting(text), {}, String(text));
});
