import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 503 });

const client = await import("./client.ts");
const diagnostics = await import("./diagnostics.ts");
const { reportNativeCrashes } = await import("./errors.ts");
const { reportLocalStore } = await import("./localStoreReport.ts");
const { viewMyData } = await import("./privacy.ts");
const { launchEvents } = await import("./launchEvents.ts");
const presses = await import("./tabPresses.ts");
const { passwordImportTally } = await import("./passwordSaves.ts");
const topApps = await import("./topAppsSharing.ts");
const defaultBrowser = await import("./defaultBrowserCounts.ts");
const { takeStuckDragCounts } = await import("./stuckDrags.ts");
const { takeCliCounts } = await import("./cliCounts.ts");
const app = stub.shellNativeModules.NillaApp;
const localModule = stub.telemetryLocalModule;
after(() => {
  delete globalThis.acTestSystemState;
  delete globalThis.acTestCliControl;
  client.setSharing(false, "settings");
});

const PRESSURE = { onBattery: false, batteryLevel: null, lowPowerMode: false, memoryPressure: "critical", physicalMemory: 1 };
const turns = async () => {
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
};

function held() {
  let release;
  const promise = new Promise((resolve) => (release = resolve));
  return { promise, release };
}

async function queued(event) {
  await client.saveQueueNow();
  return JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}').events.filter((e) => e.event === event).map((e) => e.properties);
}

async function kept(event) {
  await client.saveQueueNow();
  return stub.telemetryLocal.records().filter((r) => r.event === event);
}

function start(on) {
  client.loadChoice();
  client.setSharing(false, "settings");
  if (on) client.setSharing(true, "settings");
  stub.telemetryLocal.reset();
}

async function pageProcessGoneAcross(crossing) {
  const pressure = held();
  globalThis.acTestSystemState = () => pressure.promise;
  diagnostics.trackPageProcessGone({ reason: "oom", code: 9 }, true);
  delete globalThis.acTestSystemState;
  crossing();
  pressure.release(PRESSURE);
  await turns();
}

test("a renderer failure seen while sharing was off isn't uploaded when sharing turns on before its memory pressure arrives, and keeps its unsent local row", async () => {
  start(false);
  await pageProcessGoneAcross(() => client.setSharing(true, "settings"));
  assert.deepEqual(await queued("page_process_gone"), []);
  assert.deepEqual((await kept("page_process_gone")).map((r) => [r.sent, r.properties.reason, r.properties.memory_pressure]), [[false, "oom", "critical"]]);
});

test("a renderer failure seen before sharing went off and on again isn't uploaded under the new choice", async () => {
  start(true);
  await pageProcessGoneAcross(() => {
    client.setSharing(false, "settings");
    client.setSharing(true, "settings");
  });
  assert.deepEqual(await queued("page_process_gone"), []);
  assert.deepEqual((await kept("page_process_gone")).map((r) => r.sent), [false]);
});

test("a renderer failure seen while sharing stays on is still uploaded with its memory pressure", async () => {
  start(true);
  await pageProcessGoneAcross(() => {});
  assert.deepEqual((await queued("page_process_gone")).map((p) => p.memory_pressure), ["critical"]);
});

test("a native crash read before sharing went off and on again isn't uploaded under the new choice", async () => {
  start(true);
  const crashed = Date.now() - 1;
  const reports = held();
  const crashReports = app.crashReports;
  app.crashReports = () => reports.promise;
  try {
    const reading = reportNativeCrashes();
    client.setSharing(false, "settings");
    client.setSharing(true, "settings");
    reports.release([{ time: crashed, process: "browser", appVersion: "1.0.0", build: "1", exceptionType: "EXC_BAD_ACCESS", signal: "SIGSEGV", frames: [] }]);
    await reading;
  } finally {
    app.crashReports = crashReports;
  }
  assert.deepEqual(await queued("$exception"), []);
  assert.deepEqual((await kept("$exception")).map((r) => r.sent), [false]);
});

