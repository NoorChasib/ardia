#!/usr/bin/env node
const HELP = `usage: fixtures.mjs [--port P] [--pidfile FILE]

Benchmark fixture pages on 127.0.0.1. Prints {"port":P,"pid":N} once listening.

  /p/<n>       static page: title "Static <n> · Name", colour, favicon, 30 paragraphs
  /t/<n>       ticker: static page plus a 1 s setInterval updating a clock line
  /raf/<n>     canvas redrawn on every requestAnimationFrame
  /heavy/<n>   static page with 5,000 DOM nodes (1,000 rows x 5 cells)
  /favicon/<n> generated SVG favicon
  /slow/<ms>   answers after <ms> (max 600000); ?bench=<token> marks the request
  /pending     {"slow": {token: open requests}} for every /slow request still waiting

Every page carries window.__bench: { kind, n, raf, ticks, vis: [[epochMs, state]], shown: [[visibleAtMs, shownAtMs]],
buckets: {epochMs/100: [rafVisible, rafHidden, ticksVisible, ticksHidden]} } where shown is the second
requestAnimationFrame after a visibilitychange to visible; buckets keep the last 20 minutes.
`;

import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";

const PATTERN = ["static", "static", "ticker", "static", "raf", "static", "static", "ticker", "static", "heavy", "static", "static", "ticker", "static", "static", "static", "ticker", "static", "static", "static"];
const PATHS = { static: "p", ticker: "t", raf: "raf", heavy: "heavy" };
const TITLES = { static: "Static", ticker: "Ticker", raf: "Canvas", heavy: "Heavy" };
const NAMES = ["Harbor", "Meadow", "Lantern", "Quartz", "Juniper", "Atlas", "Ember", "Willow", "Cobalt", "Saffron", "Tundra", "Orchid"];

export const kindOf = (index) => PATTERN[index % PATTERN.length];
export const fixtureNumber = (index) => index + 1;
export const fixturePath = (index) => `/${PATHS[kindOf(index)]}/${fixtureNumber(index)}`;
export const fixtureTitle = (kind, n) => `${TITLES[kind]} ${n} · ${NAMES[(n - 1) % NAMES.length]}`;
export const fixtureTitleAt = (index) => fixtureTitle(kindOf(index), fixtureNumber(index));
export function tabSet(count) {
  return Array.from({ length: count }, (_, index) => ({ index, kind: kindOf(index), path: fixturePath(index), title: fixtureTitleAt(index) }));
}

const hue = (n) => (n * 47) % 360;

const favicon = (n) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="hsl(${hue(n)} 70% 50%)"/><text x="16" y="22" font-size="18" text-anchor="middle" fill="white" font-family="sans-serif">${n}</text></svg>`;

const probe = (kind, n) => `<script>(() => {
  const start = Date.now();
  const b = window.__bench = { kind: ${JSON.stringify(kind)}, n: ${n}, raf: 0, ticks: 0, vis: [[start, document.visibilityState]], shown: [], buckets: {}, oldest: Math.floor(start / 100) };
  b.count = (slot) => {
    const key = Math.floor(Date.now() / 100);
    const e = b.buckets[key] ??= [0, 0, 0, 0];
    e[slot + (document.visibilityState === "hidden" ? 1 : 0)]++;
    while (b.oldest < key - 12000) delete b.buckets[b.oldest++];
  };
  document.addEventListener("visibilitychange", () => {
    const at = Date.now();
    const state = document.visibilityState;
    b.vis.push([at, state]);
    if (b.vis.length > 400) b.vis.splice(1, 200);
    if (state === "visible") requestAnimationFrame(() => requestAnimationFrame(() => { b.shown.push([at, Date.now()]); if (b.shown.length > 400) b.shown.splice(0, 200); }));
  });
})();</script>`;

const head = (kind, n) => {
  const title = fixtureTitle(kind, n);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/favicon/${n}">${probe(kind, n)}<style>body{margin:0;font:16px/1.5 sans-serif;background:hsl(${hue(n)} 60% 92%);color:#222}header{padding:48px;background:hsl(${hue(n)} 70% 50%);color:#fff}h1{margin:0;font-size:48px}main{padding:24px 48px}td{padding:2px 6px;border-bottom:1px solid #ccc}canvas{display:block}</style></head>`;
};

