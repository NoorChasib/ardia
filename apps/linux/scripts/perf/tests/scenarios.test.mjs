import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tabSet } from "../lib/fixtures.mjs";
import { Launch, pageRates, switchLatency } from "../lib/runner.mjs";
import { flattenScenario } from "../lib/report.mjs";
import { pause } from "../lib/util.mjs";

const MEASURE = {
  instrument: "full",
  tabs: 10,
  settings: {},
  readSettleMs: 0,
  quietGatePct: 0,
  quietWaitS: 1,
  maxForeignPct: 150,
  contentionRepeats: 1,
  scenarioDeadlineMs: 20000,
  idleSeconds: 0.01,
  idleDiscardSeconds: 0.01,
  activeSeconds: 0.01,
  splitTicker: true,
  switches: 6,
  switchIntervalMs: 40,
  switchKey: "ctrl+Tab",
  switchVia: "key",
  edgeRepeats: 4,
  hoverRows: 3,
  hoverPasses: 2,
  hoverDwellMs: 1,
  hoverFirstDwellMs: 1,
  loadingSeconds: 0.01,
  loadingWarmupMs: 1,
  slowMs: 600000,
};

const quoted = (expression, pattern) => {
  const match = expression.match(pattern);
  return match ? new Function(`return (${match[1]});`)() : undefined;
};

