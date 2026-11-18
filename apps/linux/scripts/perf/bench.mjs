#!/usr/bin/env node
const HELP = `usage:
  bench.mjs run --builds label=dir[,label=dir...] [--out DIR] [options]
  bench.mjs report [--out DIR] [--run ID | --all] [--md FILE] [--control LABEL] [--residual-max PCT]
  bench.mjs noise [--out DIR] [--run ID] [--md FILE]

Linux CPU/RAM benchmark for Ardia UI builds (--ardia-ui-dir) on one engine. Each launch gets a fresh copy of a
per-build template profile, its own Xvfb (1920x1080x24) and fixture server, N fixture tabs created through the
app's store, and the selected scenario windows. Launches interleave ABBA across builds. One JSON per launch lands
in DIR/results; 'report' turns one run's results into markdown tables (the newest run unless --run ID; --all pools
every run in DIR and refuses runs whose builds or settings differ). 'noise' reads an A/A run (two labels of the
same build) and prints each metric's spread and the smallest difference worth trusting. Relative paths resolve
against the current directory; <repo> is the checkout this script lives in. docs/perf/linux-bench.md has the details.

run options:
  --builds L=DIR,...      UI dist dirs to compare (BUILD_INFO in each dir supplies the commit when present)
  --out DIR               results, logs, templates and scratch profiles (default <repo>/output/linux-bench)
  --runs N                launches per build (default 1)
  --tabs N                loaded tabs in the window (default 100)
  --scenarios LIST        any of S1,S2,S3,S4,S5,S6,S7 (default all, in that order)
  --settings K=V          setting applied through updateSettings around S4 and S5 (repeatable; V is JSON or a bare
                          string), read back before the scenario and restored after it; S4 leaves out autoHideTabs,
                          which it sets itself. A key the build does not know fails the launch
  --instrument MODE       full (default: counters, observers, frame and latency probes) or light (CPU/RAM only:
                          no patched DOM calls, no observers, no frame loop, no latency rows)
  --engine DIR            engine dir with chrome (default: the cache entry under
                          <repo>/apps/browser/build-ardiacore/prebuilt-linux-x86_64 whose directory changed last, which
                          is not necessarily the engine for HEAD's key: pass the dir scripts/linux/fetch-engine.sh prints)
  --content-blocker DIR   the content blocker as a packaged build ships it, lib/ardia/extensions/ublock (uBlock Origin
                          plus the Linux bridge and the seeded engine); default $ARDIA_BENCH_CONTENT_BLOCKER. A tree
                          without ardia-linux-bridge.js (the raw one from scripts/linux/fetch-ubo.sh) is refused, since
                          it never starts on the Linux engine; 'none' launches without one
  --cpus LIST             CPUs for the app, Xvfb and fixture server (default 10-15, for a 16-vCPU host; checked
                          against the online CPUs)
  --scope MODE            where each chrome runs: user (default: its own systemd-run --user --scope), delegated (a
                          child cgroup of this process's own delegated cgroup, for a run inside an external CPU
                          partition that confines user.slice to the other CPUs) or none (process-tree walk).
                          Default: $ARDIA_BENCH_SCOPE, else user
  --lock FILE             flock file (default /tmp/ardia-perflab.lock); when $ARDIA_PERFLAB_LEASE names the same file
                          and $ARDIA_PARTITION_STATE exists, an external partition already holds it for the whole
                          partition and the run takes no lock of its own
  --lock-scope S          launch, block (default: one launch of every build, so each ABBA pair runs back to back)
                          or run (held from the first template to the last launch)
  --lock-timeout S        how long to wait for the lock (default 3600)
  --display-base N        first X display number tried (default 160; up to 40 above it are tried)
  --debug-port P          chrome's --remote-debugging-port (default 0: chrome picks a free one and writes it to
                          DevToolsActivePort); a fixed port must be free, and the endpoint comes from /json/version
  --fixture-port P        the fixture server's port on 127.0.0.1 (default 0: a free one)
  --settle S              settle after all tabs load, before shell GC (default 60)
  --template-wait S       wait in the template launch for the content blocker (default 90)
  --fresh-templates       rebuild the template profiles even when one matches
  --read-settle S         quiet time between reading the fixture pages' counters over CDP and the next window (default 5)
  --idle-seconds S        S1 window (default 60)
  --idle-discard S        untimed idle window before S1, kept in the result but not reported (default: --idle-seconds)
  --active-seconds S      S2 window (default 45)
  --no-split              S2 without the ticker split beside the rAF tab
  --switches N            S3 switches (default 40), --switch-interval MS (default 500), --switch-key K (default ctrl+Tab)
  --switch-via V          key (default: real xdotool keys) or store (the store's activate); both alternate the first two
                          static tabs, and a press that leaves the switcher open or lands elsewhere is put back
                          (Escape, then the store) and counted as a miss. Latency starts when the shell receives the
                          engine's ArdiaShell:onCommand for the key. Put-back steps run inside the window, so the
                          report shows each window's put-backs (workload recoveries) beside its CPU; rank S3 CPU
                          with --switch-via store, which needs none, and keep the key run for latency
  --edge-repeats N        S4 reveals (default 20); after each 600 ms hold the harness reads tab 1's row, and polls
                          every 100 ms up to 1.5 s from the move when it isn't there yet (counted as late). A reveal
                          means the row's left edge is on screen, a hide that it is parked again, the same tests the
                          latency probe uses. A window where any reveal or hide didn't happen keeps only its latency
                          and workload rows
  --loading-seconds S     S6 and S7 window (default 45): the active tab (tab 1) loads the fixture server's /slow/<ms>
                          and stays loading for the whole window; S6 keeps the default layout (address field in the
                          toolbar, reload button breathing), S7 puts the address field in the sidebar and hides the
                          sidebar so the LoadingPill shows over the page. Both end the load and restore the layout
  --slow-ms MS            how long /slow answers after (default 600000, the fixture server's maximum)
  --loading-warmup S      S6 and S7: after the quiet gate, the load starts, runs S seconds (default 4) plus the usual
                          1 s, then the window opens. A window counts only when, at its first and its last moment, tab 1
                          is active and loading, its own /slow request is still open at the fixture server, and the
                          layout is the scenario's: S6 the address field where it was, sidebar shown, no visible pill;
                          S7 address field in the sidebar, sidebar hidden, pill visible (on screen, not transparent).
                          Before either starts the default layout must be in place, and after it ends it must be back
  --hover-rows N          S5 rows (default 24), --hover-passes N (default 3), --hover-dwell MS (default 300),
                          --hover-first-dwell MS (default 1200: the first row of a pass waits for the cold card)
  --extra-args "A B"      more chrome switches, identical on every side
  --scenario-deadline S   a scenario still running after S seconds (plus twice --quiet-wait) is cancelled and the
                          launch fails (default 300)
  --quiet-gate PCT        before each window, wait until other processes' CPU on the --cpus cores, over 3 s, is under
                          PCT % of one core (default 100; 0 turns the gate off)
  --quiet-wait S          longest wait for the gate before the window starts anyway (default 240)
  --max-foreign PCT       a window whose mean foreign CPU on the --cpus cores exceeds PCT is contended: the scenario
                          is repeated (--contention-repeats, default 1) and a window still contended is marked not
                          comparable (default 150; 0 turns it off)
  --keep-profiles         keep each launch's scratch profile
  --retries N             retries of a failed launch (default 1)
  --control LABEL         passed to the report written at the end of the run (see report)

report options:
  --control LABEL         adds a paired section against LABEL: for every scenario and memory table, each other build's
                          per-block difference from LABEL (median, min-max, n). A build with the same UI sha256 as LABEL is
                          the A/A pair: its differences are the control spread, and another build's median inside that
                          spread is marked as not separable from noise
  --residual-max PCT      in the paired section, leave out windows whose foreign CPU on the app's cores exceeds PCT
                          (default: calibrated as max(5, 2 x p90) of the control and A/A windows of the run)

Exit status: 0 when every launch succeeded, 1 when a launch failed after its retries or teardown left a process.
`;

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { acquireLock, cleanupActive, configureScopes, cpusProblem, hashFile, hashTree, makeTemplate, newestEngine } from "./lib/instance.mjs";
import { launchOrder, parse, parseBuilds, parseSettings } from "./lib/options.mjs";
import { PROTOCOL, SCENARIOS, abortCurrent, runLaunch, writeResult } from "./lib/runner.mjs";
import { buildReport, buildNoise } from "./lib/report.mjs";
import { DEFAULT_LOCK, DEFAULT_OUT, ENGINE_STORE, contentBlockerProblem, log } from "./lib/util.mjs";

