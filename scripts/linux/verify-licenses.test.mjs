import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));
const verifier = join(here, "verify-licenses.py");
const scratch = mkdtempSync(join(tmpdir(), "verify-licenses-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const has = (tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0;
const TEXTS = { LICENSE: "LICENSE", "LICENSE.Apache-2.0": "LICENSE.Apache-2.0", NOTICE: "NOTICE", "bangs-LICENSE": "third_party/bangs/LICENSE", "symbols-THIRD_PARTY_NOTICES.txt": "apps/linux/src/shims/web/symbols/THIRD_PARTY_NOTICES.txt" };

const build = `
import pathlib, shutil, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import package
root = pathlib.Path(sys.argv[2])
output, ui = root / 'out', root / 'ui'
output.mkdir()
ui.mkdir()
for name in package.REQUIRED:
    if name == 'locales':
        (output / name).mkdir()
        (output / name / 'en-US.pak').write_bytes(b'locale')
    else:
        (output / name).write_bytes(b'runtime')
(output / 'chrome').chmod(0o755)
(output / 'chrome_sandbox').write_bytes(b'helper')
(output / 'chrome_sandbox').chmod(0o755)
(ui / 'index.html').write_text('<html></html>')
deb = root / 'Nilla.deb' if shutil.which('dpkg-deb') else None
package.package(output, ui, root / 'Nilla.tar.xz', version='0.1.0', deb=deb)
`;
const built = spawnSync("python3", ["-I", "-c", build, here, scratch], { encoding: "utf8" });
assert.equal(built.status, 0, built.stderr);
const tarball = join(scratch, "Nilla.tar.xz");
const deb = has("dpkg-deb") ? join(scratch, "Nilla.deb") : null;
const extracted = join(scratch, "extracted");
mkdirSync(extracted);
assert.equal(spawnSync("tar", ["-xJf", tarball, "-C", extracted]).status, 0);
const packageRoot = join(extracted, "ardia");

const verify = (...args) => spawnSync("python3", ["-I", verifier, ...args], { encoding: "utf8" });

test("the tarball carries every licence text, byte for byte, in lib/ardia/licenses and share/doc/nilla", () => {
  const result = verify("--tarball", tarball);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^ok {3}tarball .*5 licence texts in ardia\/lib\/ardia\/licenses, ardia\/share\/doc\/nilla$/m);
  for (const folder of ["lib/ardia/licenses", "share/doc/nilla"]) {
    assert.deepEqual(readdirSync(join(packageRoot, folder)).sort(), Object.keys(TEXTS).sort());
    for (const [name, source] of Object.entries(TEXTS)) assert.deepEqual(readFileSync(join(packageRoot, folder, name)), readFileSync(join(repo, source)), `${folder}/${name}`);
  }
});

test("the .deb carries them under /usr and names Nilla in its metadata while the package stays ardia", { skip: !deb && "dpkg-deb is not installed" }, () => {
  const result = verify("--deb", deb);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const fields = spawnSync("dpkg-deb", ["-f", deb, "Package", "Maintainer", "Homepage", "Description"], { encoding: "utf8" }).stdout;
  assert.match(fields, /^Package: ardia$/m);
  assert.match(fields, /^Maintainer: Noor Chasib <NoorChasib@users\.noreply\.github\.com>$/m);
  assert.match(fields, /^Homepage: https:\/\/github\.com\/NoorChasib\/nilla$/m);
  assert.match(fields, /^Description: The Nilla web browser$/m);
});

test("install.sh stages the licence texts and every icon size, and an Arch package built from its PKGBUILD carries them too", () => {
  const destdir = join(scratch, "staged");
  const installed = spawnSync(join(packageRoot, "install.sh"), ["--prefix", "/usr", "--destdir", destdir], { encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const staged = verify("--staged", join(destdir, "usr"));
  assert.equal(staged.status, 0, staged.stdout + staged.stderr);
  for (const size of readdirSync(join(repo, "scripts/linux/icons/hicolor"))) {
    const [source] = readdirSync(join(repo, "scripts/linux/icons/hicolor", size, "apps"));
    const name = `ardia${source.slice(source.lastIndexOf("."))}`;
    assert.deepEqual(readFileSync(join(destdir, "usr/share/icons/hicolor", size, "apps", name)), readFileSync(join(repo, "scripts/linux/icons/hicolor", size, "apps", source)), `${size}/${name}`);
  }
  const pkgdir = join(scratch, "pkg");
  mkdirSync(pkgdir);
  const script = 'set -euo pipefail; source "$1"; srcdir="$2"; pkgdir="$3"; cd "$srcdir"; package';
  const arch = spawnSync("bash", ["-c", script, "pkgbuild", join(here, "arch/PKGBUILD"), extracted, pkgdir], { encoding: "utf8" });
  assert.equal(arch.status, 0, arch.stdout + arch.stderr);
  const archive = join(scratch, "ardia-bin-0.1.0-1-x86_64.pkg.tar.xz");
  assert.equal(spawnSync("tar", ["-cJf", archive, "-C", pkgdir, "usr"]).status, 0);
  const result = verify("--arch", archive);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /usr\/share\/licenses\/ardia-bin$/m);
  assert.match(readFileSync(join(here, "arch/PKGBUILD"), "utf8"), /^license=\('GPL-3\.0-only' 'Apache-2\.0'\)$/m);
});

test("the AppImage reader finds the image after the runtime and checks the same texts", { skip: !has("mksquashfs") && "mksquashfs is not installed" }, () => {
  const image = join(scratch, "image.squashfs");
  assert.equal(spawnSync("mksquashfs", [packageRoot, image, "-all-root", "-noappend", "-no-progress", "-quiet", "-no-xattrs"]).status, 0);
  const runtime = Buffer.alloc(256);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(runtime);
  runtime.writeBigUInt64LE(128n, 0x28);
  runtime.writeUInt16LE(64, 0x3a);
  runtime.writeUInt16LE(2, 0x3c);
  const appimage = join(scratch, "Nilla.AppImage");
  writeFileSync(appimage, Buffer.concat([runtime, readFileSync(image)]));
  const result = verify("--appimage", appimage);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  writeFileSync(join(scratch, "not-an-appimage"), Buffer.concat([Buffer.alloc(64), readFileSync(image)]));
  assert.match(verify("--appimage", join(scratch, "not-an-appimage")).stdout, /ELF runtime/);
});

test("a changed, missing, extra or wrongly moded text fails, and naming no package is a usage error", () => {
  const broken = join(scratch, "broken");
  cpSync(packageRoot, broken, { recursive: true });
  appendFileSync(join(broken, "lib/ardia/licenses/NOTICE"), "\nchanged\n");
  rmSync(join(broken, "share/doc/nilla/bangs-LICENSE"));
  writeFileSync(join(broken, "share/doc/nilla/README"), "extra\n");
  spawnSync("chmod", ["0600", join(broken, "share/doc/nilla/LICENSE")]);
  const result = verify("--staged", broken);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /lib\/ardia\/licenses\/NOTICE differs from NOTICE/);
  assert.match(result.stdout, /share\/doc\/nilla\/bangs-LICENSE is missing/);
  assert.match(result.stdout, /share\/doc\/nilla\/README is not one of the licence texts/);
  assert.match(result.stdout, /share\/doc\/nilla\/LICENSE has mode 0o600/);
  assert.equal(verify().status, 2);
});

test("the package's desktop entry says Nilla while its command, icon and window class keep the engine's ardia names", () => {
  const desktop = readFileSync(join(packageRoot, "share/applications/ardia.desktop"), "utf8");
  assert.match(desktop, /^Name=Nilla$/m);
  assert.match(desktop, /^Exec=ardia %U$/m);
  assert.match(desktop, /^Icon=ardia$/m);
  assert.match(desktop, /^StartupWMClass=ardia$/m);
  assert.deepEqual(readFileSync(join(packageRoot, "share/icons/hicolor/256x256/apps/ardia.png")), readFileSync(join(repo, "scripts/linux/icons/hicolor/256x256/apps/nilla.png")));
});
