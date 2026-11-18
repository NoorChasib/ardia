import assert from "node:assert/strict";
import test from "node:test";
import { reportFake, reportModule } from "../../browser/src/test-native/report.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { useReportSheet } from "../../browser/src/state/report/store.ts";
import { cancelUploads, fileSize, recordsReports, removeReportFile } from "../../browser/src/platform/report.ts";
import { canRecord, ensureDraftDir, startRecording } from "../../browser/src/state/report/recording.ts";
import { FEEDBACK_URL, reportFiles, resetReport, sendCurrentReport, setDescription, setTitle } from "../../browser/src/state/report/actions.ts";
import { initialHostSession } from "./hostSession.ts";
import { resolveHostModule } from "./hostModules.ts";
import { LOCAL_EVENTS_FILE, REPORT_EXPORT_FOLDER_KEY, hostReportExport, hostReportPost, servesReportSheet } from "./hostReport.ts";
import { createTelemetryLocal } from "./hostTelemetryLocal.ts";
import { adoptHostReports, openReport, sendsFromSheet } from "./reportProblem.ts";

const S = () => useBrowser.getState();
const tick = () => new Promise(setImmediate);
const waitFor = async (check) => { for (let i = 0; i < 400 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5)); };

function fakeHost(capabilities = [], answers = {}) {
  const invoked = [];
  return {
    invoked,
    bootstrap: { windowId: "main", profileId: "default", startup: false, capabilities },
    invoke: async (method, { args }) => {
      invoked.push([method, args]);
      if (!(method in answers)) throw Object.assign(new Error(`Unknown host method ${method}`), { code: "ERR_UNKNOWN_CALL" });
      return typeof answers[method] === "function" ? answers[method](...args) : answers[method];
    },
    call: async () => "{}",
    onEvent: () => () => {},
  };
}

function memory() {
  const items = new Map();
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, String(value)), removeItem: (key) => void items.delete(key) };
}

function mainWindow() {
  S().hydrate(initialHostSession({ bootstrap: { windowId: "main", profileId: "default", startup: false } }, null));
  S().setFocusedWindow("main");
  useReportSheet.setState(useReportSheet.getInitialState(), true);
}

const BOTH = ["report.files", "report.send"];

test("without the report capabilities ArdiaReport answers as before and nothing reaches the host", async () => {
  const host = fakeHost();
  assert.throws(() => resolveHostModule(host, "ArdiaReport", "draftDirectory")(), { code: "ERR_UNAVAILABLE" });
  assert.equal(resolveHostModule(host, "ArdiaReport", "fileSize")("/x"), 0);
  assert.equal(resolveHostModule(host, "ArdiaReport", "removeFile")("/x"), undefined);
  assert.equal(resolveHostModule(host, "ArdiaReport", "cancelUploads")(), undefined);
  await assert.rejects(resolveHostModule(host, "ArdiaReport", "gzipText")("a", "/x"), { code: "ERR_UNAVAILABLE" });
  assert.deepEqual(await resolveHostModule(host, "ArdiaReport", "upload")("id", "u", "PUT", {}, "/x"), { status: 0, body: "", error: "Sending problem reports is unavailable on Linux" });
  assert.equal(servesReportSheet(host), false);
  assert.equal(sendsFromSheet(host), false);
  assert.equal(hostReportExport(host, memory()), undefined);
  assert.equal(hostReportPost(host), undefined);
  assert.deepEqual(host.invoked, []);
});

