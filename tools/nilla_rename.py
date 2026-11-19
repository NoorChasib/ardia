#!/usr/bin/env python3
"""usage: nilla_rename.py [--root DIR] [--ref REF] [--allowlist FILE] [--edit-list FILE] [--schedule FILE]
                       [--out DIR] [--dry-run] [--stage] [--gate-only] [--worktree]

Wave 2 of the Nilla Layer 1 conversion (plan-v2 2.3 Phase D): the mechanical Ardia -> Nilla rename.

Inputs: the eligible-file list (--edit-list, R-mechanical.txt) plus every path in the move table it
computes; the rules come only from the allowlist (--allowlist, default <root>/apps/browser/src/
naming-allowlist.json). It moves paths first (outermost first, files follow their folders), then runs
the grammar pre-pass and the literal rules longest first on every eligible text file, leaving every
protected span (literal, class, basename, frozen-token, never-renamed and asserted-line entries) as it
was. Binary, generated, lead, frozen, kept and skip files are never edited. The run is deterministic.

Outputs in --out: moves.tsv (from, to, kind; folders end in /), edits.tsv (path, line, rule),
counts.tsv (edits per file) and report.txt (leftover links and hosts, Netnyahoo and tap leftovers,
nilla <word> CLI candidates per wave 3 owner, tokens the skip files still use, unhandled spans).

--dry-run    writes the tables and the report and touches no file in --root.
--stage      stages the moves and edits in --root (git add of exactly those paths).
--gate-only  runs only the pre-commit gate on --root against --ref. It checks the staged blobs (the
             index), which is what a commit records, and warns about paths whose working-tree bytes differ.
--worktree   makes the gate check the working tree instead of the index (labelled "working tree"); a
             real run without --stage always gates the working tree.

The pre-commit gate runs after every real run: (a) every asserted line is byte-identical on its
corresponding line; (b) every protected match of the pre-image, whatever its spelling, is matched again
by the same entry, with the same text, at the line and column the tool's own deterministic transformation
puts it in the post-image (so a copy elsewhere on the line, a decoy, never stands in for it), and a file's
line count changes only by the lines the addsLines rules insert; (c) only eligible and moved paths changed;
(d) the engine key's paths and scripts/windows/engine are untouched; (e) every move happened; (f) every
app target's PRODUCT_NAME, in every build configuration, is its product's name; every scheme reference
names a target ID in its container and that target's product; every workspace member that resolved
still resolves; every -scheme is a shared scheme of the -workspace or -project on the same command; and
the scripts, workflows and docs that name <Product>.app or Contents/MacOS/<Product> use the product
name (a stale Ardia.app passes only inside an entry marked keepsBundleName); (g) every MSBuild and
solution reference (include directories as directories, item includes and imports as files, whatever
the attribute order) resolves after the moves unless it already failed to resolve before them.
Exit status: 0 when the gate passes (or after a dry run), 1 when it fails, 2 on bad input."""
import argparse
import bisect
import collections
import fnmatch
import json
import os
import pathlib
import posixpath
import re
import subprocess
import sys
from xml.etree import ElementTree

WORK = pathlib.Path("/home/noor/ardia-work/nila-cleanup/work")
NAME = re.compile(r"(?i)ardia")
BRAND = re.compile(r"(?i)ardia|nilla|netnyahoo")
APP_REF = re.compile(r"(?<![A-Za-z0-9_.-])(Ardia|Nilla|Netnyahoo)\.app(?![A-Za-z0-9_-])")
EXE_REF = re.compile(r"Contents/MacOS/(Ardia|Nilla|Netnyahoo)(?![A-Za-z0-9_ -])")
SCHEME_REF = re.compile(r"-scheme[ =]+[\"']?([A-Za-z0-9_.-]+)")
CONTAINER_REF = re.compile(r"-(?:workspace|project)[ =]+[\"']?([^\s\"']+\.(?:xcworkspace|xcodeproj))(?![A-Za-z0-9_.-])")
SLN_PROJECT = re.compile(r"^Project\(\"[^\"]*\"\) = \"[^\"]*\", \"([^\"]+)\"", re.M)