const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

async function runCommand(args) {
  const builds = parseBuilds(args.builds);
  const out = resolve(args.out ?? DEFAULT_OUT);
  const runs = Number(args.runs ?? 1);
  const tabs = Number(args.tabs ?? 100);
  const scenarios = (args.scenarios ?? SCENARIOS.join(",")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const s of scenarios) if (!SCENARIOS.includes(s)) throw new Error(`unknown scenario ${s}`);
  const engineDir = args.engine ? resolve(args.engine) : newestEngine();
  if (!engineDir) throw new Error(`no engine under ${ENGINE_STORE}; run scripts/linux/fetch-engine.sh --nearest or pass --engine DIR`);
  const chrome = join(engineDir, "chrome");
  if (!existsSync(chrome)) throw new Error(`no chrome at ${chrome}; pass --engine`);
  if (!args.engine) log(`no --engine: using ${engineDir}, the newest cache entry, which may not match HEAD's engine key`);
  const blockerArg = args["content-blocker"] ?? process.env.ARDIA_BENCH_CONTENT_BLOCKER;
  if (!blockerArg) throw new Error("no content blocker: pass --content-blocker <packaged build>/lib/ardia/extensions/ublock (docs/perf/linux-bench.md, \"Engine and content blocker\"), or --content-blocker none");
  const contentBlocker = blockerArg === "none" ? null : resolve(blockerArg);
  const blockerProblem = contentBlocker && contentBlockerProblem(contentBlocker);
  if (blockerProblem) throw new Error(blockerProblem);
  const instrument = args.instrument ?? "full";
  if (!["full", "light"].includes(instrument)) throw new Error("--instrument is full or light");
  const lockScope = args["lock-scope"] ?? "block";
  if (!["launch", "block", "run"].includes(lockScope)) throw new Error("--lock-scope is launch, block or run");
  const switchVia = args["switch-via"] ?? "key";
  if (!["key", "store"].includes(switchVia)) throw new Error("--switch-via is key or store");
  const cpus = args.cpus ?? "10-15";
  const cpuProblem = cpusProblem(cpus);
  if (cpuProblem) throw new Error(cpuProblem);
  const scope = configureScopes(args.scope ?? process.env.ARDIA_BENCH_SCOPE ?? "user", cpus);
  const lockFile = resolve(args.lock ?? DEFAULT_LOCK);
  const leased = !!process.env.ARDIA_PERFLAB_LEASE && resolve(process.env.ARDIA_PERFLAB_LEASE) === lockFile && !!process.env.ARDIA_PARTITION_STATE && existsSync(process.env.ARDIA_PARTITION_STATE);
  const lockTimeout = Number(args["lock-timeout"] ?? 3600);
  const displayBase = Number(args["display-base"] ?? 160);
  const debugPort = Number(args["debug-port"] ?? 0);
  const fixturePort = Number(args["fixture-port"] ?? 0);
  for (const [flag, value] of [["--debug-port", debugPort], ["--fixture-port", fixturePort], ["--display-base", displayBase]]) if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`${flag} wants a whole number, got ${value}`);
  const extraArgs = args["extra-args"] ? args["extra-args"].split(/\s+/).filter(Boolean) : [];
  const settings = parseSettings(args.settings);
  const retries = Number(args.retries ?? 1);
  const idleSeconds = Number(args["idle-seconds"] ?? 60);
  const measure = {
    protocol: PROTOCOL,
    tabs,
    scenarios,
    settings,
    instrument,
    cpus,
    scopeMode: scope.mode,
    partition: scope.partition,
    extraArgs,
    settleSeconds: Number(args.settle ?? 60),
    readSettleMs: Number(args["read-settle"] ?? 5) * 1000,
    scenarioDeadlineMs: Number(args["scenario-deadline"] ?? 300) * 1000,
    quietGatePct: Number(args["quiet-gate"] ?? 100),
    quietWaitS: Number(args["quiet-wait"] ?? 240),
    maxForeignPct: Number(args["max-foreign"] ?? 150),
    contentionRepeats: Number(args["contention-repeats"] ?? 1),
    idleSeconds,
    idleDiscardSeconds: Number(args["idle-discard"] ?? idleSeconds),
    activeSeconds: Number(args["active-seconds"] ?? 45),
    splitTicker: !args["no-split"],
    switches: Number(args.switches ?? 40),
    switchIntervalMs: Number(args["switch-interval"] ?? 500),
    switchKey: args["switch-key"] ?? "ctrl+Tab",
    switchVia,
    edgeRepeats: Number(args["edge-repeats"] ?? 20),
    hoverRows: Number(args["hover-rows"] ?? 24),
    hoverPasses: Number(args["hover-passes"] ?? 3),
    hoverDwellMs: Number(args["hover-dwell"] ?? 300),
    hoverFirstDwellMs: Number(args["hover-first-dwell"] ?? 1200),
    loadingSeconds: Number(args["loading-seconds"] ?? 45),
    slowMs: Math.min(600000, Number(args["slow-ms"] ?? 600000)),
    loadingWarmupMs: Number(args["loading-warmup"] ?? 4) * 1000,
  };
  await mkdir(join(out, "logs"), { recursive: true });
  const hashCache = join(out, ".hash-cache.json");
  log("fingerprinting the engine, the content blocker and every UI build");
  const engineSha = hashFile(chrome, hashCache);
  const blocker = contentBlocker ? hashTree(contentBlocker).sha256 : null;
  for (const build of builds) {
    const tree = hashTree(build.dir, { exclude: ["BUILD_INFO"] });
    build.fingerprint = { ui: tree.sha256, uiFiles: tree.files, engine: engineSha, blocker };
  }
  const configFingerprint = { ...measure, engine: engineSha, blocker, sha: sha({ ...measure, engine: engineSha, blocker }) };
  const order = launchOrder(builds, runs);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const config = {
    runId: stamp,
    stamp,
    command: process.argv.join(" "),
    builds,
    runs,
    chrome,
    contentBlocker,
    lockFile,
    lockScope,
    displayBase,
    debugPort,
    fixturePort,
    scope,
    measure,
    configFingerprint,
    order: order.map((o) => o.build.label),
    node: process.version,
    hostCpus: (await import("node:os")).cpus().length,
  };
  await writeFile(join(out, `run-${stamp}.json`), JSON.stringify(config, null, 2));
  log(`run ${stamp}: order ${config.order.join(" ")}; ${tabs} tabs; scenarios ${scenarios.join(",")}; instrument ${instrument}; app on CPUs ${cpus} (scope ${scope.mode}); lock per ${lockScope}`);

  let held = null;
  const take = async (why) => {
    if (held) return;
    if (leased) {
      log(`${lockFile} is held by the external partition for its whole run (${why})`);
      held = () => {};
      return;
    }
    log(`waiting for ${lockFile} (${why})`);
    held = await acquireLock(lockFile, lockTimeout);
  };
  const drop = () => {
    held?.();
    held = null;
  };

  const templates = new Map();
  let failures = 0;
  let teardownBroken = false;
  if (lockScope !== "launch") await take("templates");
  for (const build of builds) {
    if (lockScope === "launch") await take(`template ${build.label}`);
    try {
      const template = await makeTemplate({
        build,
        chrome,
        contentBlocker,
        extraArgs,
        cpus,
        displayBase,
        debugPort,
        fixturePort,
        fingerprint: build.fingerprint,
        waitSeconds: Number(args["template-wait"] ?? 90),
        dir: join(out, "templates", build.label),
        logDir: join(out, "logs"),
        fresh: !!args["fresh-templates"],
      });
      templates.set(build.label, template.dir);
      log(`template ${build.label}: ${template.reused ? "reused" : `made (${JSON.stringify(template.validation)})`}`);
    } finally {
      if (lockScope === "launch") drop();
    }
  }
  if (lockScope === "block") drop();

  const files = [];
  let index = 0;
  for (let i = 0; i < order.length && !teardownBroken && !stopping; i++) {
    const { build, run, block } = order[i];
    index++;
    const blockStart = i === 0 || order[i - 1].block !== block;
    const blockEnd = i === order.length - 1 || order[i + 1].block !== block;
    if (lockScope === "launch" || (lockScope === "block" && blockStart)) await take(`block ${block}`);
    let result = null;
    for (let attempt = 1; attempt <= retries + 1 && !stopping; attempt++) {
      log(`launch ${index}/${order.length}: ${build.label} run ${run} block ${block} attempt ${attempt}`);
      result = await runLaunch({
        runId: stamp,
        launchId: `${stamp}-${String(index).padStart(3, "0")}-${build.label}-a${attempt}`,
        launchIndex: index,
        blockIndex: block,
        runIndex: run,
        attempt,
        build,
        fingerprint: build.fingerprint,
        configFingerprint: configFingerprint.sha,
        out,
        chrome,
        contentBlocker,
        extraArgs,
        displayBase,
        debugPort,
        fixturePort,
        template: templates.get(build.label),
        keepProfiles: !!args["keep-profiles"],
        ...measure,
      });
      result.lockFile = lockFile;
      result.lockScope = lockScope;
      result.lockLeased = leased;
      files.push(await writeResult(out, result));
      if (result.teardownFailed) {
        teardownBroken = true;
        log(`teardown left processes behind (${JSON.stringify(result.teardown)}); stopping the run`);
        break;
      }
      if (result.ok) break;
      log(`launch failed: ${result.error}`);
    }
    if (!result?.ok) failures++;
    if (lockScope === "launch" || (lockScope === "block" && blockEnd)) drop();
  }
  drop();
  log(`wrote ${files.length} result files to ${join(out, "results")}`);
  const markdown = buildReport(out, { run: stamp, control: args.control });
  await writeFile(join(out, "report.md"), markdown);
  log(`report: ${join(out, "report.md")}`);
  if (failures || teardownBroken) {
    log(`${failures} launch(es) failed${teardownBroken ? "; teardown incomplete" : ""}`);
    return 1;
  }
  return 0;
}

