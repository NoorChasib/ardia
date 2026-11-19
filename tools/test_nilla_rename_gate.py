#!/usr/bin/env python3
"""usage: test_nilla_rename_gate.py   (NILLA_RENAME_TOOL=<path> runs the tests against another copy of the tool)

Regression tests for nilla_rename.py's pre-commit gate:
- a staged blob that changes an asserted line fails even when the working tree was put back;
- a protected span with no brand word in it (an engine path) is checked like any other;
- a corrupted protected span fails although a decoy copy was added elsewhere or the span moved, for literal
  and class entries, while the lines an addsLines rule inserts keep the spans mapped;
- a protected span whose old text is still on its line inside a longer match ("notardia", apply.sh.disabled) fails;
- a protected span changed in place fails although a copy of its old text, a decoy, stays on the same line, for
  literal, class and non-brand entries, while a rule that changes the length of the text before a span on its line
  keeps the span placed, and a span pushed onto the next line by a shortened line, at the same offset in the file,
  fails;
- a stale Ardia.app after the product became Nilla fails, unless an entry marked keepsBundleName keeps it;
- a stale workspace member, a PRODUCT_NAME changed in one configuration, a scheme from another workspace and a
  scheme whose target ID is not in its project fail;
- an MSBuild include directory that ends in the kept Windows folder still resolves after the moves, an include
  directory that names a file fails, and a missing item fails whatever its attribute order;
- the allowlist's AC* entries (NILLA_ALLOWLIST=<path> reads another copy) keep Info.plist keys in key positions
  whatever follows AC, rename AC* identifiers that are not keys, and leave ACFeedbackURL and ACReleaseNotesURL
  to their owner;
- the real allowlist keeps each phone's browse scheme constant and the internal URL it classifies on the same
  scheme after the rename (NILLA_REHEARSAL=<renamed tree> also checks that tree's real files);
- run on the repo's real pre-rename sources (NILLA_SOURCE=<repo>, default this checkout, at NILLA_SOURCE_REF=<commit>,
  default c507a1f8e, the commit before the rename), the real allowlist keeps the
  Windows profile folder prefix one name in the prebuilt engine, the app's deletion check, the TypeScript caller and
  the launch smoke's held folder, and keeps the app's test gate, its source test and the smoke's real-profile input
  on the folder the prebuilt engine's test gate refuses (NILLA_REHEARSAL checks a renamed tree too);
- run on the repo's real sources, the real allowlist keeps the CLI's Linux data folder ardia after a config-home
  variable (the help and the docs name the folder the CLI and the engine use) and the CLI's independence guards
  that name an installed Ardia and its dev.ardia.hooks agent, while hooks.py's own label becomes Nilla's
  (NILLA_REHEARSAL checks a renamed tree too);
- run on the repo's real sources, the real allowlist leaves the CLI's list of an installed Ardia's folders and the
  shared Sync guard's upstream folder byte for byte, and renames a Python variable passed as a call's only argument
  (str(ardia), os.readlink(ardia)) together with its assignment (NILLA_REHEARSAL checks a renamed tree too)."""
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest

TOOL = pathlib.Path(os.environ.get("NILLA_RENAME_TOOL") or pathlib.Path(__file__).with_name("nilla_rename.py"))
ALLOWLIST = pathlib.Path(os.environ.get("NILLA_ALLOWLIST") or "/home/noor/Code/ardia/apps/browser/src/naming-allowlist.json")
LINE = 'export const INGEST_KEY_HEADER = "X-Ardia-Key";'


def git(root, *args):
    return subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, check=True).stdout


def allowlist(protect=(), lines=(), rules=None, never=(), keepsBundle=()):
    return {
        "paths": {"frozen": ["engine/*"], "keep": [], "lead": [], "generated": [], "finalByD": [], "skipHand": {},
                  "skipTree": [], "ruleLimited": {}},
        "protect": list(protect),
        "lines": list(lines),
        "rules": rules if rules is not None else [{"id": "14-upper", "find": "ARDIA", "replace": "NILLA"},
                                                  {"id": "14-title", "find": "Ardia", "replace": "Nilla"},
                                                  {"id": "14-lower", "find": "ardia", "replace": "nilla"}],
        "reports": [],
        "moves": {"never": [{"glob": g, "why": "test"} for g in never], "neverComponent": "(?i)ardiacore",
                  "contractPaths": [], "basenameOnly": [], "componentMaps": [],
                  "componentCase": [["ARDIA", "NILLA"], ["Ardia", "Nilla"], ["ardia", "nilla"]]},
    }


