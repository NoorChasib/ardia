import assert from "node:assert/strict";
import { mock } from "bun:test";
import { test } from "node:test";

const linux = import.meta.dir;
const browser = `${linux}/../../browser/src`;
const telemetry = `${browser}/state/telemetry`;
const runAs = process.env.ARDIA_CONSENT_TEST_WINDOW;
const COUNT_KEYS = ["find_opens", "imported_pinned_rows", "imported_splits"];
const turn = () => new Promise(setImmediate);
const GONE = "page_process_gone";

async function runWindow() {
  const { docs, telemetryLocal } = await import(`${browser}/test-native/index.ts`);
  let refreshId = 0;
  const refreshes = new Map();
  mock.module(`${linux}/shims/shellBase.tsx`, () => ({
    refreshDocument: async (name) => {
      if (runAs === "leader" || name !== "telemetry.json") return false;
      const contents = await new Promise((resolve) => {
        const id = ++refreshId;
        refreshes.set(id, resolve);
        process.send({ kind: "document", id });
      });
      if (contents === null) docs.delete(name);
      else docs.set(name, contents);
      return contents !== null;
    },
  }));
  globalThis.addEventListener ??= () => {};
  globalThis.fetch = async () => {
    throw new Error("No network in this fixture");
  };
  const client = await import(`${telemetry}/client.ts`);
  const choice = await import(`${telemetry}/choice.ts`);
  const { noteFind } = await import(`${telemetry}/findCounts.ts`);
  const { noteImportedPins } = await import(`${telemetry}/usage.ts`);
  const { trackPageProcessGone } = await import(`${telemetry}/diagnostics.ts`);
  const { handleTelemetryOp, saveHostLocalCopy, startHostTelemetry, settleHostTelemetry } = await import(`${linux}/hostTelemetry.ts`);
  const channel = { postMessage: (data) => process.send({ kind: "wire", data }), onmessage: null };
  let localCopiesSaved = 0;
  let localStalled = false;
  const localSettled = async () => {
    if (localStalled) return new Promise(() => {});
    await Bun.sleep(30);
    localCopiesSaved++;
  };
  let releasePressure = null;
  const role = startHostTelemetry({ host: { bootstrap: { capabilities: [] } }, candidate: runAs === "leader", channel, localSettled });
  const counted = (properties) => Object.fromEntries(COUNT_KEYS.filter((key) => properties[key]).map((key) => [key, properties[key]]));
  const actions = {
    choice: (on) => {
      client.setSharing(on, "settings");
      return docs.get("telemetry.json");
    },
    flags: () => [choice.isSharing(), choice.useTelemetry.getState().sharing],
    find: () => noteFind("opened"),
    pins: () => noteImportedPins({ rows: 3, splits: 1 }),
    log: () => client.queueLog("warn", "consent-fixture", {}),
    gone: () => {
      globalThis.acTestSystemState = () => new Promise((resolve) => (releasePressure = resolve));
      trackPageProcessGone({ reason: "oom", code: 9 }, true);
    },
    pressure: async () => {
      delete globalThis.acTestSystemState;
      releasePressure({ onBattery: false, batteryLevel: null, lowPowerMode: false, memoryPressure: "critical", physicalMemory: 1 });
      for (let i = 0; i < 10; i++) await turn();
    },
    close: async (endsSession) => {
      const before = localCopiesSaved;
      const started = Date.now();
      await settleHostTelemetry(endsSession === true);
      return { localCopySaved: localCopiesSaved > before, ms: Date.now() - started };
    },
    stallLocal: () => void (localStalled = true),
    saveLocal: async () => {
      const before = localCopiesSaved;
      await saveHostLocalCopy();
      return { localCopySaved: localCopiesSaved > before };
    },
    reset: async () => {
      await handleTelemetryOp("reset");
      return docs.get("telemetry.json");
    },
    queue: async () => {
      await client.saveQueueNow();
      const queue = JSON.parse(docs.get("telemetry-queue.json") ?? '{"events":[],"logs":[]}');
      return { counts: queue.events.filter((item) => item.event === "usage_counts").map(({ properties }) => counted(properties)), logs: queue.logs.length };
    },
    queued: async (event) => {
      await client.saveQueueNow();
      return JSON.parse(docs.get("telemetry-queue.json") ?? '{"events":[]}').events.filter((item) => item.event === event).map(({ properties }) => properties.memory_pressure);
    },
    local: () => telemetryLocal.records().filter((item) => item.event === "usage_counts" || item.kind === "log").map((item) => ({ kind: item.kind, sent: item.sent, ...(item.properties ? counted(item.properties) : {}) })),
    localEvent: (event) => telemetryLocal.records().filter((item) => item.event === event).map((item) => ({ sent: item.sent, memory_pressure: item.properties.memory_pressure })),
  };
  await new Promise((resolve, reject) => {
    process.on("message", async (message) => {
      if (message.kind === "wire") return channel.onmessage({ data: message.data });
      if (message.kind === "document") {
        refreshes.get(message.id)(message.data);
        refreshes.delete(message.id);
        return;
      }
      if (message.kind === "stop") return resolve();
      try {
        process.send({ kind: "reply", id: message.id, data: (await actions[message.kind](message.data)) ?? null });
      } catch (error) {
        reject(error);
      }
    });
    void (async () => {
      if (runAs === "leader") for (let i = 0; i < 40 && !role.leading(); i++) await turn();
      assert.equal(role.leading(), runAs === "leader");
      process.send({ kind: "ready" });
    })().catch(reject);
  });
}

