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
const [topFolder, ...others] = readdirSync(extracted);
assert.deepEqual(others, []);
const packageRoot = join(extracted, topFolder);
const desktopFile = readdirSync(join(packageRoot, "share/applications")).find((name) => name.endsWith(".desktop"));
const desktop = readFileSync(join(packageRoot, "share/applications", desktopFile), "utf8");
const iconName = /^Icon=(.+)$/m.exec(desktop)[1];

const verify = (...args) => spawnSync("python3", ["-I", verifier, ...args], { encoding: "utf8" });

test("the tarball carries every licence text, byte for byte, in lib/ardia/licenses and share/doc/nilla", () => {
  const result = verify("--tarball", tarball);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.startsWith("ok   tarball "), result.stdout);
  assert.ok(result.stdout.trimEnd().endsWith("5 licence texts in lib/ardia/licenses, share/doc/nilla"), result.stdout);
  for (const folder of ["lib/ardia/licenses", "share/doc/nilla"]) {
    assert.deepEqual(readdirSync(join(packageRoot, folder)).sort(), Object.keys(TEXTS).sort());
    for (const [name, source] of Object.entries(TEXTS)) assert.deepEqual(readFileSync(join(packageRoot, folder, name)), readFileSync(join(repo, source)), `${folder}/${name}`);
  }
});

test("the .deb carries them under /usr and names Nilla in its metadata while the package keeps the engine's name", { skip: !deb && "dpkg-deb is not installed" }, () => {
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
    const name = `${iconName}${source.slice(source.lastIndexOf("."))}`;
    assert.deepEqual(readFileSync(join(destdir, "usr/share/icons/hicolor", size, "apps", name)), readFileSync(join(repo, "scripts/linux/icons/hicolor", size, "apps", source)), `${size}/${name}`);
  }
  const pkgdir = join(scratch, "pkg");
  mkdirSync(pkgdir);
  const script = 'set -euo pipefail; source "$1"; srcdir="$2"; pkgdir="$3"; cd "$srcdir"; package';
  const arch = spawnSync("bash", ["-c", script, "pkgbuild", join(here, "arch/PKGBUILD"), extracted, pkgdir], { encoding: "utf8" });
  assert.equal(arch.status, 0, arch.stdout + arch.stderr);
  const archive = join(scratch, "nilla-test-0.1.0-1-x86_64.pkg.tar.xz");
  assert.equal(spawnSync("tar", ["-cJf", archive, "-C", pkgdir, "usr"]).status, 0);
  const result = verify("--arch", archive);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const pkgname = /^pkgname=(\S+)$/m.exec(readFileSync(join(here, "arch/PKGBUILD"), "utf8"))[1];
  assert.ok(result.stdout.trimEnd().endsWith(`usr/share/licenses/${pkgname}`), result.stdout);
  assert.match(readFileSync(join(here, "arch/PKGBUILD"), "utf8"), /^license=\('GPL-3\.0-only' 'Apache-2\.0'\)$/m);
});

test("an Arch .pkg.tar.zst is read through zstd, so it passes on a Python without the standard library's Zstandard module", { skip: !has("zstd") && "zstd is not installed" }, () => {
  const pkgdir = join(scratch, "pkg");
  const archive = join(scratch, "nilla-test-0.1.0-1-x86_64.pkg.tar.zst");
  const packed = spawnSync("sh", ["-c", 'tar -C "$1" -cf - usr | zstd -q -o "$2"', "pack", pkgdir, archive], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const result = verify("--arch", archive);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const withoutStdlibZstd = spawnSync("python3", ["-I", "-c", 'import runpy, sys; sys.modules["compression.zstd"] = None; sys.argv = sys.argv[1:]; runpy.run_path(sys.argv[0], run_name="__main__")', verifier, "--arch", archive], { encoding: "utf8" });
  assert.equal(withoutStdlibZstd.status, 0, withoutStdlibZstd.stdout + withoutStdlibZstd.stderr);
  const truncated = join(scratch, "truncated.pkg.tar.zst");
  writeFileSync(truncated, readFileSync(archive).subarray(0, 4096));
  const broken = verify("--arch", truncated);
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /^FAIL arch /);
});