class Repo:
    def __init__(self, files, allow, edit_list):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name) / "repo"
        for path, text in {**files, "apps/browser/src/naming-allowlist.json": json.dumps(allow),
                           "engine/engine-key.sh": "#!/bin/sh\necho engine\n"}.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        (self.root / "engine/engine-key.sh").chmod(0o755)
        self.edit_list = pathlib.Path(self.tmp.name) / "edit-list.txt"
        self.edit_list.write_text("".join(p + "\n" for p in edit_list))
        git(self.root, "init", "-q")
        git(self.root, "add", "-A")
        git(self.root, "-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-qm", "base")

    def close(self):
        self.tmp.cleanup()

    def tool(self, *extra):
        return subprocess.run([sys.executable, str(TOOL), "--root", str(self.root), "--edit-list", str(self.edit_list),
                               "--schedule", "/nonexistent", "--out", str(pathlib.Path(self.tmp.name) / "out"), *extra],
                              capture_output=True, text=True)

    def gate(self, *extra):
        return self.tool("--gate-only", *extra)

    def stage(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        git(self.root, "add", "-A", "--", path)

    def read(self, path):
        return (self.root / path).read_text()


class GateReadsTheIndex(unittest.TestCase):
    def setUp(self):
        self.repo = Repo({"packages/core/src/ingestKeys.ts": LINE + "\nexport const label = \"Ardia\";\n"},
                         allowlist(protect=[{"id": "T-header", "regex": "(?i)x[-_]ardia[-_]key"}],
                                   lines=[{"id": "M-ingest-header", "path": "packages/core/src/ingestKeys.ts", "text": LINE}],
                                   rules=[{"id": "14-title", "find": "Ardia", "replace": "Nilla"}]),
                         ["packages/core/src/ingestKeys.ts"])

    def tearDown(self):
        self.repo.close()

    def test_staged_change_to_an_asserted_line_fails_after_the_worktree_is_restored(self):
        path = self.repo.root / "packages/core/src/ingestKeys.ts"
        original = path.read_text()
        self.repo.stage("packages/core/src/ingestKeys.ts", original.replace("X-Ardia-Key", "X-Nilla-Key").replace('"Ardia"', '"Nilla"'))
        path.write_text(original.replace('"Ardia"', '"Nilla"'))
        staged = self.repo.gate()
        self.assertEqual(staged.returncode, 1, staged.stdout + staged.stderr)
        self.assertRegex(staged.stdout, r"\(a\) packages/core/src/ingestKeys\.ts(?::1)?: asserted line changed")
        self.assertIn("working tree differs from the staged blob", staged.stdout)
        self.assertIn("gate (staged blobs): FAILED", staged.stdout)
        worktree = self.repo.gate("--worktree")
        self.assertEqual(worktree.returncode, 0, worktree.stdout + worktree.stderr)
        self.assertIn("gate (working tree): passed", worktree.stdout)

    def test_a_clean_staged_rename_passes(self):
        path = self.repo.root / "packages/core/src/ingestKeys.ts"
        self.repo.stage("packages/core/src/ingestKeys.ts", path.read_text().replace('"Ardia"', '"Nilla"'))
        result = self.repo.gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("gate (staged blobs): passed", result.stdout)


ENGINE_PATHS = {"id": "R-engine-paths", "regex": r"(?:\.\./)*(?:engine|scripts/windows/engine)/[A-Za-z0-9_.+/-]*"}
SCHEME = {"id": "F-scheme-list", "text": "ardia", "boundary": "none", "quoted": True, "scope": ["packages/core/src/omnibox.ts"]}
ENV = {"id": "S-env", "regex": r"(?<![A-Za-z0-9_])ARDIA_[A-Z0-9_]*"}
FRESH = 'newest="$("$root/engine/chromium/apply.sh" --paths)"\necho "Ardia engine"\n'
OMNIBOX = 'const KNOWN = new Set([\n  "ardia", "chrome",\n]);\nconst dir = process.env.ARDIA_DATA_DIR;\nexport const label = "Ardia";\n'
OMNIBOX_RENAMED = OMNIBOX.replace('"Ardia"', '"Nilla"')


class EveryProtectedSpanIsMapped(unittest.TestCase):
    def setUp(self):
        self.repo = Repo({"scripts/lib/engine-fresh.sh": FRESH, "packages/core/src/omnibox.ts": OMNIBOX},
                         allowlist(protect=[ENGINE_PATHS, SCHEME, ENV]),
                         ["scripts/lib/engine-fresh.sh", "packages/core/src/omnibox.ts"])

    def tearDown(self):
        self.repo.close()

    def failed(self, result, text):
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(text, result.stdout)

    def test_the_tool_output_passes(self):
        result = self.repo.tool("--stage")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.repo.read("packages/core/src/omnibox.ts"), OMNIBOX_RENAMED)
        self.assertIn("engine/chromium/apply.sh", self.repo.read("scripts/lib/engine-fresh.sh"))

    def test_a_changed_engine_path_without_the_brand_fails(self):
        self.repo.stage("scripts/lib/engine-fresh.sh", FRESH.replace("engine/chromium/", "engine/missing/").replace("Ardia", "Nilla"))
        self.failed(self.repo.gate(), "(b) scripts/lib/engine-fresh.sh:1: protected span 'engine/chromium/apply.sh' (R-engine-paths) changed")

    def test_a_corrupted_literal_span_with_a_decoy_elsewhere_fails(self):
        self.repo.stage("packages/core/src/omnibox.ts",
                        OMNIBOX_RENAMED.replace('"ardia", "chrome"', '"nilla", "chrome"') + 'const contractDecoy = "ardia";\n')
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts: 6 lines became 7, but the rules insert 0")

    def test_a_corrupted_class_span_with_a_decoy_elsewhere_fails(self):
        self.repo.stage("packages/core/src/omnibox.ts",
                        OMNIBOX_RENAMED.replace("ARDIA_DATA_DIR", "NILLA_DATA_DIR") + 'const decoy = "ARDIA_DATA_DIR";\n')
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts: 6 lines became 7")

    def test_a_literal_span_moved_to_a_new_line_fails(self):
        self.repo.stage("packages/core/src/omnibox.ts", OMNIBOX_RENAMED.replace('  "ardia", "chrome",\n', '  "chrome",\n  "ardia",\n'))
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts: 6 lines became 7")

    def test_a_class_span_moved_to_a_new_line_fails(self):
        self.repo.stage("packages/core/src/omnibox.ts", OMNIBOX_RENAMED.replace("process.env.ARDIA_DATA_DIR;", "process.env\n  .ARDIA_DATA_DIR;"))
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts: 6 lines became 7")

    def test_a_quoted_span_changed_on_the_same_line_fails(self):
        self.repo.stage("packages/core/src/omnibox.ts", OMNIBOX_RENAMED.replace('"ardia", "chrome"', '"notardia", "chrome"'))
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts:2: protected span 'ardia' (F-scheme-list) changed")

    def test_an_engine_path_extended_on_the_same_line_fails(self):
        self.repo.stage("scripts/lib/engine-fresh.sh", FRESH.replace('apply.sh"', 'apply.sh.disabled"').replace("Ardia", "Nilla"))
        self.failed(self.repo.gate(), "(b) scripts/lib/engine-fresh.sh:1: protected span 'engine/chromium/apply.sh' (R-engine-paths) changed")

    def test_a_span_moved_within_the_same_line_count_fails(self):
        moved = OMNIBOX_RENAMED.replace('  "ardia", "chrome",\n', '  "chrome",\n').replace("process.env.ARDIA_DATA_DIR;", 'process.env.ARDIA_DATA_DIR ?? "ardia";')
        self.repo.stage("packages/core/src/omnibox.ts", moved)
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts:2: protected span 'ardia' (F-scheme-list) changed")


    def test_a_literal_span_renamed_with_its_old_text_after_it_on_the_line_fails(self):
        self.repo.stage("packages/core/src/omnibox.ts", OMNIBOX_RENAMED.replace('  "ardia", "chrome",\n', '  "nilla", "chrome", /* "ardia" */\n'))
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts:2: protected span 'ardia' (F-scheme-list) changed")

    def test_a_literal_span_renamed_with_its_old_text_before_it_on_the_line_fails(self):
        self.repo.stage("packages/core/src/omnibox.ts", OMNIBOX_RENAMED.replace('  "ardia", "chrome",\n', '"ardia";"nilla", "chrome",\n'))
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts:2: protected span 'ardia' (F-scheme-list) changed")

    def test_a_class_span_renamed_with_a_decoy_on_the_line_fails(self):
        self.repo.stage("packages/core/src/omnibox.ts", OMNIBOX_RENAMED.replace("process.env.ARDIA_DATA_DIR;", "process.env.NILLA_DATA_DIR; // ARDIA_DATA_DIR"))
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts:4: protected span 'ARDIA_DATA_DIR' (S-env) changed")

    def test_a_literal_span_pushed_onto_the_next_line_by_a_shortened_line_fails(self):
        self.repo.stage("packages/core/src/omnibox.ts", OMNIBOX_RENAMED.replace('  "ardia", "chrome",\n]);\n', 'x\n"ardia", "chrome",]);\n'))
        self.failed(self.repo.gate(), "(b) packages/core/src/omnibox.ts:2: protected span 'ardia' (F-scheme-list) changed")

    def test_a_non_brand_span_changed_with_a_decoy_on_the_line_fails(self):
        self.repo.stage("scripts/lib/engine-fresh.sh",
                        FRESH.replace('apply.sh" --paths)"', 'missing.sh" --paths)" # engine/chromium/apply.sh').replace("Ardia", "Nilla"))
        self.failed(self.repo.gate(), "(b) scripts/lib/engine-fresh.sh:1: protected span 'engine/chromium/apply.sh' (R-engine-paths) changed")


