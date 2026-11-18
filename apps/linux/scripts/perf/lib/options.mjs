import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readBuildInfo } from "./instance.mjs";

export function parse(argv) {
  const out = { _: [], settings: [] };
  const flags = new Set(["fresh-templates", "keep-profiles", "no-split", "help", "all"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") out.help = true;
    else if (a.startsWith("--")) {
      const name = a.slice(2);
      if (flags.has(name)) out[name] = true;
      else if (name === "settings") out.settings.push(argv[++i]);
      else out[name] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

export function parseSettings(list) {
  const patch = {};
  for (const item of list) {
    const eq = item.indexOf("=");
    if (eq < 1) throw new Error(`--settings wants key=value, got ${item}`);
    const raw = item.slice(eq + 1);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    patch[item.slice(0, eq)] = value;
  }
  return patch;
}

export function parseBuilds(text) {
  if (!text) throw new Error("--builds label=dir[,label=dir...] is required");
  const builds = text.split(",").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq < 1) throw new Error(`bad --builds entry ${pair}`);
    const label = pair.slice(0, eq);
    const dir = resolve(pair.slice(eq + 1));
    if (!/^[A-Za-z0-9_.-]+$/.test(label)) throw new Error(`build label ${label} must be [A-Za-z0-9_.-]`);
    if (!existsSync(join(dir, "index.html"))) throw new Error(`${dir} has no index.html`);
    return { label, dir, ...readBuildInfo(dir) };
  });
  if (new Set(builds.map((b) => b.label)).size !== builds.length) throw new Error("build labels must be unique");
  return builds;
}

export function launchOrder(builds, runs) {
  const order = [];
  for (let r = 0; r < runs; r++) {
    const round = r % 2 === 0 ? builds : [...builds].reverse();
    for (const build of round) order.push({ build, run: order.filter((o) => o.build === build).length + 1, block: r + 1 });
  }
  return order;
}
