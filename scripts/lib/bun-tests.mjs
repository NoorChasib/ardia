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
const BUN_FLAGS_TAKING_NEXT_ARG = new Set(["--preload", "-r", "--require", "--import", "--tsconfig-override", "--timeout", "--reporter", "--reporter-outfile", "--coverage-reporter", "--coverage-dir", "--path-ignore-patterns", "--max-concurrency", "--timings", "--seed", "--rerun-each", "--retry"]);

export function parseRunnerArgs(argv) {
  const options = { help: false, nodeOnly: null, junit: null, shard: null, defaults: [], paths: [], namePattern: null, bunFlags: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, value] = arg.split(/=(.*)/s);
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (flag === "--node-only") options.nodeOnly = value;
    else if (flag === "--default") options.defaults.push(value);
    else if (flag === "--junit") options.junit = value;
    else if (arg === "--shard" && i + 1 < argv.length) {
      options.shard = argv[++i];
      options.bunFlags.push(`--shard=${options.shard}`);
    } else if (BUN_FLAGS_TAKING_NEXT_ARG.has(arg) && i + 1 < argv.length) options.bunFlags.push(arg, argv[++i]);
    else if (isPath(arg)) options.paths.push(arg);
    else if (arg === "-t" || arg === "--test-name-pattern") options.namePattern = argv[++i];
    else if (flag === "--test-name-pattern") options.namePattern = value;
    else {
      if (flag === "--shard") options.shard = value;
      options.bunFlags.push(arg);
    }
  }
  return options;
}

export function planRuns(options, list, { execPath = process.execPath, cwd = process.cwd() } = {}) {
  const listed = Object.keys(list.files);
  const rel = (path) => relative(cwd, resolve(cwd, path)).split(sep).join("/");
  const within = (file, path) => {
    const target = rel(path);
    return target === "" || file === target || file.startsWith(`${target}/`);
  };
  const junit = options.junit === null ? null : resolve(cwd, options.junit);
  const chosen = options.paths.length ? options.paths : options.defaults;
  const nodeFiles = options.paths.length ? listed.filter((file) => options.paths.some((path) => within(file, path))) : listed;
  const bunPaths = chosen.filter((path) => !listed.includes(rel(path)));
  const bun =
    bunPaths.length || !chosen.length
      ? [
          execPath,
          "test",
          ...listed.map((file) => `--path-ignore-patterns=${file}`),
          ...(junit ? ["--reporter=junit", `--reporter-outfile=${join(junit, "bun.xml")}`] : []),
          ...(options.namePattern === null ? [] : ["--test-name-pattern", options.namePattern]),
          ...options.bunFlags,
          ...bunPaths,
        ]
      : null;
  const node = nodeFiles.length
    ? [
        "node",
        ...list.node,
        ...(junit
          ? ["--test-reporter=spec", "--test-reporter-destination=stdout", "--test-reporter=junit", `--test-reporter-destination=${join(junit, "node.xml")}`]
          : []),
        ...(options.shard ? [`--test-shard=${options.shard}`] : []),
        ...(options.namePattern === null ? [] : [`--test-name-pattern=${options.namePattern}`]),
        "--test",
        ...nodeFiles,
      ]
    : null;
  return { junit, bun, node, nodeCount: nodeFiles.length };
}

function main() {
  const options = parseRunnerArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (options.shard && !/^\d+\/\d+$/.test(options.shard)) {
    console.error(`--shard takes N/M, got ${options.shard}`);
    process.exit(2);
  }
  const list = options.nodeOnly ? JSON.parse(readFileSync(options.nodeOnly, "utf8")) : { node: [], files: {} };
  const plan = planRuns(options, list);
  if (plan.junit) mkdirSync(plan.junit, { recursive: true });
  const run = ([command, ...args]) => spawnSync(command, args, { stdio: "inherit" }).status ?? 1;
  const bunStatus = plan.bun ? run(plan.bun) : 0;
  let nodeStatus = 0;
  if (plan.node) {
    console.log(`\nnode --test: ${plan.nodeCount} of the files that need Node (${options.nodeOnly})`);
    nodeStatus = run(plan.node);
  }
  process.exit(bunStatus || nodeStatus);
}

if (import.meta.main) main();