RENDEZVOUS = {"id": "A-rendezvous", "regex": r"ArdiaControl(?:\.json|\.sock(?:\.lock)?)?(?![A-Za-z0-9_])"}
BUNDLE_RULES = [{"id": "7-bundle", "find": r"com\.ardia\.browser(?![A-Za-z0-9_])", "replace": "com.nilladigital.nilla"},
                {"id": "14-title", "find": "Ardia", "replace": "Nilla"}, {"id": "14-lower", "find": "ardia", "replace": "nilla"}]
ENDPOINT = 'BUNDLE = "com.ardia.browser"; CONTROL_FILE = "ArdiaControl.json"\nlabel = "Ardia"\n'
ENDPOINT_RENAMED = 'BUNDLE = "com.nilladigital.nilla"; CONTROL_FILE = "ArdiaControl.json"\nlabel = "Nilla"\n'


class SameLineDecoysNeverStandIn(unittest.TestCase):
    def setUp(self):
        self.repo = Repo({"apps/cli/tool/endpoint.py": ENDPOINT}, allowlist(protect=[RENDEZVOUS], rules=BUNDLE_RULES),
                         ["apps/cli/tool/endpoint.py"])

    def tearDown(self):
        self.repo.close()

    def test_a_longer_rename_before_the_span_keeps_it_placed(self):
        result = self.repo.tool("--stage")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.repo.read("apps/cli/tool/endpoint.py"), ENDPOINT_RENAMED)

    def test_a_renamed_control_file_with_the_old_name_in_a_comment_fails(self):
        self.repo.stage("apps/cli/tool/endpoint.py",
                        ENDPOINT_RENAMED.replace('"ArdiaControl.json"\n', '"NillaControl.json"  # ArdiaControl.json\n'))
        self.failed_on_line_1()

    def test_the_span_shifted_on_its_line_fails(self):
        self.repo.stage("apps/cli/tool/endpoint.py", ENDPOINT_RENAMED.replace("CONTROL_FILE = ", "CONTROL_FILE  = "))
        self.failed_on_line_1()

    def failed_on_line_1(self):
        result = self.repo.gate()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("(b) apps/cli/tool/endpoint.py:1: protected span 'ArdiaControl.json' (A-rendezvous) changed", result.stdout)

class InsertedLinesKeepSpansMapped(unittest.TestCase):
    BEFORE = 'module-root = ""\nkeep = "ardia"\nname = "Ardia"\n'

    def setUp(self):
        rules = [{"id": "module-name", "find": r'^module-root = ""$', "replace": 'module-root = ""\nmodule-name = "x"', "addsLines": True},
                 {"id": "14-title", "find": "Ardia", "replace": "Nilla"}]
        self.repo = Repo({"apps/cli/pyproject.toml": self.BEFORE},
                         allowlist(protect=[{"id": "N-cli-home", "text": "ardia", "boundary": "none", "quoted": True}], rules=rules),
                         ["apps/cli/pyproject.toml"])

    def tearDown(self):
        self.repo.close()

    def test_the_inserted_line_passes(self):
        result = self.repo.tool("--stage")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.repo.read("apps/cli/pyproject.toml"), 'module-root = ""\nmodule-name = "x"\nkeep = "ardia"\nname = "Nilla"\n')

    def test_a_corrupted_span_after_the_inserted_line_fails(self):
        self.repo.stage("apps/cli/pyproject.toml", 'module-root = ""\nmodule-name = "x"\nkeep = "nilla"\nname = "ardia"\n')
        result = self.repo.gate()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("(b) apps/cli/pyproject.toml:2: protected span 'ardia' (N-cli-home) changed", result.stdout)


PBXPROJ = """// !$*UTF8*$!
{
	archiveVersion = 1;
	objects = {
		5142 /* Ardia.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Ardia.app; sourceTree = BUILT_PRODUCTS_DIR; };
		7000 /* Ardia-macOS */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = 7100;
			name = "Ardia-macOS";
			productReference = 5142 /* Ardia.app */;
			productType = "com.apple.product-type.application";
		};
		7100 = {isa = XCConfigurationList; buildConfigurations = (7101 /* Debug */, 7102 /* Release */, ); };
		7101 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_NAME = Ardia;
			};
			name = Debug;
		};
		7102 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_NAME = Ardia;
			};
			name = Release;
		};
		7200 = {isa = XCConfigurationList; buildConfigurations = (7201, ); };
		7201 = {isa = XCBuildConfiguration; buildSettings = { }; name = Debug; };
		7300 /* Project object */ = {isa = PBXProject; buildConfigurationList = 7200; targets = (7000 /* Ardia-macOS */, ); };
	};
	rootObject = 7300 /* Project object */;
}
"""
SCHEME_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Scheme>
   <BuildableReference
      BuildableIdentifier = "primary"
      BlueprintIdentifier = "7000"
      BuildableName = "Ardia.app"
      BlueprintName = "Ardia-macOS"
      ReferencedContainer = "container:Ardia.xcodeproj">
   </BuildableReference>
