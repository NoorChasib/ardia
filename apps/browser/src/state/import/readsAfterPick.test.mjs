import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
globalThis.require = createRequire(import.meta.url);

const PICKED_ONLY = "ardia";
const profile = (root, extra = {}) => ({ id: "Default", name: "Person 1", path: `${root}/Default`, isDefault: true, available: ["bookmarks", "history"], ...extra });
const SOURCES = [
  { id: PICKED_ONLY, name: "Ardia", family: "chromium", requiresExport: false, needsKeychain: true, profiles: [profile("/fake/home/Ardia", { avatarPath: "/fake/home/Ardia/Default/Avatar.png" })] },
  { id: "chrome", name: "Google Chrome", family: "chromium", requiresExport: false, needsKeychain: true, profiles: [profile("/fake/home/Chrome")] },
  {
    id: "arc", name: "Arc", family: "arc", requiresExport: false, needsKeychain: true, sidebar: "arc",
    profiles: [profile("/fake/home/Arc", { spaces: [{ id: "s1", name: "Work", pinnedCount: 0, tabCount: 0, theme: "{}" }] })],
  },
];

let calls = [];
let honoursOnly = true;
let unlocked = true;
globalThis.acTestNativeModules = {
  NillaImport: {
    addListener: () => ({ remove() {} }),
    isBrowserUnlocked: (...args) => (calls.push(["isBrowserUnlocked", ...args]), unlocked),
    profilesNeedingKey: async (...args) => (calls.push(["profilesNeedingKey", ...args]), JSON.stringify(args[1])),
    forgetUnlockedKeys() {},
    cancelImport() {},
    listBrowsers: async (only) => {
      calls.push(["listBrowsers", only]);
      return JSON.stringify(honoursOnly && only ? SOURCES.filter((s) => only.includes(s.id)) : SOURCES);
    },
    unlockBrowser: async (...args) => (calls.push(["unlockBrowser", ...args]), null),
    listExtensions: async (...args) => (calls.push(["listExtensions", ...args]), "[]"),
    readDiaTabs: async () => (calls.push(["readDiaTabs"]), JSON.stringify({ profiles: [], windowCount: 0, skipped: 0, duplicates: 0, favicons: [] })),
    importData: async (_job, browserId, profileId, kinds) => {
      calls.push(["importData", browserId, profileId, kinds]);
      return JSON.stringify({
        browserId, profileId, history: [], historyCount: 0, tabs: [], tabGroups: [], credentials: [], cookieCount: 0, addressCount: 0, cardCount: 0,
        spaces: [], favorites: [], favicons: [], failed: [], warnings: [],
      });
    },
  },
};

const { useBrowser } = await import("../browser/store.ts");
const { chooseSource, importNow, setImportKinds, startImport } = await import("./flow.ts");
const { continueImport } = await import("./runImport.ts");
const { arcThemeChoices } = await import("../profiles/arcThemes.ts");
const { listedSourceTiles, sourceTiles } = await import("../../components/onboarding/sourceTiles.ts");
const { listBrowsers } = await import("@nilla/import");
const { PLATFORM_FEATURES: LINUX } = await import("../../lib/platformFeatures.linux.ts");
const { PLATFORM_FEATURES: WINDOWS } = await import("../../lib/platformFeatures.windows.ts");
const { PLATFORM_FEATURES: MAC } = await import("../../lib/platformFeatures.ts");

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const touchesPicked = ([name, ...args]) => name !== "listBrowsers" && JSON.stringify(args).toLowerCase().includes(PICKED_ONLY);
const readsOf = (id) => calls.filter(([name, browserId]) => name !== "listBrowsers" && browserId === id);

test("the Arc theme lookup asks only for Arc, even from a platform that lists every browser", async () => {
  for (const honours of [true, false]) {
    calls = [];
    honoursOnly = honours;
    const choices = await arcThemeChoices();
    assert.deepEqual(calls, [["listBrowsers", ["arc"]]]);
    assert.deepEqual(choices, []);
    assert.deepEqual((await listBrowsers(["arc"])).map((s) => s.id), ["arc"]);
  }
  honoursOnly = true;
});

test("onboarding on the Mac offers an Ardia tile only when Ardia is installed, found by its app bundle like Chrome", () => {
  const installed = sourceTiles((c) => c.id === PICKED_ONLY || c.id === "chrome", MAC);
  assert.deepEqual(installed.filter((t) => t.found).map((t) => [t.id, t.app]), [["chrome", "/Applications/Google Chrome.app"], [PICKED_ONLY, "/Applications/Ardia.app"]]);
  assert.ok(!sourceTiles(() => false, MAC).some((t) => t.id === PICKED_ONLY));
});

test("onboarding on Linux and Windows asks the import list only for the browsers it has tiles for; their importers have no Ardia source, so its tile is hidden there", async () => {
  for (const platform of [LINUX, WINDOWS]) {
    calls = [];
    const tiles = await listedSourceTiles(listBrowsers, platform);
    const [[name, only]] = calls;
    assert.equal(name, "listBrowsers");
    assert.ok(only.includes("chrome") && !only.includes(PICKED_ONLY));
    assert.ok(tiles.some((t) => t.id === "chrome" && t.found));
    assert.ok(!tiles.some((t) => t.id === PICKED_ONLY));
    assert.ok(platform.hiddenBrowserSources.includes(PICKED_ONLY));
  }
});

test("the importer lists Ardia like any browser but reads its profile only after the user picks it", async () => {
  calls = [];
  useBrowser.getState().hydrate({});
  useBrowser.getState().createWindow({ url: "https://start.example/" });
  const stop = startImport(0);
  await settle();
  assert.deepEqual(importNow().browsers.map((b) => b.id), SOURCES.map((s) => s.id));
  assert.equal(importNow().source?.id, PICKED_ONLY);
  assert.deepEqual(calls.filter(touchesPicked), []);

  chooseSource(importNow().browsers.find((b) => b.id === "chrome"));
  setImportKinds(["bookmarks", "history"]);
  continueImport();
  await settle();
  assert.equal(importNow().step.name, "done");
  assert.deepEqual(readsOf("chrome").map(([name]) => name), ["importData", "listExtensions"]);
  assert.deepEqual(calls.filter(touchesPicked), []);

  const beforePick = calls.length;
  chooseSource(importNow().browsers.find((b) => b.id === PICKED_ONLY));
  setImportKinds(["bookmarks", "history"]);
  continueImport();
  await settle();
  assert.deepEqual(calls.slice(beforePick).filter(touchesPicked).map(([name, id]) => [name, id]), [["importData", PICKED_ONLY], ["listExtensions", PICKED_ONLY]]);
  stop();
});

test("whether Ardia's open tabs need its keychain key is asked only after the user picks it and continues", async () => {
  calls = [];
  unlocked = false;
  const stop = startImport(0);
  await settle();
  assert.equal(importNow().source?.id, PICKED_ONLY);
  assert.equal(importNow().source?.profiles[0].tabsNeedKey, undefined);
  assert.deepEqual(calls.filter(touchesPicked), []);

  setImportKinds(["tabs"]);
  await continueImport();
  assert.deepEqual(calls.filter(touchesPicked).filter(([name]) => name !== "isBrowserUnlocked"), [["profilesNeedingKey", PICKED_ONLY, ["Default"]]]);
  assert.equal(importNow().step.name, "unlock");
  assert.equal(importNow().source?.profiles[0].tabsNeedKey, true);
  stop();
  unlocked = true;
});
