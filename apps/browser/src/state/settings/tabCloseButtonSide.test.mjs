import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");
const { DEFAULT_SETTINGS, SETTING_SPECS } = await import("./settings.ts");
const { isConfigSettingKey } = await import("./configAllowlist.ts");
const { unshownSettings } = await import("../../components/settings/settingsIndex.ts");

const S = () => useBrowser.getState();
const PROFILE = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const doc = (settings) => ({ version: 7, profiles: { default: PROFILE }, profileOrder: ["default"], settings, windows: [], windowOrder: [], tabs: [], groups: [], splits: [], closedTabs: [], closedWindows: [] });

test("the close button stays on the right, like Dia, until the owner picks the left", () => {
  const spec = SETTING_SPECS.tabCloseButtonSide;
  assert.equal(spec.default, "right");
  assert.equal(DEFAULT_SETTINGS.tabCloseButtonSide, "right");
  assert.deepEqual([...spec.values], ["left", "right"]);
  for (const side of ["left", "right"]) assert.ok(spec.valid(side), side);
  for (const junk of ["top", "start", "end", "", null, 1, true]) assert.ok(!spec.valid(junk), String(junk));
  assert.equal(spec.synced, true);
  assert.ok(isConfigSettingKey("tabCloseButtonSide"));
});

test("a saved left close button reads back left, and a junk value falls back to the right", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify(doc({})));
  const stop = startPersistence();
  S().updateSettings({ tabCloseButtonSide: "left" });
  flushPersistence();
  stop();
  const saved = JSON.parse(stub.docs.get("session.json"));
  assert.equal(saved.settings.tabCloseButtonSide, "left");
  assert.ok(saved.settingsMeta.chosen.includes("tabCloseButtonSide"));
  S().updateSettings({ tabCloseButtonSide: "right" });
  S().hydrate(loadSession());
  assert.equal(S().settings.tabCloseButtonSide, "left");
  stub.docs.set("session.json", JSON.stringify(doc({ tabCloseButtonSide: "top" })));
  S().hydrate(loadSession());
  assert.equal(S().settings.tabCloseButtonSide, "right");
});

test("the Close button position row shows only while tabs are in the sidebar", () => {
  const settings = S().settings;
  assert.ok(!unshownSettings(settings, { top: false }).split("\n").includes("tabs.tabCloseButtonSide"));
  assert.ok(unshownSettings(settings, { top: true }).split("\n").includes("tabs.tabCloseButtonSide"));
});