</Scheme>
"""
PHONE_SCHEME_XML = SCHEME_XML.replace('"7000"', '"8000"').replace('"Ardia-macOS"', '"Ardia"')
WORKSPACE = """<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "group:Ardia.xcodeproj">
   </FileRef>
   <FileRef
      location = "group:Pods/Pods.xcodeproj">
   </FileRef>
</Workspace>
"""
MAC_PROJECT = "apps/browser/macos/Nilla.xcodeproj/project.pbxproj"
BUILD_APP = 'app="$dd/Build/Products/$config/Ardia.app"\nxcodebuild -workspace macos/Ardia.xcworkspace -scheme Ardia-macOS\n'
CPU_CAP = 'NEVER = ("/Applications/Ardia.app/", "/Applications/Claude.app/")\nprint("Ardia")\n'
OLD_HOSTS = {"id": "U-hosts", "regex": r"(?<![a-z0-9])(?i:(?:[a-z0-9-]+\.)*ardia\.(?:dev|app))(?![A-Za-z0-9_-])"}
NEW_HOSTS = {"id": "U-hosts", "regex": r"(?<![a-z0-9])(?i:(?:[a-z0-9-]+\.)*ardia\.dev)(?![A-Za-z0-9_-])"}
OWNER_APP = {"id": "X-owner-installed-app", "regex": r"/Applications/(?:Ardia|Netnyahoo)\.app", "scope": ["scripts/agent/*"],
             "mechanism": "never", "keepsBundleName": True}


class ProductNamesMatchTheirConsumers(unittest.TestCase):
    FILES = {"apps/browser/macos/Ardia.xcodeproj/project.pbxproj": PBXPROJ,
             "apps/browser/macos/Ardia.xcodeproj/xcshareddata/xcschemes/Ardia-macOS.xcscheme": SCHEME_XML,
             "apps/browser/macos/Ardia.xcworkspace/contents.xcworkspacedata": WORKSPACE,
             "apps/phone/ios/Ardia.xcodeproj/xcshareddata/xcschemes/Ardia.xcscheme": PHONE_SCHEME_XML,
             "scripts/agent/build-app": BUILD_APP, "scripts/agent/cpu-cap": CPU_CAP}

    def run_with(self, protect):
        repo = Repo(self.FILES, allowlist(protect=protect), list(self.FILES))
        self.addCleanup(repo.close)
        return repo, repo.tool("--stage")

    def test_the_old_hosts_class_leaves_ardia_app_and_fails(self):
        repo, result = self.run_with([OLD_HOSTS, OWNER_APP])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(f"(f) {MAC_PROJECT}: target Nilla-macOS's Debug PRODUCT_NAME Nilla is not its product Ardia.app", result.stdout)
        self.assertIn("(f) scripts/agent/build-app:1: Ardia.app is not the product (Nilla)", result.stdout)
        self.assertNotIn("scripts/agent/cpu-cap", result.stdout)

    def test_hosts_without_bundle_names_rename_the_product_everywhere(self):
        repo, result = self.run_with([NEW_HOSTS, OWNER_APP])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Nilla.app", repo.read("scripts/agent/build-app"))
        self.assertIn("-workspace macos/Nilla.xcworkspace -scheme Nilla-macOS", repo.read("scripts/agent/build-app"))
        self.assertIn("/Applications/Ardia.app/", repo.read("scripts/agent/cpu-cap"))

    def staged_fails(self, path, change, text):
        repo, result = self.run_with([NEW_HOSTS, OWNER_APP])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        repo.stage(path, change(repo.read(path)))
        result = repo.gate()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(text, result.stdout)

    def test_a_stale_workspace_member_fails(self):
        self.staged_fails("apps/browser/macos/Nilla.xcworkspace/contents.xcworkspacedata",
                          lambda t: t.replace("group:Nilla.xcodeproj", "group:Ardia.xcodeproj"),
                          "(f) apps/browser/macos/Nilla.xcworkspace/contents.xcworkspacedata: workspace member "
                          "apps/browser/macos/Ardia.xcodeproj is not an existing path after the moves")

    def test_a_product_name_changed_in_one_configuration_fails(self):
        def release_only(text):
            cut = text.rindex("PRODUCT_NAME = Nilla;")
            return text[:cut] + "PRODUCT_NAME = Ardia;" + text[cut + len("PRODUCT_NAME = Nilla;"):]
        self.staged_fails(MAC_PROJECT, release_only,
                          f"(f) {MAC_PROJECT}: target Nilla-macOS's Release PRODUCT_NAME Ardia is not its product Nilla.app")

    def test_a_scheme_from_another_workspace_fails(self):
        self.staged_fails("scripts/agent/build-app", lambda t: t.replace("-scheme Nilla-macOS", "-scheme Nilla"),
                          "(f) scripts/agent/build-app:2: -scheme Nilla is not a shared scheme of apps/browser/macos/Nilla.xcworkspace")

    def test_a_scheme_naming_a_missing_target_fails(self):
        self.staged_fails("apps/browser/macos/Nilla.xcodeproj/xcshareddata/xcschemes/Nilla-macOS.xcscheme",
                          lambda t: t.replace('"7000"', '"7999"'),
                          "BlueprintIdentifier 7999 (Nilla-macOS) is no target of apps/browser/macos/Nilla.xcodeproj")

    def test_a_kept_bundle_name_needs_a_marked_entry(self):
        unmarked = {k: v for k, v in OWNER_APP.items() if k != "keepsBundleName"}
        repo, result = self.run_with([NEW_HOSTS, unmarked])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("(f) scripts/agent/cpu-cap:1: Ardia.app is not the product (Nilla) and no exception keeps it", result.stdout)


VCXPROJ = r"""<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemDefinitionGroup>
    <ResourceCompile>
      <AdditionalIncludeDirectories>$(MSBuildThisFileDirectory)..\Ardia;%(AdditionalIncludeDirectories)</AdditionalIncludeDirectories>
    </ResourceCompile>
  </ItemDefinitionGroup>
  <ItemGroup>
    <ClInclude Include="..\Ardia\EngineApi.h" />
    <ResourceCompile Include="..\Ardia\app.rc" />
  </ItemGroup>
