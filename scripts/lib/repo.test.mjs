import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { REPO } from "./repo.mjs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const checkout = fileURLToPath(new URL("../../", import.meta.url));
const engineRepo = () => /^ENGINE_REPO="([^"]+)"$/m.exec(read("scripts/lib/releases.sh"))?.[1];

test("every place that names the GitHub repo names the same one", () => {
  assert.equal(/^REPO="([^"]+)"$/m.exec(read("scripts/lib/releases.sh"))?.[1], REPO);
  assert.match(read("scripts/windows/publish-alpha.sh"), /^repo="\$REPO"$/m);
});

test("the engine repo is the upstream one the engine fetches default to, never Nilla's own", () => {
  const engine = engineRepo();
  assert.ok(engine, "scripts/lib/releases.sh sets ENGINE_REPO");
  assert.notEqual(engine, REPO);
  assert.equal(/^repo=\$\{ARDIACORE_PREBUILT_REPO:-([^}]+)\}$/m.exec(read("scripts/linux/fetch-engine.sh"))?.[1], engine);
  for (const workflow of [".github/workflows/linux.yml", ".github/workflows/release.yml"]) {
    const defaults = [...read(workflow).matchAll(/ARDIACORE_PREBUILT_REPO: \$\{\{ vars\.ARDIACORE_PREBUILT_REPO \|\| '([^']+)' \}\}/g)].map((match) => match[1]);
    assert.ok(defaults.length > 0, `${workflow} sets ARDIACORE_PREBUILT_REPO`);
    for (const fetched of defaults) assert.equal(fetched, engine, workflow);
  }
  assert.match(read(".github/workflows/windows.yml"), new RegExp(`vars\\.WINDOWS_ENGINE_REPO \\|\\| '${engine.replace("/", "\\/")}'`));
  assert.match(/^repo=\$\{ARDIACORE_PREBUILT_REPO:-([^}]+)\}$/m.exec(read("packages/ardiacore/scripts/fetch-engine.sh"))?.[1] ?? "", /^(?:ardia-browser|mantrakp04)\/ardia$/);
});

test("the Linux engine publisher never uploads without a repo named on the command line", () => {
  const publisher = spawnSync("python3", ["-I", "scripts/linux/publish_engine.py", "--out", "/nonexistent/out", "--source", "/nonexistent/source", "--upload"], {
    cwd: checkout,
    env: { PATH: process.env.PATH, ARDIACORE_PREBUILT_REPO: "ardia-browser/ardia" },
    encoding: "utf8",
  });
  assert.equal(publisher.status, 64, publisher.stderr);
  assert.match(publisher.stderr, /--upload needs --repo/);
});

test("no script, workflow or doc tells anyone to upload an engine without naming a repo", () => {
  const listed = spawnSync("git", ["ls-files", "-z", "scripts", ".github", "docs", "packages/ardiacore/scripts", "README.md", "CONTRIBUTING.md", "AGENTS.md"], { cwd: checkout, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const prescriptions = [];
  for (const path of listed.stdout.split("\0").filter((path) => path && !/^docs\/(?:history|audit)\//.test(path))) {
    const joined = read(path).replace(/\\\n\s*/g, " ");
    const commands = path.endsWith(".md") ? joined.split(/\n\s*\n|\n(?=\s*(?:[-*|#]|```|\d+\.)\s)/) : joined.split("\n");
    for (const command of commands) if (/publish-engine\.sh\b[\s\S]*--upload\b/.test(command) && !/--repo\b/.test(command)) prescriptions.push(`${path}: ${command.trim().replace(/\s+/g, " ").slice(0, 160)}`);
  }
  assert.ok(read("scripts/linux/fetch-engine.sh").includes("scripts/linux/release.sh --engine DIR"), "the fetcher points at a local engine instead");
  assert.deepEqual(prescriptions, []);
});

test("the workflows cache the CLI toolchain in the folder build.sh writes", () => {
  const build = read("apps/cli/scripts/build.sh");
  const linux = /cache=\$HOME\/\.cache\/([\w-]+) ;;/.exec(build)?.[1];
  const mac = /cache=\$HOME\/Library\/Caches\/([\w-]+)$/m.exec(build)?.[1];
  assert.ok(linux && mac, "build.sh names its cache folders");
  for (const workflow of [".github/workflows/linux.yml", ".github/workflows/release.yml"]) {
    const cached = [...read(workflow).matchAll(/path: ~\/(?:\.cache|Library\/Caches)\/([\w-]*cli[\w-]*)/g)].map((match) => match[1]);
    assert.ok(cached.length > 0, `${workflow} caches the CLI toolchain`);
    for (const folder of cached) assert.ok(folder === linux || folder === mac, `${workflow} caches ${folder}, not ${linux}`);
  }
});