function fakeLaunch(overrides = {}) {
  const tabs = tabSet(MEASURE.tabs).map((t) => ({ ...t, id: `tab-${t.index + 1}`, url: `http://fixture${t.path}` }));
  const launch = new Launch({
    runId: "R1",
    launchId: "R1-001-fake-a1",
    build: { label: "fake", dir: "/ui", commit: "c0ffee", info: null },
    fingerprint: { ui: "u", engine: "e", blocker: "b" },
    configFingerprint: "cfg",
    launchIndex: 1,
    blockIndex: 1,
    runIndex: 1,
    attempt: 1,
    ...MEASURE,
    ...overrides,
  });
  const world = {
    active: tabs[0].id,
    settings: { autoHideTabs: false, showTabHoverMenu: false, sidebarRevealSpeed: "default", addressBar: "toolbar" },
    stuckSettings: false,
    rowLeft: -1200,
    revealOnEdge: true,
    pointerX: 0,
    loading: false,
    pending: false,
    sidebarHidden: false,
    pillBroken: false,
    layoutReads: 0,
    loadingStopsAtRead: null,
    foreign: [],
    commands: [],
    activations: [],
    shown: new Map(),
    keys: [],
    moves: [],
    frames: null,
    wrongOnPress: new Set(),
    presses: 0,
    stopFrames: () => ({ frames: 30, gapsOver25: 2, maxGapMs: 41.26, gaps: { "25-33": 1, "33-50": 1 } }),
  };
  const activate = (id, at = Date.now()) => {
    if (world.active === id) return;
    world.active = id;
    world.activations.push([at + 2, id]);
    const url = tabs.find((t) => t.id === id).url;
    world.shown.set(url, [...(world.shown.get(url) ?? []), [at + 3, at + 9]]);
  };
  launch.tabInfo = tabs;
  launch.app = { exited: false };
  launch.shell = { send: async (method) => (method === "Performance.getMetrics" ? { metrics: [{ name: "TaskDuration", value: world.presses / 100 }, { name: "Nodes", value: 2594 }] } : {}) };
  let marks = 0;
  launch.sampler = {
    mark: async () => marks++,
    window: async () => ({ byKind: { total: { cpuPct: 12.5, ctxPerS: 300, procs: 9 }, shell: { cpuPct: 4, ctxPerS: 40, procs: 1 } }, shellThreads: { main: 3 }, aux: { xvfb: 1 }, contention: { foreignPct: world.foreign.length ? world.foreign.shift() : 0 }, sampling: { readErrors: 0 }, samples: 3 }),
  };
  launch.sleep = async (ms) => {
    launch.check();
    await pause(Math.min(ms, 40));
  };
  launch.xdotool = async (args) => {
    world.keys.push(args.join(" "));
    if (args[0] === "mousemove") {
      world.moves.push([Number(args[2]), Number(args[3])]);
      world.pointerX = Number(args[2]);
    }
    if (args[0] === "key" && args.at(-1) === "ctrl+Tab") {
      const at = Date.now();
      world.presses++;
      world.commands.push(at + 1);
      if (world.wrongOnPress.has(world.presses)) return;
      activate(world.active === tabs[0].id ? tabs[1].id : tabs[0].id, at);
    }
  };
  launch.state = async (body) => {
    const target = quoted(body, /s\.activate\(("[^"]+")\)/);
    if (target) activate(target);
    const navigation = body.match(/s\.navigate\(("[^"]+"), ("[^"]+")\)/);
    if (navigation) world.loading = world.pending = JSON.parse(navigation[2]).includes("/slow/");
    if (body.includes("s.toggleSidebar(")) world.sidebarHidden = !world.sidebarHidden;
    const patch = quoted(body, /s\.updateSettings\((\{.*?\})\)/);
    if (patch && !(world.stuckSettings && world.settingsApplied)) {
      Object.assign(world.settings, patch);
      world.settingsApplied = true;
      if ("autoHideTabs" in patch) world.rowLeft = patch.autoHideTabs ? world.rowLeft : 0;
    }
    const keys = quoted(body, /Object\.fromEntries\((\[.*?\])\.map/);
    if (keys) return Object.fromEntries(keys.map((k) => [k, world.settings[k] ?? null]));
    if (body.includes("createSplit")) return "split-1";
    return true;
  };
  launch.shellEval = async (expression) => {
    launch.check();
    if (expression.startsWith("__benchProbe.reset")) return true;
    if (expression.startsWith("__benchProbe.snapshot")) return { mode: launch.instrument, counts: { rafCallbacks: world.presses * 10, getAnimations: 0 }, chromeSend: { "invoke:tab.command:capturePicture": world.presses }, hostEvents: {}, loaf: { count: 0, blockingMs: 0, durationMs: 0, maxMs: 0 }, events: {}, commands: world.commands, activations: world.activations, keys: [] };
    if (expression.startsWith("__benchProbe.startFrames")) return { rowsFound: launch.hoverRows };
    if (expression.startsWith("__benchProbe.stopFrames")) return world.stopFrames();
    if (expression.startsWith("__benchProbe.rowLeft")) return world.settings.autoHideTabs && world.revealOnEdge && world.pointerX <= 2 ? 0 : world.rowLeft;
    if (expression.startsWith("__benchProbe.findRow")) {
      const index = tabs.findIndex((t) => t.title === quoted(expression, /findRow\(("[^"]+")\)/));
      return { clientLeft: 8, clientRight: 248, clientTop: 100 + index * 40, clientBottom: 136 + index * 40, hittable: true };
    }
    if (expression.includes("lastActive")) return { active: world.active, open: false };
    throw new Error(`unexpected shell expression ${expression.slice(0, 80)}`);
  };
  launch.readPages = async () => {
    launch.lastReadAt = Date.now();
    const pages = tabs.map((t) => ({
      url: t.url,
      kind: t.kind,
      visibility: t.id === world.active || (t.kind === "ticker" && t.index === 2) ? "visible" : "hidden",
      shown: world.shown.get(t.url) ?? [],
      vis: [[0, "hidden"]],
      window: { visibleMs: t.id === world.active ? 1000 : 0, hiddenMs: t.id === world.active ? 0 : 1000, rafVisible: 0, rafHidden: t.kind === "raf" ? 2 : 0, ticksVisible: 0, ticksHidden: t.kind === "ticker" ? 1 : 0, transitions: 0 },
    }));
    return { pages, targets: pages.length, failed: 0 };
  };
  launch.fixtures = { base: "http://fixture" };
  launch.pendingSlow = async () => world.pending;
  launch.layoutState = async () => {
    world.layoutReads++;
    if (world.layoutReads === world.loadingStopsAtRead) world.loading = world.pending = false;
    const addressBar = world.settings.addressBar;
    return { active: world.active, loading: world.loading, pill: { present: true, visible: !world.pillBroken && world.loading && addressBar === "sidebar" && world.sidebarHidden }, addressBar, rowLeft: world.sidebarHidden ? -1200 : 0 };
  };
  return { launch, world, tabs };
}

describe("scenarios in memory", () => {
  it("S1 keeps the untimed idle window apart and reports hidden-page rates", async () => {
    const { launch } = fakeLaunch();
    await launch.scenario("S1");
    const { scenarios, discarded, windows } = launch.result;
    assert.ok(discarded.S1, "the first idle window is kept under discarded");
    assert.equal(discarded.S1.pages, null);
    assert.equal(scenarios.S1.valid, true);
    assert.equal(scenarios.S1.cpu.total.cpuPct, 12.5);
    assert.equal(scenarios.S1.levels.Nodes, 2594);
    assert.deepEqual(scenarios.S1.pages.coverage, { expected: 10, targets: 10, read: 10, failed: 0 });
    assert.equal(scenarios.S1.pages.byKind.raf.rafPerHiddenS, 2);
    assert.equal(scenarios.S1.pages.byKind.ticker.ticksPerHiddenS, 1);
    assert.deepEqual(windows.map((w) => [w.name, w.discard]), [["S1", true], ["S1", false]]);
  });

  it("repeats a contended window once, then marks it not comparable", async () => {
    const once = fakeLaunch({ idleDiscardSeconds: 0 });
    once.world.foreign.push(400, 10);
    await once.launch.scenario("S1");
    assert.equal(once.launch.result.scenarios.S1.valid, true);
    assert.equal(once.launch.result.discarded["S1 contended 1"].contended, true);
    const twice = fakeLaunch({ idleDiscardSeconds: 0 });
    twice.world.foreign.push(400, 500);
    await twice.launch.scenario("S1");
    assert.equal(twice.launch.result.scenarios.S1.valid, false);
    assert.match(twice.launch.result.scenarios.S1.invalidReason, /contended: 500 % foreign CPU/);
  });

  it("S2 splits the rAF and ticker tabs into the foreground and separates them after", async () => {
    const { launch, world, tabs } = fakeLaunch();
    await launch.scenario("S2");
    const s2 = launch.result.scenarios.S2;
    assert.equal(s2.valid, true, s2.invalidReason);
    assert.deepEqual(s2.foreground, { split: true, visibility: { raf: "visible", ticker: "visible" } });
    assert.equal(world.active, tabs[0].id);
  });

  it("S3 times each ctrl+Tab from the shell's command to the page's frame and puts a stray press back", async () => {
    const { launch, world, tabs } = fakeLaunch();
    world.wrongOnPress.add(3);
    await launch.scenario("S3");
    const s3 = launch.result.scenarios.S3;
    assert.equal(s3.valid, true);
    assert.equal(world.keys.filter((k) => k.endsWith("ctrl+Tab")).length, 6);
    assert.equal(s3.switches.presses, 6);
    assert.equal(s3.switches.recovered, 1);
    assert.equal(s3.switches.shown, 5);
    assert.equal(s3.switches.misses, 1);
    assert.equal(s3.switches.keyToStore.median, 1);
    assert.equal(s3.switches.keyToShown.median, 8);
    assert.equal(s3.switches.raw[2].outcome, "recovered:wrong-tab");
    assert.deepEqual(s3.workload, { expected: 6, presses: 6, recoveries: 1, matched: false });
    const rows = flattenScenario(s3);
    assert.ok(rows.some(([metric]) => metric === "switch recovered"), "latency rows stay");
    assert.ok(rows.some(([metric, kind]) => metric === "workload recoveries" && kind === "workload"));
    assert.ok(!rows.some(([metric]) => metric === "CPU %"), "a window with a put-back press did extra work, so its CPU rows go");
    assert.deepEqual(s3.frames, { frames: 30, gapsOver25: 2, maxGapMs: 41.3, gaps: { "25-33": 1, "33-50": 1 } });
    assert.equal(world.active, tabs[0].id);
  });

  it("S4 is comparable only when the sidebar was hidden, and counts unarmed pointer arrivals as misses", async () => {
    const hidden = fakeLaunch();
    hidden.world.stopFrames = () => ({ frames: 50, gapsOver25: 0, maxGapMs: 20, gaps: {}, arms: 3, reveals: [120, 130, 140], misses: 0 });
    await hidden.launch.scenario("S4");
    const s4 = hidden.launch.result.scenarios.S4;
    assert.equal(s4.valid, true);
    assert.deepEqual({ median: s4.reveal.median, arms: s4.reveal.arms, unarmed: s4.reveal.unarmed, misses: s4.reveal.misses }, { median: 130, arms: 3, unarmed: 1, misses: 1 });
    assert.equal(hidden.world.moves.filter(([x]) => x === 0).length, 4);
    assert.equal(hidden.world.settings.autoHideTabs, false);
    assert.deepEqual(s4.workload, { expected: 4, revealed: 4, hidden: 4, matched: true });
    assert.ok(flattenScenario(s4).some(([metric, kind]) => metric === "CPU %" && kind === "total"));
    const shown = fakeLaunch();
    shown.world.rowLeft = 0;
    shown.world.stopFrames = () => ({ frames: 1, gapsOver25: 0, maxGapMs: 0, gaps: {}, arms: 0, reveals: [], misses: 0 });
    await shown.launch.scenario("S4");
    assert.equal(shown.launch.result.scenarios.S4.valid, false);
    assert.match(shown.launch.result.scenarios.S4.invalidReason, /sidebar not hidden/);
  });

  it("S4 keeps only its latency rows when a reveal doesn't happen, so a broken reveal can't look cheaper", async () => {
    const { launch, world } = fakeLaunch({ instrument: "light" });
    world.revealOnEdge = false;
    await launch.scenario("S4");
    const s4 = launch.result.scenarios.S4;
    assert.equal(s4.valid, true);
    assert.deepEqual(s4.workload, { expected: 4, revealed: 0, hidden: 4, matched: false });
    assert.ok(!flattenScenario(s4).some(([metric]) => metric === "CPU %"));
  });

  it("S4 runs with --settings applied (except autoHideTabs, which it sets itself) and puts them back", async () => {
    const { launch, world } = fakeLaunch({ instrument: "light", settings: { sidebarRevealSpeed: "slower", autoHideTabs: true } });
    const seen = [];
    const move = launch.move.bind(launch);
    launch.move = async (x, y) => {
      if (x === 0) seen.push(world.settings.sidebarRevealSpeed);
      return move(x, y);
    };
    await launch.scenario("S4");
    assert.deepEqual(launch.result.settingsApplied, { S4: { sidebarRevealSpeed: "slower" } });
    assert.deepEqual([...new Set(seen)], ["slower"]);
    assert.equal(world.settings.sidebarRevealSpeed, "default");
    assert.equal(world.settings.autoHideTabs, false);
    assert.equal(launch.result.scenarios.S4.workload.matched, true);
  });

  it("S5 sweeps the rows with the settings on and fails the launch when they don't go back", async () => {
    const ok = fakeLaunch({ settings: { showTabHoverMenu: true } });
    ok.world.stopFrames = () => ({ frames: 20, gapsOver25: 0, maxGapMs: 16, gaps: {}, rowEntries: 6, offRow: 0, superseded: 0, misses: 0, hovers: [{ warm: false, ms: 870 }, { warm: true, ms: 40 }, { warm: false, ms: 880 }] });
    await ok.launch.scenario("S5");
    const s5 = ok.launch.result.scenarios.S5;
    assert.equal(s5.valid, true, s5.invalidReason);
    assert.deepEqual(ok.launch.result.settingsApplied, { S5: { showTabHoverMenu: true } });
    assert.equal(s5.hover.cold.median, 875);
    assert.equal(s5.hover.expected, 6);
    assert.equal(ok.world.settings.showTabHoverMenu, false);
    const stuck = fakeLaunch({ settings: { showTabHoverMenu: true } });
    stuck.world.stuckSettings = true;
    stuck.world.stopFrames = ok.world.stopFrames;
    await assert.rejects(stuck.launch.scenario("S5"), /S5 settings were not restored: showTabHoverMenu/);
  });

  it("S6 counts a window that stays loading in the default layout, and restores the page after", async () => {
    const { launch, world } = fakeLaunch();
    await launch.scenario("S6");
    const s6 = launch.result.scenarios.S6;
    assert.equal(s6.valid, true, s6.invalidReason);
    assert.deepEqual([s6.loading.pill, s6.loading.pillShown, s6.loading.start.problems, s6.loading.end.problems], [false, false, [], []]);
    assert.deepEqual([world.loading, world.settings.addressBar, world.sidebarHidden], [false, "toolbar", false]);
  });

  it("S6 marks a window not comparable when the load ends inside it", async () => {
    const { launch, world } = fakeLaunch();
    world.loadingStopsAtRead = 3;
    await launch.scenario("S6");
    const s6 = launch.result.scenarios.S6;
    assert.equal(s6.valid, false);
    assert.match(s6.invalidReason, /^at the end: the active tab is not loading; its \/slow request is not pending/);
  });

  it("S7 counts a window with the pill shown over the hidden sidebar, and puts the layout back", async () => {
    const { launch, world } = fakeLaunch();
    await launch.scenario("S7");
    const s7 = launch.result.scenarios.S7;
    assert.equal(s7.valid, true, s7.invalidReason);
    assert.deepEqual([s7.loading.pillShown, s7.loading.sidebarHidden], [true, true]);
    assert.deepEqual([world.settings.addressBar, world.sidebarHidden], ["toolbar", false]);
  });

  it("S7 marks a window not comparable when the pill isn't shown", async () => {
    const { launch, world } = fakeLaunch();
    world.pillBroken = true;
    await launch.scenario("S7");
    const s7 = launch.result.scenarios.S7;
    assert.equal(s7.valid, false);
    assert.match(s7.invalidReason, /^at the start: the loading pill is not visible/);
  });

  it("a startup failure whose teardown left chrome running fails the teardown and keeps the scratch profile", async () => {
    const { launch } = fakeLaunch();
    launch.app = undefined;
    launch.sampler = undefined;
    launch.startupTeardown = { clean: false, leftover: [4242] };
    await launch.finish("/nonexistent/scratch/launch");
    assert.equal(launch.result.teardownFailed, true);
    assert.deepEqual(launch.result.teardown, { app: false, leftover: [4242], xvfb: true, fixtures: true, duringStartup: true });
    assert.ok(launch.result.notes.some((n) => n.includes("scratch profile kept at /nonexistent/scratch/launch")));
  });

  it("stops a scenario at its next step once the launch is aborted", async () => {
    const { launch } = fakeLaunch({ idleDiscardSeconds: 0, idleSeconds: 30 });
    launch.sleep = Launch.prototype.sleep;
    setTimeout(() => { launch.abortReason = "SIGTERM"; }, 50);
    await assert.rejects(launch.scenario("S1"), /SIGTERM/);
  });
});

describe("window arithmetic", () => {
  it("divides page counts by the page-seconds spent in each state", () => {
    const rates = pageRates({ targets: 2, failed: 0, pages: [
      { kind: "raf", window: { visibleMs: 2000, hiddenMs: 0, rafVisible: 120, rafHidden: 0, ticksVisible: 0, ticksHidden: 0, transitions: 1 } },
      { kind: "raf", window: { visibleMs: 0, hiddenMs: 400, rafVisible: 0, rafHidden: 3, ticksVisible: 0, ticksHidden: 0, transitions: 0 } },
    ] }, 2);
    assert.equal(rates.byKind.raf.rafPerVisibleS, 60);
    assert.equal(rates.byKind.raf.rafPerHiddenS, null);
  });

  it("uses each page's shown event once and only inside its press", () => {
    const tabInfo = [{ id: "a", index: 0, url: "u/a" }, { id: "b", index: 1, url: "u/b" }];
    const presses = [{ at: 1000, want: "b", recovered: null }, { at: 1500, want: "a", recovered: null }];
    const probe = { commands: [1002, 1503], activations: [[1004, "b"], [1505, "a"]], keys: [] };
    const pages = [{ url: "u/b", shown: [[1006, 1030]], vis: [] }, { url: "u/a", shown: [[900, 950]], vis: [[0, "visible"], [1004, "hidden"]] }];
    const s = switchLatency(presses, probe, pages, tabInfo, true);
    assert.deepEqual([s.shown, s.notShown, s.alreadyVisible], [1, 1, 0]);
    assert.equal(s.keyToShown.median, 28);
    assert.equal(s.spawnToCommand.median, 2.5);
  });
});