test("the local store reading, the local copy export and the launch events taken while sharing was off aren't uploaded after it turns on mid-read", async () => {
  start(false);
  const prune = held();
  const exported = held();
  const hardware = held();
  const originals = { prune: localModule.prune, exportToDownloads: localModule.exportToDownloads, hardwareInfo: app.hardwareInfo };
  localModule.prune = () => prune.promise;
  localModule.exportToDownloads = () => exported.promise;
  app.hardwareInfo = () => hardware.promise;
  try {
    const reading = reportLocalStore();
    const viewing = viewMyData();
    const launching = launchEvents({ previous: "clean", updatedFrom: "0.9.0", lastLaunchAt: null, lastQuitAt: null, firstOfVersion: true, context: null });
    client.setSharing(true, "settings");
    prune.release({ bytes: 10, lines: 1, files: 1, droppedLines: 0, pruneMs: 1, writeMs: [1] });
    exported.release(null);
    hardware.release(stub.diagnostics.hardware);
    await Promise.all([reading, viewing, launching]);
  } finally {
    Object.assign(localModule, { prune: originals.prune, exportToDownloads: originals.exportToDownloads });
    app.hardwareInfo = originals.hardwareInfo;
  }
  for (const event of ["telemetry_local_store", "local_copy_exported", "app_launched", "app_updated", "top_apps_sharing"]) {
    assert.deepEqual(await queued(event), [], event);
    assert.deepEqual((await kept(event)).map((r) => r.sent), [false], event);
  }
});

test("a repeated row press whose answer arrives after sharing went off and on again isn't counted under the new choice", async () => {
  start(true);
  const focus = stub.shellNativeModules.NillaFocus;
  const answer = held();
  const pressRepeated = focus.pressRepeated;
  focus.pressRepeated = () => answer.promise;
  try {
    const noting = presses.noteRowPress(true);
    client.setSharing(false, "settings");
    client.setSharing(true, "settings");
    answer.release({ landedOn: "RCTView<Surface", ms: 600 });
    await noting;
  } finally {
    focus.pressRepeated = pressRepeated;
  }
  presses.notePressStarted();
  presses.notePressEnded("click");
  presses.emitTabPresses();
  assert.deepEqual((await queued("tab_presses")).map((p) => [p.presses, p.repeat_presses]), [[1, 0]]);
});

test("a password import that started while sharing was off isn't uploaded when sharing turns on before it finishes", async () => {
  start(false);
  const saving = held();
  const tally = passwordImportTally("csv");
  const attempt = tally.attempt(saving.promise);
  client.setSharing(true, "settings");
  saving.release(true);
  await attempt;
  tally.done();
  assert.deepEqual(await queued("password_import"), []);
  assert.deepEqual((await kept("password_import")).map((r) => [r.sent, r.properties.tried, r.properties.saved]), [[false, 1, 1]]);
});

test("a Top Apps sharing event held while sharing was off isn't uploaded when it's released after sharing turns on", async () => {
  start(false);
  topApps.noteTopAppsSharing("top_apps_sharing_synced", { path: "synced_record", on: true, profile_count: 1, sharing_profiles: 1 });
  client.setSharing(true, "settings");
  topApps.releaseTopAppsSharing();
  assert.deepEqual(await queued("top_apps_sharing_synced"), []);
  assert.deepEqual((await kept("top_apps_sharing_synced")).map((r) => r.sent), [false]);
});

test("a default browser answer that arrives after sharing went off and on again isn't counted under the new choice", async () => {
  start(true);
  const answer = held();
  defaultBrowser.checkDefaultBrowserAtLaunch(() => answer.promise);
  client.setSharing(false, "settings");
  client.setSharing(true, "settings");
  answer.release(true);
  await turns();
  assert.equal(defaultBrowser.takeDefaultBrowserCounts().launches_as_default_browser, 0);
});

test("stuck drag and windowless page totals read before sharing went off and on again aren't counted under the new choice, but later growth is", async () => {
  start(true);
  takeStuckDragCounts();
  takeCliCounts();
  const status = (ownerGone, given) => ({ state: "on", connections: 0, generation: 1, file: "", dragsEnded: { ownerGone, debuggerUnowned: 0, nativeRefused: 0 }, windowlessPages: { given, missed: 0 } });
  const reply = held();
  globalThis.acTestCliControl = () => reply.promise;
  await diagnostics.recordContext();
  client.setSharing(false, "settings");
  client.setSharing(true, "settings");
  reply.release(status(2, 3));
  await turns();
  assert.equal(takeStuckDragCounts().stuck_drags_ended_owner_gone, 0);
  assert.equal(takeCliCounts().windowless_pages_given_geometry, 0);
  globalThis.acTestCliControl = () => Promise.resolve(status(3, 5));
  await diagnostics.recordContext();
  await turns();
  delete globalThis.acTestCliControl;
  assert.equal(takeStuckDragCounts().stuck_drags_ended_owner_gone, 1);
  assert.equal(takeCliCounts().windowless_pages_given_geometry, 2);
});
