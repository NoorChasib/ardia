#!/usr/bin/env python3
import argparse
import io
import pathlib
import shutil
import stat
import struct
import subprocess
import sys
import tarfile

REPO = pathlib.Path(__file__).resolve().parents[2]
TEXTS = {
    'LICENSE': 'LICENSE',
    'LICENSE.Apache-2.0': 'LICENSE.Apache-2.0',
    'NOTICE': 'NOTICE',
    'bangs-LICENSE': 'third_party/bangs/LICENSE',
    'symbols-THIRD_PARTY_NOTICES.txt': 'apps/linux/src/shims/web/symbols/THIRD_PARTY_NOTICES.txt',
}
FOLDERS = {
    'tarball': ('ardia/lib/ardia/licenses', 'ardia/share/doc/nilla'),
    'deb': ('usr/lib/ardia/licenses', 'usr/share/doc/nilla'),
    'appimage': ('lib/ardia/licenses', 'share/doc/nilla'),
    'arch': ('usr/lib/ardia/licenses', 'usr/share/doc/nilla', 'usr/share/licenses/ardia-bin'),
    'staged': ('lib/ardia/licenses', 'share/doc/nilla'),
}
SQUASHFS_MAGIC = b'hsqs'
DESCRIPTION = '''Checks that Nilla's Linux packages carry the licence texts byte for byte: LICENSE,
LICENSE.Apache-2.0, NOTICE, third_party/bangs/LICENSE as bangs-LICENSE and the Linux
symbol notices as symbols-THIRD_PARTY_NOTICES.txt, each a regular 0644 file, with nothing
else beside them.

  tarball   ardia/lib/ardia/licenses and ardia/share/doc/nilla (tarfile)
  deb       usr/lib/ardia/licenses and usr/share/doc/nilla (dpkg-deb --fsys-tarfile)
  appimage  lib/ardia/licenses and share/doc/nilla (unsquashfs at the runtime's end;
            nothing in the image runs)
  arch      usr/lib/ardia/licenses, usr/share/doc/nilla and usr/share/licenses/ardia-bin
            (a .pkg.tar.zst or .pkg.tar.xz, read with tarfile)
  staged    lib/ardia/licenses and share/doc/nilla under an install root
            (install.sh --destdir D --prefix P gives D/P; an Arch pkgdir gives pkgdir/usr)

It prints one line per package and exits 0 when every package is complete, 1 when
one isn't, and 2 on a usage error.'''


class Problem(Exception):
    pass


def expected():
    texts = {}
    for name, source in TEXTS.items():
        path = REPO / source
        if not path.is_file():
            raise Problem(f'the repo has no {source}')
        texts[name] = path.read_bytes()
    return texts


def tar_listing(archive):
    found = {}
    for member in archive.getmembers():
        name = member.name.removeprefix('./').rstrip('/')
        if member.isfile():
            found[name] = (member.mode & 0o7777, archive.extractfile(member).read())
        else:
            found[name] = (None, None)
    return found


def read_tar(path):
    try:
        with tarfile.open(path) as archive:
            return tar_listing(archive)
    except (tarfile.TarError, OSError, EOFError) as error:
        raise Problem(f'{path} is not a readable tar archive: {error}') from None


def read_deb(path):
    if shutil.which('dpkg-deb') is None:
        raise Problem('dpkg-deb is required to read a .deb')
    result = subprocess.run(['dpkg-deb', '--fsys-tarfile', str(path)], capture_output=True, check=False)
    if result.returncode != 0:
        raise Problem(f'dpkg-deb could not read {path}: {result.stderr.decode(errors="replace").strip()}')
    with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
        return tar_listing(archive)


def appimage_offset(path):
    with open(path, 'rb') as handle:
        header = handle.read(64)
        if header[:4] != b'\x7fELF' or header[4] != 2 or header[5] != 1:
            raise Problem(f'{path} does not start with a little-endian 64-bit ELF runtime')
        section_offset, = struct.unpack_from('<Q', header, 0x28)
        entry_size, count = struct.unpack_from('<HH', header, 0x3A)
        offset = section_offset + entry_size * count
        handle.seek(offset)
        if handle.read(4) != SQUASHFS_MAGIC:
            raise Problem(f'{path} has no squashfs image after its runtime (offset {offset})')
    return offset


