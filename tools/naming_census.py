#!/usr/bin/env python3
"""Census of ardia/netnyahoo occurrences at a git ref, classified for the Nila rename.

usage: naming_census.py <repo> <ref> <workdir>
Reads `git grep` of the ref (no checkout), writes <workdir>/census.json and census.tsv.
"""
import collections, json, re, subprocess, sys

repo, ref, work = sys.argv[1:4]

def git(*args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True, errors="replace").stdout

raw = git("grep", "-I", "-n", "-i", "-E", "ardia|netnyahoo", ref)
eng_switches = set(open(f"{work}/eng_switches.txt").read().split())
eng_env = set(open(f"{work}/eng_env.txt").read().split()) - {"ARDIA_"}
iface_lits = set()
for line in open(f"{work}/iface_lits.txt"):
    lit = line.strip().split(" ", 1)[1]
    if lit not in ('"Ardia"', '"ardia"', '"Ardia "', '"ardiacore"', '"ardiacore:"'):
        iface_lits.add(lit)

TOKEN = re.compile(r"[A-Za-z0-9_]*(?:ardia|netnyahoo)[A-Za-z0-9_]*", re.I)
FALSE_POS = re.compile(r"guardian|ancardia|lombardia|cardiac", re.I)
DOC_EXT = (".md", ".mdx", ".txt", ".td")
L2_PATHS = ("engine/", "scripts/windows/engine/", "apps/browser/assets/offline-game")
GOV_PATHS = ("CLA.md", ".coderabbit.yaml", ".github/vouch/", ".github/TEAM.td", ".github/VOUCHED.td",
             ".github/workflows/cla.yml", ".github/workflows/vouch-", ".github/workflows/linked-issue.yml",
             ".claude/skills/release/", ".claude/skills/stats/", ".github/pull_request_template.md")
LEGACY_PATH = re.compile(r"(^|/)(legacy[^/]*|Legacy[^/]*|carryover[^/]*|legacy-migration[^/]*)$|LegacyMigration|LegacyDockTile|LegacyKeychain|PhoneLegacy", re.I)
PREBUILT_FILES = {"packages/ardiacore/prebuilt-engines.tsv", "packages/ardiacore/prebuilt-engines-linux.tsv",
                  "scripts/windows/engine/prebuilt.json"}
PREBUILT_SCRIPTS = {"packages/ardiacore/scripts/fetch-engine.sh", "scripts/linux/fetch-engine.sh",
                    "scripts/windows/fetch-engine.ps1", "scripts/windows/engine-source.sh"}
