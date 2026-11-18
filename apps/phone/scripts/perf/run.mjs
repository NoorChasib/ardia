#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `usage: node scripts/perf/run.mjs [--repeats N] [--sizes 50,200,1000] [--only a,b] [--platform ios|android] [--label name] [--cpu-prof dir]
Runs the phone's perf scenarios (scripts/perf/scenarios.perf.tsx) N times in jest's render environment, one process per
repeat, and prints the median and range of each scenario's counts and CPU time. Results land in
scripts/perf/results/<label>.jsonl and <label>.summary.json.`;

if (process.argv.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const repeats = Number(option("repeats", "3"));
const sizes = option("sizes", "50,200,1000");
const only = option("only", "");
const platforms = option("platform", "ios,android").split(",");
const label = option("label", "run");
const cpuProf = option("cpu-prof", "");
const resultsDir = join(here, "results");
mkdirSync(resultsDir, { recursive: true });
const out = join(resultsDir, `${label}.jsonl`);
rmSync(out, { force: true });

for (let repeat = 0; repeat < repeats; repeat++) {
  for (const platform of platforms) {
    const nodeArgs = ["--expose-gc", ...(cpuProf ? ["--cpu-prof", `--cpu-prof-dir=${cpuProf}`] : []), join(app, "node_modules/jest/bin/jest.js"), "--config", join(here, "jest.perf.config.js"), "--ci", "--runInBand", "--silent"];
    const run = spawnSync(process.execPath, nodeArgs, {
      cwd: app,
      env: { ...process.env, PERF_SIZES: sizes, PERF_ONLY: only, PERF_PLATFORM: platform, PERF_OUT: out, PERF_REPEAT: String(repeat) },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.status !== 0) {
      process.stderr.write(run.stdout.slice(-4000) + run.stderr.slice(-4000));
      process.exit(run.status ?? 1);
    }
    process.stderr.write(`repeat ${repeat + 1}/${repeats} ${platform} done\n`);
  }
}

if (!existsSync(out)) {
  console.error(`no scenario matched --only ${only}; the names are those the table prints (and their tests' names)`);
  process.exit(1);
}
const wanted = only ? new Set(only.split(",")) : null;
const rows = readFileSync(out, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((row) => !wanted || wanted.has(row.scenario) || [...wanted].some((name) => row.scenario.startsWith(name)));
const groups = new Map();
for (const row of rows) {
  const key = `${row.platform} ${row.scenario} ${row.size}`;
  groups.set(key, [...(groups.get(key) ?? []), row]);
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const summary = [...groups.entries()].map(([key, list]) => {
  const stat = (field) => ({ median: median(list.map((row) => row[field])), min: Math.min(...list.map((row) => row[field])), max: Math.max(...list.map((row) => row[field])) });
  return { key, n: list.length, commits: stat("commits"), renders: stat("renders"), mounts: stat("mounts"), timers: stat("timers"), frames: stat("frames"), cpuMs: stat("cpuMs") };
});
writeFileSync(join(resultsDir, `${label}.summary.json`), JSON.stringify(summary, null, 2));
const pad = (value, width) => String(value).padStart(width);
console.log(`${"scenario".padEnd(36)}${pad("n", 3)}${pad("commits", 9)}${pad("renders", 9)}${pad("mounts", 8)}${pad("timers", 8)}${pad("frames", 9)}  cpuMs median [min-max]`);
for (const row of summary) {
  const exact = (stat) => (stat.min === stat.max ? stat.median : `${stat.median}~`);
  console.log(`${row.key.padEnd(36)}${pad(row.n, 3)}${pad(exact(row.commits), 9)}${pad(exact(row.renders), 9)}${pad(exact(row.mounts), 8)}${pad(exact(row.timers), 8)}${pad(exact(row.frames), 9)}  ${row.cpuMs.median} [${row.cpuMs.min}-${row.cpuMs.max}]`);
}
