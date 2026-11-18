import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createExport, toolBunfig } from "./bundle-export.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const corexBun = path.join(here, "corex-bun");
const made = [];
after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function scratch(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

function write(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, mode ? { mode } : undefined);
}

function fakeBun(file, version, log) {
  write(file, `#!/bin/bash\nif [ "$1" = "--version" ]; then echo ${version}; exit 0; fi\necho "$PWD $*" >> ${log}\n`, 0o755);
}

function tree(root, packageManager, { bunfig = false } = {}) {
  write(path.join(root, "apps/phone/package.json"), `{\n  "name": "ardia-phone",\n  "packageManager": "${packageManager}"\n}\n`);
  if (bunfig) write(path.join(root, "apps/phone/bunfig.toml"), "[install]\nlinker = \"hoisted\"\n");
  return root;
}

function setup({ revision, revisionBunfig, installed, npmInstalls }) {
  const base = scratch("corex-bun-base-");
  const log = path.join(base, "calls.log");
  const tools = tree(scratch("corex-bun-tools-"), "bun@1.4.4", { bunfig: true });
  const src = tree(scratch("corex-bun-src-"), revision, { bunfig: revisionBunfig });
  for (const [version, reports] of Object.entries(installed ?? {})) {
    fakeBun(path.join(base, `bun-${version}/node_modules/.bin/bun`), reports, log);
  }
  const fakes = scratch("corex-bun-path-");
  write(
    path.join(fakes, "npm"),
    `#!/bin/bash\necho "npm $*" >> ${log}\nprefix="$4"\nmkdir -p "$prefix/node_modules/.bin"\nprintf '#!/bin/bash\\nif [ "$1" = "--version" ]; then echo ${npmInstalls ?? "none"}; exit 0; fi\\necho "$PWD $*" >> ${log}\\n' > "$prefix/node_modules/.bin/bun"\nchmod +x "$prefix/node_modules/.bin/bun"\n`,
    0o755,
  );
  const run = (...args) =>
    spawnSync("bash", [corexBun, ...args.slice(0, 1), base, src, tools, ...args.slice(1)], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakes}:/usr/bin:/bin` },
    });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);
  return { base, src, tools, run, calls };
}

test("a Bun-era commit installs with the Bun it pins and its own bunfig", () => {
  const { base, src, run, calls } = setup({ revision: "bun@1.4.4", revisionBunfig: true, installed: { "1.4.4": "1.4.4" } });
  const found = run("path");
  assert.equal(found.status, 0, found.stderr);
  assert.equal(found.stdout.trim(), path.join(base, "bun-1.4.4/node_modules/.bin"));
  const installed = run("install", "--silent");
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(calls(), [`${path.join(src, "apps/phone")} install --frozen-lockfile --silent`]);
});

test("a commit from before Bun installs with the branch head's Bun and bunfig", () => {
  const { base, src, tools, run, calls } = setup({ revision: "pnpm@11.1.3", revisionBunfig: false, installed: { "1.4.4": "1.4.4" } });
  const found = run("path");
  assert.equal(found.status, 0, found.stderr);
  assert.equal(found.stdout.trim(), path.join(base, "bun-1.4.4/node_modules/.bin"));
  const installed = run("install");
  assert.equal(installed.status, 0, installed.stderr);
  assert.deepEqual(calls(), [`${path.join(src, "apps/phone")} install --frozen-lockfile --config=${path.join(tools, "apps/phone/bunfig.toml")}`]);
});

test("a clone set up before Bun gets the pinned Bun installed before it is used", () => {
  const { base, run, calls } = setup({ revision: "bun@1.4.4", revisionBunfig: true, npmInstalls: "1.4.4" });
  const found = run("path");
  assert.equal(found.status, 0, found.stderr);
  assert.equal(found.stdout.trim(), path.join(base, "bun-1.4.4/node_modules/.bin"));
  assert.deepEqual(calls(), [`npm install --silent --prefix ${path.join(base, "bun-1.4.4")} bun@1.4.4`]);
});

test("a Bun that reports another version is reinstalled, and refused if it still does", () => {
  const fixed = setup({ revision: "bun@1.4.4", revisionBunfig: true, installed: { "1.4.4": "1.3.9" }, npmInstalls: "1.4.4" });
  assert.equal(fixed.run("path").status, 0);
  assert.equal(fixed.calls().length, 1);
  const broken = setup({ revision: "bun@1.4.4", revisionBunfig: true, npmInstalls: "1.3.9" });
  const refused = broken.run("install");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /reports 1\.3\.9, not 1\.4\.4/);
  assert.equal(broken.calls().filter((line) => line.includes(" install --frozen-lockfile")).length, 0);
});

test("a bundle export of a commit from before Bun installs with this checkout's bunfig", () => {
  const root = scratch("pre-bun-export-repo-");
  const parent = scratch("pre-bun-export-out-");
  const fakes = scratch("pre-bun-export-path-");
  const log = path.join(fakes, "calls.log");
  fakeBun(path.join(fakes, "bun"), "1.4.4", log);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "export@example.com");
  git("config", "user.name", "export");
  tree(root, "pnpm@11.1.3");
  write(path.join(root, "apps/phone/pnpm-lock.yaml"), "lockfileVersion: 9\n");
  for (const file of ["patches/a.patch", "packages/phone/src/index.ts", "packages/core/src/index.ts"]) write(path.join(root, file), "x\n");
  git("add", "-A");
  git("commit", "-qm", "before Bun");
  const before = git("rev-parse", "HEAD").trim();
  tree(root, "bun@1.4.4", { bunfig: true });
  git("add", "-A");
  git("commit", "-qm", "Bun");
  const previous = process.env.PATH;
  process.env.PATH = `${fakes}:${previous}`;
  try {
    const old = createExport(root, before, { parent });
    const current = createExport(root, "HEAD", { parent });
    assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [
      `${path.join(old.dir, "apps/phone")} install --offline --frozen-lockfile --config=${toolBunfig} --silent`,
      `${path.join(current.dir, "apps/phone")} install --offline --frozen-lockfile --silent`,
    ]);
  } finally {
    process.env.PATH = previous;
  }
  assert.ok(fs.existsSync(toolBunfig));
});