test("report files route to the engine with the Mac's arguments, sending stays off behind the Layer 1 gate, and recording stays off", async () => {
  const answers = {
    "ArdiaReport.draftDirectory": "/p/Report Drafts/u1",
    "ArdiaReport.fileSize": 12,
    "ArdiaReport.removeFile": null,
    "ArdiaReport.gzipFile": 7,
    "ArdiaReport.gzipText": 9,
    "ArdiaReport.upload": { status: 200, body: "", error: null },
    "ArdiaReport.post": { status: 201, body: "{}", error: null },
    "ArdiaReport.cancelUploads": null,
  };
  const host = fakeHost(BOTH, answers);
  const call = (method, ...args) => resolveHostModule(host, "ArdiaReport", method)(...args);
  assert.equal(await call("draftDirectory"), "/p/Report Drafts/u1");
  assert.equal(await call("fileSize", "/p/a"), 12);
  assert.equal(await call("removeFile", "/p/a"), null);
  assert.equal(await call("gzipFile", "/p/a", "/p/a.gz", true), 7);
  assert.equal(await call("gzipText", "text", "/p/t.gz"), 9);
  assert.equal((await call("upload", "local-events.jsonl.gz", "https://feedback.example.test/api/feedback/r1/files/local-events.jsonl.gz", "PUT", { Authorization: "Bearer t" }, "/p/t.gz")).status, 0);
  assert.equal(hostReportPost(host), undefined);
  await call("cancelUploads");
  assert.deepEqual(host.invoked, [
    ["ArdiaReport.draftDirectory", []],
    ["ArdiaReport.fileSize", ["/p/a"]],
    ["ArdiaReport.removeFile", ["/p/a"]],
    ["ArdiaReport.gzipFile", ["/p/a", "/p/a.gz", true]],
    ["ArdiaReport.gzipText", ["text", "/p/t.gz"]],
  ]);
  host.invoked.length = 0;
  await assert.rejects(call("startRecording", "main", false, "/p/r.mp4", 60), { code: "ERR_UNAVAILABLE" });
  assert.equal(call("isRecording"), false);
  assert.equal(await call("stopRecording"), false);
  assert.equal(await call("recordingThumbnail", "/p/r.mp4", "/p/r.png"), false);
  assert.deepEqual(host.invoked, []);

  const filesOnly = fakeHost(["report.files"], answers);
  assert.equal(await resolveHostModule(filesOnly, "ArdiaReport", "gzipText")("a", "/p/t.gz"), 9);
  assert.equal((await resolveHostModule(filesOnly, "ArdiaReport", "upload")("id", "u", "PUT", {}, "/x")).status, 0);
  assert.equal(servesReportSheet(filesOnly), false);
  const sendOnly = fakeHost(["report.send"], answers);
  assert.throws(() => resolveHostModule(sendOnly, "ArdiaReport", "draftDirectory")(), { code: "ERR_UNAVAILABLE" });
  assert.equal(servesReportSheet(sendOnly), false);
  assert.equal(servesReportSheet(host), false);
});

test("the local events export is gzipped into one remembered draft folder, and a lost folder is replaced", async () => {
  let made = 0;
  let lost = false;
  const host = fakeHost(BOTH, {
    "ArdiaReport.draftDirectory": () => `/p/Report Drafts/u${++made}`,
    "ArdiaReport.gzipText": (text, path) => {
      if (lost && path.startsWith("/p/Report Drafts/u1/")) throw Object.assign(new Error("outside"), { code: "ERR_REPORT" });
      return text.length;
    },
  });
  const storage = memory();
  const write = hostReportExport(host, storage);
  assert.deepEqual(await write("abc"), { path: `/p/Report Drafts/u1/${LOCAL_EVENTS_FILE}`, bytes: 3 });
  assert.equal(storage.items.get(REPORT_EXPORT_FOLDER_KEY), "/p/Report Drafts/u1");
  assert.deepEqual(await hostReportExport(host, storage)("abcd"), { path: `/p/Report Drafts/u1/${LOCAL_EVENTS_FILE}`, bytes: 4 });
  assert.equal(made, 1, "the next export, in any window, overwrites the same file as on the Mac");
  lost = true;
  assert.deepEqual(await write("ab"), { path: `/p/Report Drafts/u2/${LOCAL_EVENTS_FILE}`, bytes: 2 });
  assert.equal(storage.items.get(REPORT_EXPORT_FOLDER_KEY), "/p/Report Drafts/u2");
  const refusing = hostReportExport(fakeHost(BOTH, { "ArdiaReport.draftDirectory": () => { throw new Error("no folder"); } }), memory());
  await assert.rejects(refusing("a"));
});

test("ArdiaTelemetryLocal.exportForReport answers the Mac's path, bytes and lines from the local copy", async () => {
  const NOW = Date.parse("2026-11-14T12:00:00.000Z");
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const line = (at, n) => `${JSON.stringify({ at, n })}\n`;
  const rows = [{ key: 1, day: day(NOW - 86_400_000 * 9), text: line(NOW - 86_400_000 * 9, "old") }, { key: 2, day: day(NOW), text: line(NOW - 10, "a") + line(NOW - 5, "b") }];
  const chunks = { add: async () => {}, all: async () => rows, change: async (plan) => plan(rows).result, clear: async () => {} };
  const written = [];
  const served = createTelemetryLocal({ chunks, writes: true, save: async () => null, reportFile: async (text) => (written.push(text), { path: "/p/d/local-events.jsonl.gz", bytes: 42 }), clock: () => 0, now: () => NOW });
  assert.deepEqual(await served.exportForReport(NOW - 86_400_000 * 7), { path: "/p/d/local-events.jsonl.gz", bytes: 42, lines: 2 });
  assert.deepEqual(written, [line(NOW - 10, "a") + line(NOW - 5, "b")]);
  const failing = createTelemetryLocal({ chunks, writes: true, save: async () => null, reportFile: async () => null, clock: () => 0, now: () => NOW });
  assert.equal(await failing.exportForReport(NOW), null);
  const unserved = createTelemetryLocal({ chunks, writes: true, save: async () => null, clock: () => 0, now: () => NOW });
  assert.equal(await unserved.exportForReport(NOW), null, "an engine without report.files keeps answering null");
});

