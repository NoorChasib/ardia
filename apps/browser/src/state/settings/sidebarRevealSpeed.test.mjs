import assert from "node:assert/strict";
import { test } from "node:test";
globalThis.acTestNativeModules = { NillaSharedFolders: { location: () => ({ path: "/scratch", iCloudAvailable: true, iCloudPath: "/scratch" }) } };
const { SETTING_SPECS, DEFAULT_SETTINGS, parseSettings } = await import("./settings.ts");
const { isConfigSettingKey } = await import("./configAllowlist.ts");
const { settingsSnapshot } = await import("../telemetry/settingsSnapshot.ts");
const { unshownSettings, SETTINGS } = await import("../../components/settings/settingsIndex.ts");

test("the sidebar reveals at today's speed unless the owner picks Faster or Slower, on every device they sync", () => {
  assert.equal(DEFAULT_SETTINGS.sidebarRevealSpeed, "default");
  assert.equal(SETTING_SPECS.sidebarRevealSpeed.synced, true);
  assert.ok(isConfigSettingKey("sidebarRevealSpeed"));
  for (const speed of ["faster", "default", "slower"]) assert.equal(parseSettings({ sidebarRevealSpeed: speed }).sidebarRevealSpeed, speed);
  for (const junk of ["fast", "slow", 250, null, true, ""]) assert.equal(parseSettings({ sidebarRevealSpeed: junk }).sidebarRevealSpeed, "default", String(junk));
  assert.equal(parseSettings({}).sidebarRevealSpeed, "default");
});

test("the settings snapshot says which reveal speed is on and whether it's the default", () => {
  const snapshot = settingsSnapshot({ ...DEFAULT_SETTINGS, sidebarRevealSpeed: "slower" });
  assert.equal(snapshot.setting_sidebarRevealSpeed, "slower");
  assert.equal(snapshot.default_sidebarRevealSpeed, "default");
  assert.equal(settingsSnapshot(DEFAULT_SETTINGS).setting_sidebarRevealSpeed, "default");
});

test("the reveal speed row sits in Settings › Tabs › Layout and goes away with tabs along the top", () => {
  const row = SETTINGS.find((s) => s.id === "tabs.sidebarRevealSpeed");
  assert.ok(row, "row exists");
  assert.equal(row.pane, "tabs");
  assert.equal(row.explained, true);
  const unshown = (settings, top) => new Set(unshownSettings({ ...DEFAULT_SETTINGS, ...settings }, { top, syncOn: false }).split("\n"));
  assert.ok(!unshown({}, false).has("tabs.sidebarRevealSpeed"));
  assert.ok(unshown({ tabLayout: "top" }, true).has("tabs.sidebarRevealSpeed"));
});