const appimageBuild = `
import pathlib, shutil, struct, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import linux_formats
root, destination = pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
runtime = bytearray(256)
runtime[:7] = bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
runtime[8:11] = b'AI\\x02'
struct.pack_into('<Q', runtime, 0x28, 128)
struct.pack_into('<HH', runtime, 0x3a, 64, 2)
(destination.parent / 'runtime').write_bytes(bytes(runtime))
linux_formats.build_appimage(root, destination, {'runtime': destination.parent / 'runtime', 'mksquashfs': shutil.which('mksquashfs')})
`;

test("the AppImage build puts the documentation copy in usr/share/doc/nilla, and the reader finds the image after the runtime", { skip: !(has("mksquashfs") && has("unsquashfs")) && "squashfs-tools is not installed" }, () => {
  const appimage = join(scratch, "Nilla.AppImage");
  const built = spawnSync("python3", ["-I", "-c", appimageBuild, here, packageRoot, appimage], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  const result = verify("--appimage", appimage);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.trimEnd().endsWith("5 licence texts in lib/ardia/licenses, usr/share/doc/nilla"), result.stdout);
  const listing = spawnSync("unsquashfs", ["-o", "256", "-lc", appimage], { encoding: "utf8" }).stdout.split("\n").map((line) => line.replace(/^squashfs-root\//, ""));
  for (const name of Object.keys(TEXTS)) assert.ok(listing.includes(`usr/share/doc/nilla/${name}`), name);
  assert.ok(!listing.some((line) => line.startsWith("share/doc/")), "the AppImage keeps no share/doc copy");
  const image = join(scratch, "image.squashfs");
  assert.equal(spawnSync("mksquashfs", [packageRoot, image, "-all-root", "-noappend", "-no-progress", "-quiet", "-no-xattrs"]).status, 0);
  writeFileSync(join(scratch, "not-an-appimage"), Buffer.concat([Buffer.alloc(64), readFileSync(image)]));
  assert.match(verify("--appimage", join(scratch, "not-an-appimage")).stdout, /ELF runtime/);
  const runtime = Buffer.alloc(256);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(runtime);
  runtime.writeBigUInt64LE(128n, 0x28);
  runtime.writeUInt16LE(64, 0x3a);
  runtime.writeUInt16LE(2, 0x3c);
  writeFileSync(join(scratch, "misplaced.AppImage"), Buffer.concat([runtime, readFileSync(image)]));
  assert.match(verify("--appimage", join(scratch, "misplaced.AppImage")).stdout, /usr\/share\/doc\/nilla\/LICENSE is missing/);
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
  assert.ok(result.stdout.includes("lib/ardia/licenses/NOTICE differs from NOTICE"), result.stdout);
  assert.match(result.stdout, /share\/doc\/nilla\/bangs-LICENSE is missing/);
  assert.match(result.stdout, /share\/doc\/nilla\/README is not one of the licence texts/);
  assert.match(result.stdout, /share\/doc\/nilla\/LICENSE has mode 0o600/);
  assert.equal(verify().status, 2);
});

test("the package's desktop entry says Nilla while its command, icon and window class keep the engine's names", () => {
  assert.match(desktop, /^Name=Nilla$/m);
  assert.match(desktop, /^Exec=ardia %U$/m);
  assert.match(desktop, /^Icon=ardia$/m);
  assert.match(desktop, /^StartupWMClass=ardia$/m);
  assert.deepEqual(readFileSync(join(packageRoot, `share/icons/hicolor/256x256/apps/${iconName}.png`)), readFileSync(join(repo, "scripts/linux/icons/hicolor/256x256/apps/nilla.png")));
});