</Project>
"""
WINDOWS_FILES = {"apps/browser/windows/Ardia/EngineApi.h": "#pragma once\n", "apps/browser/windows/Ardia/app.rc": "1 ICON\n",
                 "apps/browser/windows/ArdiaLauncher/ArdiaLauncher.vcxproj": VCXPROJ}
LAUNCHER = "apps/browser/windows/NillaLauncher/NillaLauncher.vcxproj"
FOLDER = {"id": "P-windows-folder", "regex": r"(?<![A-Za-z0-9_.-])Ardia(?=[/\\])", "scope": ["apps/browser/windows/*"]}
SIBLING = {"id": "P-windows-folder-sibling", "regex": r"(?<=\.\.[/\\])Ardia(?=[/\\;\"'`<>\s,)\]]|$)", "scope": ["apps/browser/windows/*"]}


class MsbuildReferencesResolveAfterTheMoves(unittest.TestCase):
    def run_with(self, protect):
        repo = Repo(WINDOWS_FILES, allowlist(protect=protect, never=["apps/browser/windows/Ardia", "apps/browser/windows/Ardia/*"]),
                    ["apps/browser/windows/ArdiaLauncher/ArdiaLauncher.vcxproj"])
        self.addCleanup(repo.close)
        return repo, repo.tool("--stage")

    def test_a_terminal_folder_reference_renamed_away_from_the_kept_folder_fails(self):
        repo, result = self.run_with([FOLDER])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(f"(g) {LAUNCHER}: MSBuild reference apps/browser/windows/Nilla "
                      "is not an existing directory after the moves (it was apps/browser/windows/Ardia)", result.stdout)

    def test_the_protected_terminal_folder_reference_passes(self):
        repo, result = self.run_with([FOLDER, SIBLING])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("$(MSBuildThisFileDirectory)..\\Ardia;", repo.read(LAUNCHER))

    def staged_fails(self, change, text):
        repo, result = self.run_with([FOLDER, SIBLING])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        repo.stage(LAUNCHER, change(repo.read(LAUNCHER)))
        result = repo.gate()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(text, result.stdout)

    def test_an_include_directory_that_names_a_file_fails(self):
        self.staged_fails(lambda t: t.replace("..\\Ardia;", "..\\Ardia\\EngineApi.h;"),
                          f"(g) {LAUNCHER}: MSBuild reference apps/browser/windows/Ardia/EngineApi.h is not an existing directory")

    def test_a_missing_item_after_a_condition_attribute_fails(self):
        self.staged_fails(lambda t: t.replace('<ResourceCompile Include="..\\Ardia\\app.rc" />',
                                              '<ResourceCompile Condition="\'$(Configuration)\'==\'Release\'" Include="..\\Ardia\\Missing.rc" />'),
                          f"(g) {LAUNCHER}: MSBuild reference apps/browser/windows/Ardia/Missing.rc is not an existing file")

    def test_an_added_missing_item_fails(self):
        self.staged_fails(lambda t: t.replace("  </ItemGroup>", '    <None Include="Missing.txt" />\n  </ItemGroup>'),
                          f"(g) {LAUNCHER}: MSBuild reference apps/browser/windows/NillaLauncher/Missing.txt is not an existing file")


def real_entries(*ids):
    entries = {e["id"]: e for e in json.loads(ALLOWLIST.read_text())["protect"]}
    return [entries[i] for i in ids]


PLIST = ("<dict>\n\t<key>ACURLArdia</key>\n\t<string>Ardia</string>\n\t<key>ACUpdateChannel</key>\n\t<string>nightly</string>\n"
         "\t<key>ACFeedbackURL</key>\n\t<string>https://example.invalid</string>\n</dict>\n")
SWIFT = ('let a = Bundle.main.object(forInfoDictionaryKey: "ACURLArdia")\nlet b = UserDefaults.standard.string(forKey: "ACUpdateFeedURL")\n'
         'let c = ACBrowserWindow()\n')
TS = "export const ACArdia = 1;\nexport const ACUpdateChannelArdia = 2;\n"
AC_FILES = {"apps/browser/macos/Ardia-macOS/Info.plist": PLIST, "packages/shell/ios/MainMenu.swift": SWIFT, "apps/browser/src/acKeys.ts": TS}
PLIST_AFTER = "apps/browser/macos/Nilla-macOS/Info.plist"


class AcEntriesProtectKeysNotIdentifiers(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(AC_FILES, allowlist(protect=real_entries("J-ac-plist-keys", "J-ac-key-names", "R-ac-engine-names")), list(AC_FILES))
        self.addCleanup(self.repo.close)
        self.result = self.repo.tool("--stage")

    def test_keys_stay_and_identifiers_rename(self):
        self.assertEqual(self.result.returncode, 0, self.result.stdout + self.result.stderr)
        self.assertEqual(self.repo.read(PLIST_AFTER), PLIST.replace("<string>Ardia</string>", "<string>Nilla</string>"))
        self.assertEqual(self.repo.read("packages/shell/ios/MainMenu.swift"), SWIFT)
        self.assertEqual(self.repo.read("apps/browser/src/acKeys.ts"), TS.replace("Ardia", "Nilla"))

    def test_a_renamed_key_fails(self):
        self.repo.stage(PLIST_AFTER, self.repo.read(PLIST_AFTER).replace("ACURLArdia", "ACURLNilla"))
        result = self.repo.gate()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("(b) apps/browser/macos/Ardia-macOS/Info.plist:2: protected span 'ACURLArdia' (J-ac-plist-keys) changed", result.stdout)

    def test_a_renamed_engine_class_fails(self):
        self.repo.stage("packages/shell/ios/MainMenu.swift", SWIFT.replace("ACBrowserWindow", "NCBrowserWindow"))
        result = self.repo.gate()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("protected span 'ACBrowserWindow' (R-ac-engine-names) changed", result.stdout)

    def test_the_two_owner_keys_are_not_protected(self):
        self.repo.stage(PLIST_AFTER, self.repo.read(PLIST_AFTER).replace("ACFeedbackURL", "NLFeedbackURL"))
        result = self.repo.gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


ANDROID = "packages/phone/android/src/main/java/com/ardia/browser/"
ANDROID_TEST = "packages/phone/android/src/test/java/com/ardia/browser/"
IOS = "packages/phone/ios/ArdiaKit/"
SCHEME_FILES = {
    ANDROID + "BrowserUrl.kt": ('package com.ardia.browser\n\nobject BrowserUrl {\n    const val BROWSE_SCHEME = "ardia"\n'
                                '    const val SYSTEM_LINK_SCHEME = "nilla"\n}\n'),
    ANDROID + "ExternalLinks.kt": ('package com.ardia.browser\n\nobject ExternalLinks {\n'
                                   '    private val webSchemes = setOf("http", "https", "about", BrowserUrl.BROWSE_SCHEME)\n}\n'),
    ANDROID_TEST + "ExternalLinksTest.kt": ('package com.ardia.browser\n\nclass ExternalLinksTest {\n'
                                            '    val internal = listOf("https://example.com", "ardia://start")\n}\n'),
    IOS + "Sources/ArdiaBrowser/Tabs/TabPolicies.swift": ('public enum BrowserURL {\n  public static let browseScheme = "ardia"\n'
                                                          '  public static let systemLinkScheme = "nilla"\n}\n'),
    IOS + "Tests/ArdiaBrowserTests/TabStoreTests.swift": 'func opensInbox() {\n    fixture.open("ardia://inbox")\n}\n',
}
SCHEME_PAIRS = [("BrowserUrl.kt", r'BROWSE_SCHEME = "([a-z]+)"', "ExternalLinksTest.kt", r'"([a-z]+)://start"'),
                ("TabPolicies.swift", r'browseScheme = "([a-z]+)"', "TabStoreTests.swift", r'"([a-z]+)://inbox"')]


def scheme_pairs(read_by_name):
    found = []
    for const_file, const_rx, url_file, url_rx in SCHEME_PAIRS:
        const = re.search(const_rx, read_by_name(const_file))
        url = re.search(url_rx, read_by_name(url_file))
        found.append((const_file, const and const.group(1), url_file, url and url.group(1)))
    return found


class PhoneBrowseSchemeMatchesItsUrls(unittest.TestCase):
    def run_real_allowlist(self, drop=()):
        doc = json.loads(ALLOWLIST.read_text())
        doc["protect"] = [e for e in doc["protect"] if e["id"] not in drop]
        repo = Repo(SCHEME_FILES, doc, list(SCHEME_FILES))
        self.addCleanup(repo.close)
        result = repo.tool("--stage")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        tracked = git(repo.root, "ls-files").split()

        def read_by_name(name):
            matches = [p for p in tracked if p.rsplit("/", 1)[-1] == name]
            self.assertEqual(len(matches), 1, (name, matches))
            return repo.read(matches[0])

        return scheme_pairs(read_by_name)

    def test_the_constant_and_its_internal_url_keep_one_scheme(self):
        for const_file, const, url_file, url in self.run_real_allowlist():
            self.assertIsNotNone(const, const_file)
            self.assertEqual(const, url, f"{const_file} says {const}, {url_file} says {url}")

    def test_without_the_entry_the_constant_and_the_url_split(self):
        pairs = self.run_real_allowlist(drop=("F-phone-browse-scheme",))
        self.assertTrue(all(const != url for _, const, _, url in pairs), pairs)

    @unittest.skipUnless(os.environ.get("NILLA_REHEARSAL"), "set NILLA_REHEARSAL to a renamed tree")
    def test_the_rehearsal_tree_keeps_one_scheme(self):
        root = pathlib.Path(os.environ["NILLA_REHEARSAL"])
        tracked = git(root, "ls-files", "packages/phone").split()
        pins = {"BrowserUrl.kt": "/android/src/main/", "TabPolicies.swift": "/Sources/",
                "ExternalLinksTest.kt": "/android/src/test/", "TabStoreTests.swift": "/Tests/"}

        def read_by_name(name):
            matches = [p for p in tracked if p.rsplit("/", 1)[-1] == name and pins[name] in p]
            self.assertEqual(len(matches), 1, (name, matches))
            return (root / matches[0]).read_text()

        for const_file, const, url_file, url in scheme_pairs(read_by_name):
            self.assertIsNotNone(const, const_file)
            self.assertEqual(const, url, f"{const_file} says {const}, {url_file} says {url}")


SOURCE = pathlib.Path(os.environ.get("NILLA_SOURCE") or "/home/noor/Code/ardia")
SOURCE_REF = os.environ.get("NILLA_SOURCE_REF") or "c507a1f8e810a03050f2b77df19c3163579c0ab1"
WINDOWS_ENGINE_PROFILES = "scripts/windows/engine/src/ardia/win/profiles.cc"
WINDOWS_ENGINE_GATE = "scripts/windows/engine/src/ardia/win/test_gate.cc"
WINDOWS_APP_HOST = "apps/browser/windows/Ardia/EngineHostModule.h"
WINDOWS_APP_GATE = "apps/browser/windows/Ardia/TestGate.h"
WINDOWS_TS_PROFILES = "packages/expo-windows/src/engine/domains/profiles.ts"
WINDOWS_SMOKE = "scripts/windows/launch-smoke.ps1"
WINDOWS_GATE_TEST = "apps/browser/src/platform/windowsLaunchConfig.test.mjs"
WINDOWS_FOLDER_FILES = [WINDOWS_ENGINE_PROFILES, WINDOWS_ENGINE_GATE, WINDOWS_APP_HOST, WINDOWS_APP_GATE,
                        WINDOWS_TS_PROFILES, WINDOWS_SMOKE, WINDOWS_GATE_TEST]
HELD_FOLDER = "self-check-stuck"


def found_all(pattern, text, where):
    values = re.findall(pattern, text)
    if not values:
        raise AssertionError(f"{where}: nothing matches {pattern}")
    return values


def is_profile_folder_name(folder, prefix):
    longest = 255 - len(" (removing)")
    if len(folder) <= len(prefix) or len(folder) > longest or not folder.startswith(prefix):
        return False
    return all(c.islower() and c.isascii() or c.isdigit() or c == "-" for c in folder[len(prefix):])


def windows_folder_names(read):
    smoke = read(WINDOWS_SMOKE)
    prefixes = {
        "engine kDirectoryPrefix": found_all(r'kDirectoryPrefix\[\] = "([^"]*)"', read(WINDOWS_ENGINE_PROFILES), WINDOWS_ENGINE_PROFILES),
        "app ProfileFolderPrefix": found_all(r'ProfileFolderPrefix = "([^"]*)"', read(WINDOWS_APP_HOST), WINDOWS_APP_HOST),
        "TypeScript FOLDER_PREFIX": found_all(r'FOLDER_PREFIX = "([^"]*)"', read(WINDOWS_TS_PROFILES), WINDOWS_TS_PROFILES),
        "smoke held folder": found_all(r'"Chromium\\([^"]*?)' + HELD_FOLDER + r' \(removing\)"', smoke, WINDOWS_SMOKE),
    }
    guards = {
        "engine RealFolderClashOf": found_all(r'CanonicalPath\(folder\.Append\(FILE_PATH_LITERAL\("([^"]+)"\)\)\)', read(WINDOWS_ENGINE_GATE), WINDOWS_ENGINE_GATE),
        "app TestGate": found_all(r'L"(?:LOCAL)?APPDATA"\) / L"([^"]+)"', read(WINDOWS_APP_GATE), WINDOWS_APP_GATE),
        "source test": found_all(r'L"(?:LOCAL)?APPDATA"\\\) \\/ L"([^"]+)"', read(WINDOWS_GATE_TEST), WINDOWS_GATE_TEST),
        "smoke real profile": found_all(r'\$realProfile = Join-Path \$env:LOCALAPPDATA "([^"]+)"', smoke, WINDOWS_SMOKE),
        "smoke real user data": found_all(r'\$realUserData = Join-Path \$env:LOCALAPPDATA "([^"\\]+)\\User Data"', smoke, WINDOWS_SMOKE),
    }
    return prefixes, guards


def windows_folder_mismatches(read):
    prefixes, guards = windows_folder_names(read)
    problems = []
    engine_prefix = prefixes["engine kDirectoryPrefix"][0]
    for name, values in prefixes.items():
        problems += [f"{name} is {v!r}, the engine makes {engine_prefix!r}" for v in values if v != engine_prefix]
    app_prefix = prefixes["app ProfileFolderPrefix"][0]
    for held in prefixes["smoke held folder"]:
        if not is_profile_folder_name(held + HELD_FOLDER, app_prefix):
            problems.append(f"the app's deletion check refuses the smoke's held folder {held + HELD_FOLDER!r}")
    if not is_profile_folder_name(engine_prefix + HELD_FOLDER, app_prefix):
        problems.append(f"the app's deletion check refuses the engine's folder {engine_prefix + HELD_FOLDER!r}")
    engine_guard = guards["engine RealFolderClashOf"][0]
    for name, values in guards.items():
        problems += [f"{name} watches {v!r}, the engine's test gate refuses {engine_guard!r}" for v in values if v != engine_guard]
    return problems


class WindowsProfileFoldersMatchTheEngine(unittest.TestCase):
    def run_real_allowlist(self, drop=()):
        files = {p: git(SOURCE, "show", SOURCE_REF + ":" + p) for p in WINDOWS_FOLDER_FILES}
        doc = json.loads(ALLOWLIST.read_text())
        doc["protect"] = [e for e in doc["protect"] if e["id"] not in drop]
        repo = Repo(files, doc, [p for p in WINDOWS_FOLDER_FILES if not p.startswith("scripts/windows/engine/")])
        self.addCleanup(repo.close)
        result = repo.tool("--stage")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(git(repo.root, "diff", "--cached", "--name-only", "--", "scripts/windows/engine"), "")
        return repo.read

    def test_the_source_agrees_before_the_rename(self):
        self.assertEqual(windows_folder_mismatches(lambda p: git(SOURCE, "show", SOURCE_REF + ":" + p)), [])

    def test_the_renamed_sources_agree_with_the_engine(self):
        self.assertEqual(windows_folder_mismatches(self.run_real_allowlist()), [])

    def test_without_the_entries_the_app_and_smoke_split_from_the_engine(self):
        problems = windows_folder_mismatches(self.run_real_allowlist(drop=("P-windows-profile-folders-native", "P-windows-real-profile-guard")))
        for expected in ("app ProfileFolderPrefix is 'Nilla '", "smoke held folder is 'Nilla '",
                         "the app's deletion check refuses the engine's folder 'Ardia self-check-stuck'",
                         "app TestGate watches 'Nilla'", "source test watches 'Nilla'", "smoke real profile watches 'Nilla'"):
            self.assertTrue(any(p.startswith(expected) for p in problems), (expected, problems))

    @unittest.skipUnless(os.environ.get("NILLA_REHEARSAL"), "set NILLA_REHEARSAL to a renamed tree")
    def test_the_rehearsal_tree_agrees_with_the_engine(self):
        root = pathlib.Path(os.environ["NILLA_REHEARSAL"])
        self.assertEqual(windows_folder_mismatches(lambda p: (root / p).read_text()), [])


CLI_FILES = ["apps/cli/ardia_cli/endpoint.py", "apps/cli/ardia_cli/hooks.py", "apps/cli/tests/test_automation.py",
             "apps/cli/tests/test_linux.py", "docs/cli.md", "docs/config.md"]


def cli_independence_problems(read):
    expected = {
        "endpoint.py": ['LINUX_DATA_DIR_SHOWN = "$ARDIA_CONFIG_HOME/ardia"', 'return Path(override) / "ardia" if override',
                        "never reaches an installed Ardia's ~/.config/ardia"],
        "hooks.py": ['LABEL = "com.nilladigital.nilla.hooks"', "never run an installed Ardia's ~/.local/share/ardia/cli"],
        "test_automation.py": ['upstream = agents / "dev.ardia.hooks.plist"', '["dev.ardia.hooks.plist"]', 'any("dev.ardia" in part'],
        "test_linux.py": ['upstream = units / "dev.ardia.hooks.service"', '["dev.ardia.hooks.service"]', 'any("dev.ardia" in part'],
        "cli.md": ["${ARDIA_CONFIG_HOME:-${XDG_CONFIG_HOME:-~/.config}}/ardia` (the engine's Chromium user data dir",
                   "`$ARDIA_CONFIG_HOME/ardia/ArdiaControl.json`: this development build"],
        "config.md": ["`$ARDIA_CONFIG_HOME/ardia` is that data dir", "`$ARDIA_CONFIG_HOME/ardia/config` (this development build sets no default"],
    }
    problems = []
    for name, needles in expected.items():
        text = read(name)
        problems += [f"{name} lost {needle!r}" for needle in needles if needle not in text]
    return problems


class CliLinuxFolderAndGuardsSurviveTheRename(unittest.TestCase):
    def run_real_allowlist(self, drop=()):
        files = {p: git(SOURCE, "show", SOURCE_REF + ":" + p) for p in CLI_FILES}
        doc = json.loads(ALLOWLIST.read_text())
        doc["protect"] = [e for e in doc["protect"] if e["id"] not in drop]
        repo = Repo(files, doc, CLI_FILES)
        self.addCleanup(repo.close)
        result = repo.tool("--stage")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        tracked = git(repo.root, "ls-files").split()

        def read_by_name(name):
            matches = [p for p in tracked if p.rsplit("/", 1)[-1] == name]
            self.assertEqual(len(matches), 1, (name, matches))
            return repo.read(matches[0])

        return read_by_name

    def test_the_renamed_sources_keep_the_folder_and_the_guards(self):
        self.assertEqual(cli_independence_problems(self.run_real_allowlist()), [])

    def test_without_the_entries_the_help_and_the_guards_follow_the_rename(self):
        problems = cli_independence_problems(self.run_real_allowlist(drop=("N-linux-data-folder", "X-ardia-install-guards-cli")))
        for expected in ("endpoint.py lost 'LINUX_DATA_DIR_SHOWN", "endpoint.py lost \"never reaches", "hooks.py lost \"never run",
                         "test_automation.py lost 'upstream", "test_linux.py lost 'upstream", "cli.md lost", "config.md lost"):
            self.assertTrue(any(p.startswith(expected) for p in problems), (expected, problems))

    @unittest.skipUnless(os.environ.get("NILLA_REHEARSAL"), "set NILLA_REHEARSAL to a renamed tree")
    def test_the_rehearsal_tree_keeps_the_folder_and_the_guards(self):
        root = pathlib.Path(os.environ["NILLA_REHEARSAL"])
        tracked = git(root, "ls-files", "apps/cli", "docs").split()
        pins = {"endpoint.py": "apps/cli/nilla_browser_cli/", "hooks.py": "apps/cli/nilla_browser_cli/", "test_automation.py": "apps/cli/tests/",
                "test_linux.py": "apps/cli/tests/", "cli.md": "docs/cli.md", "config.md": "docs/config.md"}

        def read_by_name(name):
            matches = [p for p in tracked if p.rsplit("/", 1)[-1] == name and p.startswith(pins[name].rsplit(name, 1)[0])]
            self.assertEqual(len(matches), 1, (name, matches))
            return (root / matches[0]).read_text()

        self.assertEqual(cli_independence_problems(read_by_name), [])


UPSTREAM_GUARD_FILES = ["apps/cli/ardia_cli/upstream.py", "packages/sync/src/upstreamSyncFolder.ts", "apps/cli/tests/test_computer.py",
                        "apps/cli/tests/test_linux.py"]


def upstream_guard_problems(read):
    problems = []
    for path in UPSTREAM_GUARD_FILES[:2]:
        name = path.rsplit("/", 1)[-1]
        if read(name) != git(SOURCE, "show", SOURCE_REF + ":" + path):
            problems.append(f"{name} changed")
    computer, linux = read("test_computer.py"), read("test_linux.py")
    for name, text, pattern in (("test_computer.py", computer, r"str\((ardia|nilla)\)"), ("test_linux.py", linux, r"os\.readlink\((ardia|nilla)\)")):
        for variable in sorted(set(re.findall(pattern, text))):
            if not re.search(rf"^\s+{variable} = ", text, re.M):
                problems.append(f"{name} uses {variable} that nothing assigns")
    return problems


class UpstreamGuardsSurviveTheRename(unittest.TestCase):
    def run_real_allowlist(self, drop=()):
        files = {p: git(SOURCE, "show", SOURCE_REF + ":" + p) for p in UPSTREAM_GUARD_FILES}
        doc = json.loads(ALLOWLIST.read_text())
        doc["protect"] = [e for e in doc["protect"] if e["id"] not in drop]
        repo = Repo(files, doc, UPSTREAM_GUARD_FILES)
        self.addCleanup(repo.close)
        result = repo.tool("--stage")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        tracked = git(repo.root, "ls-files").split()
        return lambda name: repo.read(next(p for p in tracked if p.rsplit("/", 1)[-1] == name))

    def test_the_guards_stay_whole_and_the_variables_follow_their_assignments(self):
        self.assertEqual(upstream_guard_problems(self.run_real_allowlist()), [])

    def test_without_the_entries_the_guards_would_name_nilla(self):
        problems = upstream_guard_problems(self.run_real_allowlist(drop=("X-ardia-sync-folder-guard", "X-ardia-upstream-folders-cli")))
        self.assertEqual(sorted(p for p in problems if p.endswith("changed")), ["upstream.py changed", "upstreamSyncFolder.ts changed"])

    @unittest.skipUnless(os.environ.get("NILLA_REHEARSAL"), "set NILLA_REHEARSAL to a renamed tree")
    def test_the_rehearsal_tree_keeps_the_guards(self):
        root = pathlib.Path(os.environ["NILLA_REHEARSAL"])
        places = {"upstream.py": "apps/cli/nilla_browser_cli/upstream.py", "upstreamSyncFolder.ts": "packages/sync/src/upstreamSyncFolder.ts",
                  "test_computer.py": "apps/cli/tests/test_computer.py", "test_linux.py": "apps/cli/tests/test_linux.py"}
        self.assertEqual(upstream_guard_problems(lambda name: (root / places[name]).read_text()), [])


if __name__ == "__main__":
    os.environ.setdefault("GIT_CONFIG_NOSYSTEM", "1")
    unittest.main()
