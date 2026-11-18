import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

function binomial(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function mannWhitney(a, b) {
  const n1 = a.length;
  const n2 = b.length;
  if (!n1 || !n2) return null;
  const all = [...a, ...b];
  const r = ranks(all);
  const r1 = r.slice(0, n1).reduce((s, x) => s + x, 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const mean = (n1 * n2) / 2;
  if (all.every((v) => v === all[0])) return { u: u1, p: 1, exact: true };
  if (binomial(n1 + n2, n1) <= 200000) {
    const observed = Math.abs(u1 - mean);
    let extreme = 0;
    let total = 0;
    const pick = [];
    const walk = (start, left, sum) => {
      if (left === 0) {
        total++;
        const u = sum - (n1 * (n1 + 1)) / 2;
        if (Math.abs(u - mean) >= observed - 1e-9) extreme++;
        return;
      }
      for (let i = start; i <= r.length - left; i++) {
        pick.push(i);
        walk(i + 1, left - 1, sum + r[i]);
        pick.pop();
      }
    };
    walk(0, n1, 0);
    return { u: u1, p: extreme / total, exact: true };
  }
  const n = n1 + n2;
  const counts = new Map();
  for (const v of all) counts.set(v, (counts.get(v) ?? 0) + 1);
  const tie = [...counts.values()].reduce((s, t) => s + (t ** 3 - t), 0);
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tie / (n * (n - 1))));
  if (!sigma) return { u: u1, p: 1, exact: false };
  const z = (Math.abs(u1 - mean) - 0.5) / sigma;
  return { u: u1, p: Math.min(1, 2 * (1 - normalCdf(Math.max(0, z)))), exact: false };
}

function signTest(diffs) {
  const nonzero = diffs.filter((d) => d !== 0);
  const n = nonzero.length;
  const k = nonzero.filter((d) => d > 0).length;
  if (!n) return { k, n, p: 1 };
  let tail = 0;
  for (let i = 0; i <= Math.min(k, n - k); i++) tail += binomial(n, i);
  return { k, n, p: Math.min(1, (2 * tail) / 2 ** n) };
}

export function listRuns(out) {
  if (!existsSync(out)) return [];
  return readdirSync(out)
    .filter((f) => /^run-.*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(out, f), "utf8")))
    .sort((a, b) => String(a.runId ?? a.stamp).localeCompare(String(b.runId ?? b.stamp)));
}

export function loadResults(out, { run, all = false } = {}) {
  const dir = join(out, "results");
  if (!existsSync(dir)) return { results: [], runs: [] };
  const every = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .map((r) => ({ ...r, runId: r.runId ?? String(r.launchId ?? "").split("-")[0] }));
  const runIds = [...new Set(every.map((r) => r.runId))].sort();
  const chosen = all ? runIds : [run ?? runIds.at(-1)];
  if (!all && run && !runIds.includes(run)) throw new Error(`no results for run ${run} in ${dir} (runs: ${runIds.join(", ")})`);
  const results = every.filter((r) => chosen.includes(r.runId)).sort((a, b) => a.runId.localeCompare(b.runId) || (a.launchIndex ?? 0) - (b.launchIndex ?? 0));
  if (all && chosen.length > 1) {
    const configs = new Set(results.map((r) => r.config ?? "unknown"));
    if (configs.size > 1) throw new Error(`--all: runs differ in measurement settings, engine or blocker (config ${[...configs].join(" / ")}); report them one at a time`);
    for (const label of new Set(results.map((r) => r.label))) {
      const uis = new Set(results.filter((r) => r.label === label).map((r) => r.fingerprint?.ui ?? "unknown"));
      if (uis.size > 1) throw new Error(`--all: label ${label} names different UI builds across runs (${[...uis].map((u) => u.slice(0, 12)).join(", ")})`);
    }
  }
  return { results, runs: chosen };
}

function put(rows, metric, kind, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  if (typeof value !== "number") return;
  rows.push([metric, kind, value]);
}

const ZERO_FILL = [/^CPU %$/, /^ctx switches\/s$/, /^processes$/, /^count /, /^chrome\.send /, /^host event /];
const zeroFillable = (metric, kind) => ZERO_FILL.some((re) => re.test(metric)) && kind !== "unattributed";

