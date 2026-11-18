import assert from "node:assert/strict";
import { mock, test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { webviews, webviewRef } = await import("../../platform/webviews.ts");
const { LOADED_SETTLE_MS, lastPicture, onPicturesChanged, rememberPicture, startTabPictures } = await import("./tabPictures.ts");
const { takeHoverCardCounts } = await import("../telemetry/hoverCardCounts.ts");

const S = () => useBrowser.getState();
mock.timers.enable({ apis: ["setTimeout"] });
startTabPictures();

const SETTLE_MS = 1500;
const FRAME = [0, 0, 1600, 1000];
const calls = [];
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};
const fake = (id, answer = () => Promise.resolve({ data: "AA", frame: FRAME })) =>
  webviewRef(id)({
    capturePicture: (scale) => {
      calls.push({ id, scale });
      return answer();
    },
  });
const capturesOf = (id) => calls.filter((c) => c.id === id).length;

async function setup({ preview = false, url = "https://red.example/" } = {}) {
  for (const id of [...webviews.keys()]) webviews.delete(id);
  S().hydrate({});
  S().updateSettings({ showPagePreviewInTabHoverMenu: preview });
  const w = S().createWindow({ url });
  const a = S().windows[w].tabIds[0];
  S().updateTab(a, { url, title: "Red" });
  fake(a);
  mock.timers.tick(SETTLE_MS);
  await flush();
  calls.length = 0;
  takeHoverCardCounts();
  return { w, a };
}

const finishLoad = (id) => {
  S().updateLive(id, { isLoading: true });
  S().updateLive(id, { isLoading: false });
};

test("a picture remembers the address it was taken of and when", async () => {
  const before = Date.now();
  const { a } = await setup();
  const picture = lastPicture(a);
  assert.equal(picture.url, "https://red.example/");
  assert.deepEqual(picture.frame, FRAME);
  assert.equal(picture.data, "AA");
  assert.ok(picture.at >= before);
});

test("a picture whose tab moved to another address while it was taken is dropped", async () => {
  const { w } = await setup();
  const b = S().newTab(w, { url: "https://blue.example/" });
  let answer;
  fake(b, () => new Promise((resolve) => (answer = resolve)));
  mock.timers.tick(SETTLE_MS);
  await flush();
  assert.equal(capturesOf(b), 1);
  S().updateTab(b, { url: "https://green.example/" });
  answer({ data: "BB", frame: FRAME });
  await flush();
  assert.equal(lastPicture(b), null, "the picture shows blue but the tab is on green");
});

test("with the preview off, a finished load costs nothing extra: no timer, no capture", async () => {
  const { a } = await setup({ preview: false });
  const schedule = globalThis.setTimeout;
  let scheduled = 0;
  globalThis.setTimeout = (...args) => (scheduled++, schedule(...args));
  try {
    for (let i = 0; i < 10; i++) finishLoad(a);
  } finally {
    globalThis.setTimeout = schedule;
  }
  assert.equal(scheduled, 0);
  mock.timers.tick(10 * SETTLE_MS);
  await flush();
  assert.equal(calls.length, 0);
  assert.deepEqual([takeHoverCardCounts().tab_hover_preview_captures, takeHoverCardCounts().tab_hover_preview_capture_misses], [0, 0]);
});

test("with the preview on, the active tab is captured once, 500 ms after its load ends, and a background tab never", async () => {
  const { w, a } = await setup({ preview: true });
  assert.equal(LOADED_SETTLE_MS, 500);
  const b = S().newTab(w, { url: "https://blue.example/", background: true });
  fake(b);
  finishLoad(b);
  finishLoad(a);
  mock.timers.tick(LOADED_SETTLE_MS - 1);
  await flush();
  assert.equal(calls.length, 0);
  mock.timers.tick(1);
  await flush();
  assert.deepEqual(calls, [{ id: a, scale: 0.25 }]);
  mock.timers.tick(10 * SETTLE_MS);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(capturesOf(b), 0);
  const counts = takeHoverCardCounts();
  assert.deepEqual([counts.tab_hover_preview_captures, counts.tab_hover_preview_capture_misses], [1, 0]);
});

test("a load that starts again, a tab switched away from or a preview turned off before the settle is not captured", async () => {
  const { w, a } = await setup({ preview: true });
  finishLoad(a);
  mock.timers.tick(LOADED_SETTLE_MS / 2);
  S().updateLive(a, { isLoading: true });
  mock.timers.tick(LOADED_SETTLE_MS);
  await flush();
  assert.equal(calls.length, 0, "still loading");
  S().updateLive(a, { isLoading: false });
  mock.timers.tick(LOADED_SETTLE_MS / 2);
  S().updateSettings({ showPagePreviewInTabHoverMenu: false });
  mock.timers.tick(LOADED_SETTLE_MS);
  await flush();
  assert.equal(calls.length, 0, "turned off");
  S().updateSettings({ showPagePreviewInTabHoverMenu: true });
  finishLoad(a);
  const b = S().newTab(w, { url: "https://blue.example/" });
  fake(b);
  mock.timers.tick(LOADED_SETTLE_MS);
  await flush();
  assert.equal(capturesOf(a), 0, "no longer the active tab");
});

test("private windows and incognito tabs are never captured, by any trigger", async () => {
  await setup({ preview: true });
  const p = S().createWindow({ kind: "private", url: "https://secret.example/" });
  const pa = S().windows[p].tabIds[0];
  fake(pa);
  finishLoad(pa);
  mock.timers.tick(10 * SETTLE_MS);
  await rememberPicture(pa);
  await flush();
  assert.equal(capturesOf(pa), 0);
  assert.equal(lastPicture(pa), null);
  const { a } = await setup({ preview: true });
  S().updateTab(a, { profileId: "incognito:1@default" });
  assert.equal(S().tabs[a].profileId, "incognito:1@default");
  finishLoad(a);
  S().updateTab(a, { url: "https://secret.example/" });
  mock.timers.tick(10 * SETTLE_MS);
  await rememberPicture(a);
  await flush();
  assert.equal(capturesOf(a), 0);
  assert.equal(takeHoverCardCounts().tab_hover_preview_captures, 0);
});

test("a page that can't be captured counts a miss and keeps no picture", async () => {
  const { w, a } = await setup({ preview: true });
  const b = S().newTab(w, { url: "https://chrome-error.example/" });
  fake(b, () => Promise.resolve(null));
  mock.timers.tick(SETTLE_MS);
  await flush();
  assert.equal(takeHoverCardCounts().tab_hover_preview_captures, 0, "the switch capture isn't a preview capture");
  finishLoad(b);
  mock.timers.tick(LOADED_SETTLE_MS);
  await flush();
  fake(b, () => Promise.reject(new Error("timed out")));
  finishLoad(b);
  mock.timers.tick(LOADED_SETTLE_MS);
  await flush();
  const counts = takeHoverCardCounts();
  assert.deepEqual([counts.tab_hover_preview_captures, counts.tab_hover_preview_capture_misses], [2, 2]);
  assert.equal(lastPicture(b), null);
  assert.ok(lastPicture(a), "the other tab's picture stays");
});

test("a closed tab's picture is dropped and its readers are told", async () => {
  const { w, a } = await setup();
  S().newTab(w, { url: "https://blue.example/" });
  let told = 0;
  const stop = onPicturesChanged(() => told++);
  S().closeTab(a);
  stop();
  assert.equal(lastPicture(a), null);
  assert.equal(told, 1);
});
