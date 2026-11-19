#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cliProblems, reportDraftProblems, reportTemplate } from "./exercise-checks.mjs";

const USAGE = `usage: node exercise-linux.mjs --launcher PATH --results DIR [--repo DIR] [--idle-seconds N]
                                [--url URL] [--port N] [--extra-arg ARG]...
                                [--python PATH] [--virtual-seconds N] [--sharing on|off]

Drives the Linux app the way a user would, for the no-upstream check. Run it
inside nilla-isolate --net --display. PATH is the launcher: launch-dev.sh,
which starts the extracted package through the repo's scripts/linux/nilla-dev-run
with ARDIA_DATA_DIR and ARDIA_CONFIG_HOME under $ISOLATE_RUN/dev (a bare
bin/ardia launch stops at the isolation page before the engine starts). The
exercise clears the ARDIA_* variables it inherits, adds only
--remote-debugging-port, --proxy-server from ISOLATE_PROXY, --ozone-platform=x11
and stderr logging, then:

  launch     waits for the main shell renderer and screenshots it
  updates    opens Settings > General > Updates and fails if Check Now or any
             update control is offered (updates are behind the Layer 1 gate)
  report     runs Report a Problem and fails unless a draft opens at exactly
             https://github.com/NoorChasib/nilla/issues/new whose only query
             field is body, equal to the app's REPORT_ISSUE_BODY template (no
             diagnostics, no other fields, no fragment)
  page       opens URL (default https://example.com/) in a new tab
  timers     advances every shell renderer's virtual clock by --virtual-seconds
             (default 21700, past the 6 h update interval) so the telemetry
             flush, the hourly local-copy check and the update timer fire
  consent    reads the app's telemetry state: the saved choice matches
             --sharing (default off; on writes a saved choice with sharing on
             and an install id into the profile's telemetry.json before the
             launch), the app may not post, and every telemetry request it
             logged is a dry run with no endpoint
  cli        turns CLI control on and runs nilla-browser (windows, tabs, pinned,
             feedback, browse get url, and with browse --port N: tab active,
             tab <the page's target id>, get url; then star --help)
             with --python (default /home/noor/ardia-work/venv-cli/bin/python)
             against the instance, with the same ARDIA_DATA_DIR and
             ARDIA_CONFIG_HOME, then windows with neither; windows and tabs
             must exit 0, browse --port N tab <id> and get url must exit 0
             and get url print the page step's URL, and the run with neither
             variable must exit 2
             with the data-folder refusal; the other runs are recorded only
  idle       waits N seconds (default 300) with the app untouched
  quit       Browser.close, then SIGTERM/SIGKILL on the process group

Each step's start and end time goes to DIR/exercise.json, which
check-upstream.py --since/--until can use. --repo (default
/home/noor/Code/ardia) supplies the acceptance CDP helpers and the CLI.`;

const options = { launcher: null, results: null, repo: "/home/noor/Code/ardia", idle: 300, url: "https://example.com/", port: 9222, extra: [], python: "/home/noor/ardia-work/venv-cli/bin/python", virtual: 21700, sharing: "off" };
const argv = process.argv.slice(2);
while (argv.length) {
  const key = argv.shift();
  if (key === "-h" || key === "--help") { console.log(USAGE); process.exit(0); }
  const value = argv.shift();
  if (value === undefined) { console.error(USAGE); process.exit(64); }
  if (key === "--launcher") options.launcher = resolve(value);
  else if (key === "--results") options.results = resolve(value);
  else if (key === "--repo") options.repo = resolve(value);
  else if (key === "--idle-seconds") options.idle = Number(value);
  else if (key === "--url") options.url = value;
  else if (key === "--port") options.port = Number(value);
  else if (key === "--extra-arg") options.extra.push(value);
  else if (key === "--python") options.python = value;
  else if (key === "--virtual-seconds") options.virtual = Number(value);
  else if (key === "--sharing" && (value === "on" || value === "off")) options.sharing = value;
  else { console.error(USAGE); process.exit(64); }
}
if (!options.launcher || !options.results) { console.error(USAGE); process.exit(64); }
const sharingOn = options.sharing === "on";
const telemetryDocument = join(process.env.ISOLATE_RUN ?? options.results, "dev/config/ardia/Default/Ardia/telemetry.json");
if (sharingOn) {
  const now = Date.now();
  await mkdir(join(telemetryDocument, ".."), { recursive: true, mode: 0o700 });
  await writeFile(telemetryDocument, JSON.stringify({ sharing: true, installId: randomUUID(), decidedAt: now, askDoneAt: now, crashCursor: now, consentEpoch: 1, version: 1 }), { mode: 0o600 });
}

