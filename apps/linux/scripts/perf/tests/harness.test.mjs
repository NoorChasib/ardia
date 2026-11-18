import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fixturePath, startFixtureServer, tabSet } from "../lib/fixtures.mjs";
import { createServer } from "node:net";
import { launchArguments, launchEnvironment, newestEngine, portFree, readBuildInfo } from "../lib/instance.mjs";
import { launchOrder, parse, parseBuilds, parseSettings } from "../lib/options.mjs";
import { classify, parseCpuList } from "../lib/procs.mjs";
import { buildNoise, buildReport, mannWhitney } from "../lib/report.mjs";
import { DEFAULT_OUT, ENGINE_STORE, REPO_ROOT } from "../lib/util.mjs";

let root;
before(async () => { root = await mkdtemp(join(tmpdir(), "ardia-linux-bench-")); });
after(() => rm(root, { recursive: true, force: true }));

describe("options", () => {
  it("parses flags, repeated settings and positional commands", () => {
    const args = parse(["run", "--runs", "4", "--settings", "a=true", "--settings", "b=sidebar", "--no-split", "--instrument", "light"]);
    assert.deepEqual(args._, ["run"]);
    assert.equal(args.runs, "4");
    assert.equal(args["no-split"], true);
    assert.deepEqual(parseSettings(args.settings), { a: true, b: "sidebar" });
    assert.throws(() => parseSettings(["novalue"]), /key=value/);
  });

  it("reads every BUILD_INFO form and refuses bad build lists", async () => {
    const forms = { json: '{"commit":"aaa111"}\n', pairs: "commit=bbb222\nbranch=x\n", bare: "ccc333\n" };
    const dirs = {};
    for (const [name, text] of Object.entries(forms)) {
      dirs[name] = join(root, "builds", name);
      await mkdir(dirs[name], { recursive: true });
      await writeFile(join(dirs[name], "index.html"), "<!doctype html>");
      await writeFile(join(dirs[name], "BUILD_INFO"), text);
    }
    assert.deepEqual(Object.values(dirs).map((d) => readBuildInfo(d).commit), ["aaa111", "bbb222", "ccc333"]);
    const builds = parseBuilds(`stock=${dirs.json},final=${dirs.pairs}`);
    assert.deepEqual(builds.map((b) => [b.label, b.commit]), [["stock", "aaa111"], ["final", "bbb222"]]);
    assert.throws(() => parseBuilds(`a=${dirs.json},a=${dirs.bare}`), /unique/);
    assert.throws(() => parseBuilds(`bad label=${dirs.json}`), /must be/);
    assert.throws(() => parseBuilds(`a=${join(root, "missing")}`), /no index.html/);
    assert.throws(() => parseBuilds(undefined), /required/);
  });

  it("interleaves launches ABBA and numbers runs and blocks", () => {
    const order = launchOrder([{ label: "a" }, { label: "b" }], 4);
    assert.deepEqual(order.map((o) => o.build.label).join(""), "abbaabba");
    assert.deepEqual(order.map((o) => o.block), [1, 1, 2, 2, 3, 3, 4, 4]);
    assert.deepEqual(order.filter((o) => o.build.label === "b").map((o) => o.run), [1, 2, 3, 4]);
    const three = launchOrder([{ label: "s" }, { label: "f" }, { label: "b" }, { label: "o" }], 2);
    assert.equal(three.map((o) => o.build.label).join(""), "sfboobfs");
  });
});

describe("defaults", () => {
  it("resolves the repo, the engine store and the output dir from the checkout", () => {
    assert.ok(existsSync(join(REPO_ROOT, "apps/linux/package.json")));
    assert.equal(ENGINE_STORE, join(REPO_ROOT, "apps/browser/build-ardiacore/prebuilt-linux-x86_64"));
    assert.equal(DEFAULT_OUT, join(REPO_ROOT, "output/linux-bench"));
  });

  it("picks the newest engine dir that holds chrome, nested or not", async () => {
    const store = join(root, "engines");
    const older = join(store, "111111111111");
    const newer = join(store, "222222222222", "ardiacore-linux-x64");
    const empty = join(store, "333333333333");
    for (const dir of [older, newer, empty]) await mkdir(dir, { recursive: true });
    await writeFile(join(older, "chrome"), "");
    await writeFile(join(newer, "chrome"), "");
    await utimes(join(store, "111111111111"), new Date(1000), new Date(1000));
    await utimes(join(store, "222222222222"), new Date(2000), new Date(2000));
    assert.equal(newestEngine(store), newer);
    assert.equal(newestEngine(join(root, "nowhere")), null);
  });
});

