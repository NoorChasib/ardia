import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("./nilla-dev-run", import.meta.url));
const scratch = mkdtempSync("/tmp/nilla-dev-run-");
after(() => rmSync(scratch, { recursive: true, force: true }));

const script = join(scratch, "nilla-dev-run");
copyFileSync(source, script);
const home = join(scratch, "home");
const build = join(scratch, "build");
const seen = join(scratch, "seen.txt");
mkdirSync(join(build, "bin"), { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(build, "bin", "ardia"), `#!/bin/sh\nprintf '%s\\n' "$@" "data=$ARDIA_DATA_DIR" > '${seen}'\n`);
chmodSync(join(build, "bin", "ardia"), 0o755);

const config = join(scratch, "config");
const profile = join(config, "ardia");
const data = join(scratch, "data");
const baseEnv = { PATH: process.env.PATH, HOME: home, NILLA_DISPOSABLE_HOST: "1", ARDIA_DATA_DIR: data, ARDIA_CONFIG_HOME: config };

function launched() {
  try {
    return readFileSync(seen, "utf8").trimEnd().split("\n");
  } catch {
    return null;
  }
}

function run(args, env = {}, wrapper = []) {
  rmSync(seen, { force: true });
  const command = [...wrapper, "bash", script, build, ...args];
  const result = spawnSync(command[0], command.slice(1), { encoding: "utf8", env: { ...baseEnv, ...env } });
  return { status: result.status, stderr: result.stderr, launched: launched() };
}

const realHome = spawnSync("getent", ["passwd", String(process.getuid())], { encoding: "utf8" }).stdout.split(":")[5];
const canUnshare = spawnSync("unshare", ["--user", "--map-root-user", "--mount", "true"]).status === 0;

function inMountNamespace(setup, args, env) {
  const prepare = `set -e; ${setup}; exec "$@"`;
  return run(args, env, ["unshare", "--user", "--map-root-user", "--mount", "--", "bash", "-c", prepare, "prepare"]);
}

test("starts the build on its own profile with the basic password store, the forwarded arguments and the data folder exported", () => {
  const { status, stderr, launched } = run(["https://example.com"]);
  assert.equal(status, 0, stderr);
  assert.deepEqual(launched, [`--user-data-dir=${profile}`, "--password-store=basic", "https://example.com", `data=${data}`]);
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
  const linkedConfig = join(scratch, "config-with-link");
  mkdirSync(linkedConfig, { recursive: true });
  symlinkSync(join(scratch, "elsewhere-profile"), join(linkedConfig, "ardia"));
  const { status, stderr, launched } = run([], { ARDIA_CONFIG_HOME: linkedConfig });
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

test("refuses a data folder or a config home inside Ardia's", () => {
  assert.equal(run([], { ARDIA_DATA_DIR: join(home, ".config", "ardia", "x") }).status, 2);
  assert.equal(run([], { ARDIA_CONFIG_HOME: join(home, ".local", "share", "ardia") }).status, 2);
  assert.equal(launched(), null);
});

for (const variable of ["ARDIA_DATA_DIR", "ARDIA_CONFIG_HOME"]) {
  test(`refuses to start without ${variable}, or with a relative one`, () => {
    for (const value of ["", "relative"]) {
      const { status, stderr, launched } = run([], { [variable]: value });
      assert.equal(status, 2);
      assert.match(stderr, new RegExp(variable));
      assert.equal(launched, null);
    }
  });
}

const onTheHost = readFileSync("/proc/self/uid_map", "utf8").trim().split(/\s+/).join(" ") === "0 0 4294967295";

test("without NILLA_DISPOSABLE_HOST it refuses where the account's real home is writable: on the host, and in a user namespace that shares the host's view", () => {
  assert.ok(onTheHost || canUnshare, "the refusal must be exercised: run on the host, or where unprivileged user namespaces are allowed");
  if (onTheHost) {
    const direct = run([], { NILLA_DISPOSABLE_HOST: "" });
    assert.equal(direct.status, 2);
    assert.match(direct.stderr, /isn't verified to be isolated \(this isn't a user namespace\)/);
    assert.equal(direct.launched, null);
  }
  if (canUnshare) {
    const shared = inMountNamespace(`mount -t tmpfs tmpfs '${realHome}'`, [], { NILLA_DISPOSABLE_HOST: "" });
    assert.equal(shared.status, 2, shared.stderr);
    assert.match(shared.stderr, /isn't verified to be isolated \(.*is writable here, so the build could reach/);
    assert.equal(shared.launched, null);
  }
});

test("without NILLA_DISPOSABLE_HOST it starts in a user and mount namespace that covers the real home read-only and gives a scratch HOME", { skip: !canUnshare && "unprivileged user namespaces are unavailable here" }, () => {
  const cover = `mount -t tmpfs tmpfs '${realHome}'; mount -o remount,ro,bind '${realHome}'`;
  const isolated = inMountNamespace(cover, [], { NILLA_DISPOSABLE_HOST: "" });
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.equal(isolated.launched[0], `--user-data-dir=${profile}`);
  const homeIsReal = inMountNamespace(cover, [], { NILLA_DISPOSABLE_HOST: "", HOME: realHome });
  assert.equal(homeIsReal.status, 2);
  assert.match(homeIsReal.stderr, /is the account folder/);
  const writableConfig = inMountNamespace(`mount -t tmpfs tmpfs '${realHome}'; mkdir '${realHome}/.config'; mount -o remount,ro,bind '${realHome}'; mount -t tmpfs tmpfs '${realHome}/.config'`, [], { NILLA_DISPOSABLE_HOST: "" });
  assert.equal(writableConfig.status, 2);
  assert.match(writableConfig.stderr, /\.config is writable here/);
  const planted = inMountNamespace(`mount -t tmpfs tmpfs '${realHome}'; mkdir -p '${realHome}/.config/ardia'; mount -o remount,ro,bind '${realHome}'`, [], { NILLA_DISPOSABLE_HOST: "" });
  assert.equal(planted.status, 2);
  assert.match(planted.stderr, /this machine has Ardia's .*\.config\/ardia/);
});

test("the account's real home holds no Ardia folders when the host is declared disposable either", { skip: !canUnshare && "unprivileged user namespaces are unavailable here" }, () => {
  const planted = inMountNamespace(`mount -t tmpfs tmpfs '${realHome}'; mkdir -p '${realHome}/.cache/ardia'`, []);
  assert.equal(planted.status, 2);
  assert.match(planted.stderr, /this machine has Ardia's .*\.cache\/ardia/);
});

for (const folder of [[".config", "ardia"], [".local", "share", "ardia"], [".cache", "ardia"], [".local", "state", "ardia"]]) {
  test(`refuses a HOME that has ${folder.join("/")}, even with scratch folders`, () => {
    const plantedFolder = join(home, ...folder);
    mkdirSync(plantedFolder, { recursive: true });
    try {
      const { status, stderr, launched } = run([]);
      assert.equal(status, 2);
      assert.match(stderr, /this machine has Ardia's/);
      assert.equal(launched, null);
    } finally {
      rmSync(plantedFolder, { recursive: true, force: true });
    }
  });
}
