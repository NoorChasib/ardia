import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    env: { PATH: process.env.PATH, HOME: home, NILLA_DISPOSABLE_HOST: "1", ARDIA_DATA_DIR: join(scratch, "data"), ARDIA_CONFIG_HOME: join(scratch, "config"), ...env },
  });
  let launched = null;
  try {
    launched = readFileSync(seen, "utf8").trimEnd().split("\n");
  } catch {}
  return { status: result.status, stderr: result.stderr, launched };
}

test("starts the build on its own profile with the basic password store and the forwarded arguments", () => {
  const { status, launched } = run(["https://example.com"]);
  assert.equal(status, 0);
  assert.deepEqual(launched, [`--user-data-dir=${join(scratch, "config", "ardia")}`, "--password-store=basic", "https://example.com"]);
});

test("passes the resolved profile, so the engine reports the instance as isolated", () => {
  const real = join(scratch, "real-config");
  const linked = join(scratch, "linked-config");
  mkdirSync(real, { recursive: true });
  symlinkSync(real, linked);
  const { status, launched } = run([], { ARDIA_CONFIG_HOME: linked });
  assert.equal(status, 0);
  assert.equal(launched[0], `--user-data-dir=${join(real, "ardia")}`);
});

test("refuses a profile folder that is a link out of the config home", () => {
  const config = join(scratch, "config-with-link");
  mkdirSync(config, { recursive: true });
  symlinkSync(join(scratch, "elsewhere-profile"), join(config, "ardia"));
  const { status, stderr, launched } = run([], { ARDIA_CONFIG_HOME: config });
  assert.equal(status, 2);
  assert.match(stderr, /isn't inside ARDIA_CONFIG_HOME|is a link/);
  assert.equal(launched, null);
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

const outsideANamespace = readFileSync("/proc/self/uid_map", "utf8").trim().split(/\s+/).join(" ") === "0 0 4294967295";

test("refuses outside a user namespace unless the host is declared disposable", { skip: !outsideANamespace && "this test already runs inside a user namespace" }, () => {
  const { status, stderr, launched } = run([], { NILLA_DISPOSABLE_HOST: "" });
  assert.equal(status, 2);
  assert.match(stderr, /disposable user namespace/);
  assert.equal(launched, null);
});

for (const folder of [[".config", "ardia"], [".local", "share", "ardia"], [".cache", "ardia"], [".local", "state", "ardia"]]) {
  test(`refuses an account that has ${folder.join("/")}, even with scratch folders`, () => {
    const planted = join(home, ...folder);
    mkdirSync(planted, { recursive: true });
    try {
      const { status, stderr, launched } = run([]);
      assert.equal(status, 2);
      assert.match(stderr, /this account has Ardia's/);
      assert.equal(launched, null);
    } finally {
      rmSync(planted, { recursive: true, force: true });
    }
  });
}