def read_appimage(path, folders):
    if shutil.which('unsquashfs') is None:
        raise Problem('unsquashfs is required to read an AppImage')
    offset = str(appimage_offset(path))
    listing = subprocess.run(['unsquashfs', '-o', offset, '-lc', str(path)], capture_output=True, text=True, check=False)
    if listing.returncode != 0:
        raise Problem(f'unsquashfs could not list {path}: {listing.stderr.strip()}')
    found = {}
    for line in listing.stdout.splitlines():
        name = line.strip().removeprefix('squashfs-root').lstrip('/')
        if not any(name.startswith(folder + '/') for folder in folders):
            continue
        detail = subprocess.run(['unsquashfs', '-o', offset, '-lln', str(path), name], capture_output=True, text=True, check=False)
        mode = next((parse_mode(row.split()[0]) for row in detail.stdout.splitlines() if row.rstrip().endswith('/' + name)), None)
        content = subprocess.run(['unsquashfs', '-o', offset, '-cat', str(path), name], capture_output=True, check=False)
        if content.returncode != 0:
            raise Problem(f'unsquashfs could not read {name} from {path}')
        found[name] = (mode, content.stdout)
    return found


def parse_mode(text):
    if len(text) != 10 or text[0] != '-':
        return None
    bits = 0
    for index, flag in enumerate(text[1:]):
        if flag != '-':
            bits |= 1 << (8 - index)
    return bits


def read_staged(root):
    root = pathlib.Path(root)
    if not root.is_dir():
        raise Problem(f'{root} is not a folder')
    found = {}
    for path in root.rglob('*'):
        name = path.relative_to(root).as_posix()
        if path.is_file() and not path.is_symlink():
            found[name] = (stat.S_IMODE(path.stat().st_mode), path.read_bytes())
        else:
            found[name] = (None, None)
    return found


def problems_in(found, folders, texts):
    problems = []
    for folder in folders:
        present = {name.removeprefix(folder + '/') for name in found if name.startswith(folder + '/')}
        for name, content in texts.items():
            entry = found.get(f'{folder}/{name}')
            if entry is None:
                problems.append(f'{folder}/{name} is missing')
            elif entry[1] is None:
                problems.append(f'{folder}/{name} is not a regular file')
            elif entry[1] != content:
                problems.append(f'{folder}/{name} differs from {TEXTS[name]}')
            elif entry[0] != 0o644:
                problems.append(f'{folder}/{name} has mode {oct(entry[0]) if entry[0] is not None else "unknown"}, not 0o644')
        for extra in sorted(present - set(texts)):
            problems.append(f'{folder}/{extra} is not one of the licence texts')
    return problems


def verify(kind, path, texts):
    folders = FOLDERS[kind]
    if kind == 'deb':
        found = read_deb(path)
    elif kind == 'appimage':
        found = read_appimage(path, folders)
    elif kind == 'staged':
        found = read_staged(path)
    else:
        found = read_tar(path)
    return problems_in(found, folders, texts)


def main(argv=None):
    parser = argparse.ArgumentParser(prog='scripts/linux/verify-licenses.py', description=DESCRIPTION, formatter_class=argparse.RawDescriptionHelpFormatter)
    for kind in FOLDERS:
        parser.add_argument(f'--{kind}', action='append', default=[], type=pathlib.Path, metavar='PATH', help=f'a {kind} to check (repeatable)')
    args = parser.parse_args(argv)
    packages = [(kind, path) for kind in FOLDERS for path in getattr(args, kind)]
    if not packages:
        parser.error('name at least one package')
    try:
        texts = expected()
    except Problem as error:
        print(f'verify-licenses: {error}', file=sys.stderr)
        return 1
    failed = False
    for kind, path in packages:
        try:
            problems = verify(kind, path, texts)
        except Problem as error:
            problems = [str(error)]
        if problems:
            failed = True
            print(f'FAIL {kind} {path}: ' + '; '.join(problems))
        else:
            print(f'ok   {kind} {path}: {len(texts)} licence texts in ' + ', '.join(FOLDERS[kind]))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