const lib = join(options.repo, "apps/linux/scripts/acceptance/lib");
const helper = await import(join(lib, "nilla.mjs"));
const DrivenApp = helper.NillaApp ?? helper.ArdiaApp;
const { connectCdp, evaluate, fetchJson } = await import(join(lib, "cdp.mjs"));
const { until } = await import(join(lib, "util.mjs"));

await mkdir(options.results, { recursive: true });
const report = { launcher: options.launcher, started: Date.now() / 1000, steps: [], ok: true };
const save = () => writeFile(join(options.results, "exercise.json"), JSON.stringify(report, null, 2));
const say = (text) => console.log(`[exercise ${new Date().toISOString().slice(11, 19)}] ${text}`);

async function step(name, body) {
  const entry = { name, start: Date.now() / 1000 };
  report.steps.push(entry);
  say(`${name}: start`);
  try {
    entry.detail = await body();
    entry.ok = true;
  } catch (error) {
    entry.ok = false;
    entry.error = String(error?.stack ?? error);
    if (error?.detail) entry.detail = error.detail;
    report.ok = false;
    say(`${name}: FAILED ${error?.message ?? error}`);
  }
  entry.end = Date.now() / 1000;
  await save();
  say(`${name}: ${entry.ok ? "ok" : "failed"} (${(entry.end - entry.start).toFixed(1)}s)`);
  return entry.ok;
}

const args = [`--remote-debugging-port=${options.port}`, "--remote-debugging-address=127.0.0.1", "--ozone-platform=x11", "--enable-logging=stderr", "--v=0", ...options.extra];
if (process.env.ISOLATE_PROXY) args.push(`--proxy-server=${process.env.ISOLATE_PROXY}`);
const environment = { ...process.env };
for (const name of ["ARDIA_DATA_DIR", "ARDIA_CONFIG_HOME", "ARDIA_BACKGROUND", "ARDIA_SWITCHES", "ARDIA_INSTANCE"]) delete environment[name];
const logPath = join(options.results, "app.log");
const log = openSync(logPath, "w");
const child = spawn(options.launcher, args, { stdio: ["ignore", log, log], env: environment, detached: true });
closeSync(log);
report.command = [options.launcher, ...args];
const app = new DrivenApp({ child, scratch: options.results, logPath, label: "exercise" });
let main = null;

await step("launch", async () => {
  const version = await until(() => fetchJson(`http://127.0.0.1:${options.port}/json/version`, 2000).catch(() => false), { timeout: 60000, label: "the DevTools endpoint", abort: () => app.exitReason() });
  app.port = options.port;
  app.browser = await connectCdp(version.webSocketDebuggerUrl);
  main = await app.mainShell({ timeout: 60000 });
  const info = await main.eval("(() => { const b = globalThis.__ardiaHost?.bootstrap; return { launchConfig: b?.launchConfig ?? null, appVersion: b?.systemInfo?.appVersion ?? null, title: document.title } })()");
  await main.screenshot(join(options.results, "1-launch.png"));
  return { browser: version.Browser, ...info };
});