test("the shared report code works with a module that answers promises where the Mac answers at once", async () => {
  const original = { ...reportModule };
  const failures = [];
  const unhandled = (reason) => failures.push(reason);
  process.on("unhandledRejection", unhandled);
  try {
    assert.equal(fileSize("/tmp/known"), -1, "the Mac's synchronous size still comes straight back");
    reportFake.sizes.set("/tmp/known", 33);
    assert.equal(fileSize("/tmp/known"), 33);
    let removed = 0;
    Object.assign(reportModule, {
      draftDirectory: () => new Promise((resolve) => setTimeout(() => resolve("/p/Report Drafts/async"), 5)),
      fileSize: async () => 99,
      removeFile: async () => { removed++; throw new Error("refused"); },
      cancelUploads: async () => { throw new Error("refused"); },
    });
    assert.equal(fileSize("/tmp/known"), -1, "a size that isn't known at once leaves the recorded size standing");
    assert.equal(removeReportFile("/p/x"), undefined);
    assert.equal(cancelUploads(), undefined);
    useReportSheet.setState(useReportSheet.getInitialState(), true);
    useReportSheet.setState({ local: { path: "/p/x/local-events.jsonl.gz", bytes: 64, lines: 3 } });
    assert.deepEqual(reportFiles().map((file) => [file.name, file.bytes]), [["local-events.jsonl.gz", 64]]);
    const first = ensureDraftDir();
    const second = ensureDraftDir();
    assert.equal(typeof first.then, "function");
    assert.equal(second, first, "two callers share one folder");
    assert.equal(await first, "/p/Report Drafts/async");
    assert.equal(useReportSheet.getState().draftDir, "/p/Report Drafts/async");
    assert.equal(ensureDraftDir(), "/p/Report Drafts/async");
    resetReport();
    await tick();
    assert.equal(removed, 3);
    assert.deepEqual(failures, []);
  } finally {
    process.off("unhandledRejection", unhandled);
    Object.assign(reportModule, original);
    reportFake.sizes.clear();
    useReportSheet.setState(useReportSheet.getInitialState(), true);
  }
});

test("with both capabilities but no feedback server Report a Problem opens the issue page, never the sheet, and posts nothing", async () => {
  mainWindow();
  const host = fakeHost(BOTH, { "ArdiaReport.post": () => ({ status: 201, body: "{}", error: null }) });
  adoptHostReports(host);
  try {
    assert.equal(sendsFromSheet(host), false);
    await openReport("main", "menu", host);
    assert.equal(useReportSheet.getState().windowId, null);
    const opened = Object.values(S().tabs).map((tab) => tab.url ?? tab.navigation?.url ?? "").filter((url) => url.startsWith("https://github.com/NoorChasib/nilla/issues/new?body="));
    assert.equal(opened.length, 1);
    assert.deepEqual([...new URL(opened[0]).searchParams.keys()], ["body"]);
    await sendCurrentReport();
    assert.deepEqual(host.invoked.filter(([method]) => method === "ArdiaReport.post"), []);
  } finally {
    resetReport();
    adoptHostReports(undefined);
  }
});

test("with the Layer 1 gate there is no engine post, even when the engine advertises one", async () => {
  mainWindow();
  const host = fakeHost(BOTH, { "ArdiaReport.post": { status: 201, body: "{}", error: null } });
  assert.equal(hostReportPost(host), undefined);
  await assert.rejects(resolveHostModule(host, "ArdiaReport", "post")(FEEDBACK_URL, "{}", {}).then((reply) => (reply?.status ? reply : Promise.reject(new Error("refused")))));
  assert.deepEqual(host.invoked.filter(([method]) => method === "ArdiaReport.post"), []);
});
