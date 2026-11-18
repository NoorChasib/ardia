#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const USAGE = `usage: node scripts/perf/hermes-bench.mjs --hermes <path to the hermes CLI> [--runs N] <bench.ts> [more bench files]
Bundles each benchmark file with Bun into one plain script and runs it N times (default 5) in the Hermes CLI with
-O, printing every run's output. A benchmark file imports the code it measures, times it with Date.now() over
enough repeats to reach whole milliseconds, and prints one line per case with print(). Build the CLI that matches
the app's Hermes (sdks/hermes-engine/version.properties) from facebook/hermes's bump-hermes-<version> branch.`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  console.log(USAGE);
  process.exit(0);
}
const take = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const [value] = args.splice(at, 2).slice(1);
  return value;
};
const hermes = take("hermes", process.env.HERMES_CLI ?? "");
const runs = Number(take("runs", "5"));
if (!hermes) {
  console.error("--hermes is required");
  process.exit(2);
}
const bun = process.env.BUN ?? "bun";
const scratch = mkdtempSync(join(tmpdir(), "hermes-bench-"));
try {
  for (const file of args) {
    const out = join(scratch, "bench.js");
    const built = spawnSync(bun, ["build", resolve(file), "--target=browser", "--format=iife", "--minify-syntax", `--outfile=${out}`], { encoding: "utf8" });
    if (built.status !== 0) {
      process.stderr.write(built.stdout + built.stderr);
      process.exit(1);
    }
    for (let run = 0; run < runs; run++) {
      const ran = spawnSync(hermes, ["-O", "-w", out], { encoding: "utf8" });
      if (ran.status !== 0) {
        process.stderr.write(ran.stdout + ran.stderr);
        process.exit(1);
      }
      process.stdout.write(`${file} run ${run + 1}\n${ran.stdout}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
