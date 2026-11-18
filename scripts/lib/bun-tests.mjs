#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const HELP = `Runs a suite with bun test, plus the files that must stay on node --test.

  bun scripts/lib/bun-tests.mjs [--node-only=<list.json>] [--default=<path>]... [--junit=<dir>] [--shard=N/M]
                                [-t <pattern>] [<bun test flags>...] [<./path>...]

  --node-only=<list.json>  {"node": [node flags], "files": {"<path>": "why it needs Node"}}: those files are left out
                           of bun test and run with node <flags> --test <files>, from the current directory
  --default=<path>         what to run when no ./path is given (repeat it for several)
  ./path, ../path, /path   run only these files or folders; a node-only file among them runs on node
  --junit=<dir>            writes <dir>/bun.xml and, when node runs, <dir>/node.xml
  --shard=N/M              runs shard N of M of both parts (bun test --shard, node --test-shard)
  -t, --test-name-pattern  goes to both runners

Every other argument goes to bun test. Exits non-zero when either part fails.`;

const isPath = (arg) => /^(?:\.\.?\/|\/)/.test(arg);
const BUN_FLAGS_WITH_VALUE = new Set(["--preload", "-r", "--require", "--import", "--tsconfig-override", "--timeout", "--reporter", "--reporter-outfile", "--coverage-reporter", "--coverage-dir", "--path-ignore-patterns", "--max-concurrency", "--timings", "--seed", "--bail", "--rerun-each", "--retry", "--changed"]);
const own = { nodeOnly: null, junit: null, shard: null, defaults: [], paths: [], namePattern: null };
const bunFlags = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "-h" || arg === "--help") {
    console.log(HELP);
    process.exit(0);
  }
  const [flag, value] = arg.split(/=(.*)/s);
  if (flag === "--node-only") own.nodeOnly = value;
  else if (flag === "--default") own.defaults.push(value);
  else if (flag === "--junit") own.junit = resolve(value);
  else if (arg === "--shard" && i + 1 < argv.length) {
    own.shard = argv[++i];
    bunFlags.push(`--shard=${own.shard}`);
  } else if (BUN_FLAGS_WITH_VALUE.has(arg) && i + 1 < argv.length) bunFlags.push(arg, argv[++i]);
  else if (isPath(arg)) own.paths.push(arg);
  else if (arg === "-t" || arg === "--test-name-pattern") own.namePattern = argv[++i];
  else if (flag === "--test-name-pattern") own.namePattern = value;
  else {
    if (flag === "--shard") own.shard = value;
    bunFlags.push(arg);
  }
}
if (own.shard && !/^\d+\/\d+$/.test(own.shard)) {
  console.error(`--shard takes N/M, got ${own.shard}`);
  process.exit(2);
}

const list = own.nodeOnly ? JSON.parse(readFileSync(own.nodeOnly, "utf8")) : { node: [], files: {} };
const listed = Object.keys(list.files);
const rel = (path) => relative(process.cwd(), resolve(path)).split(sep).join("/");
const within = (file, path) => {
  const target = rel(path);
  return target === "" || file === target || file.startsWith(`${target}/`);
};

const chosen = own.paths.length ? own.paths : own.defaults;
const nodeFiles = own.paths.length ? listed.filter((file) => own.paths.some((path) => within(file, path))) : listed;
const bunPaths = chosen.filter((path) => !listed.includes(rel(path)));
if (own.junit) mkdirSync(own.junit, { recursive: true });

const run = (command, args) => spawnSync(command, args, { stdio: "inherit" }).status ?? 1;

let bunStatus = 0;
if (bunPaths.length || !chosen.length) {
  bunStatus = run(process.execPath, [
    "test",
    ...listed.map((file) => `--path-ignore-patterns=${file}`),
    ...(own.junit ? ["--reporter=junit", `--reporter-outfile=${join(own.junit, "bun.xml")}`] : []),
    ...(own.namePattern === null ? [] : ["--test-name-pattern", own.namePattern]),
    ...bunFlags,
    ...bunPaths,
  ]);
}

let nodeStatus = 0;
if (nodeFiles.length) {
  console.log(`\nnode --test: ${nodeFiles.length} of the files that need Node (${own.nodeOnly})`);
  nodeStatus = run("node", [
    ...list.node,
    ...(own.junit
      ? ["--test-reporter=spec", "--test-reporter-destination=stdout", "--test-reporter=junit", `--test-reporter-destination=${join(own.junit, "node.xml")}`]
      : []),
    ...(own.shard ? [`--test-shard=${own.shard}`] : []),
    ...(own.namePattern === null ? [] : [`--test-name-pattern=${own.namePattern}`]),
    "--test",
    ...nodeFiles,
  ]);
}

process.exit(bunStatus || nodeStatus);