PREBUILT_LINE = re.compile(r"ardia-browser/ardia|mantrakp04/ardia|ArdiaCore-\$|ardia-engine-win|ardiacore-linux-x64|PREBUILT_REPO")
LICENSE_LINE = re.compile(r"(?i:copyright|SPDX-|apache[- ]license|apache-2\.0|licensed under|\bcredits?\b|attribution|ardiaCredit)|\bGPL\b|GPL-3|\bNOTICE\b|\bLICENSE\b")
UPSTREAM = re.compile(r"ardia-browser/|mantrakp04/|(?<![A-Za-z0-9_-])(?:[a-z0-9-]+\.)*ardia\.(?:dev|app)\b|netnyahoo\.com|homebrew-tap|ardia-plugins|github\.com/ardia\b", re.I)
SCHEME = re.compile(r"\b(?:ardia|netnyahoo)://", re.I)
RDNS = re.compile(r"\b(?:com|dev)\.(?:ardia|netnyahoo)(?:\.[A-Za-z0-9_-]+)*")
KOTLIN_PKG = re.compile(r"^\s*(?:package|import)\s+com\.ardia\.")
KEYCHAIN = re.compile(r"Ardia (?:Safe Storage|Connected Accounts|Sync Key|Recovery Kit|Live Tokens|Live Folder|Sync|Tab History|Scripts|Passwords|Bookmarks|Favicons|DevTools|Shared|Dev\b)")
DATA_DIR = re.compile(r"(?<!Ardia::AppIcon::Claim)(?:Application Support|\.config/ardia|\.local/share/ardia|LOCALAPPDATA|AppData|XDG_(?:CONFIG|DATA|STATE|CACHE)_HOME|kProductPathName|\bProgID|ArdiaHTM|ArdiaPDF|AppUserModel|ardia\.desktop|dev\.ardia\.linux|CFBundle(?:Name|DisplayName|Executable)|PRODUCT_NAME|AppId=|AppName=|DefaultDirName|Ardia\.app\b|Ardia\.exe\b|applicationId|bundleIdentifier|\"package\":|\"scheme\":|\"slug\":)", re.I)
CLI_NAME = re.compile(r"^\s*ardia\s*=\s*\"ardia_cli|\bbin/ardia\b|/ardia\"|\bardia\.(?:bash|zsh|fish)\b|complete -[A-Za-z] .*ardia|Casks/ardia", re.I)
PKG = re.compile(r"@ardia/|\"name\":\s*\"ardia|\bname\s*=\s*\"ardia-cli\"|\bardia_cli\b|\.podspec|s\.name\s*=|pod ['\"]Ardia|ardia-hexclave-cli|include ['\"]:ardia|project\(['\"]:ardia|ardia-design")
L2_TOKEN = re.compile(r"^(?:ArdiaCore(?:Tab|Profile|Window|Engine|PageView|PageScroll\w*|Adoption\w*|\w*Delegate|Main)|ARDIACORE_EXPORT|g_ardia_\w+|__ardia\w+|ardiaRequest|ardiacore_(?:tab|engine|window|profile|hooks|api_internal|tab_media|tab_internal)\w*|ArdiaAppStart\w*|ArdiaAppStop|ArdiaAppPreTranslateMessage|ArdiaAppRun|ArdiaApp\.dll)$")
L2_INCLUDE = re.compile(r"#\s*(?:include|import)\s+[\"<][^\">]*(?:chrome/browser/ardia/|ardia/(?:core|linux|win)/|/engine/)")
L2_MISC = re.compile(r"chrome://ardia|ArdiaApp\.dll|ardia-linux-bridge|HEADER_SEARCH_PATHS.*engine/ardiacore|engine/ardiacore(?:-linux)?/src|engine/chromium/src")
SALT = re.compile(r"netnyahoo-sync/v1|\bNNS1\b")

def area(path):
    parts = path.split("/")
    if parts[0] in ("apps", "packages", "engine", "extras", "infra", ".github", ".claude") and len(parts) > 2:
        return "/".join(parts[:2])
    if parts[0] == "scripts" and len(parts) > 2:
        return "scripts/windows/engine" if path.startswith("scripts/windows/engine/") else "/".join(parts[:2])
    if parts[0] == "docs":
        return "docs/release-notes" if path.startswith("docs/release-notes/") else "docs"
    return parts[0] if len(parts) > 1 else "(root files)"

def is_test(path):
    return bool(re.search(r"(^|/)(tests?|__tests__|androidTest|fixtures)/|\.test\.|_test\.|test_[^/]*\.py$|Tests?\.(swift|kt|mm)$|Test\.kt$", path))

def is_doc(path):
    return (path.endswith(DOC_EXT) or path.startswith(("docs/", "apps/site/", "apps/videos/", ".github/", "extras/", ".claude/"))
            or path in ("AGENTS.md", "README.md", "CONTRIBUTING.md", "CLAUDE.md"))