export const PRIMARY = new Set([
  "CPU %\u0000total",
  "CPU %\u0000shell",
  "CPU %\u0000gpu",
  "CPU %\u0000page",
  "CPU %\u0000browser",
  "switch key->shown ms median\u0000latency",
  "edge reveal ms median\u0000latency",
  "hover card cold ms median\u0000latency",
  "PSS MiB\u0000total",
  "USS MiB\u0000total",
  "PSS MiB\u0000shell",
]);

export const workloadMatched = (record) => record?.workload?.matched !== false;

export function flattenScenario(record) {
  const rows = flattenWindow(record);
  if (record.workload) for (const [name, v] of Object.entries(record.workload)) put(rows, `workload ${name}`, "workload", typeof v === "boolean" ? Number(v) : v);
  return workloadMatched(record) ? rows : rows.filter(([, kind]) => kind === "latency" || kind === "workload");
}

function flattenWindow(record) {
  const rows = [];
  for (const [kind, v] of Object.entries(record.cpu ?? {})) {
    put(rows, "CPU %", kind, v.cpuPct);
    if (kind !== "unattributed") {
      put(rows, "ctx switches/s", kind, v.ctxPerS);
      put(rows, "processes", kind, v.procs);
    }
  }
  for (const [cls, v] of Object.entries(record.shellThreads ?? {})) put(rows, "CPU %", `shell thread:${cls}`, v);
  for (const [name, v] of Object.entries(record.aux ?? {})) put(rows, "CPU % (outside total)", name, v);
  put(rows, "foreign CPU % on the app's cores", "machine", record.contention?.foreignPct);
  put(rows, "quiet gate wait s", "machine", record.gate?.waitedS);
  for (const [name, v] of Object.entries(record.perf ?? {})) put(rows, `perf ${name}`, "shell main", v);
  for (const [name, v] of Object.entries(record.levels ?? {})) put(rows, `level ${name}`, "shell", v);
  for (const [name, v] of Object.entries(record.counts ?? {})) put(rows, `count ${name}`, "shell", v);
  for (const [name, v] of Object.entries(record.chromeSend ?? {})) put(rows, `chrome.send ${name}`, "shell", v);
  for (const [name, v] of Object.entries(record.hostEvents ?? {})) put(rows, `host event ${name}`, "shell", v);
  if (record.loaf) for (const name of ["count", "blockingMs", "durationMs", "maxMs"]) put(rows, `LoAF ${name}`, "shell", record.loaf[name]);
  for (const [name, v] of Object.entries(record.interactions ?? {})) put(rows, `event timing (shell events >= 16 ms) ${name}`, "shell", v);
  if (record.frames) {
    put(rows, "rAF frames", "shell", record.frames.frames);
    put(rows, "rAF gaps > 25 ms", "shell", record.frames.gapsOver25);
    put(rows, "rAF max gap ms", "shell", record.frames.maxGapMs);
    for (const [bucket, v] of Object.entries(record.frames.gaps ?? {})) put(rows, `rAF gaps ${bucket} ms`, "shell", v);
  }
  if (record.loading) {
    put(rows, "loading pill shown", "state", record.loading.pillShown ? 1 : 0);
    put(rows, "sidebar hidden", "state", record.loading.sidebarHidden ? 1 : 0);
  }
  if (record.switches) {
    const s = record.switches;
    put(rows, "switch key->store ms median", "latency", s.keyToStore?.median);
    put(rows, "switch key->shown ms median", "latency", s.keyToShown?.median);
    put(rows, "switch key->shown ms p90", "latency", s.keyToShown?.p90);
    put(rows, "switch xdotool spawn->shell command ms median", "latency", s.spawnToCommand?.median);
    put(rows, "switch misses", "latency", s.misses);
    for (const name of ["noActivation", "wrongTab", "alreadyVisible", "notShown", "keyNotReceived", "recovered"]) put(rows, `switch ${name}`, "latency", s[name]);
  }
  if (record.reveal) {
    put(rows, "edge reveal ms median", "latency", record.reveal.median);
    put(rows, "edge reveal ms p90", "latency", record.reveal.p90);
    put(rows, "edge reveal misses", "latency", record.reveal.misses);
    put(rows, "edge reveal unarmed", "latency", record.reveal.unarmed);
  }
  if (record.hover) {
    const h = record.hover;
    put(rows, "hover card warm ms median", "latency", h.warm?.median);
    put(rows, "hover card warm ms p90", "latency", h.warm?.p90);
    put(rows, "hover card cold ms median", "latency", h.cold?.median);
    put(rows, "hover card misses", "latency", h.misses);
    put(rows, "hover cards shown", "latency", h.shown);
    put(rows, "hover rows left before the card", "latency", h.superseded);
    put(rows, "hover row entries", "latency", h.entries);
    put(rows, "hover off-row moves", "latency", h.offRow);
  }
  const pages = record.pages;
  if (pages?.byKind) {
    for (const [kind, v] of Object.entries(pages.byKind)) {
      if (kind === "raf") {
        put(rows, "page rAF/s", "raf.visible", v.rafPerVisibleS);
        put(rows, "page rAF/s", "raf.hidden", v.rafPerHiddenS);
      }
      if (kind === "ticker") {
        put(rows, "page timer ticks/s", "ticker.visible", v.ticksPerVisibleS);
        put(rows, "page timer ticks/s", "ticker.hidden", v.ticksPerHiddenS);
      }
      put(rows, "page visible page-s", kind, v.visiblePageS);
      put(rows, "page visibility changes", kind, v.transitions);
    }
    put(rows, "page reads ok", "coverage", pages.coverage?.read);
    put(rows, "page reads expected", "coverage", pages.coverage?.expected);
  }
  put(rows, "load avg 1m start", "machine", record.window?.loadStart?.one);
  put(rows, "load avg 1m end", "machine", record.window?.loadEnd?.one);
  put(rows, "window s", "machine", record.window?.seconds);
  put(rows, "sampler read errors", "machine", record.sampling?.readErrors);
  return rows;
}