const paragraphs = (n) => {
  const name = NAMES[(n - 1) % NAMES.length];
  return Array.from({ length: 30 }, (_, i) => `<p>${name} paragraph ${i + 1}. The quick brown fox jumps over the lazy dog while the fixture server keeps everything local.</p>`).join("");
};

const pages = {
  static: (n) => `${head("static", n)}<body><header><h1>Static ${n}</h1></header><main>${paragraphs(n)}</main></body></html>`,
  ticker: (n) => `${head("ticker", n)}<body><header><h1>Ticker ${n}</h1><div id="clock">0</div></header><main>${paragraphs(n)}</main><script>(() => { const el = document.getElementById("clock"); setInterval(() => { window.__bench.ticks++; window.__bench.count(2); el.textContent = new Date().toLocaleTimeString() + " · tick " + window.__bench.ticks; }, 1000); })();</script></body></html>`,
  raf: (n) => `${head("raf", n)}<body><header><h1>Canvas ${n}</h1></header><canvas id="c" width="800" height="400"></canvas><main>${paragraphs(n)}</main><script>(() => { const c = document.getElementById("c"); const g = c.getContext("2d"); const frame = (t) => { window.__bench.raf++; window.__bench.count(0); g.fillStyle = "hsl(${hue(n)} 60% 92%)"; g.fillRect(0, 0, 800, 400); for (let i = 0; i < 24; i++) { const a = t / 600 + i / 24 * Math.PI * 2; g.fillStyle = "hsl(" + ((${hue(n)} + i * 15) % 360) + " 70% 50%)"; g.beginPath(); g.arc(400 + Math.cos(a) * 160, 200 + Math.sin(a * 1.3) * 140, 14, 0, Math.PI * 2); g.fill(); } requestAnimationFrame(frame); }; requestAnimationFrame(frame); })();</script></body></html>`,
  heavy: (n) => {
    const rows = Array.from({ length: 1000 }, (_, r) => `<tr><td>${r}</td><td>row ${r}</td><td>${(r * 7919) % 1000}</td><td>${hue(r)}</td><td>cell</td></tr>`).join("");
    return `${head("heavy", n)}<body><header><h1>Heavy ${n}</h1></header><main><table>${rows}</table></main></body></html>`;
  },
};

export function startFixtureServer({ port = 0 } = {}) {
  const pending = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    let match;
    if ((match = url.pathname.match(/^\/(p|t|raf|heavy)\/(\d+)$/))) {
      const kind = Object.keys(PATHS).find((k) => PATHS[k] === match[1]);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(pages[kind](Number(match[2])));
    }
    if ((match = url.pathname.match(/^\/favicon\/(\d+)$/))) {
      res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=3600" });
      return res.end(favicon(Number(match[1])));
    }
    if ((match = url.pathname.match(/^\/slow\/(\d+)$/))) {
      const token = url.searchParams.get("bench");
      if (token) pending.set(token, (pending.get(token) ?? 0) + 1);
      let done = false;
      const finish = () => {
        if (done || !token) return;
        done = true;
        const left = (pending.get(token) ?? 1) - 1;
        if (left > 0) pending.set(token, left);
        else pending.delete(token);
      };
      res.once("close", finish);
      await new Promise((r) => {
        const timer = setTimeout(r, Math.min(Number(match[1]), 600000));
        res.once("close", () => {
          clearTimeout(timer);
          r();
        });
      });
      if (res.destroyed || res.writableEnded) return finish();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Slow ${match[1]}</title><h1>Slow ${match[1]} ms</h1>`);
      return finish();
    }
    if (url.pathname === "/pending") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ slow: Object.fromEntries(pending) }));
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const option = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const server = await startFixtureServer({ port: Number(option("--port") ?? 0) });
  const pidfile = option("--pidfile");
  if (pidfile) await writeFile(pidfile, `${process.pid}\n`);
  process.stdout.write(`${JSON.stringify({ port: server.address().port, pid: process.pid })}\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
}