def parse_args():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("-h", "--help", action="store_true")
    ap.add_argument("--root", default="/home/noor/Code/ardia")
    ap.add_argument("--ref", default="HEAD")
    ap.add_argument("--allowlist")
    ap.add_argument("--edit-list", default=str(WORK / "ownership-v2/R-mechanical.txt"))
    ap.add_argument("--schedule", default=str(WORK / "ownership-v2/schedule.tsv"))
    ap.add_argument("--out", default=str(WORK / "rename"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stage", action="store_true")
    ap.add_argument("--gate-only", action="store_true")
    ap.add_argument("--worktree", action="store_true")
    args = ap.parse_args()
    if args.help:
        print(__doc__)
        sys.exit(0)
    return args


class Repo:
    def __init__(self, root, ref):
        self.root = root
        self.ref = subprocess.run(["git", "-C", root, "rev-parse", ref], capture_output=True, text=True,
                                  check=True).stdout.strip()

    def git(self, *args, inp=None, check=True):
        return subprocess.run(["git", "-C", self.root, *args], input=inp, capture_output=True, check=check).stdout

    def tracked(self):
        return self.git("ls-tree", "-r", "--name-only", "-z", self.ref).decode().strip("\0").split("\0")

    def tree_listing(self):
        listing = {}
        for line in self.git("ls-tree", "-r", "-z", self.ref).decode().strip("\0").split("\0"):
            meta, path = line.split("\t", 1)
            listing[path] = meta.split()[2]
        return listing

    def index_listing(self):
        listing = {}
        for line in self.git("ls-files", "-s", "-z").decode().strip("\0").split("\0"):
            if not line:
                continue
            meta, path = line.split("\t", 1)
            listing[path] = meta.split()[1]
        return listing

    def blobs(self, paths, listing=None):
        listing = self.tree_listing() if listing is None else listing
        wanted = [p for p in paths if p in listing]
        if not wanted:
            return {}
        out = {}
        batch = self.git("cat-file", "--batch", inp="".join(listing[p] + "\n" for p in wanted).encode())
        pos = 0
        for p in wanted:
            end = batch.index(b"\n", pos)
            size = int(batch[pos:end].split()[2])
            out[p] = batch[end + 1:end + 1 + size]
            pos = end + 1 + size + 1
        return out


def globbed(path, globs):
    return any(fnmatch.fnmatchcase(path, g) for g in globs or [])


def in_scope(path, entry):
    if entry.get("scope") and not globbed(path, entry["scope"]):
        return False
    if entry.get("except") and globbed(path, entry["except"]):
        return False
    return True


def compile_protect(entry):
    if "regex" in entry:
        return re.compile(entry["regex"], re.M)
    text = re.escape(entry["text"])
    if entry.get("quoted"):
        return re.compile(r"(?<=[\"'`])" + text + r"(?=[\"'`])")
    if entry.get("boundary", "word") == "word":
        pre = r"(?<![A-Za-z0-9_])" if re.match(r"\w", entry["text"][0]) else ""
        post = r"(?![A-Za-z0-9_])" if re.match(r"\w", entry["text"][-1]) else ""
        return re.compile(pre + text + post)
    return re.compile(text)


class Allowlist:
    def __init__(self, path):
        self.doc = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        self.paths = self.doc["paths"]
        self.protect = [(e, compile_protect(e)) for e in self.doc["protect"]]
        self.lines = self.doc["lines"]
        self.rules = [(r, re.compile(r["find"], re.M)) for r in self.doc["rules"]]
        self.reports = [(r, re.compile(r["regex"], re.M)) for r in self.doc["reports"]]
        self.moves = self.doc["moves"]
        self.never_component = re.compile(self.moves["neverComponent"])

    def untouchable(self, path):
        p = self.paths
        return globbed(path, p["frozen"] + p["keep"] + p["lead"] + p["generated"] + p["finalByD"] + p["skipTree"])

    def spans(self, path, text):
        found = []
        for entry, rx in self.protect:
            if in_scope(path, entry):
                for m in rx.finditer(text):
                    if m.end() > m.start():
                        found.append((m.start(), m.end(), entry["id"]))
        if self.lines:
            starts = None
            for entry in self.lines:
                if entry["path"] != path:
                    continue
                if starts is None:
                    starts = [0] + [m.end() for m in re.finditer("\n", text)]
                for i, s in enumerate(starts):
                    e = text.find("\n", s)
                    e = len(text) if e < 0 else e
                    if text[s:e] == entry["text"]:
                        found.append((s, e, entry["id"]))
        found.sort()
        merged = []
        for s, e, why in found:
            if merged and s < merged[-1][1]:
                if e > merged[-1][1]:
                    merged[-1] = (merged[-1][0], e, merged[-1][2])
            else:
                merged.append((s, e, why))
        return merged


def placeholder(i):
    return "" + "".join(chr(0xE100 + int(d)) for d in str(i)) + ""


PH = re.compile("([-]+)")


def transform(allow, path, text, limited=None):
    spans = allow.spans(path, text)
    pieces, kept, last = [], [], 0
    for s, e, _ in spans:
        pieces.append(text[last:s])
        pieces.append(placeholder(len(kept)))
        kept.append(text[s:e])
        last = e
    pieces.append(text[last:])
    work = "".join(pieces)
    masked = work
    edits = []
    for rule, rx in allow.rules:
        if limited is not None and rule["id"] not in limited:
            continue
        if not in_scope(path, rule):
            continue
        hits = [m.start() for m in rx.finditer(work)]
        if not hits:
            continue
        starts = [0] + [m.end() for m in re.finditer("\n", work)]
        for h in hits:
            edits.append((bisect.bisect_right(starts, h), rule["id"]))
        work = rx.sub(rule["replace"], work)
    out = PH.sub(lambda m: kept[int("".join(str(ord(c) - 0xE100) for c in m.group(1)))], work)
    return out, edits, spans, work, masked


class Plan:
    def __init__(self, repo, allow, edit_list, schedule):
        self.repo = repo
        self.allow = allow
        self.tracked = repo.tracked()
        tracked_set = set(self.tracked)
        self.wave1_gone = set()
        self.wave3 = {}
        if schedule and os.path.exists(schedule):
            for line in open(schedule, encoding="utf-8"):
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3 or parts[0] == "path":
                    continue
                for step in parts[2].split(" ; "):
                    bits = step.split(":", 2)
                    if bits[0] == "w1" and len(bits) > 2 and bits[2] in ("delete", "move"):
                        self.wave1_gone.add(parts[0])
                    if bits[0] == "w3" and len(bits) > 1:
                        self.wave3[parts[0]] = bits[1]
        listed = [l.strip() for l in open(edit_list, encoding="utf-8") if l.strip()]
        self.missing_listed = sorted(p for p in listed if p not in tracked_set)
        self.compute_moves()
        limited = allow.paths.get("ruleLimited", {})
        eligible = set(p for p in listed if p in tracked_set) | set(self.file_moves)
        self.limited = {p: set(r) for p, r in limited.items() if p in tracked_set}
        eligible |= set(self.limited)
        self.eligible = sorted(p for p in eligible
                               if not allow.untouchable(p) and p not in self.wave1_gone
                               and (p not in allow.paths["skipHand"] or p in self.limited))

    def blocked_dirs(self):
        allow = self.allow
        blocked = set()
        never = [n["glob"] for n in allow.moves["never"]]
        anchors = [p.rstrip("/") for p in allow.moves["contractPaths"]]
        for path in self.tracked:
            if globbed(path, never) or path in self.wave1_gone:
                parts = path.split("/")
                for i in range(1, len(parts)):
                    blocked.add("/".join(parts[:i]))
        for a in anchors:
            parts = a.split("/")
            for i in range(1, len(parts) + 1):
                blocked.add("/".join(parts[:i]))
        for g in never:
            if "*" not in g:
                blocked.add(g)
        return blocked

    def new_component(self, name):
        if self.allow.never_component.search(name) or not NAME.search(name):
            return name
        for old, new in self.allow.moves["componentCase"]:
            name = name.replace(old, new)
        return name

    def compute_moves(self):
        allow = self.allow
        blocked = self.blocked_dirs()
        self.blocked = blocked
        dirs = set()
        for path in self.tracked:
            parts = path.split("/")
            for i in range(1, len(parts)):
                dirs.add("/".join(parts[:i]))
        maps = [(re.compile(m["match"]), m) for m in allow.moves["componentMaps"]]
        final = {"": ""}
        for d in sorted(dirs, key=lambda x: (x.count("/"), x)):
            parent, _, name = d.rpartition("/")
            base = final[parent]
            if d in blocked:
                final[d] = (base + "/" if base else "") + name
                continue
            rule = next((m for rx, m in maps if rx.search(d)), None)
            if rule and rule.get("merge"):
                final[d] = base
            elif rule:
                final[d] = (base + "/" if base else "") + rule["replace"]
            else:
                final[d] = (base + "/" if base else "") + self.new_component(name)
        basename_only = allow.moves["basenameOnly"]
        never = [n["glob"] for n in allow.moves["never"]]
        anchors = set(p.rstrip("/") for p in allow.moves["contractPaths"])
        file_moves = {}
        for path in self.tracked:
            if path in self.wave1_gone or globbed(path, never):
                continue
            parent, _, name = path.rpartition("/")
            new_name = name
            if path not in anchors and not globbed(path, basename_only):
                new_name = self.new_component(name)
            new = (final[parent] + "/" if final[parent] else "") + new_name
            if new != path:
                file_moves[path] = new
        targets = collections.Counter(file_moves.values())
        stay = set(self.tracked) - set(file_moves)
        self.collisions = sorted(t for t, n in targets.items() if n > 1 or t in stay)
        self.file_moves = file_moves
        self.dir_final = final
        self.dir_moves = {d: f for d, f in final.items() if d and f != d}

    def move_rows(self):
        rows = []
        for d in sorted(self.dir_moves, key=lambda x: (x.count("/"), x)):
            parent, _, name = d.rpartition("/")
            implied = (self.dir_final[parent] + "/" if parent else "") + name
            if implied != self.dir_final[d]:
                rows.append((d + "/", self.dir_final[d] + "/", "dir"))
        for f in sorted(self.file_moves):
            parent, _, name = f.rpartition("/")
            implied = (self.dir_final[parent] + "/" if parent else "") + name
            if implied != self.file_moves[f]:
                rows.append((f, self.file_moves[f], "file"))
        return rows


def run(args):
    root = str(pathlib.Path(args.root).resolve())
    repo = Repo(root, args.ref)
    allow_path = args.allowlist or os.path.join(root, "apps/browser/src/naming-allowlist.json")
    if not os.path.exists(allow_path):
        print(f"nilla_rename: no allowlist at {allow_path}", file=sys.stderr)
        return 2
    allow = Allowlist(allow_path)
    plan = Plan(repo, allow, args.edit_list, args.schedule)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if plan.collisions:
        for c in plan.collisions:
            print(f"nilla_rename: two paths would move to {c}", file=sys.stderr)
        return 2
    if args.gate_only:
        return gate(repo, allow, plan, staged=not args.worktree)
    blobs = repo.blobs(sorted(set(plan.eligible) | set(allow.paths["skipHand"])))
    results = {}
    skipped = collections.Counter()
    for path in plan.eligible:
        blob = blobs.get(path)
        if blob is None:
            continue
        if b"\0" in blob[:8000]:
            skipped["binary"] += 1
            continue
        try:
            text = blob.decode("utf-8")
        except UnicodeDecodeError:
            skipped["not utf-8"] += 1
            continue
        if "" in text or "" in text:
            skipped["holds placeholder characters"] += 1
            print(f"nilla_rename: {path} holds U+E000/U+E001 and was left alone", file=sys.stderr)
            continue
        new, edits, spans, work, masked = transform(allow, path, text, plan.limited.get(path))
        results[path] = (text, new, edits, spans, work, masked)
    write_tables(out, plan, results)
    report(out, allow, plan, results, blobs, skipped)
    if args.dry_run:
        print(f"dry run: {len(plan.file_moves)} files move ({len(plan.dir_moves)} folders), "
              f"{sum(1 for r in results.values() if r[0] != r[1])} files change, "
              f"{sum(len(r[2]) for r in results.values())} edits; tables in {out}")
        return 0
    apply(root, plan, results)
    if args.stage:
        stage(repo, plan, results)
    return gate(repo, allow, plan, staged=args.stage and not args.worktree)


def write_tables(out, plan, results):
    with open(out / "moves.tsv", "w", encoding="utf-8") as f:
        f.write("from\tto\tkind\n")
        for row in plan.move_rows():
            f.write("\t".join(row) + "\n")
    with open(out / "edits.tsv", "w", encoding="utf-8") as f:
        f.write("path\tline\trule\n")
        for path in sorted(results):
            for line, rule in sorted(results[path][2]):
                f.write(f"{path}\t{line}\t{rule}\n")
    with open(out / "counts.tsv", "w", encoding="utf-8") as f:
        f.write("edits\tpath\tnew_path\n")
        for path in sorted(results):
            n = len(results[path][2])
            if n:
                f.write(f"{n}\t{path}\t{plan.file_moves.get(path, path)}\n")


def family(path):
    parts = path.split("/")
    if parts[:2] in (["apps", "linux"], ["scripts", "linux"]):
        return "linux"
    return "/".join(parts[:2])


def report(out, allow, plan, results, blobs, skipped):
    lines = []
    by_rule = collections.Counter(rule for r in results.values() for _, rule in r[2])
    lines.append("edits by rule: " + ", ".join(f"{k} {v}" for k, v in sorted(by_rule.items())))
    lines.append(f"eligible files: {len(plan.eligible)}; text files read: {len(results)}; changed: "
                 f"{sum(1 for r in results.values() if r[0] != r[1])}; skipped: {dict(skipped)}")
    lines.append(f"moves: {len(plan.file_moves)} files, {len(plan.dir_moves)} folders; "
                 f"listed paths not tracked at the ref: {len(plan.missing_listed)}")
    for p in plan.missing_listed[:20]:
        lines.append(f"  not tracked: {p}")
    for rep, rx in allow.reports:
        found = collections.defaultdict(list)
        for path, (old, new, edits, spans, work, masked) in sorted(results.items()):
            haystack = work if rep["id"] == "upstream-links" else old if rep.get("scan") == "pre" else new
            starts = [0] + [m.end() for m in re.finditer("\n", haystack)]
            for m in rx.finditer(haystack):
                ln = bisect.bisect_right(starts, m.start())
                owner = plan.wave3.get(path, "-")
                found[owner].append(f"{plan.file_moves.get(path, path)}:{ln}: {haystack[starts[ln - 1]:][:140].splitlines()[0].strip()}")
        total = sum(len(v) for v in found.values())
        lines.append("")
        lines.append(f"[{rep['id']}] {rep['what']}: {total}")
        for owner in sorted(found):
            lines.append(f"  {owner}: {len(found[owner])}")
            for item in found[owner][:400]:
                lines.append("    " + item)
    renamed_tokens = collections.defaultdict(collections.Counter)
    tok = re.compile(r"[A-Za-z0-9_]*(?i:ardia)[A-Za-z0-9_]*")
    for path, (old, new, edits, spans, work, masked) in results.items():
        if path in plan.limited:
            continue
        for t in set(tok.findall(masked)):
            renamed_tokens[family(path)][t] += 1
    drift = []
    for path in sorted(allow.paths["skipHand"]):
        blob = blobs.get(path)
        if not blob or b"\0" in blob[:8000] or path in plan.limited:
            continue
        text = blob.decode("utf-8", "replace")
        own = set(tok.findall(text))
        for t in sorted(own):
            if t in ("Ardia", "ardia", "ARDIA"):
                continue
            n = renamed_tokens[family(path)].get(t)
            if n:
                drift.append(f"  {path} ({allow.paths['skipHand'][path]}): {t} (renamed in {n} R files of {family(path)})")
    lines.append("")
    lines.append(f"[skip-file drift] tokens the skip files keep that R renamed elsewhere: {len(drift)}")
    lines.extend(drift)
    unhandled = []
    for path, (old, new, edits, spans, work, masked) in sorted(results.items()):
        if path in plan.limited:
            continue
        for m in re.finditer(r"(?i)ardia", PH.sub("", work)):
            unhandled.append(f"  {path}")
            break
    lines.append("")
    lines.append(f"[unhandled] files with an unprotected ardia left after the rules: {len(unhandled)}")
    lines.extend(unhandled)
    (out / "report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(l for l in lines if not l.startswith("    ")))


def apply(root, plan, results):
    for old in sorted(plan.file_moves, key=lambda p: (p.count("/"), p)):
        new = plan.file_moves[old]
        src = os.path.join(root, old)
        dst = os.path.join(root, new)
        os.makedirs(os.path.dirname(dst) or root, exist_ok=True)
        os.rename(src, dst)
    for path, (old, new, edits, spans, work, masked) in results.items():
        if old != new:
            target = os.path.join(root, plan.file_moves.get(path, path))
            mode = os.stat(target).st_mode
            with open(target, "w", encoding="utf-8", newline="") as f:
                f.write(new)
            os.chmod(target, mode)
    for old in sorted(plan.file_moves, key=lambda p: -p.count("/")):
        d = os.path.dirname(os.path.join(root, old))
        while d.startswith(root + "/") and os.path.isdir(d) and not os.listdir(d):
            os.rmdir(d)
            d = os.path.dirname(d)


def stage(repo, plan, results):
    paths = sorted(set(plan.file_moves) | set(plan.file_moves.values())
                   | {plan.file_moves.get(p, p) for p, r in results.items() if r[0] != r[1]})
    for i in range(0, len(paths), 500):
        repo.git("add", "-A", "--", *paths[i:i + 500])


def line_starts(text):
    return [0] + [m.end() for m in re.finditer("\n", text)]


def inserted_lines(allow, path, before, limited):
    inserts = collections.Counter()
    starts = None
    for rule, rx in allow.rules:
        if not rule.get("addsLines") or not in_scope(path, rule) or (limited is not None and rule["id"] not in limited):
            continue
        for m in rx.finditer(before):
            extra = m.expand(rule["replace"]).count("\n") - m.group(0).count("\n")
            if extra:
                starts = starts or line_starts(before)
                inserts[bisect.bisect_right(starts, max(m.end() - 1, m.start()))] += extra
    return inserts


class LineMap:
    def __init__(self, before_lines, inserts):
        self.first = [0] * (len(before_lines) + 2)
        offset = 0
        for ln in range(1, len(before_lines) + 1):
            self.first[ln] = ln + offset
            offset += inserts.get(ln, 0)
        self.inserts = inserts
        self.expected = len(before_lines) + offset

    def span(self, first_line, last_line):
        return self.first[first_line], self.first[last_line] + self.inserts.get(last_line, 0)


def check_shape_and_spans(allow, path, before, after, limited, failures):
    before_lines = before.split("\n")
    after_lines = after.split("\n")
    lmap = LineMap(before_lines, inserted_lines(allow, path, before, limited))
    if len(after_lines) != lmap.expected:
        failures.append(f"(b) {path}: {len(before_lines)} lines became {len(after_lines)}, but the rules insert "
                        f"{lmap.expected - len(before_lines)}: protected spans cannot be mapped to their lines")
        return

    def segment(first_line, last_line):
        a, b = lmap.span(first_line, last_line)
        return "\n".join(after_lines[a - 1:b])

    for entry in allow.lines:
        if entry["path"] != path:
            continue
        for ln, line in enumerate(before_lines, 1):
            if line == entry["text"] and line not in segment(ln, ln).split("\n"):
                failures.append(f"(a) {path}:{ln}: asserted line changed: {entry['text'][:100]}")
    expected, spans, where, lost = placed_spans(allow, path, before, limited)
    if expected.count("\n") != after.count("\n"):
        failures.append(f"(b) {path}: the tool's own output has {expected.count(chr(10)) + 1} lines and the post-image "
                        f"{len(after_lines)}: protected spans cannot be placed")
        return
    before_starts, expected_starts, after_starts = line_starts(before), line_starts(expected), line_starts(after)
    span_starts = [s for s, _, _ in spans]

    def line_and_column(starts, offset):
        line = bisect.bisect_right(starts, offset)
        return line, offset - starts[line - 1]

    present = {(why, *line_and_column(after_starts, start), text) for why, start, _, text in protected_offsets(allow, path, after)}
    for why, start, end, text in protected_offsets(allow, path, before):
        line = bisect.bisect_right(before_starts, start)
        k = bisect.bisect_right(span_starts, start) - 1
        if k < 0 or k in lost or end > spans[k][1]:
            failures.append(f"(b) {path}:{line}: protected span {text[:80]!r} ({why}) changed: the rules moved or "
                            f"copied its placeholder")
            continue
        target = where[k] + (start - spans[k][0])
        if (why, *line_and_column(expected_starts, target), text) not in present:
            failures.append(f"(b) {path}:{line}: protected span {text[:80]!r} ({why}) changed")


def placed_spans(allow, path, before, limited):
    if "\ue000" in before or "\ue001" in before:
        spans = allow.spans(path, before)
        return before, spans, {k: s for k, (s, _, _) in enumerate(spans)}, set()
    expected, _, spans, work, _ = transform(allow, path, before, limited)
    seen = collections.Counter()
    where = {}
    shift = 0
    for m in PH.finditer(work):
        k = int("".join(str(ord(c) - 0xE100) for c in m.group(1)))
        seen[k] += 1
        where[k] = m.start() + shift
        shift += (spans[k][1] - spans[k][0]) - (m.end() - m.start())
    lost = {k for k in range(len(spans)) if seen[k] != 1}
    return expected, spans, where, lost


def protected_offsets(allow, path, text):
    out = []
    for entry, rx in allow.protect:
        if not in_scope(path, entry):
            continue
        for m in rx.finditer(text):
            if m.end() > m.start():
                out.append((entry["id"], m.start(), m.end(), m.group(0)))
    return out


def tree_dirs(paths):
    dirs = set()
    for path in paths:
        parts = path.split("/")
        for i in range(1, len(parts)):
            dirs.add("/".join(parts[:i]))
    return dirs


class Tree:
    def __init__(self, plan, pre_paths, post_paths):
        self.plan = plan
        self.pre_paths, self.post_paths = pre_paths, post_paths
        self.pre_dirs, self.post_dirs = tree_dirs(pre_paths), tree_dirs(post_paths)

    def resolves(self, kind, path, post):
        paths, dirs = (self.post_paths, self.post_dirs) if post else (self.pre_paths, self.pre_dirs)
        return path in dirs if kind == "dir" else path in paths if kind == "file" else path in paths or path in dirs

    def moved(self, path):
        if path in self.plan.file_moves:
            return self.plan.file_moves[path]
        head, rest = path, ""
        while head:
            if head in self.plan.dir_final:
                return self.plan.dir_final[head] + rest
            head, _, tail = head.rpartition("/")
            rest = "/" + tail + rest
        return path

    def check(self, label, target, old_refs, new_refs, failures, what):
        stale = set()
        for ref in old_refs:
            if ref[1] is not None and not self.resolves(ref[0], ref[1], False):
                stale |= {ref, (ref[0], self.moved(ref[1]))}
        same = len(old_refs) == len(new_refs)
        for i, ref in enumerate(new_refs):
            kind, path = ref
            if path is None or self.resolves(kind, path, True) or ref in stale:
                continue
            old = old_refs[i][1] if same else None
            noun = {"dir": "directory", "file": "file"}.get(kind, "path")
            failures.append(f"({label}) {target}: {what} {path} is not an existing {noun} after the moves"
                            + (f" (it was {old})" if old and old != path else ""))


MSBUILD_DIR_LISTS = {"AdditionalIncludeDirectories", "AdditionalLibraryDirectories"}
MSBUILD_NOT_PATHS = {"Filter", "ProjectConfiguration", "ProjectCapability", "PackageReference", "PropertyPageSchema",
                     "AvailableItemName", "ProjectTools"}
MSBUILD_MACROS = ("$(MSBuildThisFileDirectory)", "$(ProjectDir)", "$(MSBuildProjectDirectory)\\", "$(MSBuildProjectDirectory)/")


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def msbuild_refs(path, text):
    raw = []
    if path.endswith(".sln"):
        raw = [("file", m.group(1)) for m in SLN_PROJECT.finditer(text)]
    else:
        root = ElementTree.fromstring(text.lstrip("﻿").encode("utf-8"))
        for el in root.iter():
            tag = local_name(el.tag)
            if tag in MSBUILD_DIR_LISTS:
                raw.extend(("dir", item) for item in (el.text or "").split(";"))
            elif tag == "Import":
                raw.append(("file", el.get("Project", "")))
            elif tag == "ItemGroup":
                for item in el:
                    if local_name(item.tag) not in MSBUILD_NOT_PATHS and item.get("Include") is not None:
                        raw.extend(("file", part) for part in item.get("Include").split(";"))
    base = posixpath.dirname(path)
    refs = []
    for kind, item in raw:
        item = item.strip()
        for macro in MSBUILD_MACROS:
            item = item.replace(macro, "")
        if not item or "$(" in item or "%(" in item or "*" in item or ":" in item:
            refs.append((kind, None))
            continue
        resolved = posixpath.normpath(posixpath.join(base, item.replace("\\", "/")))
        refs.append((kind, None if resolved.startswith("..") else resolved))
    return refs


def check_msbuild(pairs, tree, failures):
    for src, target, before, after in pairs:
        if not target.endswith((".vcxproj", ".props", ".targets", ".sln", ".filters")):
            continue
        try:
            old_refs = msbuild_refs(src, before)
        except ElementTree.ParseError:
            continue
        try:
            new_refs = msbuild_refs(target, after)
        except ElementTree.ParseError as e:
            failures.append(f"(g) {target}: not well-formed MSBuild XML after the rename ({e})")
            continue
        tree.check("g", target, old_refs, new_refs, failures, "MSBuild reference")


PBX_TOKEN = re.compile(r'\s+|//[^\n]*|/\*.*?\*/|"((?:[^"\\]|\\.)*)"|([^\s{}()=;,"]+)|([{}()=;,])', re.S)


def parse_pbx(text):
    tokens = []
    pos = 0
    while pos < len(text):
        m = PBX_TOKEN.match(text, pos)
        if not m:
            raise ValueError(f"unexpected {text[pos:pos + 20]!r} at {pos}")
        pos = m.end()
        if m.group(1) is not None:
            tokens.append(("s", re.sub(r"\\(.)", lambda e: {"n": "\n", "t": "\t"}.get(e.group(1), e.group(1)), m.group(1))))
        elif m.group(2) is not None:
            tokens.append(("s", m.group(2)))
        elif m.group(3) is not None:
            tokens.append(("p", m.group(3)))

    def value(i):
        kind, tok = tokens[i]
        if kind == "p" and tok == "{":
            d, i = {}, i + 1
            while tokens[i] != ("p", "}"):
                k, i = value(i)
                if tokens[i] != ("p", "="):
                    raise ValueError(f"expected = after {k}")
                d[k], i = value(i + 1)
                if tokens[i] != ("p", ";"):
                    raise ValueError(f"expected ; after {k}")
                i += 1
            return d, i + 1
        if kind == "p" and tok == "(":
            items, i = [], i + 1
            while tokens[i] != ("p", ")"):
                v, i = value(i)
                items.append(v)
                if tokens[i] == ("p", ","):
                    i += 1
            return items, i + 1
        if kind == "p":
            raise ValueError(f"unexpected {tok}")
        return tok, i + 1

    return value(0)[0]


def xcode_targets(text):
    root = parse_pbx(text)
    objs = root["objects"]
    project = objs[root["rootObject"]]

    def configs(list_id):
        return {objs[c]["name"]: objs[c].get("buildSettings", {}) for c in objs[list_id]["buildConfigurations"]}

    project_configs = configs(project["buildConfigurationList"])
    targets = {}
    for tid in project.get("targets", []):
        t = objs[tid]
        ref = objs.get(t.get("productReference"), {})
        names = {}
        for config, settings in configs(t["buildConfigurationList"]).items():
            name = settings.get("PRODUCT_NAME", project_configs.get(config, {}).get("PRODUCT_NAME", "$(TARGET_NAME)"))
            names[config] = name.replace("$(TARGET_NAME)", t["name"]).replace("${TARGET_NAME}", t["name"])
        targets[tid] = {"name": t["name"], "product": ref.get("path"), "configs": names}
    return targets


def container_of(path):
    for ext in (".xcodeproj", ".xcworkspace"):
        if ext + "/" in path:
            return path[:path.index(ext + "/") + len(ext)]
    return None


def workspace_of(path):
    return path[:-len("/contents.xcworkspacedata")]


def workspace_members(path, text):
    workspace = workspace_of(path)
    home = posixpath.dirname(workspace)
    own = home if home.endswith(".xcodeproj") else workspace
    members = []

    def walk(el, base):
        for child in el:
            tag = local_name(child.tag)
            kind, _, loc = child.get("location", "").partition(":")
            if kind == "group":
                ref = posixpath.normpath(posixpath.join(base, loc))
            elif kind == "container":
                ref = posixpath.normpath(posixpath.join(home, loc))
            elif kind == "self":
                ref = own
            else:
                ref = None
            if tag == "Group":
                walk(child, ref if ref is not None else base)
            elif tag == "FileRef":
                members.append(("any", None if ref is None or ref.startswith("..") else ref))

    walk(ElementTree.fromstring(text.encode("utf-8")), home)
    return members


def logical_lines(text):
    out = []
    start, buf = 1, []
    for ln, line in enumerate(text.split("\n"), 1):
        if not buf:
            start = ln
        if line.rstrip().endswith("\\"):
            buf.append(line.rstrip()[:-1])
            continue
        buf.append(line)
        out.append((start, " ".join(buf)))
        buf = []
    if buf:
        out.append((start, " ".join(buf)))
    return out


def container_candidates(token, post_dirs):
    parts = [p for p in token.split("/") if p not in ("", ".")]
    last_var = max((i for i, p in enumerate(parts) if "$" in p or "{" in p or "}" in p), default=-1)
    suffix = "/".join(parts[last_var + 1:])
    found = sorted(d for d in post_dirs if d == suffix or d.endswith("/" + suffix))
    if not found:
        found = sorted(d for d in post_dirs if d.rsplit("/", 1)[-1] == parts[-1])
    return found


def check_products(allow, pairs, tree, failures):
    post_paths, post_dirs = tree.post_paths, tree.post_dirs
    projects = {}
    stems = set()
    for src, target, before, after in pairs:
        if not target.endswith(".pbxproj"):
            continue
        project = container_of(target)
        try:
            xcode_targets(before)
        except (ValueError, KeyError, IndexError, TypeError):
            continue
        try:
            targets = xcode_targets(after)
        except (ValueError, KeyError, IndexError, TypeError) as e:
            failures.append(f"(f) {target}: the project no longer parses ({e})")
            continue
        projects[project] = targets
        apps, names = set(), set()
        for info in targets.values():
            product = info["product"] or ""
            if not product.endswith(".app"):
                continue
            stem = product[:-len(".app")]
            apps.add(stem)
            for config, name in sorted(info["configs"].items()):
                if "$" in name:
                    continue
                names.add(name)
                if name != stem:
                    failures.append(f"(f) {target}: target {info['name']}'s {config} PRODUCT_NAME {name} is not its product {product}")
        for app in sorted(set(re.findall(r"path = \"?([^\";]+)\.app\"?; sourceTree = BUILT_PRODUCTS_DIR", after)) - apps):
            failures.append(f"(f) {target}: the product reference {app}.app is no app target's product ({', '.join(sorted(apps))}.app)")
        for app in sorted(set(re.findall(r"/\* ([^*/]+)\.app \*/", after)) - apps):
            failures.append(f"(f) {target}: {app}.app is named in the project but is not its product ({', '.join(sorted(apps))}.app)")
        stems |= names & {"Ardia", "Nilla", "Netnyahoo"}
    shared = collections.defaultdict(set)
    for p in post_paths:
        if p.endswith(".xcscheme") and "/xcshareddata/xcschemes/" in p:
            shared[container_of(p)].add(p.rsplit("/", 1)[-1][:-len(".xcscheme")])
    every_scheme = set().union(*shared.values()) if shared else set()
    members = {}
    for src, target, before, after in pairs:
        if not target.endswith(".xcworkspace/contents.xcworkspacedata"):
            continue
        try:
            old = workspace_members(src, before)
        except ElementTree.ParseError:
            continue
        try:
            new = workspace_members(target, after)
        except ElementTree.ParseError as e:
            failures.append(f"(f) {target}: not well-formed workspace XML after the rename ({e})")
            continue
        tree.check("f", target, old, new, failures, "workspace member")
        members[workspace_of(target)] = [ref for _, ref in new if ref]

    def schemes_in(container):
        if container.endswith(".xcworkspace") and container not in members:
            return every_scheme
        found = set(shared.get(container, ()))
        for member in members.get(container, ()):
            found |= shared.get(member, set())
        return found

    for src, target, before, after in pairs:
        if target.endswith(".xcscheme") and container_of(target):
            home = posixpath.dirname(container_of(target))
            try:
                scheme_xml = ElementTree.fromstring(after.encode("utf-8"))
            except ElementTree.ParseError as e:
                failures.append(f"(f) {target}: not well-formed scheme XML after the rename ({e})")
                continue
            for el in scheme_xml.iter("BuildableReference"):
                container = el.get("ReferencedContainer", "")
                if not container.startswith("container:"):
                    continue
                ref = posixpath.normpath(posixpath.join(home, container[len("container:"):]))
                if ref not in post_dirs:
                    failures.append(f"(f) {target}: ReferencedContainer {container[len('container:'):]} does not exist after the moves")
                    continue
                if ref not in projects:
                    continue
                info = projects[ref].get(el.get("BlueprintIdentifier"))
                if info is None:
                    failures.append(f"(f) {target}: BlueprintIdentifier {el.get('BlueprintIdentifier')} ({el.get('BlueprintName')}) is no target of {ref}")
                    continue
                if el.get("BlueprintName") != info["name"]:
                    failures.append(f"(f) {target}: BlueprintName {el.get('BlueprintName')} is not the target's name {info['name']}")
                name = el.get("BuildableName", "")
                if name.endswith(".app") and name != info["product"]:
                    failures.append(f"(f) {target}: BuildableName {name} is not target {info['name']}'s product {info['product']}")
        if target.endswith((".pbxproj", ".xcscheme", ".xcworkspacedata")):
            continue
        spans = None
        starts = None
        for rx, what in ((APP_REF, "{}.app"), (EXE_REF, "Contents/MacOS/{}")):
            if not stems:
                break
            for m in rx.finditer(after):
                if m.group(1) in stems:
                    continue
                if spans is None:
                    spans = [(k.start(), k.end()) for entry, krx in allow.protect
                             if entry.get("keepsBundleName") and in_scope(src, entry) for k in krx.finditer(after)]
                if any(s <= m.start() and m.end() <= e for s, e in spans):
                    continue
                starts = starts or line_starts(after)
                failures.append(f"(f) {target}:{bisect.bisect_right(starts, m.start())}: {what.format(m.group(1))} "
                                f"is not the product ({', '.join(sorted(stems))}) and no exception keeps it")
        if not ("-scheme" in after or "-workspace" in after or "-project" in after):
            continue
        for ln, line in logical_lines(after):
            containers = []
            for m in CONTAINER_REF.finditer(line):
                found = container_candidates(m.group(1), post_dirs)
                if not found and BRAND.search(m.group(1).rsplit("/", 1)[-1]):
                    failures.append(f"(f) {target}:{ln}: {m.group(1).rsplit('/', 1)[-1]} does not exist after the moves")
                containers.extend(found)
            for m in SCHEME_REF.finditer(line):
                scheme = m.group(1)
                if not BRAND.search(scheme):
                    continue
                if containers:
                    if not any(scheme in schemes_in(c) for c in containers):
                        failures.append(f"(f) {target}:{ln}: -scheme {scheme} is not a shared scheme of {' or '.join(containers)}")
                elif scheme not in every_scheme:
                    failures.append(f"(f) {target}:{ln}: -scheme {scheme} names no scheme")


def gate(repo, allow, plan, staged=False):
    root = repo.root
    failures = []
    warnings = []
    pre = repo.blobs(plan.eligible)
    index = repo.index_listing() if staged else None
    targets = sorted({plan.file_moves.get(p, p) for p in plan.eligible})
    staged_blobs = repo.blobs(targets, index) if staged else None

    def present(path):
        return path in index if staged else os.path.exists(os.path.join(root, path))

    def after_text(path):
        if staged:
            return staged_blobs[path].decode("utf-8", errors="replace")
        return pathlib.Path(os.path.join(root, path)).read_text(encoding="utf-8", errors="replace")

    pairs = []
    for path in plan.eligible:
        blob = pre.get(path)
        if blob is None or b"\0" in blob[:8000]:
            continue
        try:
            before = blob.decode("utf-8")
        except UnicodeDecodeError:
            continue
        target = plan.file_moves.get(path, path)
        if not present(target):
            failures.append(f"(e) {path} -> {target} is missing")
            continue
        after = after_text(target)
        if staged:
            disk = os.path.join(root, target)
            if not os.path.exists(disk) or pathlib.Path(disk).read_bytes() != staged_blobs[target]:
                warnings.append(f"{target}: the working tree differs from the staged blob (the gate checked the staged blob)")
        check_shape_and_spans(allow, path, before, after, plan.limited.get(path), failures)
        pairs.append((path, target, before, after))
    tree = Tree(plan, set(plan.tracked), set(index) if staged else {plan.file_moves.get(p, p) for p in plan.tracked})
    check_products(allow, pairs, tree, failures)
    check_msbuild(pairs, tree, failures)
    for old, new in plan.file_moves.items():
        if present(old) and old not in plan.file_moves.values():
            failures.append(f"(e) {old} was not moved to {new}")
        if not present(new):
            failures.append(f"(e) {new} does not exist")
    allowed = set(plan.eligible) | set(plan.file_moves) | set(plan.file_moves.values())
    staged_new = repo.git("diff", "--cached", "--name-only", "-z", "--no-renames", repo.ref).decode().strip("\0").split("\0")
    if staged:
        changed, untracked = [], []
    else:
        changed = repo.git("diff", "--name-only", "-z", "--no-renames", repo.ref).decode().strip("\0").split("\0")
        untracked = repo.git("ls-files", "--others", "--exclude-standard", "-z").decode().strip("\0").split("\0")
    for path in sorted(set(changed + untracked + staged_new) - {""}):
        if path not in allowed:
            failures.append(f"(c) {path} changed but is neither eligible nor moved")
    key_paths = subprocess.run([os.path.join(root, "engine/engine-key.sh"), "--paths"], cwd=root, capture_output=True,
                               text=True).stdout.split()
    touched = set(repo.git("diff", "--cached", "--name-only", repo.ref, "--", *key_paths, "scripts/windows/engine").decode().split())
    if not staged:
        touched |= set(repo.git("diff", "--name-only", repo.ref, "--", *key_paths, "scripts/windows/engine").decode().split())
    if touched:
        failures.append("(d) engine key paths changed: " + " ".join(sorted(touched)[:10]))
    what = "staged blobs" if staged else "working tree"
    for w in warnings[:50]:
        print("gate: warning: " + w)
    for f in failures[:200]:
        print("gate: " + f)
    print(f"gate ({what}): {'FAILED' if failures else 'passed'} ({len(failures)} problems; {len(plan.eligible)} files checked, "
          f"{len(plan.file_moves)} moves; {len(warnings)} unstaged differences)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run(parse_args()))
