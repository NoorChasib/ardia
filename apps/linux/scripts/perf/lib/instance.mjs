import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, closeSync, constants as fsConstants, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectCdp, attach, evaluate } from "./cdp.mjs";
import { ENGINE_STORE, groupAlive, log, pause, pidAlive, run, until } from "./util.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
export const FIXTURE_SCRIPT = join(here, "fixtures.mjs");
export const SCREEN = { width: 1920, height: 1080, depth: 24 };

const live = new Set();

export function track(resource) {
  live.add(resource);
  return () => live.delete(resource);
}

export async function cleanupActive() {
  for (const resource of [...live]) {
    live.delete(resource);
    await resource.release().catch(() => {});
  }
}

export function liveResources() {
  return live.size;
}

export function hashFile(path, cacheFile) {
  const st = statSync(path);
  const key = `${resolve(path)}:${st.size}:${st.mtimeMs}:${st.ino}`;
  let cache = {};
  if (cacheFile && existsSync(cacheFile)) {
    try {
      cache = JSON.parse(readFileSync(cacheFile, "utf8"));
    } catch {}
  }
  if (cache[key]) return cache[key];
  const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (cacheFile) {
    cache[key] = sha;
    try {
      writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {}
  }
  return sha;
}

export function hashTree(dir, { exclude = [] } = {}) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      else if (!exclude.includes(relative(dir, path))) files.push(path);
    }
  };
  walk(dir);
  const h = createHash("sha256");
  for (const path of files) h.update(`${relative(dir, path)}\0${createHash("sha256").update(readFileSync(path)).digest("hex")}\n`);
  return { sha256: h.digest("hex"), files: files.length };
}

export function newestEngine(root = ENGINE_STORE) {
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root)
    .map((name) => join(root, name))
    .filter((dir) => statSync(dir).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const dir of dirs) {
    if (existsSync(join(dir, "chrome"))) return dir;
    if (existsSync(join(dir, "ardiacore-linux-x64/chrome"))) return join(dir, "ardiacore-linux-x64");
  }
  return null;
}

export function readBuildInfo(dir) {
  const file = join(dir, "BUILD_INFO");
  if (!existsSync(file)) return { commit: null, info: null };
  const text = readFileSync(file, "utf8").trim();
  try {
    const parsed = JSON.parse(text);
    return { commit: parsed.commit ?? null, info: parsed };
  } catch {}
  const pairs = Object.fromEntries(text.split("\n").map((line) => line.split("=")).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join("=").trim()]));
  if (pairs.commit) return { commit: pairs.commit, info: pairs };
  return { commit: text.split(/\s+/)[0] || null, info: { raw: text } };
}

export async function acquireLock(path, timeoutSeconds) {
  const child = spawn("flock", ["-w", String(timeoutSeconds), path, "sh", "-c", "echo locked; exec cat"], { stdio: ["pipe", "pipe", "ignore"] });
  await new Promise((resolveLock, reject) => {
    child.stdout.once("data", () => resolveLock());
    child.once("exit", (code) => reject(new Error(`could not take ${path} within ${timeoutSeconds} s (flock exited ${code})`)));
    child.once("error", reject);
  });
  return () => {
    try {
      child.stdin.end();
    } catch {}
  };
}

function displayFree(n) {
  return !existsSync(`/tmp/.X${n}-lock`) && !existsSync(`/tmp/.X11-unix/X${n}`);
}