async function withWindows(run) {
  let authoritative = null;
  let droppingRequests = false;
  const heldChoices = [];
  let documentReads = 0;
  let nextId = 0;
  const pending = new Map();
  const windows = {};
  const start = (side) =>
    new Promise((ready) => {
      windows[side] = Bun.spawn([process.execPath, "test", "--timeout=20000", "--tsconfig-override=../../scripts/lib/test-tsconfig.json", "--preload", "./scripts/host-test-preload.mjs", import.meta.path], {
        cwd: `${linux}/..`,
        env: { ...process.env, ARDIA_CONSENT_TEST_WINDOW: side },
        stdout: "ignore",
        stderr: "inherit",
        ipc(message) {
          if (message.kind === "ready") ready();
          if (message.kind === "reply") {
            pending.get(message.id)?.(message.data);
            pending.delete(message.id);
          }
          if (message.kind === "document") {
            documentReads++;
            windows[side].send({ kind: "document", id: message.id, data: authoritative });
          }
          if (message.kind === "wire") {
            if (side === "leader" && message.data.kind === "choice") return void heldChoices.push(message);
            if (side === "follower" && droppingRequests && message.data.kind === "request") return;
            windows[side === "leader" ? "follower" : "leader"]?.send(message);
          }
        },
      });
    });
  const call = (side, kind, data) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      windows[side].send({ id, kind, data });
    });
  const setChoice = async (on) => {
    authoritative = await call("leader", "choice", on);
  };
  const resetId = async () => {
    authoritative = await call("leader", "reset");
  };
  const dropRequests = () => void (droppingRequests = true);
  const announce = async (expected = 1) => {
    const before = documentReads;
    const deadline = Date.now() + 3000;
    while (heldChoices.length < expected && Date.now() < deadline) await Bun.sleep(5);
    const announcements = heldChoices.splice(0);
    assert.equal(announcements.length, expected, "the leader announced each choice");
    for (const announcement of announcements) windows.follower.send(announcement);
    while (documentReads < before + announcements.length && Date.now() < deadline) await Bun.sleep(5);
    assert.equal(documentReads, before + announcements.length);
    await call("follower", "flags");
  };
  try {
    await Promise.all([start("leader"), start("follower")]);
    await run({ call, setChoice, announce, resetId, dropRequests });
  } finally {
    for (const window of Object.values(windows)) {
      window.send({ kind: "stop" });
      window.kill();
    }
    await Promise.all(Object.values(windows).map((window) => window.exited));
  }
}