export function flattenMemory(memory) {
  const rows = [];
  for (const [kind, v] of Object.entries(memory?.byKind ?? {})) {
    put(rows, "PSS MiB", kind, v.pssMiB ?? v.pssMB);
    put(rows, "USS MiB", kind, v.ussMiB ?? v.ussMB);
  }
  for (const [name, v] of Object.entries(memory?.shell ?? {})) put(rows, `level ${name}`, "shell", v);
  put(rows, "smaps read errors", "machine", memory?.readErrors);
  return rows;
}

const KIND_ORDER = ["total", "browser", "shell", "shell thread:main", "shell thread:compositor", "page", "extension", "gpu", "utility:network", "utility:storage", "utility:audio", "zygote", "crashpad", "unattributed", "other", "shell main", "latency", "coverage", "machine"];
const kindRank = (k) => {
  const i = KIND_ORDER.indexOf(k);
  return i < 0 ? KIND_ORDER.length - 4 : i;
};

function fmt(v) {
  if (v === null || v === undefined) return "-";
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function cell(values) {
  if (!values?.length) return "-";
  return `${fmt(median(values))} (${fmt(Math.min(...values))}-${fmt(Math.max(...values))}, ${values.length})`;
}

function collect(results, pick) {
  const perResult = [];
  for (const result of results) {
    const rows = pick(result);
    if (!rows) continue;
    const map = new Map();
    for (const [metric, kind, value] of rows) map.set(`${metric}\u0000${kind}`, value);
    perResult.push({ result, map });
  }
  const fill = new Set();
  for (const { map } of perResult) for (const id of map.keys()) {
    const [metric, kind] = id.split("\u0000");
    if (zeroFillable(metric, kind)) fill.add(id);
  }
  for (const { result, map } of perResult) {
    for (const id of fill) {
      if (map.has(id)) continue;
      const [metric] = id.split("\u0000");
      const counterFamily = /^(count|chrome\.send|host event) /.test(metric);
      if (counterFamily && result.instrument === "light") continue;
      map.set(id, 0);
    }
  }
  return perResult;
}

function series(perResult, label, id) {
  return perResult.filter((p) => p.result.label === label && p.map.has(id)).map((p) => p.map.get(id));
}

function blockDiffs(perResult, base, other, id) {
  const diffs = [];
  const blocks = new Map();
  for (const p of perResult) {
    if (!p.map.has(id)) continue;
    const key = `${p.result.runId}:${p.result.blockIndex ?? Math.ceil((p.result.launchIndex ?? 0) / 2)}`;
    const b = blocks.get(key) ?? {};
    b[p.result.label] = p.map.get(id);
    blocks.set(key, b);
  }
  for (const b of blocks.values()) if (base in b && other in b) diffs.push(b[other] - b[base]);
  return diffs;
}

function table(title, perResult, labels) {
  const keys = new Map();
  for (const { map } of perResult) for (const id of map.keys()) keys.set(id, id.split("\u0000"));
  const sorted = [...keys.values()].sort((a, b) => a[0].localeCompare(b[0]) || kindRank(a[1]) - kindRank(b[1]) || a[1].localeCompare(b[1]));
  const base = labels[0];
  const header = ["Metric", "Kind", ...labels.map((l) => `${l} median (min-max, n)`), ...labels.slice(1).flatMap((l) => [`Δ ${l}-${base}`, `blocks ${l}>${base}`, `p (sign, blocks)`, `p (MWU)`])];
  const lines = [`### ${title}`, "", `| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const [metric, kind] of sorted) {
    const id = `${metric}\u0000${kind}`;
    const values = labels.map((l) => series(perResult, l, id));
    const deltas = labels.slice(1).flatMap((l, i) => {
      const a = values[0];
      const b = values[i + 1];
      if (!a.length || !b.length) return ["-", "-", "-", "-"];
      const ma = median(a);
      const mb = median(b);
      const pct = ma ? ` (${(((mb - ma) / Math.abs(ma)) * 100).toFixed(1)} %)` : "";
      const test = mannWhitney(a, b);
      const sign = signTest(blockDiffs(perResult, base, l, id));
      return [`${fmt(mb - ma)}${pct}`, `${sign.k}/${sign.n}`, sign.n ? sign.p.toFixed(3) : "-", test ? test.p.toFixed(3) : "-"];
    });
    const name = PRIMARY.has(id) ? `**${metric}**` : metric;
    lines.push(`| ${[name, kind, ...values.map(cell), ...deltas].join(" | ")} |`);
  }
  return lines.join("\n");
}

function spread(values) {
  return values.length ? `${fmt(median(values))} (${fmt(Math.min(...values))}..${fmt(Math.max(...values))}, ${values.length})` : "-";
}

function pairedSection(ok, labels, scenarios, control, residualMax) {
  if (!labels.includes(control)) throw new Error(`--control ${control} is not a build in this run (${labels.join(", ")})`);
  const controlRun = ok.find((r) => r.label === control);
  const aa = labels.filter((l) => l !== control && ok.some((r) => r.label === l && r.fingerprint?.ui === controlRun?.fingerprint?.ui && r.fingerprint?.engine === controlRun?.fingerprint?.engine));
  const others = labels.filter((l) => l !== control && !aa.includes(l));
  const foreignOf = (r, scenario) => r.scenarios?.[scenario]?.contention?.foreignPct;
  const calibration = ok.filter((r) => r.label === control || aa.includes(r.label)).flatMap((r) => scenarios.map((s) => (validWindow(r, s) ? foreignOf(r, s) : null))).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const p90 = calibration.length ? calibration[Math.min(calibration.length - 1, Math.floor(0.9 * calibration.length))] : null;
  const threshold = Number.isFinite(residualMax) ? residualMax : Math.max(5, 2 * (p90 ?? 0));
  const partitions = [...new Set(ok.map((r) => r.partition ?? "none"))];
  const lines = [`## Paired against ${control}`, ""];
  if (partitions.length > 1) throw new Error(`--control: the run mixes partitioned and unpartitioned launches (${partitions.join(", ")})`);
  lines.push(
    `Partition: ${partitions[0]}. A/A pair (same UI and engine sha256 as ${control}): ${aa.join(", ") || "none"}. Residual foreign CPU ceiling ${fmt(threshold)} %${Number.isFinite(residualMax) ? " (given)" : ` (calibrated: max(5, 2 x p90 ${p90 === null ? "-" : fmt(p90)} %) over ${calibration.length} control and A/A windows)`}; windows above it are left out of this section only.`,
    "",
    `Cells: per ABBA block, the build's value minus ${control}'s in the same block; median (min..max, n blocks). "% of ${control}" divides the median by ${control}'s median. The control spread is the largest absolute A/A difference; a build whose median difference is inside it cannot be told apart from noise and is marked "inside".`,
    "",
  );
  const flagged = [];
  const sections = [];
  for (const scenario of scenarios) {
    const usable = ok.filter((r) => {
      if (!validWindow(r, scenario)) return false;
      const f = foreignOf(r, scenario);
      if (typeof f === "number" && f > threshold) {
        flagged.push(`${r.launchId} ${scenario}: ${fmt(f)} % foreign`);
        return false;
      }
      return true;
    });
    sections.push([scenario, collect(usable, (r) => flattenScenario(r.scenarios[scenario]))]);
  }
  sections.push(["Memory at rest", collect(ok.filter((r) => r.memoryAtRest), (r) => flattenMemory(r.memoryAtRest))]);
  sections.push(["Memory at the end", collect(ok.filter((r) => r.memory), (r) => flattenMemory(r.memory))]);
  const header = ["Metric", "Kind", `${control} median`, ...aa.map((l) => `A/A ${l}-${control}`), ...others.flatMap((l) => [`${l}-${control}`, `% of ${control}`, "vs control spread"])];
  for (const [name, perResult] of sections) {
    const ids = [...new Set(perResult.flatMap((p) => [...p.map.keys()]))].filter((id) => PRIMARY.has(id) || /^CPU %\u0000shell thread:main$/.test(id) || /^count (rafCallbacks|getBoundingClientRect|getComputedStyle)\u0000/.test(id));
    if (!ids.length) continue;
    lines.push(`### ${name}`, "", `| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`);
    for (const id of ids.sort()) {
      const [metric, kind] = id.split("\u0000");
      const base = series(perResult, control, id);
      const aaDiffs = aa.map((l) => blockDiffs(perResult, control, l, id));
      const bound = Math.max(0, ...aaDiffs.flat().map(Math.abs));
      const cells = others.flatMap((l) => {
        const d = blockDiffs(perResult, control, l, id);
        if (!d.length) return ["-", "-", "-"];
        const m = median(d);
        const mb = median(base);
        const pct = mb ? `${((m / Math.abs(mb)) * 100).toFixed(1)} %` : "-";
        const verdict = !aaDiffs.flat().length ? "no A/A" : Math.abs(m) > bound ? `beyond (${fmt(bound)})` : `inside (${fmt(bound)})`;
        return [spread(d), pct, verdict];
      });
      lines.push(`| ${[PRIMARY.has(id) ? `**${metric}**` : metric, kind, base.length ? fmt(median(base)) : "-", ...aaDiffs.map(spread), ...cells].join(" | ")} |`);
    }
    lines.push("");
  }
  if (flagged.length) lines.push(`### Windows over the residual ceiling (left out of this section)`, "", ...flagged.map((n) => `- ${n}`), "");
  return lines;
}

function validWindow(result, scenario) {
  const record = result.scenarios?.[scenario];
  return record && record.valid !== false ? record : null;
}

export function buildReport(out, options = {}) {
  const { results: all, runs } = loadResults(out, options);
  const ok = all.filter((r) => r.ok);
  const failed = all.filter((r) => !r.ok);
  const labels = [...new Set(all.map((r) => r.label))];
  const scenarios = [...new Set(ok.flatMap((r) => Object.keys(r.scenarios ?? {})))].sort();
  const lines = ["# Ardia Linux benchmark report", ""];
  lines.push(`Results: \`${out}\`, run${runs.length > 1 ? "s" : ""} ${runs.join(", ")}. ${ok.length} launches ok, ${failed.length} failed.`, "");
  lines.push("| Build | Dir | Commit | UI sha256 | Launches ok | Tabs loaded | Load avg 1m at launch (min-max) |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const label of labels) {
    const mine = ok.filter((r) => r.label === label);
    const any = all.find((r) => r.label === label);
    const loads = mine.map((r) => r.loadAtLaunch?.one).filter((v) => typeof v === "number");
    lines.push(`| ${label} | \`${any.build}\` | ${any.commit ? any.commit.slice(0, 12) : "-"} | ${any.fingerprint?.ui?.slice(0, 12) ?? "-"} | ${mine.length} | ${[...new Set(mine.map((r) => r.tabsLoaded))].join(", ") || "-"} | ${loads.length ? `${fmt(Math.min(...loads))}-${fmt(Math.max(...loads))}` : "-"} |`);
  }
  const gpus = [...new Set(ok.map((r) => r.gpu?.renderer ?? r.gpu?.error ?? "unknown"))];
  const engines = [...new Set(ok.map((r) => r.fingerprint?.engine?.slice(0, 12) ?? "unknown"))];
  lines.push("", `GPU (GL renderer): ${gpus.join("; ")}. Engine chrome sha256: ${engines.join(", ")}. CPUs for the app: ${[...new Set(ok.map((r) => r.cpus))].join(", ")}. Scope: ${[...new Set(ok.map((r) => r.scopeMode ?? "-"))].join(", ")}. Partition (rest|bench): ${[...new Set(ok.map((r) => r.partition ?? "none"))].join(", ")}. Instrumentation: ${[...new Set(ok.map((r) => r.instrument ?? "full"))].join(", ")}.`);
  lines.push(
    "",
    "Cells: median (min-max, n) over launches. Δ is the difference of medians against the first build. `blocks` counts the ABBA blocks (one launch of each build, back to back) where the other build was higher, with a two-sided sign test over those blocks; MWU is a two-sided Mann-Whitney U test over all launches that ignores the blocks. Bold rows are the prespecified primary metrics; every other row is exploratory, and with this many rows some p-values below 0.05 are expected by chance. Counters, CPU, context switches and process counts read 0 when a launch measured the window and saw none.",
    "",
  );
  const sequence = all.map((r) => `${r.label}${r.ok ? "" : "(failed)"}`).join(" ");
  lines.push(`Launch order: ${sequence}`, "");
  const invalid = [];
  const unmatched = [];
  for (const scenario of scenarios) {
    const usable = ok.filter((r) => validWindow(r, scenario));
    for (const r of ok) if (r.scenarios?.[scenario] && !validWindow(r, scenario)) invalid.push(`${r.launchId} ${scenario}: ${r.scenarios[scenario].invalidReason}`);
    for (const r of usable) if (!workloadMatched(r.scenarios[scenario])) unmatched.push(`${r.launchId} ${scenario}: ${JSON.stringify(r.scenarios[scenario].workload)}`);
    const perResult = collect(usable, (r) => flattenScenario(r.scenarios[scenario]));
    lines.push(table(scenario, perResult, labels), "");
  }
  const atRest = collect(ok.filter((r) => r.memoryAtRest), (r) => flattenMemory(r.memoryAtRest));
  if (atRest.length) lines.push(table("Memory at rest (all tabs loaded and settled, shell GC + 10 s, before S1), MiB", atRest, labels), "");
  const memory = collect(ok.filter((r) => r.memory), (r) => flattenMemory(r.memory));
  lines.push(table("Memory at the end of the run (after shell GC + 10 s; depends on which scenarios ran and repeated), MiB", memory, labels), "");
  if (invalid.length) lines.push("### Windows left out (not comparable)", "", ...invalid.map((n) => `- ${n}`), "");
  if (unmatched.length) lines.push("### Windows left out of the CPU and counter rows (their interaction work differed: recoveries in S3, reveals or hides that didn't happen in S4); their latency and workload rows stay", "", ...unmatched.map((n) => `- ${n}`), "");
  if (failed.length) {
    lines.push("### Failed launches", "");
    for (const r of failed) lines.push(`- ${r.launchId} (${r.label}, attempt ${r.attempt}): ${r.error}`);
    lines.push("");
  }
  const notes = ok.flatMap((r) => (r.notes ?? []).map((n) => `${r.launchId}: ${n}`));
  if (notes.length) lines.push("### Notes", "", ...notes.map((n) => `- ${n}`), "");
  if (options.control) lines.push(...pairedSection(ok, labels, scenarios, options.control, options.residualMax));
  return lines.join("\n");
}

function verdict(rangePct, abs) {
  if (abs === 0) return "exact";
  if (rangePct === null) return "near zero";
  if (rangePct <= 5) return "tight";
  if (rangePct <= 15) return "usable";
  if (rangePct <= 35) return "noisy";
  return "unusable";
}

export function noiseRows(perResult, labels) {
  const [a, b] = labels;
  const keys = new Map();
  for (const { map } of perResult) for (const id of map.keys()) keys.set(id, id.split("\u0000"));
  const rows = [];
  for (const [id, [metric, kind]] of keys) {
    const va = series(perResult, a, id);
    const vb = series(perResult, b, id);
    const pooled = [...va, ...vb];
    if (pooled.length < 2) continue;
    const m = median(pooled);
    const lo = Math.min(...pooled);
    const hi = Math.max(...pooled);
    const range = hi - lo;
    const mad = median(pooled.map((v) => Math.abs(v - m)));
    const delta = va.length && vb.length ? median(vb) - median(va) : null;
    const rangePct = Math.abs(m) > 1e-9 ? (range / Math.abs(m)) * 100 : null;
    const deltaPct = delta !== null && Math.abs(m) > 1e-9 ? (Math.abs(delta) / Math.abs(m)) * 100 : null;
    const floor = Math.max(range, delta === null ? 0 : 2 * Math.abs(delta));
    rows.push({ id, metric, kind, n: pooled.length, median: m, lo, hi, range, rangePct, madPct: Math.abs(m) > 1e-9 ? (mad / Math.abs(m)) * 100 : null, delta, deltaPct, floor, floorPct: Math.abs(m) > 1e-9 ? (floor / Math.abs(m)) * 100 : null, verdict: verdict(rangePct, range), primary: PRIMARY.has(id) });
  }
  return rows.sort((x, y) => x.metric.localeCompare(y.metric) || kindRank(x.kind) - kindRank(y.kind) || x.kind.localeCompare(y.kind));
}

export function buildNoise(out, options = {}) {
  const { results: all, runs } = loadResults(out, options);
  const ok = all.filter((r) => r.ok);
  const labels = [...new Set(all.map((r) => r.label))];
  if (labels.length !== 2) throw new Error(`noise wants exactly two labels (an A/A pair), found ${labels.join(", ")}`);
  const uis = new Set(ok.map((r) => r.fingerprint?.ui));
  const lines = ["# A/A noise floor", ""];
  lines.push(`Run ${runs.join(", ")} in \`${out}\`: ${labels.join(" vs ")}, ${ok.length} launches ok of ${all.length}. UI sha256 ${[...uis].map((u) => String(u).slice(0, 12)).join(", ")}${uis.size === 1 ? " (identical builds)" : " (NOT identical)"}.`, "");
  lines.push(
    "Per metric over all launches of both labels: median, min-max, range as % of the median, MAD as % of the median, the A/A difference of medians, and the floor: the larger of the pooled range and twice the A/A difference. A real difference smaller than the floor cannot separate the two sides' ranges at this n, so treat it as noise. Verdict by range: exact 0, tight <= 5 %, usable <= 15 %, noisy <= 35 %, unusable above. Rows whose median is 0 show only absolute values.",
    "",
  );
  const sections = [];
  const scenarios = [...new Set(ok.flatMap((r) => Object.keys(r.scenarios ?? {})))].sort();
  for (const scenario of scenarios) sections.push([scenario, collect(ok.filter((r) => validWindow(r, scenario)), (r) => flattenScenario(r.scenarios[scenario]))]);
  if (ok.some((r) => r.memoryAtRest)) sections.push(["Memory at rest", collect(ok.filter((r) => r.memoryAtRest), (r) => flattenMemory(r.memoryAtRest))]);
  sections.push(["Memory at the end", collect(ok.filter((r) => r.memory), (r) => flattenMemory(r.memory))]);
  const pct = (v) => (v === null ? "-" : `${v.toFixed(1)} %`);
  const summaryRows = [];
  for (const [name, perResult] of sections) {
    const rows = noiseRows(perResult, labels);
    lines.push(`### ${name}`, "", "| Metric | Kind | n | median | min-max | range | MAD | A/A Δ | floor (abs) | floor | verdict |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of rows) {
      lines.push(`| ${r.primary ? `**${r.metric}**` : r.metric} | ${r.kind} | ${r.n} | ${fmt(r.median)} | ${fmt(r.lo)}-${fmt(r.hi)} | ${pct(r.rangePct)} | ${pct(r.madPct)} | ${r.delta === null ? "-" : fmt(r.delta)} | ${fmt(r.floor)} | ${pct(r.floorPct)} | ${r.verdict} |`);
      summaryRows.push({ scenario: name, ...r });
    }
    lines.push("");
  }
  const counts = {};
  for (const r of summaryRows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  lines.splice(4, 0, `Verdicts over ${summaryRows.length} rows: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}.`, "");
  return lines.join("\n");
}