function displayAnswers(n) {
  try {
    execFileSync("xdpyinfo", [], { env: { ...process.env, DISPLAY: `:${n}` }, stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function startXvfb({ base, cpus, logDir }) {
  for (let n = base; n < base + 40; n++) {
    if (!displayFree(n)) continue;
    const logFile = openSync(join(logDir, `xvfb-${n}.log`), "a");
    const argv = benchArgv(["taskset", "-c", cpus, "Xvfb", `:${n}`, "-screen", "0", `${SCREEN.width}x${SCREEN.height}x${SCREEN.depth}`, "-nolisten", "tcp", "-ac", "+extension", "RANDR"]);
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: ["ignore", logFile, logFile] });
    closeSync(logFile);
    child.unref();
    const pid = child.pid;
    const xvfb = { display: n, pid };
    xvfb.untrack = track({ release: () => stopXvfb(xvfb) });
    try {
      await until(() => !pidAlive(pid) ? Promise.reject(new Error("Xvfb exited")) : displayAnswers(n), { timeout: 10000, interval: 100, label: `Xvfb :${n}` });
      return xvfb;
    } catch (error) {
      await stopXvfb(xvfb);
      log(`Xvfb :${n} failed (${error.message}); trying the next display`);
    }
  }
  throw new Error(`no free X display from :${base}`);
}

async function stopPid(pid, waitSteps) {
  try { process.kill(pid, "SIGTERM"); } catch {}
  for (let i = 0; i < waitSteps && pidAlive(pid); i++) await pause(100);
  if (pidAlive(pid)) {
    try { process.kill(pid, "SIGKILL"); } catch {}
    for (let i = 0; i < 20 && pidAlive(pid); i++) await pause(100);
  }
  return !pidAlive(pid);
}

export async function stopXvfb(xvfb) {
  if (!xvfb?.pid) return true;
  const clean = await stopPid(xvfb.pid, 30);
  if (clean) xvfb.untrack?.();
  return clean;
}

export async function startFixtures({ cpus, port = 0 }) {
  const argv = benchArgv(["taskset", "-c", cpus, process.execPath, FIXTURE_SCRIPT, "--port", String(port)]);
  const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  child.unref();
  const handle = { pid: child.pid };
  handle.untrack = track({ release: () => stopFixtures(handle) });
  const info = await new Promise((resolveInfo, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error("fixture server did not start in 10 s")), 10000);
    child.stdout.on("data", (d) => {
      text += d;
      if (text.includes("\n")) {
        clearTimeout(timer);
        resolveInfo(JSON.parse(text.split("\n")[0]));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture server exited ${code}`));
    });
  }).catch(async (error) => {
    await stopFixtures(handle);
    throw error;
  });
  child.stdout.destroy();
  return Object.assign(handle, { port: info.port, base: `http://127.0.0.1:${info.port}` });
}

export async function stopFixtures(fixtures) {
  if (!fixtures?.pid) return true;
  const clean = await stopPid(fixtures.pid, 20);
  if (clean) fixtures.untrack?.();
  return clean;
}

export function launchArguments({ data, uiDir, contentBlocker, extraArgs = [], debugPort = 0 }) {
  const args = [
    `--user-data-dir=${data}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,MediaRouter",
    `--remote-debugging-port=${debugPort}`,
    "--remote-debugging-address=127.0.0.1",
    "--enable-logging=stderr",
    "--v=0",
    "--ozone-platform=x11",
    `--ardia-ui-dir=${uiDir}`,
    "--window-position=0,0",
    `--window-size=${SCREEN.width},${SCREEN.height}`,
    "--lang=en-US",
  ];
  if (contentBlocker) args.push(`--ardia-content-blocker-dir=${contentBlocker}`);
  return [...args, ...extraArgs];
}

export function launchEnvironment({ data, display }) {
  const env = {
    ...process.env,
    ARDIA_DATA_DIR: data,
    HOME: join(data, "home"),
    XDG_CONFIG_HOME: join(data, "home", ".config"),
    XDG_CACHE_HOME: join(data, "home", ".cache"),
    XDG_DATA_HOME: join(data, "home", ".local", "share"),
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(data, "no-session-bus")}`,
    CUPS_SERVER: join(data, "no-cups-server"),
    DISPLAY: `:${display}`,
    ARDIA_BACKGROUND: "1",
  };
  for (const name of ["WAYLAND_DISPLAY", "ARDIA_SWITCHES", "ARDIA_INSTANCE", "XDG_ACTIVATION_TOKEN", "DESKTOP_STARTUP_ID"]) delete env[name];
  return env;
}

export const RECORDED_ENV = ["ARDIA_DATA_DIR", "HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "DBUS_SESSION_BUS_ADDRESS", "CUPS_SERVER", "DISPLAY", "ARDIA_BACKGROUND"];

export async function seedProfile(data) {
  await mkdir(join(data, "Default", "Ardia"), { recursive: true });
  await mkdir(join(data, "home"), { recursive: true });
  await writeFile(join(data, "Default", "Ardia", "onboarding.json"), '{"completedAt":1,"version":1}');
  await writeSession(data);
  if (!existsSync(join(data, "Default", "Preferences"))) await writeFile(join(data, "Default", "Preferences"), '{"browser":{"has_seen_welcome_page":true}}');
}

export async function writeSession(data) {
  const tab = { id: "main-tab-0", windowId: "main", profileId: "default", url: "", title: "", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, page: { kind: "idle" }, openerId: null, createdAt: 1, lastActiveAt: 1 };
  const seed = {
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 1 } },
    profileOrder: ["default"],
    windows: { main: { id: "main", profileId: "default", kind: "main", tabIds: [tab.id], activeTabIds: { default: tab.id }, frame: [0, 0, SCREEN.width, SCREEN.height], createdAt: 1 } },
    windowOrder: ["main"],
    tabs: { [tab.id]: tab },
    focusedWindowId: "main",
    settings: { restoreSession: true },
  };
  await writeFile(join(data, "Default", "Ardia", "linux-session.json"), JSON.stringify(seed));
}

export const SCOPE_MODES = ["user", "delegated", "none"];
let scopeMode = "user";
let delegatedParent = null;

function cpusetOf(cgroupDir) {
  for (let dir = cgroupDir; dir.startsWith("/sys/fs/cgroup"); dir = resolve(dir, "..")) {
    try {
      return parseCpuSet(readFileSync(join(dir, "cpuset.cpus.effective"), "utf8").trim());
    } catch {}
    if (dir === "/sys/fs/cgroup") break;
  }
  return null;
}

function parseCpuSet(text) {
  const out = new Set();
  for (const part of String(text).split(",").filter(Boolean)) {
    const [a, b] = part.split("-").map(Number);
    for (let c = a; c <= (Number.isFinite(b) ? b : a); c++) out.add(c);
  }
  return out;
}

function missingCpus(cgroupDir, cpus) {
  const allowed = cpusetOf(cgroupDir);
  if (!allowed) return [];
  return [...parseCpuSet(cpus)].filter((c) => !allowed.has(c));
}

const sameCpus = (a, b) => {
  const x = parseCpuSet(a);
  const y = parseCpuSet(b);
  return x.size === y.size && [...x].every((c) => y.has(c));
};

function ownAffinity() {
  const line = readFileSync("/proc/self/status", "utf8").split("\n").find((l) => l.startsWith("Cpus_allowed_list:"));
  return line ? line.split(/\s+/)[1] : "";
}

function makeCpusetChild(dir, cpus) {
  mkdirSync(dir, { recursive: false });
  writeFileSync(join(dir, "cpuset.cpus"), cpus);
  const effective = readFileSync(join(dir, "cpuset.cpus.effective"), "utf8").trim();
  if (!sameCpus(effective, cpus)) throw new Error(`${dir}: cpuset.cpus.effective is ${effective}, wanted ${cpus}`);
  return dir;
}

let auxCgroup = null;

function configureDelegated(own, cpus) {
  try {
    accessSync(join(own, "cgroup.procs"), fsConstants.W_OK);
    accessSync(join(own, "cgroup.subtree_control"), fsConstants.W_OK);
    accessSync(own, fsConstants.W_OK);
  } catch {
    throw new Error(`--scope delegated: ${own} is not writable; run under partition.sh (a Delegate=yes unit)`);
  }
  if (!readFileSync(join(own, "cgroup.controllers"), "utf8").split(/\s+/).includes("cpuset")) throw new Error(`--scope delegated: no cpuset controller in ${own}`);
  const partition = process.env.ARDIA_PARTITION;
  let rest = null;
  if (partition) {
    const [restList, benchList] = partition.split("|");
    if (!sameCpus(benchList, cpus)) throw new Error(`--cpus ${cpus} is not the partition's bench CPUs ${benchList}`);
    if (![...parseCpuSet(ownAffinity())].every((c) => parseCpuSet(restList).has(c))) throw new Error(`the orchestrator may run on CPUs ${ownAffinity()}, outside the partition's rest CPUs ${restList}; start it under taskset -c ${restList}`);
    rest = restList;
  }
  const orchestrator = join(own, "orchestrator");
  if (!existsSync(orchestrator)) mkdirSync(orchestrator);
  for (const pid of cgroupPids(own)) writeFileSync(join(orchestrator, "cgroup.procs"), String(pid));
  if (!readFileSync(join(own, "cgroup.subtree_control"), "utf8").includes("cpuset")) writeFileSync(join(own, "cgroup.subtree_control"), "+cpuset");
  if (rest) writeFileSync(join(orchestrator, "cpuset.cpus"), rest);
  auxCgroup = join(own, "bench-aux");
  if (existsSync(auxCgroup)) rmdirSync(auxCgroup);
  makeCpusetChild(auxCgroup, cpus);
  return { orchestrator, orchestratorCpus: readFileSync(join(orchestrator, "cpuset.cpus.effective"), "utf8").trim(), aux: auxCgroup };
}

export function benchArgv(argv) {
  if (scopeMode === "delegated" && auxCgroup) return ["sh", "-c", 'echo $$ > "$0/cgroup.procs" && exec "$@"', auxCgroup, ...argv];
  return argv;
}

export function configureScopes(mode, cpus) {
  if (!SCOPE_MODES.includes(mode)) throw new Error(`--scope is ${SCOPE_MODES.join(", ")}`);
  scopeMode = mode;
  const own = cgroupOf(process.pid);
  let delegated = null;
  if (mode === "delegated") {
    if (!own) throw new Error("--scope delegated: this process has no cgroup v2 path");
    delegated = configureDelegated(own, cpus);
    delegatedParent = own;
  }
  const userManager = join("/sys/fs/cgroup/user.slice", `user-${process.getuid()}.slice`, `user@${process.getuid()}.service`);
  const checks = mode === "user" ? [userManager] : mode === "delegated" ? [auxCgroup] : [own];
  for (const dir of checks) {
    const missing = dir ? missingCpus(dir, cpus) : [];
    if (missing.length) throw new Error(`CPUs ${missing.join(",")} of --cpus ${cpus} are outside ${dir}'s cpuset${mode === "user" ? " (is the partition on? run the benchmark through partition.sh, which uses --scope delegated)" : ""}`);
  }
  return { mode, parent: mode === "delegated" ? delegatedParent : mode === "user" ? userManager : own, partition: process.env.ARDIA_PARTITION ?? null, ...(delegated ?? {}) };
}

let scopeSupport = null;
function systemdScopes() {
  if (scopeSupport !== null) return scopeSupport;
  try {
    execFileSync("systemd-run", ["--user", "--scope", "-q", `--unit=ardia-bench-check-${process.pid}`, "true"], { stdio: "ignore", timeout: 10000 });
    scopeSupport = true;
  } catch {
    scopeSupport = false;
  }
  return scopeSupport;
}

function cgroupOf(pid) {
  try {
    const line = readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n").find((l) => l.startsWith("0::"));
    return line ? join("/sys/fs/cgroup", line.slice(3)) : null;
  } catch {
    return null;
  }
}

export function cgroupPids(path) {
  if (!path) return [];
  try {
    return readFileSync(join(path, "cgroup.procs"), "utf8").split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

export function portFree(port) {
  return new Promise((resolvePort) => {
    const server = createNetServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
  });
}

async function devtoolsEndpoint(data, debugPort) {
  if (!debugPort) {
    const text = await readFile(join(data, "DevToolsActivePort"), "utf8");
    if (!text.includes("\n")) return null;
    const [port, path] = text.trim().split("\n");
    return { port: Number(port), url: `ws://127.0.0.1:${port}${path}` };
  }
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(2000) });
  const version = response.ok ? await response.json() : null;
  return version?.webSocketDebuggerUrl ? { port: debugPort, url: version.webSocketDebuggerUrl } : null;
}

export async function launch({ chrome, data, uiDir, contentBlocker, extraArgs, debugPort = 0, display, cpus, logPath, unit, startTimeout = 45000 }) {
  if (debugPort && !(await portFree(debugPort))) throw new Error(`--debug-port ${debugPort} is already in use on 127.0.0.1`);
  await rm(join(data, "DevToolsActivePort"), { force: true });
  await mkdir(join(data, "home"), { recursive: true });
  const args = launchArguments({ data, uiDir, contentBlocker, extraArgs, debugPort });
  const env = launchEnvironment({ data, display });
  const logFile = openSync(logPath, "a");
  const unitName = unit ? unit.replace(/[^A-Za-z0-9_.-]/g, "_") : null;
  const scopeUnit = unitName && (scopeMode === "delegated" || (scopeMode === "user" && systemdScopes())) ? unitName : null;
  let ownCgroup = null;
  let argv;
  if (scopeUnit && scopeMode === "delegated") {
    ownCgroup = makeCpusetChild(join(delegatedParent, `${scopeUnit}.scope`), cpus);
    argv = ["sh", "-c", 'echo $$ > "$0/cgroup.procs" && exec "$@"', ownCgroup, "taskset", "-c", cpus, chrome, ...args];
  } else if (scopeUnit) argv = ["systemd-run", "--user", "--scope", "-q", "--collect", `--unit=${scopeUnit}`, "taskset", "-c", cpus, chrome, ...args];
  else argv = ["taskset", "-c", cpus, chrome, ...args];
  const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: ["ignore", logFile, logFile], env });
  closeSync(logFile);
  child.unref();
  const app = { pid: child.pid, args, chrome, launcher: argv.slice(0, argv.indexOf(chrome)), scopeMode: scopeUnit ? scopeMode : "none", unit: scopeUnit, ownCgroup, cgroup: null, env: Object.fromEntries(RECORDED_ENV.map((k) => [k, env[k]])), exited: false, exitCode: null };
  app.untrack = track({ release: () => quit(app, { graceful: false }) });
  child.once("exit", (code, signal) => {
    app.exited = true;
    app.exitCode = code ?? signal;
  });
  if (scopeUnit) {
    app.cgroup = await until(() => {
      const path = cgroupOf(child.pid);
      return path && path.endsWith(`/${scopeUnit}.scope`) ? path : null;
    }, { timeout: 10000, interval: 20, label: `cgroup ${scopeUnit}`, abort: () => (app.exited ? `chrome exited (${app.exitCode})` : null) }).catch((error) => {
      if (scopeMode !== "delegated") return null;
      error.message = `--scope delegated: chrome never reached ${ownCgroup} (${error.message})`;
      throw error;
    }).catch(async (error) => {
      error.teardown = await quit(app, { graceful: false });
      throw error;
    });
  }
  try {
    const endpoint = await until(() => devtoolsEndpoint(data, debugPort), {
      timeout: startTimeout,
      label: debugPort ? `DevTools on port ${debugPort}` : "DevToolsActivePort",
      abort: () => (app.exited ? `chrome exited (${app.exitCode}); log ${logPath}` : null),
    });
    app.port = endpoint.port;
    app.browser = await connectCdp(endpoint.url, { callTimeout: 30000 });
  } catch (error) {
    const down = await quit(app, { graceful: false });
    error.teardown = down;
    throw error;
  }
  return app;
}

export async function shellSession(app, { timeout = 45000 } = {}) {
  const target = await until(
    async () => {
      const { targetInfos } = await app.browser.send("Target.getTargets", {}, { timeout: 5000 });
      return targetInfos.find((t) => t.type === "page" && t.url.startsWith("chrome://ardia/"));
    },
    { timeout, label: "shell target", abort: () => (app.exited ? `chrome exited (${app.exitCode})` : null) },
  );
  const session = await attach(app.browser, target.targetId);
  await until(() => session.eval("!!(globalThis.ardiaLinux?.store && globalThis.__ardiaHost && document.querySelector('[data-ardia-linux-window]'))", { timeout: 5000 }), {
    timeout,
    label: "shell ready",
    abort: () => (app.exited ? `chrome exited (${app.exitCode})` : null),
  });
  return session;
}

const appAlive = (app) => groupAlive(app.pid) || cgroupPids(app.cgroup).length > 0;

export async function quit(app, { graceful = true } = {}) {
  if (!app?.pid) return { clean: true };
  if (graceful && app.browser && !app.browser.closed && appAlive(app)) await app.browser.send("Browser.close", {}, { timeout: 5000 }).catch(() => {});
  app.browser?.close();
  for (let i = 0; i < (graceful ? 60 : 4) && appAlive(app); i++) await pause(250);
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    if (!appAlive(app)) break;
    try { process.kill(-app.pid, signal); } catch {}
    if (signal === "SIGKILL" && app.cgroup) {
      try { writeFileSync(join(app.cgroup, "cgroup.kill"), "1"); } catch {}
    }
    for (let i = 0; i < 20 && appAlive(app); i++) await pause(100);
  }
  const clean = !appAlive(app);
  if (clean && app.ownCgroup) {
    try {
      rmdirSync(app.ownCgroup);
    } catch {}
  }
  if (clean) app.untrack?.();
  return { clean, leftover: clean ? [] : cgroupPids(app.cgroup) };
}

export async function cleanVolatile(data) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort", ".ardia-instance.json"]) await rm(join(data, name), { force: true });
  for (const name of readdirSync(data)) if (/^chrome-.*\.log$|\.log$/.test(name)) await rm(join(data, name), { force: true });
}

