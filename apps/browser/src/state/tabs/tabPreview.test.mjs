import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { previewAspect, previewState, tabOnScreen } = await import("./tabPreview.ts");
const { tabNeverCaptured } = await import("./tabPictures.ts");

const S = () => useBrowser.getState();
const URL_A = "https://red.example/";
const base = { picture: { url: URL_A }, tabUrl: URL_A, onScreen: false, crashed: false, neverCaptured: false };

test("a background tab shows its picture only while the picture is of the address the tab is on", () => {
  assert.equal(previewState(base), "shown");
  assert.equal(previewState({ ...base, tabUrl: "https://red.example/inbox" }), "stale", "navigated since, SPA changes included");
  assert.equal(previewState({ ...base, picture: null }), "none");
});

test("the tab on screen, a blank, crashed, private or incognito tab never shows a preview", () => {
  assert.equal(previewState({ ...base, onScreen: true }), "hidden");
  assert.equal(previewState({ ...base, crashed: true }), "hidden");
  assert.equal(previewState({ ...base, neverCaptured: true, picture: null }), "hidden");
  assert.equal(previewState({ ...base, tabUrl: "", picture: null }), "hidden");
  assert.equal(previewState({ ...base, tabUrl: "about:blank", picture: { url: "about:blank" } }), "hidden");
  assert.equal(previewState({ ...base, onScreen: true, picture: null }), "hidden", "hidden wins over none, so it isn't counted");
});

test("the active tab and every pane of the active split are on screen; other tabs aren't", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.example/", background: true });
  const c = S().newTab(w, { url: "https://c.example/", background: true });
  const d = S().newTab(w, { url: "https://d.example/", background: true });
  assert.deepEqual([a, b, c, d].map((id) => tabOnScreen(S(), w, id)), [true, false, false, false]);
  S().createSplit([b, c]);
  S().activate(b);
  assert.deepEqual([a, b, c, d].map((id) => tabOnScreen(S(), w, id)), [false, true, true, false]);
  assert.equal(tabOnScreen(S(), "gone", a), false);
});

test("private windows and incognito profiles are never captured", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const a = S().windows[w].tabIds[0];
  const p = S().createWindow({ kind: "private", url: "https://secret.example/" });
  const pa = S().windows[p].tabIds[0];
  assert.equal(tabNeverCaptured(S(), a), false);
  assert.equal(tabNeverCaptured(S(), pa), true);
  assert.equal(tabNeverCaptured(S(), "gone"), true);
  S().updateTab(a, { profileId: "incognito:1@default" });
  assert.equal(tabNeverCaptured(S(), a), true);
});

test("the preview keeps the page's own shape, falling back for an empty frame", () => {
  assert.equal(previewAspect([0, 0, 1600, 1000], 1.6), 1.6);
  assert.equal(previewAspect([10, 40, 1200, 900], 1.6), 1200 / 900);
  assert.equal(previewAspect([0, 0, 0, 0], 1.6), 1.6);
  assert.equal(previewAspect([0, 0, 800, 0], 1.6), 1.6);
});