def classify(path, line, tok, start):
    if FALSE_POS.search(tok):
        return "false-positive"
    if path in ("LICENSE", "LICENSE.Apache-2.0", "NOTICE") or path.startswith("third_party/") or LICENSE_LINE.search(line):
        return "keep:license-attribution"
    if path.startswith("docs/release-notes/") or re.match(r"docs/perf/\d", path):
        return "keep:history"
    if path in PREBUILT_FILES or (path in PREBUILT_SCRIPTS and PREBUILT_LINE.search(line)) or (path.startswith(".github/workflows/") and "PREBUILT_REPO" in line):
        return "keep:upstream-prebuilt-engine"
    if SALT.search(line) and re.match(r"netnyahoo", tok, re.I):
        return "decide:sync-protocol-constant"
    if path.startswith(GOV_PATHS):
        return "remove:upstream-governance"
    if LEGACY_PATH.search(path) or re.match(r"netnyahoo", tok, re.I):
        return "remove:legacy-migration"
    if path.startswith(L2_PATHS):
        return "layer2:engine-tree"
    if is_doc(path):
        return "docs-site-github-extras"
    seg = line[max(0, start - 60): start + len(tok) + 60]
    if UPSTREAM.search(seg):
        return "upstream-service-or-repo"
    if L2_TOKEN.match(tok):
        return "layer2:app-side-interface:framework-symbol"
    if L2_INCLUDE.search(line) or L2_MISC.search(seg):
        return "layer2:app-side-interface:engine-path-or-host"
    if tok in eng_env:
        return "layer2:app-side-interface:engine-env-var"
    if any(s in seg for s in ("--" + x for x in eng_switches)) or tok.lower() in eng_switches:
        return "layer2:app-side-interface:engine-switch"
    for lit in iface_lits:
        if tok in lit and lit in line:
            if " " in lit:
                return "layer2:app-side-interface:engine-copy"
            if path.startswith(("apps/linux/", "scripts/linux/")):
                return "layer2:app-side-interface:linux-wire-literal"
            break
    if PKG.search(line) or tok in ("ardia_cli",):
        return "package-name"
    if KOTLIN_PKG.search(line):
        return "internal-layer1"
    rd = RDNS.search(seg)
    if rd and re.search(r"\.[A-Z]", rd.group(0)):
        rd = None
    if SCHEME.search(seg) or rd or KEYCHAIN.search(seg) or DATA_DIR.search(line) or CLI_NAME.search(line):
        return "nila-identity"
    if tok == "Ardia" and (path.endswith((".pbxproj", ".xcscheme", ".patch")) or re.search(r"Ardia::|namespace Ardia|\[Ardia\b|\bArdia\]", line)):
        return "internal-layer1"
    if tok == "Ardia":
        return "user-visible:test" if is_test(path) else "user-visible"
    return "internal-layer1"

cats = collections.Counter()
by_area = collections.defaultdict(collections.Counter)
tok_by_cat = collections.defaultdict(collections.Counter)
files_by_cat = collections.defaultdict(collections.Counter)
lines_out = []
prefix = ref + ":"
for row in raw.splitlines():
    if not row.startswith(prefix):
        continue
    rest = row[len(prefix):]
    path, lineno, line = rest.split(":", 2)
    for m in TOKEN.finditer(line):
        tok = m.group(0)
        c = classify(path, line, tok, m.start())
        sub = len(re.findall(r"ardia|netnyahoo", tok, re.I))
        cats[c] += sub
        by_area[c][area(path)] += sub
        tok_by_cat[c][tok] += sub
        files_by_cat[c][path] += sub
        lines_out.append(f"{c}\t{path}\t{lineno}\t{tok}")

with open(f"{work}/census.tsv", "w") as f:
    f.write("\n".join(lines_out) + "\n")
json.dump({"total": sum(cats.values()), "categories": cats, "by_area": by_area,
           "tokens": {k: v.most_common(40) for k, v in tok_by_cat.items()},
           "files": {k: v.most_common(25) for k, v in files_by_cat.items()},
           "file_counts": {k: len(v) for k, v in files_by_cat.items()}},
          open(f"{work}/census.json", "w"), indent=1)
print("total", sum(cats.values()))
for k, v in cats.most_common():
    print(f"{v:6d}  {len(files_by_cat[k]):5d} files  {k}")
