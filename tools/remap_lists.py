#!/usr/bin/env python3
import pathlib
import subprocess
import sys

USAGE = """usage: remap_lists.py <repo> <ref> <move-map.tsv> <ownership-dir> <outdir>

Rewrites every wave 3 list (<ownership-dir>/C-*.txt) through the move map
that R's rename tool writes (old path TAB new path, files or directories
ending in /), then checks that every rewritten path is tracked at <ref>.
Writes <outdir>/<owner>.txt and <outdir>/missing.tsv; exits 1 when any
listed path is missing at <ref>. Run it on the commit right after R."""

if len(sys.argv) != 6 or sys.argv[1] in ("-h", "--help"):
    sys.exit(USAGE)
repo, ref, move_map, own_dir, outdir = sys.argv[1:6]
out = pathlib.Path(outdir)
out.mkdir(parents=True, exist_ok=True)

files_moved = {}
dirs_moved = []
for line in open(move_map, encoding="utf-8"):
    line = line.rstrip("\n")
    if not line or line.startswith("from\t"):
        continue
    old, new = line.split("\t")[:2]
    if old.endswith("/"):
        dirs_moved.append((old, new if new.endswith("/") else new + "/"))
    else:
        files_moved[old] = new
dirs_moved.sort(key=lambda pair: -len(pair[0]))


def remap(path):
    if path in files_moved:
        return files_moved[path]
    for old, new in dirs_moved:
        if path.startswith(old):
            return new + path[len(old):]
    return path


tracked = set(subprocess.run(["git", "-C", repo, "ls-tree", "-r", "--name-only", ref], capture_output=True, check=True,
                             text=True).stdout.splitlines())
missing = []
for listing in sorted(pathlib.Path(own_dir).glob("C-*.txt")):
    rewritten = []
    for path in listing.read_text().split("\n"):
        if not path:
            continue
        new = remap(path)
        rewritten.append(new)
        if new not in tracked:
            missing.append((listing.stem, path, new))
    (out / listing.name).write_text("\n".join(sorted(set(rewritten))) + "\n")
    print(f"{listing.stem}: {len(rewritten)} paths, {sum(1 for p in rewritten if p not in tracked)} missing at {ref}")
with open(out / "missing.tsv", "w") as s:
    s.write("owner\tbefore\tafter\n")
    for row in missing:
        s.write("\t".join(row) + "\n")
sys.exit(1 if missing else 0)