export async function copyProfile(template, data) {
  await rm(data, { recursive: true, force: true });
  await mkdir(resolve(data, ".."), { recursive: true });
  await run("cp", ["-a", "--reflink=auto", template, data], { timeout: 120000 });
  await cleanVolatile(data);
  await writeSession(data);
  await rm(join(data, "Default", "Sessions"), { recursive: true, force: true });
}

export async function makeTemplate({ build, chrome, contentBlocker, extraArgs, cpus, displayBase, debugPort = 0, fixturePort = 0, waitSeconds, dir, logDir, fingerprint, fresh = false }) {
  const marker = join(dir, ".bench-template.json");
  const identity = { ui: build.dir, uiSha256: fingerprint?.ui ?? null, commit: build.commit, chrome, engineSha256: fingerprint?.engine ?? null, contentBlocker: contentBlocker ?? null, blockerSha256: fingerprint?.blocker ?? null, extraArgs, waitSeconds, cpus };
  if (!fresh && existsSync(marker)) {
    const saved = JSON.parse(readFileSync(marker, "utf8"));
    if (JSON.stringify(saved.identity) === JSON.stringify(identity)) return { dir, reused: true };
  }
  log(`making the template profile for ${build.label} (waits ${waitSeconds} s for the content blocker)`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await seedProfile(dir);
  let xvfb;
  let fixtures;
  let app;
  let validation = null;
  try {
    fixtures = await startFixtures({ cpus, port: fixturePort });
    xvfb = await startXvfb({ base: displayBase, cpus, logDir });
    app = await launch({ chrome, data: dir, uiDir: build.dir, contentBlocker, extraArgs, debugPort, display: xvfb.display, cpus, unit: `ardia-bench-template-${build.label}-${process.pid}`, logPath: join(logDir, `template-${build.label}.log`) });
    const shell = await shellSession(app);
    await shell.eval(`(() => { const s = ardiaLinux.store.getState(); const w = s.windows[__ardiaHost.bootstrap.windowId]; s.navigate(w.activeTabIds[w.profileId], ${JSON.stringify(`${fixtures.base}/p/1`)}); return true; })()`);
    await pause(waitSeconds * 1000);
    const title = await shell.eval(`(() => { const s = ardiaLinux.store.getState(); const w = s.windows[__ardiaHost.bootstrap.windowId]; return s.tabs[w.activeTabIds[w.profileId]]?.title ?? null; })()`);
    const { targetInfos } = await app.browser.send("Target.getTargets", {}, { timeout: 10000 });
    const extensions = targetInfos.filter((t) => t.url.startsWith("chrome-extension://")).length;
    validation = { title, extensions };
    if (!/^Static 1 /.test(title ?? "")) throw new Error(`template: fixture page did not load (title ${title})`);
    if (contentBlocker && !extensions) throw new Error("template: no extension target, the content blocker did not start");
    await quit(app);
  } finally {
    const down = await quit(app, { graceful: false });
    const xDown = await stopXvfb(xvfb);
    const fDown = await stopFixtures(fixtures);
    if (!down.clean || !xDown || !fDown) throw new Error(`template teardown incomplete (app ${down.clean}, Xvfb ${xDown}, fixtures ${fDown}; leftover ${down.leftover?.join(",")})`);
  }
  await cleanVolatile(dir);
  await writeFile(marker, JSON.stringify({ identity, createdAt: new Date().toISOString(), waitSeconds, validation }, null, 2));
  return { dir, reused: false, validation };
}

export { evaluate };