describe("launch arguments", () => {
  it("passes the debug port, the UI dir and the content blocker, and isolates the environment", () => {
    const args = launchArguments({ data: "/d", uiDir: "/ui", contentBlocker: "/ubo", extraArgs: ["--x"], debugPort: 9460 });
    assert.ok(args.includes("--remote-debugging-port=9460"));
    assert.ok(args.includes("--ardia-ui-dir=/ui") && args.includes("--ardia-content-blocker-dir=/ubo"));
    assert.equal(args.at(-1), "--x");
    assert.ok(launchArguments({ data: "/d", uiDir: "/ui" }).includes("--remote-debugging-port=0"));
    const saved = process.env.WAYLAND_DISPLAY;
    process.env.WAYLAND_DISPLAY = "wayland-0";
    const env = launchEnvironment({ data: "/d", display: 260 });
    if (saved === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = saved;
    assert.equal(env.DISPLAY, ":260");
    assert.equal(env.HOME, "/d/home");
    assert.equal(env.ARDIA_BACKGROUND, "1");
    assert.equal(env.WAYLAND_DISPLAY, undefined);
  });

  it("refuses a debug port something already listens on", async () => {
    const taken = createServer();
    await new Promise((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address();
    assert.equal(await portFree(port), false);
    await new Promise((resolve) => taken.close(resolve));
    assert.equal(await portFree(port), true);
  });

  it("classifies processes by command line", () => {
    const shellPids = new Set([30]);
    const kind = (cmdline, pid = 99) => classify(cmdline, { pid, rootPid: 10, shellPids });
    assert.equal(kind(["/e/chrome"], 10), "browser");
    assert.equal(kind(["/e/chrome", "--type=renderer"], 30), "shell");
    assert.equal(kind(["/e/chrome", "--type=renderer"]), "page");
    assert.equal(kind(["/e/chrome", "--type=renderer", "--extension-process"]), "extension");
    assert.equal(kind(["/e/chrome", "--type=gpu-process"]), "gpu");
    assert.equal(kind(["/e/chrome", "--type=utility", "--utility-sub-type=network.mojom.NetworkService"]), "utility:network");
    assert.equal(kind(["/e/chrome_crashpad_handler"]), "crashpad");
    assert.deepEqual(parseCpuList("0-2,8"), [0, 1, 2, 8]);
  });
});

describe("fixture server", () => {
  let server;
  let base;
  before(async () => {
    server = await startFixtureServer();
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }));

  it("chooses the same tab set for every N", () => {
    const ten = tabSet(10);
    const count = (kind) => ten.filter((t) => t.kind === kind).length;
    assert.deepEqual([count("static"), count("ticker"), count("raf"), count("heavy")], [6, 2, 1, 1]);
    assert.equal(ten[0].kind, "static");
    assert.deepEqual(tabSet(100).slice(0, 10), ten);
    assert.equal(fixturePath(4), "/raf/5");
    assert.equal(ten[0].title, "Static 1 · Harbor");
  });

  it("serves every page kind with its probe and a 404 for anything else", async () => {
    const page = await fetch(`${base}/p/1`).then((r) => r.text());
    assert.match(page, /<title>Static 1 · Harbor<\/title>/);
    assert.match(page, /window\.__bench/);
    assert.match(await fetch(`${base}/t/3`).then((r) => r.text()), /setInterval/);
    assert.match(await fetch(`${base}/raf/5`).then((r) => r.text()), /requestAnimationFrame\(frame\)/);
    assert.equal((await fetch(`${base}/heavy/10`).then((r) => r.text())).match(/<tr>/g).length, 1000);
    assert.equal((await fetch(`${base}/favicon/1`)).headers.get("content-type"), "image/svg+xml");
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });

  it("tracks slow requests until they answer or are dropped", async () => {
    const pending = () => fetch(`${base}/pending`).then((r) => r.json()).then((j) => j.slow);
    assert.match(await fetch(`${base}/slow/5?bench=quick`).then((r) => r.text()), /Slow 5 ms/);
    assert.deepEqual(await pending(), {});
    const controller = new AbortController();
    const slow = fetch(`${base}/slow/600000?bench=held`, { signal: controller.signal }).catch((e) => e.name);
    let seen = {};
    for (let i = 0; i < 50 && !seen.held; i++) {
      await new Promise((r) => setTimeout(r, 20));
      seen = await pending();
    }
    assert.deepEqual(seen, { held: 1 });
    controller.abort();
    assert.equal(await slow, "AbortError");
    for (let i = 0; i < 50 && (await pending()).held; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await pending(), {});
  });
});

const record = ({ cpu, capture, foreign = 0 }) => ({
  valid: true,
  window: { seconds: 60 },
  contention: { foreignPct: foreign },
  cpu: { total: { cpuPct: cpu, ctxPerS: 100, procs: 8 }, shell: { cpuPct: cpu / 2, ctxPerS: 10, procs: 1 } },
  counts: { rafCallbacks: 5 },
  chromeSend: capture === undefined ? {} : { "invoke:tab.command:capturePicture": capture },
});

const launchResult = (label, index, block, { runId = "R1", ui = `ui-${label}`, config = "c1", instrument = "full", cpu, capture, pss = 1000, valid = true, foreign } = {}) => ({
  runId,
  launchId: `${runId}-${String(index).padStart(3, "0")}-${label}-a1`,
  label,
  build: `/builds/${label}`,
  commit: `${label}0000000000`,
  fingerprint: { ui, engine: "engine", blocker: "blocker" },
  config,
  launchIndex: index,
  blockIndex: block,
  attempt: 1,
  instrument,
  ok: true,
  cpus: "10-15",
  tabsLoaded: 100,
  scenarios: { S3: { ...record({ cpu, capture, foreign }), valid, invalidReason: valid ? null : "sidebar not hidden" } },
  memoryAtRest: { byKind: { total: { pssMiB: pss, ussMiB: pss - 200 } } },
  memory: { byKind: { total: { pssMiB: pss + 50, ussMiB: pss - 150 } } },
});

async function writeRun(dir, results) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "results"), { recursive: true });
  for (const r of results) await writeFile(join(dir, "results", `${r.launchId}.json`), JSON.stringify(r));
  return dir;
}

