import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const CLK_TCK = (() => {
  try {
    return Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100;
  } catch {
    return 100;
  }
})();

function readStat(path) {
  const text = readFileSync(path, "utf8");
  const close = text.lastIndexOf(")");
  const comm = text.slice(text.indexOf("(") + 1, close);
  const fields = text.slice(close + 2).split(" ");
  return { comm, ppid: Number(fields[1]), sid: Number(fields[3]), ticks: Number(fields[11]) + Number(fields[12]), start: Number(fields[19]) };
}

function readCtxOf(path) {
  const status = readFileSync(path, "utf8");
  const v = status.match(/^voluntary_ctxt_switches:\s+(\d+)/m);
  const n = status.match(/^nonvoluntary_ctxt_switches:\s+(\d+)/m);
  return Number(v?.[1] ?? 0) + Number(n?.[1] ?? 0);
}

function threadClass(comm) {
  if (comm === "Compositor") return "compositor";
  if (/^ThreadPool/.test(comm)) return "threadpool";
  if (/^VizCompositor/.test(comm)) return "viz";
  if (/^Chrome_ChildIOT|^Chrome_IOThread/.test(comm)) return "io";
  return "other";
}

function readThreads(pid, errors) {
  const out = {};
  let tids;
  try {
    tids = readdirSync(`/proc/${pid}/task`);
  } catch {
    return null;
  }
  for (const tid of tids) {
    try {
      const s = readStat(`/proc/${pid}/task/${tid}/stat`);
      const ctx = readCtxOf(`/proc/${pid}/task/${tid}/status`);
      out[tid] = { cls: Number(tid) === pid ? "main" : threadClass(s.comm), ticks: s.ticks, start: s.start, ctx };
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") errors.count++;
    }
  }
  return out;
}

function readCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function readCgroupUsage(path) {
  if (!path) return null;
  try {
    const m = readFileSync(`${path}/cpu.stat`, "utf8").match(/^usage_usec\s+(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function readCgroupPids(path) {
  if (!path) return null;
  try {
    return readFileSync(`${path}/cgroup.procs`, "utf8").split("\n").filter(Boolean).map(Number);
  } catch {
    return null;
  }
}

export function parseCpuList(text) {
  const out = [];
  for (const part of String(text).split(",")) {
    const [a, b] = part.split("-").map(Number);
    for (let c = a; c <= (Number.isFinite(b) ? b : a); c++) out.push(c);
  }
  return out;
}

function readCoreBusy(cpus) {
  try {
    const lines = readFileSync("/proc/stat", "utf8").split("\n");
    let busy = 0;
    for (const cpu of cpus) {
      const line = lines.find((l) => l.startsWith(`cpu${cpu} `));
      if (!line) continue;
      const f = line.trim().split(/\s+/).slice(1).map(Number);
      busy += f[0] + f[1] + f[2] + f[5] + f[6] + f[7];
    }
    return busy;
  } catch {
    return null;
  }
}

const UTILITY_NAMES = { "network.mojom.NetworkService": "network", "storage.mojom.StorageService": "storage", "audio.mojom.AudioService": "audio", "video_capture.mojom.VideoCaptureService": "video-capture", "data_decoder.mojom.DataDecoderService": "data-decoder" };

export function classify(cmdline, { pid, rootPid, shellPids }) {
  const joined = cmdline.join(" ");
  if (/chrome_crashpad_handler/.test(cmdline[0] ?? "")) return "crashpad";
  if (/(^|\/)(taskset|systemd-run)$/.test(cmdline[0] ?? "")) return "launcher";
  const type = joined.match(/--type=(\S+)/)?.[1];
  if (!type) return pid === rootPid ? "browser" : "other";
  if (type === "zygote") return "zygote";
  if (type === "gpu-process") return "gpu";
  if (type === "utility") {
    const sub = joined.match(/--utility-sub-type=(\S+)/)?.[1] ?? "unknown";
    return `utility:${UTILITY_NAMES[sub] ?? sub.split(".").pop().toLowerCase()}`;
  }
  if (type === "renderer") {
    if (joined.includes("--extension-process")) return "extension";
    if (shellPids.has(pid)) return "shell";
    return "page";
  }
  return `other:${type}`;
}

function workerMain() {
  const { rootPid, intervalMs, cgroup, cpus, aux } = workerData;
  const coreList = parseCpuList(cpus);
  let rootSid = null;
  const shellPids = new Set();
  const members = new Map();
  const outsiders = new Set();
  const samples = [];
  const errors = { count: 0 };
  let timer = null;

  const uptimeTicks = () => Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * CLK_TCK;

  function admit(pid) {
    let stat;
    try {
      stat = readStat(`/proc/${pid}/stat`);
    } catch {
      return;
    }
    members.set(pid, { start: stat.start, cmdline: readCmdline(pid), comm: stat.comm });
  }

  function discover() {
    const inGroup = readCgroupPids(cgroup);
    if (inGroup) {
      for (const pid of inGroup) if (!members.has(pid)) admit(pid);
      return;
    }
    let entries;
    try {
      entries = readdirSync("/proc");
    } catch {
      return;
    }
    const alive = new Set();
    for (const name of entries) {
      if (name.charCodeAt(0) < 48 || name.charCodeAt(0) > 57) continue;
      const pid = Number(name);
      alive.add(pid);
      if (members.has(pid) || outsiders.has(pid)) continue;
      let stat;
      try {
        stat = readStat(`/proc/${pid}/stat`);
      } catch {
        continue;
      }
      if (pid === rootPid) rootSid = stat.sid;
      const isMember = pid === rootPid || (rootSid !== null && stat.sid === rootSid && rootSid === rootPid) || members.has(stat.ppid);
      if (isMember) members.set(pid, { start: stat.start, cmdline: readCmdline(pid), comm: stat.comm });
      else outsiders.add(pid);
    }
    for (const pid of outsiders) if (!alive.has(pid)) outsiders.delete(pid);
  }

  function sample() {
    const t = Date.now();
    if (rootSid === null) {
      try {
        rootSid = readStat(`/proc/${rootPid}/stat`).sid;
      } catch {}
    }
    discover();
    const up = uptimeTicks();
    const group = readCgroupUsage(cgroup);
    const cores = readCoreBusy(coreList);
    const procs = {};
    for (const [pid, info] of members) {
      let stat;
      try {
        stat = readStat(`/proc/${pid}/stat`);
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") errors.count++;
        members.delete(pid);
        continue;
      }
      if (stat.start !== info.start) {
        members.delete(pid);
        continue;
      }
      if (info.cmdline.length === 0) info.cmdline = readCmdline(pid);
      const threads = readThreads(pid, errors);
      procs[pid] = { start: stat.start, ticks: stat.ticks, threads };
    }
    const auxTicks = {};
    for (const [name, pid] of Object.entries(aux ?? {})) {
      try {
        auxTicks[name] = readStat(`/proc/${pid}/stat`).ticks;
      } catch {}
    }
    const at = Date.now();
    samples.push({ at, readMs: at - t, up, group, cores, procs, aux: auxTicks, errors: errors.count });
    return samples.length - 1;
  }

  const kinds = new Map();
  function kindOf(pid) {
    const info = members.get(pid) ?? kinds.get(pid);
    if (!info) return "other";
    return classify(info.cmdline, { pid, rootPid, shellPids });
  }

  function remember() {
    for (const [pid, info] of members) kinds.set(pid, info);
  }

  function windowStats(a, b) {
    remember();
    const first = samples[a];
    const last = samples[b];
    const seconds = (last.at - first.at) / 1000;
    const perProc = new Map();
    const perThread = new Map();
    let maxGapMs = 0;
    for (let i = a; i <= b; i++) {
      if (i > a) maxGapMs = Math.max(maxGapMs, samples[i].at - samples[i - 1].at);
      for (const [pidText, p] of Object.entries(samples[i].procs)) {
        const pid = Number(pidText);
        const key = `${pid}:${p.start}`;
        let entry = perProc.get(key);
        if (!entry) {
          const atStart = i === a;
          const bornInside = !atStart && p.start >= first.up - CLK_TCK;
          entry = { pid, base: atStart ? p.ticks : bornInside ? 0 : p.ticks, last: p.ticks, born: bornInside, lateSeen: !atStart && !bornInside };
          perProc.set(key, entry);
        } else entry.last = p.ticks;
        for (const [tid, t] of Object.entries(p.threads ?? {})) {
          const tkey = `${key}:${tid}:${t.start}`;
          let te = perThread.get(tkey);
          if (!te) {
            const atStart = i === a;
            const bornInside = !atStart && t.start >= first.up - CLK_TCK;
            te = { pid, cls: t.cls, baseTicks: atStart || !bornInside ? t.ticks : 0, baseCtx: atStart || !bornInside ? t.ctx : 0, lastTicks: t.ticks, lastCtx: t.ctx };
            perThread.set(tkey, te);
          } else {
            te.lastTicks = t.ticks;
            te.lastCtx = t.ctx;
          }
        }
      }
    }
    const byKind = {};
    const total = { cpuPct: 0, ctxPerS: 0, procs: 0 };
    let lateSeen = 0;
    for (const e of perProc.values()) {
      const kind = kindOf(e.pid);
      const cpu = ((e.last - e.base) / CLK_TCK / seconds) * 100;
      const k = (byKind[kind] ??= { cpuPct: 0, ctxPerS: 0, procs: 0 });
      k.cpuPct += cpu;
      k.procs += 1;
      total.cpuPct += cpu;
      total.procs += 1;
      if (e.lateSeen) lateSeen++;
    }
    const shellThreads = {};
    for (const t of perThread.values()) {
      const kind = kindOf(t.pid);
      const ctx = (t.lastCtx - t.baseCtx) / seconds;
      byKind[kind].ctxPerS += ctx;
      total.ctxPerS += ctx;
      if (shellPids.has(t.pid)) shellThreads[t.cls] = (shellThreads[t.cls] ?? 0) + ((t.lastTicks - t.baseTicks) / CLK_TCK / seconds) * 100;
    }
    const sampled = total.cpuPct;
    if (first.group !== null && last.group !== null) {
      total.cpuPct = ((last.group - first.group) / 1e6 / seconds) * 100;
      byKind.unattributed = { cpuPct: total.cpuPct - sampled, ctxPerS: 0, procs: 0 };
    }
    byKind.total = total;
    const auxCpu = {};
    for (const name of Object.keys(last.aux ?? {})) {
      if (first.aux?.[name] === undefined) continue;
      auxCpu[name] = ((last.aux[name] - first.aux[name]) / CLK_TCK / seconds) * 100;
    }
    let contention = null;
    if (first.cores !== null && last.cores !== null) {
      const coresPct = ((last.cores - first.cores) / CLK_TCK / seconds) * 100;
      const ours = total.cpuPct + Object.values(auxCpu).reduce((s, v) => s + v, 0);
      contention = { coresBusyPct: coresPct, foreignPct: Math.max(0, coresPct - ours), cores: coreList.length };
    }
    return {
      seconds,
      samples: b - a + 1,
      sampling: { maxGapMs, readErrors: last.errors - first.errors, lateSeen, cgroup: first.group !== null, maxReadMs: Math.max(...samples.slice(a, b + 1).map((s) => s.readMs)) },
      byKind,
      shellThreads,
      aux: auxCpu,
      contention,
    };
  }

  function current() {
    remember();
    return [...members.entries()].map(([pid, info]) => ({ pid, kind: classify(info.cmdline, { pid, rootPid, shellPids }), cmdline: info.cmdline }));
  }

  function ticksOf(pids) {
    const out = {};
    for (const pid of pids) {
      try {
        out[pid] = readStat(`/proc/${pid}/stat`).ticks;
      } catch {}
    }
    return out;
  }

  parentPort.on("message", ({ id, op, args }) => {
    let result;
    try {
      if (op === "start") {
        sample();
        timer = setInterval(sample, intervalMs);
        result = true;
      } else if (op === "mark") result = sample();
      else if (op === "window") result = windowStats(args.a, args.b);
      else if (op === "shell") {
        for (const pid of args.pids) shellPids.add(pid);
        result = true;
      } else if (op === "current") {
        discover();
        result = current();
      } else if (op === "ticks") result = ticksOf(args.pids);
      else if (op === "stop") {
        clearInterval(timer);
        result = true;
      }
      parentPort.postMessage({ id, result });
    } catch (error) {
      parentPort.postMessage({ id, error: error.message });
    }
  });
}

export class ProcSampler {
  constructor(rootPid, { intervalMs = 1000, cgroup = null, cpus = "", aux = {} } = {}) {
    this.worker = new Worker(new URL(import.meta.url), { workerData: { rootPid, intervalMs, cgroup, cpus, aux } });
    this.worker.unref();
    this.next = 1;
    this.pending = new Map();
    this.worker.on("message", ({ id, result, error }) => {
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
    });
    this.worker.on("error", (error) => {
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    });
  }

  call(op, args = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sampler ${op} timed out`));
      }, 30000);
      this.pending.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
      this.worker.postMessage({ id, op, args });
    });
  }

  start() { return this.call("start"); }
  mark() { return this.call("mark"); }
  window(a, b) { return this.call("window", { a, b }); }
  setShell(pids) { return this.call("shell", { pids }); }
  current() { return this.call("current"); }
  ticks(pids) { return this.call("ticks", { pids }); }
  async stop() {
    await this.call("stop").catch(() => {});
    await this.worker.terminate().catch(() => {});
  }
}

export function memoryByKind(processes) {
  const byKind = {};
  const total = { pssMiB: 0, ussMiB: 0, procs: 0 };
  let readErrors = 0;
  for (const { pid, kind } of processes) {
    let text;
    try {
      text = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") readErrors++;
      continue;
    }
    const field = (name) => Number(text.match(new RegExp(`^${name}:\\s+(\\d+) kB`, "m"))?.[1] ?? NaN);
    const pssKb = field("Pss");
    const ussKb = field("Private_Clean") + field("Private_Dirty");
    if (!Number.isFinite(pssKb) || !Number.isFinite(ussKb)) {
      readErrors++;
      continue;
    }
    const k = (byKind[kind] ??= { pssMiB: 0, ussMiB: 0, procs: 0 });
    k.pssMiB += pssKb / 1024;
    k.ussMiB += ussKb / 1024;
    k.procs += 1;
    total.pssMiB += pssKb / 1024;
    total.ussMiB += ussKb / 1024;
    total.procs += 1;
  }
  byKind.total = total;
  return { byKind, readErrors, expected: processes.length };
}

if (!isMainThread && workerData?.rootPid) workerMain();