if (runAs) test(`run the ${runAs} window`, runWindow, { timeout: 20000 });
else {
  test("an opted-out follower window's close relays no usage counts or logs to an opted-in leader, and keeps them as unsent local rows", () =>
    withWindows(async ({ call, setChoice }) => {
      await setChoice(true);
      assert.deepEqual(await call("follower", "flags"), [false, false]);
      await call("follower", "pins");
      await call("follower", "find");
      await call("follower", "log");
      assert.equal((await call("follower", "close")).localCopySaved, true);
      assert.deepEqual(await call("leader", "queue"), { counts: [], logs: 0 });
      assert.deepEqual(await call("follower", "local"), [
        { kind: "log", sent: false },
        { kind: "event", sent: false, find_opens: 1, imported_pinned_rows: 3, imported_splits: 1 },
      ]);
    }), { timeout: 20000 });

  test("an opted-in follower window still relays its usage counts and logs", () =>
    withWindows(async ({ call, setChoice, announce }) => {
      await setChoice(true);
      await announce();
      assert.deepEqual(await call("follower", "flags"), [true, true]);
      await call("follower", "pins");
      await call("follower", "find");
      await call("follower", "log");
      await call("follower", "gone");
      await call("follower", "pressure");
      await call("follower", "close");
      assert.deepEqual(await call("leader", "queue"), { counts: [{ find_opens: 1, imported_pinned_rows: 3, imported_splits: 1 }], logs: 1 });
      assert.deepEqual(await call("leader", "queued", GONE), ["critical"]);
    }), { timeout: 20000 });

  test("a renderer failure a follower saw while sharing was off isn't relayed once sharing turns on before its memory pressure arrives, and stays an unsent local row", () =>
    withWindows(async ({ call, setChoice, announce }) => {
      assert.deepEqual(await call("follower", "flags"), [false, false]);
      await call("follower", "gone");
      await setChoice(true);
      await announce();
      assert.deepEqual(await call("follower", "flags"), [true, true]);
      await call("follower", "pressure");
      await call("follower", "close");
      assert.deepEqual(await call("leader", "queued", GONE), []);
      assert.deepEqual(await call("follower", "localEvent", GONE), [{ sent: false, memory_pressure: "critical" }]);
    }), { timeout: 20000 });

  test("a renderer failure a follower saw before sharing went off and on again isn't relayed under the new choice", () =>
    withWindows(async ({ call, setChoice, announce }) => {
      await setChoice(true);
      await announce();
      await call("follower", "gone");
      await setChoice(false);
      await setChoice(true);
      await announce(2);
      assert.deepEqual(await call("follower", "flags"), [true, true]);
      await call("follower", "pressure");
      await call("follower", "close");
      assert.deepEqual(await call("leader", "queued", GONE), []);
      assert.deepEqual(await call("follower", "localEvent", GONE), [{ sent: false, memory_pressure: "critical" }]);
    }), { timeout: 20000 });

  test("a follower that only reads the final choice after an off and on again drops what it counted in between", () =>
    withWindows(async ({ call, setChoice, announce }) => {
      await setChoice(true);
      await announce();
      await setChoice(false);
      await call("follower", "find");
      await setChoice(true);
      await announce(2);
      assert.deepEqual(await call("follower", "flags"), [true, true]);
      await call("follower", "close");
      assert.deepEqual((await call("leader", "queue")).counts, []);
    }), { timeout: 20000 });

  test("the leader refuses what a follower relays from before a consent change it hasn't read yet", () =>
    withWindows(async ({ call, setChoice, announce }) => {
      await setChoice(true);
      await announce();
      await setChoice(false);
      await call("follower", "find");
      await call("follower", "log");
      await setChoice(true);
      assert.deepEqual(await call("follower", "flags"), [true, true]);
      await call("follower", "close");
      assert.deepEqual(await call("leader", "queue"), { counts: [], logs: 0 });
    }), { timeout: 20000 });

  test("a renderer failure a follower saw before the anonymous ID was reset isn't uploaded under the new ID, and stays an unsent local row", () =>
    withWindows(async ({ call, setChoice, announce, resetId }) => {
      await setChoice(true);
      await announce();
      await call("follower", "gone");
      await resetId();
      await call("follower", "pressure");
      await call("follower", "close");
      assert.deepEqual(await call("leader", "queued", GONE), []);
      assert.deepEqual(await call("leader", "localEvent", GONE), [{ sent: false, memory_pressure: "critical" }]);
    }), { timeout: 20000 });

  test("a renderer failure the leader refuses as stale from a follower that hasn't read an off and on again stays an unsent local row", () =>
    withWindows(async ({ call, setChoice, announce }) => {
      await setChoice(true);
      await announce();
      await call("follower", "gone");
      await setChoice(false);
      await setChoice(true);
      assert.deepEqual(await call("follower", "flags"), [true, true]);
      await call("follower", "pressure");
      await call("follower", "close");
      assert.deepEqual(await call("leader", "queued", GONE), []);
      assert.deepEqual(await call("leader", "localEvent", GONE), [{ sent: false, memory_pressure: "critical" }]);
      assert.deepEqual(await call("follower", "localEvent", GONE), []);
    }), { timeout: 20000 });

  test("an opted-out utility window saves its buffered local rows when it closes, without relaying them", () =>
    withWindows(async ({ call, setChoice }) => {
      await setChoice(true);
      await call("follower", "log");
      assert.deepEqual(await call("follower", "saveLocal"), { localCopySaved: true });
      assert.deepEqual(await call("follower", "local"), [{ kind: "log", sent: false }]);
      assert.deepEqual(await call("leader", "queue"), { counts: [], logs: 0 });
    }), { timeout: 20000 });

  test("a close whose session end and local save both stall still finishes within one telemetry deadline", () =>
    withWindows(async ({ call, dropRequests }) => {
      dropRequests();
      await call("follower", "stallLocal");
      const { localCopySaved, ms } = await call("follower", "close", true);
      assert.equal(localCopySaved, false);
      assert.ok(ms >= 1900 && ms < 3000, `close took ${ms} ms`);
    }), { timeout: 20000 });
}
