#!/usr/bin/env node
// Builds the phone's release bundles with Metro (expo export:embed, Android and iOS) for a commit from each install era,
// so a change to the install layout or the Metro config can't leave a revision that no longer bundles.
//
//   node apps/phone/scripts/bundle-embed-check.ts [--root REPO] [--commit REV]… [--platform android|ios]… [--working-tree]
//
// Without --commit it checks HEAD and the last commit before Bun (the parent of the commit that took the pnpm pin out
// of apps/phone/package.json). Each commit is bundled from a bundle-export.ts export, so the offline install and the
// Metro config wrapping are the ones corex-build and build-apk use. --working-tree also bundles this checkout's
// apps/phone in place, where the desktop workspace's node_modules sit beside the phone's. Every bundle's source map
// must name only files from apps/phone, packages/phone and packages/core, with node_modules only inside
// apps/phone/node_modules. Prints one line a bundle and exits 1 when one fails.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExport, removeExport } from "./bundle-export.ts";

export const PLATFORMS = ["android", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

export function lastCommitBeforeBun(root: string): string | undefined {
  const switched = execFileSync("git", ["log", "-1", "--format=%H", "-G", '"packageManager": "pnpm@', "HEAD", "--", "apps/phone/package.json"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (!switched) return undefined;
  const pinned = execFileSync("git", ["show", `${switched}:apps/phone/package.json`], { cwd: root, encoding: "utf8" });
  if (pinned.includes('"packageManager": "pnpm@')) return undefined;
  return execFileSync("git", ["rev-parse", `${switched}^`], { cwd: root, encoding: "utf8" }).trim();
}

export function strayModules(sources: string[], root: string): string[] {
  const allowed = ["apps/phone", "packages/phone", "packages/core"].map((folder) => path.join(root, folder) + path.sep);
  const phoneModules = path.join(root, "apps/phone/node_modules") + path.sep;
  return sources.filter((source) => {
    if (!path.isAbsolute(source)) return false;
    if (source.startsWith(phoneModules)) return false;
    if (!allowed.some((folder) => source.startsWith(folder))) return true;
    return source.split(path.sep).includes("node_modules");
  });
}

type SourceMap = { sources?: string[]; sections?: { map: SourceMap }[] };

export function mapSources(map: SourceMap, phone: string): string[] {
  const own = (map.sources ?? []).filter((name) => name.startsWith("/")).map((name) => path.join(phone, name));
  return [...own, ...(map.sections ?? []).flatMap((section) => mapSources(section.map, phone))];
}

function bundle(root: string, platform: Platform, work: string): { ok: boolean; detail: string } {
  const phone = path.join(root, "apps/phone");
  const out = fs.mkdtempSync(path.join(work, `${platform}-`));
  const node = process.execPath;
  const entry = execFileSync(node, ["-e", "require('expo/scripts/resolveAppEntry')", phone, platform, "absolute"], { cwd: phone, encoding: "utf8" }).trim().split("\n").pop()!;
  const cli = execFileSync(node, ["--print", "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })"], { cwd: phone, encoding: "utf8" }).trim();
  const map = path.join(out, "main.map");
  const log = path.join(out, "bundle.log");
  const run = spawnSync(
    node,
    [cli, "export:embed", "--entry-file", entry, "--platform", platform, "--dev", "false", "--reset-cache", "--minify", "false",
      "--bundle-output", path.join(out, "main.bundle"), "--sourcemap-output", map, "--assets-dest", path.join(out, "assets")],
    { cwd: phone, env: { ...process.env, EXPO_PUBLIC_ARDIA_LAB: "false", CI: "1" }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  fs.writeFileSync(log, `${run.stdout ?? ""}${run.stderr ?? ""}`);
  if (run.status !== 0) {
    const reason = `${run.stdout}${run.stderr}`.split("\n").find((line) => /Unable to resolve|Error:/.test(line)) ?? `exit ${run.status ?? run.signal}`;
    return { ok: false, detail: `${reason.trim()} (log: ${log})` };
  }
  const sources = mapSources(JSON.parse(fs.readFileSync(map, "utf8")) as SourceMap, phone);
  const stray = strayModules(sources, fs.realpathSync(root));
  if (stray.length) return { ok: false, detail: `${stray.length} modules from outside the phone's install, first ${stray[0]}` };
  return { ok: true, detail: `${sources.length} modules, ${fs.statSync(path.join(out, "main.bundle")).size} bytes` };
}

function options(argv: string[], name: string): string[] {
  return argv.flatMap((argument, index) => (argument === name && argv[index + 1] ? [argv[index + 1]] : []));
}

function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    const lines = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
    console.log(lines.filter((line) => line.startsWith("//")).map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
    return 0;
  }
  const root = options(argv, "--root")[0] ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const platforms = options(argv, "--platform") as Platform[];
  const unknown = platforms.filter((platform) => !PLATFORMS.includes(platform));
  if (unknown.length) {
    console.error(`--platform takes ${PLATFORMS.join(" or ")}, not ${unknown.join(", ")}`);
    return 64;
  }
  let commits = options(argv, "--commit");
  if (!commits.length) {
    const beforeBun = lastCommitBeforeBun(root);
    if (!beforeBun) console.log("no commit before Bun in this history: checking HEAD only");
    commits = beforeBun ? ["HEAD", beforeBun] : ["HEAD"];
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ardia-embed-check-"));
  let failed = 0;
  const report = (label: string, platform: Platform, result: { ok: boolean; detail: string }) => {
    if (!result.ok) failed += 1;
    console.log(`${result.ok ? "ok  " : "FAIL"} ${label} ${platform}: ${result.detail}`);
  };
  for (const rev of commits) {
    let made: { dir: string; commit: string } | undefined;
    try {
      made = createExport(root, rev);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${rev}: the export did not install: ${(error as Error).message.split("\n")[0]}`);
      continue;
    }
    try {
      for (const platform of platforms.length ? platforms : PLATFORMS) report(made.commit.slice(0, 9), platform, bundle(made.dir, platform, work));
    } finally {
      removeExport(made.dir);
    }
  }
  if (argv.includes("--working-tree")) {
    for (const platform of platforms.length ? platforms : PLATFORMS) report("working tree", platform, bundle(root, platform, work));
  }
  if (!failed) fs.rmSync(work, { recursive: true, force: true });
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
