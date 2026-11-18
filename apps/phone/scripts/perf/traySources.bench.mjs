#!/usr/bin/env node
const USAGE = `usage: node scripts/perf/traySources.bench.ts <checkout root> <history rows> [iterations]
Times one page visit followed by the tray-open source work (summary, sources, idle searches) against the
apps/phone of the given checkout, on V8, and prints one JSON line with the median and range in ms.`;

if (process.argv.length < 4 || process.argv.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}

const root = process.argv[2];
const rowCount = Number(process.argv[3]);
const iterations = Number(process.argv[4] ?? 60);
const app = `${root}/apps/phone`;

const { nodeDatabase } = await import(`${app}/test/nodeDatabase.ts`);
const { migrate } = await import(`${app}/src/state/store/schema.ts`);
const { createHistoryLog } = await import(`${app}/src/state/history/historyLog.ts`);
const { buildSources, recentSearches } = await import(`${app}/src/state/search/sources.ts`);
const { mobileSetSources } = await import(`${root}/packages/core/src/mobile.ts`);

const db = nodeDatabase();
migrate(db);
const log = createHistoryLog(db);
let at = 1_000_000;
for (let round = 0; round < 2; round++) for (let i = 0; i < rowCount; i++) log.record(`https://site${i}.example/path/${i}`, `Site ${i} page`, "link", null, (at += 1));
const tabs = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, url: `https://tab${i}.example/`, title: `Tab ${i}`, faviconUrl: null, isPrivate: false }));

const trayOpen = () => {
  const local = log.summary();
  mobileSetSources(buildSources(tabs, local, []));
  recentSearches(local);
};

trayOpen();
const times = [];
for (let i = 0; i < iterations; i++) {
  const began = performance.now();
  const visit = log.record(`https://site${(i * 7919) % rowCount}.example/path/${(i * 7919) % rowCount}`, "", "link", null, (at += 1));
  log.amend(visit, { title: `Visited again ${i}` });
  trayOpen();
  times.push(performance.now() - began);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(JSON.stringify({ root, rows: rowCount, iterations, medianMs: Number(median.toFixed(3)), minMs: Number(times[0].toFixed(3)), maxMs: Number(times[times.length - 1].toFixed(3)) }));