const row = (markdown, metric, kind) => markdown.split("\n").find((line) => line.startsWith(`| ${metric} | ${kind} |`) || line.startsWith(`| **${metric}** | ${kind} |`));

describe("report", () => {
  it("fills a counter a build removed with 0 and shows the drop", async () => {
    const out = await writeRun(join(root, "zero"), [
      launchResult("base", 1, 1, { cpu: 60, capture: 36 }),
      launchResult("fix", 2, 1, { cpu: 40 }),
      launchResult("fix", 3, 2, { cpu: 42 }),
      launchResult("base", 4, 2, { cpu: 62, capture: 36 }),
    ]);
    const md = buildReport(out);
    const capture = row(md, "chrome.send invoke:tab.command:capturePicture", "shell");
    assert.ok(capture, md);
    assert.match(capture, /\| 0 \(0-0, 2\) \|/);
    assert.match(capture, /-100\.0 %/);
    const total = row(md, "CPU %", "total");
    assert.match(total, /^\| \*\*CPU %\*\* \| total \| 61\.00 \(60\.00-62\.00, 2\) \| 41\.00 \(40\.00-42\.00, 2\) \| -20\.00 \(-32\.8 %\) \| 0\/2 \|/);
    assert.match(row(md, "PSS MiB", "total"), /1000 \(1000-1000, 2\)/);
    assert.match(md, /Launch order: base fix fix base/);
  });

  it("leaves counters blank in light runs and lists windows that are not comparable", async () => {
    const out = await writeRun(join(root, "light"), [
      launchResult("base", 1, 1, { cpu: 60, capture: 36, instrument: "light" }),
      launchResult("fix", 2, 1, { cpu: 40, instrument: "light" }),
      launchResult("fix", 3, 2, { cpu: 41, valid: false }),
    ]);
    const md = buildReport(out);
    assert.match(row(md, "chrome.send invoke:tab.command:capturePicture", "shell"), /\| 36\.00 \(36\.00-36\.00, 1\) \| - \|/);
    assert.match(md, /R1-003-fix-a1 S3: sidebar not hidden/);
  });

  it("pools runs only when their settings and builds match", async () => {
    const same = await writeRun(join(root, "pool"), [launchResult("a", 1, 1, { cpu: 1 }), launchResult("a", 1, 1, { cpu: 2, runId: "R2" })]);
    assert.match(buildReport(same, { all: true }), /runs R1, R2/);
    assert.match(buildReport(same), /run R2\./);
    assert.throws(() => buildReport(same, { run: "R9" }), /no results for run R9/);
    const config = await writeRun(join(root, "pool-config"), [launchResult("a", 1, 1, { cpu: 1 }), launchResult("a", 1, 1, { cpu: 2, runId: "R2", config: "c2" })]);
    assert.throws(() => buildReport(config, { all: true }), /differ in measurement settings/);
    const ui = await writeRun(join(root, "pool-ui"), [launchResult("a", 1, 1, { cpu: 1 }), launchResult("a", 1, 1, { cpu: 2, runId: "R2", ui: "other" })]);
    assert.throws(() => buildReport(ui, { all: true }), /names different UI builds/);
  });

  it("pairs every build against the control and marks what the A/A spread can't separate", async () => {
    const out = await writeRun(join(root, "paired"), [
      launchResult("bun", 1, 1, { cpu: 10, ui: "u" }),
      launchResult("aa", 2, 1, { cpu: 11, ui: "u" }),
      launchResult("final", 3, 1, { cpu: 20 }),
      launchResult("final", 4, 2, { cpu: 20 }),
      launchResult("aa", 5, 2, { cpu: 9, ui: "u" }),
      launchResult("bun", 6, 2, { cpu: 10, ui: "u" }),
    ]);
    const md = buildReport(out, { control: "bun" }).split("## Paired against bun")[1];
    assert.match(md, /A\/A pair \(same UI and engine sha256 as bun\): aa\./);
    const total = row(md, "CPU %", "total");
    assert.match(total, /\| 10\.00 \| 0 \(-1\.\.1, 2\) \| 10\.00 \(10\.00\.\.10\.00, 2\) \| 100\.0 % \| beyond \(1\) \|/);
    assert.throws(() => buildReport(out, { control: "nobody" }), /is not a build in this run/);
  });

  it("computes the exact Mann-Whitney p and the A/A noise floor", async () => {
    assert.deepEqual(mannWhitney([1, 2, 3], [4, 5, 6]), { u: 0, p: 0.1, exact: true });
    assert.equal(mannWhitney([5, 5], [5, 5]).p, 1);
    const out = await writeRun(join(root, "noise"), [launchResult("a", 1, 1, { cpu: 10, ui: "u" }), launchResult("b", 2, 1, { cpu: 12, ui: "u" })]);
    const md = buildNoise(out);
    assert.match(md, /UI sha256 u \(identical builds\)/);
    assert.match(row(md, "CPU %", "total"), /\| 2 \| 11\.00 \| 10\.00-12\.00 \| 18\.2 % \|/);
    const three = await writeRun(join(root, "noise3"), [launchResult("a", 1, 1, { cpu: 1 }), launchResult("b", 2, 1, { cpu: 1 }), launchResult("c", 3, 1, { cpu: 1 })]);
    assert.throws(() => buildNoise(three), /exactly two labels/);
  });
});
