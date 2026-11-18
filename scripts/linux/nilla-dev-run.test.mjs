import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./nilla-dev-run", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "nilla-dev-run-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const home = join(scratch, "home");
const build = join(scratch, "build");
const seen = join(scratch, "seen.txt");
mkdirSync(join(build, "bin"), { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(build, "bin", "ardia"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${seen}'\n`);
chmodSync(join(build, "bin", "ardia"), 0o755);

function run(args, env = {}) {
  rmSync(seen, { force: true });
  const result = spawnSync("bash", [script, build, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, ARDIA_DATA_DIR: join(scratch, "data"), ARDIA_CONFIG_HOME: join(scratch, "config"), ...env },
  });
  let launched = null;
  try {
    launched = readFileSync(seen, "utf8").trimEnd().split("\n");
  } catch {}
  return { status: result.status, stderr: result.stderr, launched };
}

test("starts the build with the basic password store and the forwarded arguments", () => {
  const { status, launched } = run(["https://example.com"]);
  assert.equal(status, 0);
  assert.deepEqual(launched, ["--password-store=basic", "https://example.com"]);
});

for (const argument of [
  "--password-store=gnome-libsecret",
  "--password-store",
  "-password-store=kwallet5",
  `--user-data-dir=${join(home, ".config", "ardia")}`,
  "--user-data-dir",
  `-user-data-dir=${join(scratch, "elsewhere")}`,
]) {
  test(`refuses ${argument} before launching`, () => {
    const { status, stderr, launched } = run(["https://example.com", argument]);
    assert.equal(status, 2);
    assert.match(stderr, /isn't allowed/);
    assert.equal(launched, null);
  });
}

test("refuses a data folder inside Ardia's", () => {
  const { status, launched } = run([], { ARDIA_DATA_DIR: join(home, ".config", "ardia", "x") });
  assert.equal(status, 2);
  assert.equal(launched, null);
});

test("refuses to start without ARDIA_CONFIG_HOME", () => {
  const { status, stderr, launched } = run([], { ARDIA_CONFIG_HOME: "" });
  assert.equal(status, 2);
  assert.match(stderr, /set ARDIA_CONFIG_HOME/);
  assert.equal(launched, null);
});
