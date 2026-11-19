import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "package-launcher-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const launcherText = spawnSync("python3", ["-I", "-c", "import sys; sys.path.insert(0, sys.argv[1]); import package; sys.stdout.write(package.LAUNCHER)", here], { encoding: "utf8" });
assert.equal(launcherText.status, 0, launcherText.stderr);
const root = join(scratch, "package");
const seen = join(scratch, "seen.txt");
const launcher = join(root, "bin/ardia");
const engineLauncher = join(root, "lib/ardia/ardia-launch");
mkdirSync(join(root, "bin"), { recursive: true });
mkdirSync(join(root, "lib/ardia"), { recursive: true });
writeFileSync(launcher, launcherText.stdout);
chmodSync(launcher, 0o755);
writeFileSync(engineLauncher, `#!/bin/sh\nprintf '%s\\n' "$@" > '${seen}'\n`);
chmodSync(engineLauncher, 0o755);

function launch(args) {
  rmSync(seen, { force: true });
  const result = spawnSync(launcher, args, { encoding: "utf8", env: { PATH: process.env.PATH } });
  return { status: result.status, stderr: result.stderr, launched: existsSync(seen) ? readFileSync(seen, "utf8").trimEnd().split("\n") : null };
}

for (const args of [[], ["https://example.com"], ["--user-data-dir="], ["--user-data-dir", "/scratch/profile"], ["-user-data-dir=/scratch/profile"]]) {
  test(`the packaged launcher refuses to start the engine on its default profile (${JSON.stringify(args)})`, () => {
    const { status, stderr, launched } = launch(args);
    assert.equal(status, 2);
    assert.match(stderr, /starts only with --user-data-dir/);
    assert.equal(launched, null);
  });
}

test("the packaged launcher starts the engine on a profile it was given, with every argument", () => {
  const { status, launched } = launch(["--user-data-dir=/scratch/profile", "--password-store=basic", "https://example.com"]);
  assert.equal(status, 0);
  assert.deepEqual(launched, ["--user-data-dir=/scratch/profile", "--password-store=basic", "https://example.com"]);
});
