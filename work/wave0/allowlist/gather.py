#!/usr/bin/env python3
import collections
import csv
import subprocess
import sys

repo, ref, own = sys.argv[1:4]


def git(*args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, errors="replace").stdout


def platform(p):
    if p.startswith("scripts/windows/engine/"):
        return "win"
    if p.startswith("engine/ardiacore-linux/") or "linux" in p.split("/")[-1]:
        return "linux"
    if p.startswith("engine/ardiacore/"):
        return "mac"
    if "/tests/" in p or "/test" in p:
        return "test"
    if p.startswith("engine/chromium/"):
        return "chromium"
    return "patch"


def area(p):
    for pre, name in [("apps/linux/", "linux"), ("scripts/linux/", "linux"), ("apps/browser/windows/", "win"),
                      ("packages/expo-windows/", "win"), ("scripts/windows/", "win"), ("apps/browser/macos/", "mac"),
                      ("packages/ardiacore/", "ardiacore"), ("apps/cli/", "cli"), ("apps/phone/", "phone"),
                      ("packages/phone/", "phone"), ("apps/browser/src/", "ui"), ("packages/", "pkg"),
                      ("docs/", "docs"), ("apps/browser/scripts/", "scripts"), ("scripts/", "scripts"),
                      (".github/", "gh"), (".claude/", "claude"), ("apps/site/", "site"), ("infra/", "infra"),
                      ("extras/", "extras"), ("apps/", "apps")]:
        if p.startswith(pre):
            return name
    return "root"


occ = collections.defaultdict(list)
with open(f"{own}/engine-literal-occurrences.tsv") as f:
    r = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
    next(r)
    for row in r:
        occ[row[0]].append(row)
out = csv.writer(sys.stdout, delimiter="\t", quoting=csv.QUOTE_NONE, escapechar="\\", lineterminator="\n")
out.writerow(["literal", "engine_files", "engine_platforms", "occ", "files", "areas", "scheds"])
with open(f"{own}/engine-literals.tsv") as f:
    r = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
    next(r)
    for row in r:
        lit = row[0]
        efiles = [l for l in git("grep", "-F", "-l", "-e", lit, ref, "--", "engine", "scripts/windows/engine").splitlines()]
        efiles = [l.split(":", 1)[1] for l in efiles]
        plats = collections.Counter(platform(p) for p in efiles)
        rows = occ.get(lit, [])
        files = sorted({x[1] for x in rows})
        areas = collections.Counter(area(p) for p in files)
        scheds = collections.Counter(x[6].split(" ; ")[0].split(":")[1] if x[6] != "-" else "-" for x in rows)
        out.writerow([lit, len(efiles), ",".join(f"{k}{v}" for k, v in sorted(plats.items())), len(rows), len(files),
                      ",".join(f"{k}{v}" for k, v in sorted(areas.items())),
                      ",".join(f"{k}{v}" for k, v in sorted(scheds.items()))])