async function reportCommand(args) {
  const markdown = buildReport(resolve(args.out ?? DEFAULT_OUT), { run: args.run, all: !!args.all, control: args.control, residualMax: args["residual-max"] === undefined ? undefined : Number(args["residual-max"]) });
  if (args.md) await writeFile(resolve(args.md), markdown);
  else process.stdout.write(`${markdown}\n`);
  return 0;
}

async function noiseCommand(args) {
  const markdown = buildNoise(resolve(args.out ?? DEFAULT_OUT), { run: args.run });
  if (args.md) await writeFile(resolve(args.md), markdown);
  else process.stdout.write(`${markdown}\n`);
  return 0;
}

const args = parse(process.argv.slice(2));
const command = args._[0];
if (args.help || !command) {
  process.stdout.write(HELP);
  process.exit(args.help ? 0 : 2);
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: stopping the instance, Xvfb and fixture server`);
    abortCurrent(signal);
    await cleanupActive().catch(() => {});
    process.exit(130);
  });
}

const main = { run: runCommand, report: reportCommand, noise: noiseCommand }[command];
if (!main) {
  process.stderr.write(`unknown command ${command}\n${HELP}`);
  process.exit(2);
}
main(args).then(
  (code) => process.exit(code ?? 0),
  async (error) => {
    process.stderr.write(`bench: ${error.stack ?? error.message}\n`);
    await cleanupActive().catch(() => {});
    process.exit(1);
  },
);