if (main) {
  await step("updates", async () => {
    await main.command("openSettings");
    const settings = await app.shell("settings", { timeout: 30000 });
    await until(async () => (await settings.text()).includes("Updates"), { timeout: 15000, label: "the Updates section" });
    const before = await settings.text();
    const at = before.indexOf("Updates");
    let pressed = false;
    const scrolled = await settings.eval(`(() => {
      const nodes = [...document.querySelectorAll("*")].filter((n) => (n.innerText ?? "").trim() === "Check Now");
      nodes.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
      if (!nodes.length) return false;
      nodes[0].scrollIntoView({ block: "center" });
      return true;
    })()`);
    await delay(800);
    const button = scrolled ? await settings.rectByText("Check Now").catch(() => null) : null;
    if (button) {
      await settings.mouse(button.x, button.y);
      pressed = true;
      await until(async () => !(await settings.text()).includes("Not checked yet."), { timeout: 15000, label: "the manual check to finish" }).catch(() => {});
    }
    await settings.screenshot(join(options.results, "2-settings-updates.png"));
    const after = await settings.text();
    const atAfter = after.indexOf("Updates");
    if (pressed) throw new Error("Check Now was offered and pressed while updates are behind the Layer 1 gate");
    const updatesRows = await settings.eval(`[...document.querySelectorAll("*")].filter((n) => /^(Check Now|Automatically check for updates|Automatically download updates)$/.test((n.innerText ?? "").trim())).length`);
    if (updatesRows) throw new Error(`${updatesRows} update controls are shown while updates are behind the Layer 1 gate`);
    return { pressedCheckNow: pressed, checkNowShown: scrolled, updateControls: updatesRows, sectionBefore: before.slice(at, at + 600), sectionAfter: after.slice(atAfter, atAfter + 600) };
  });

  await step("report", async () => {
    await main.command("reportProblem");
    const opened = await until(async () => (await app.targets()).find((t) => t.type === "page" && t.url.includes("/issues/new")) ?? false, { timeout: 20000, label: "the report page" }).catch(() => null);
    await delay(3000);
    const url = opened?.url ?? null;
    const problems = reportDraftProblems(url, await reportTemplate(options.repo));
    if (problems.length) throw new Error(`Report a Problem: ${problems.join("; ")}`);
    return { opened: url };
  });

  let pageUrl = null;
  let pageTarget = null;
  await step("page", async () => {
    const tabId = await main.newTab(options.url);
    const target = await app.pageLoaded(options.url, { timeout: 45000 });
    pageUrl = target.url;
    pageTarget = target.id;
    await main.screenshot(join(options.results, "3-page.png"));
    return { tabId, url: target.url, title: target.title };
  });

  await step("timers", async () => {
    const shells = (await app.shells()).filter((s) => s.windowId);
    const clocks = [];
    for (const shell of shells) {
      const start = await evaluate(shell.session, "Date.now()", { timeout: 3000 }).catch(() => null);
      const expired = new Promise((done) => {
        const off = shell.session.on("Emulation.virtualTimeBudgetExpired", () => { off?.(); done(true); });
      });
      await shell.session.send("Emulation.setVirtualTimePolicy", { policy: "advance", budget: options.virtual * 1000 }, { timeout: 10000 });
      const finished = await Promise.race([expired, delay(180000).then(() => false)]);
      const end = await evaluate(shell.session, "Date.now()", { timeout: 5000 }).catch(() => null);
      clocks.push({ windowId: shell.windowId, utility: shell.utility, finished, advancedSeconds: start && end ? Math.round((end - start) / 1000) : null });
      say(`timers: ${shell.windowId} advanced ${clocks.at(-1).advancedSeconds}s (budget expired: ${finished})`);
    }
    if (!clocks.length) throw new Error("no shell renderer to advance");
    if (clocks.some((c) => !c.advancedSeconds || c.advancedSeconds < options.virtual - 5)) throw new Error(`a shell clock didn't advance ${options.virtual}s: ${JSON.stringify(clocks)}`);
    await delay(20000);
    return { virtualSeconds: options.virtual, clocks };
  });

  await step("consent", async () => {
    const state = await main.eval("(() => { const t = (globalThis.nillaLinux ?? globalThis.ardiaLinux).telemetry; const s = t.state(); return { sharing: s.saved.sharing, installId: !!s.saved.installId, canSend: s.canSend, queued: s.queued, droppedWhileOff: s.droppedWhileOff, requests: t.requests().map((r) => ({ kind: r.kind, url: r.url, status: r.status, dryRun: r.dryRun ?? false })) }; })()");
    const saved = JSON.parse(await readFile(telemetryDocument, "utf8").catch(() => "{}"));
    const problems = [];
    if (state.sharing !== sharingOn) problems.push(`the app's saved choice says sharing ${state.sharing}, expected ${sharingOn}`);
    if ((saved.sharing === true) !== sharingOn) problems.push(`telemetry.json says sharing ${saved.sharing}, expected ${sharingOn}`);
    if (state.canSend) problems.push("the app may post telemetry");
    const sent = state.requests.filter((r) => r.url || !r.dryRun);
    if (sent.length) problems.push(`${sent.length} telemetry requests had an endpoint or weren't dry runs`);
    if (problems.length) throw Object.assign(new Error(`consent ${options.sharing}: ${problems.join("; ")}`), { detail: state });
    return { expected: options.sharing, ...state, savedSharing: saved.sharing };
  });

  await step("cli", async () => {
    const cliDir = join(options.repo, "apps/cli");
    await main.eval("(globalThis.nillaLinux ?? globalThis.ardiaLinux).store.getState().updateSettings({ cliControl: true }), true");
    await delay(4000);
    const env = { ...environment, ARDIA_DATA_DIR: join(process.env.ISOLATE_RUN, "dev/data"), ARDIA_CONFIG_HOME: join(process.env.ISOLATE_RUN, "dev/config"), PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: cliDir };
    if (!pageUrl || !pageTarget) throw new Error("the page step opened no page for browse to read");
    const runs = [];
    const port = ["browse", "--port", String(options.port)];
    for (const args of [["windows"], ["tabs"], ["pinned"], ["feedback", "--title", "Harness check", "the no-upstream run"], ["browse", "get", "url"], [...port, "tab", "active"], [...port, "tab", pageTarget], [...port, "get", "url"], ["star", "--help"]]) {
      const started = Date.now();
      const run = spawnSync(options.python, ["-m", "nilla_browser_cli", ...args], { cwd: process.env.HOME, env, encoding: "utf8", timeout: 90000, input: "" });
      runs.push({ args, status: run.status, signal: run.signal, seconds: Math.round((Date.now() - started) / 100) / 10, stdout: (run.stdout ?? "").slice(0, 400), stderr: (run.stderr ?? "").slice(-400) });
      say(`cli: ${args.join(" ")} -> ${run.status}`);
    }
    const unsetRun = spawnSync(options.python, ["-m", "nilla_browser_cli", "windows"], { cwd: process.env.HOME, env: { ...environment, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: cliDir }, encoding: "utf8", timeout: 60000, input: "" });
    runs.push({ args: ["windows", "(neither ARDIA_DATA_DIR nor ARDIA_CONFIG_HOME)"], status: unsetRun.status, stdout: (unsetRun.stdout ?? "").slice(0, 300), stderr: (unsetRun.stderr ?? "").slice(-300) });
    const problems = cliProblems({ windows: runs[0], tabs: runs[1], select: runs[6], browse: runs[7], unset: runs.at(-1) }, pageUrl);
    if (problems.length) throw Object.assign(new Error(`the CLI check failed: ${problems.join("; ")}`), { detail: { runs, pageUrl, pageTarget } });
    return { runs, pageUrl, pageTarget };
  });

  await step("idle", async () => {
    const samples = [];
    const end = Date.now() + options.idle * 1000;
    while (Date.now() < end) {
      await delay(Math.min(60000, end - Date.now()));
      if (app.exitReason()) throw new Error(app.exitReason());
      const targets = await app.targets().catch(() => []);
      samples.push({ at: Date.now() / 1000, targets: targets.length });
      say(`idle: ${Math.round((end - Date.now()) / 1000)}s left, ${targets.length} targets`);
    }
    return { seconds: options.idle, samples };
  });
}

await step("quit", async () => {
  const exited = await app.close({ graceful: true, timeout: 15000 });
  return { exited, exitCode: app.exitCode };
});
report.finished = Date.now() / 1000;
await save();
const tail = (await readFile(logPath, "utf8").catch(() => "")).split("\n").slice(-5).join("\n");
say(`done, ok=${report.ok}; app log tail:\n${tail}`);
process.exit(report.ok ? 0 : 1);
