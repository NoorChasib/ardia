import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nilla_browser_cli import cli, computer, config_files, endpoint, hooks, upstream, usage
from test_linux import INSTALL_SH, ON_LINUX, InstallScript

PLANTED = '{"settings": {"planted": true}}\n'


def snapshot(root: Path) -> list:
    rows = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            rows.append((str(path), "->", os.readlink(path)))
        elif path.is_file():
            rows.append((str(path), path.read_bytes()))
        else:
            rows.append((str(path), "dir"))
    return rows


class Guarded(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix="nilla-guard-test-")).resolve()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.home = self.temp / "home"
        self.home.mkdir()
        self.upstream_config = self.home / ".config" / "ardia"
        (self.upstream_config / "config" / "themes").mkdir(parents=True)
        (self.upstream_config / "config" / "config.json").write_text(PLANTED)
        (self.upstream_config / "config" / "themes" / "dusk.json").write_text('{"name": "dusk"}\n')
        self.installed = self.temp / "installed"
        self.installed.mkdir()
        environment = {"HOME": str(self.home), "ARDIA_DATA_DIR": "", "ARDIA_CONFIG_HOME": "", "ARDIA_CLI_HOME": "", "VISUAL": "", "EDITOR": ""}
        for name in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"):
            environment[name] = ""
        for patch in (mock.patch.dict(os.environ, environment), mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.installed)):
            patch.start()
            self.addCleanup(patch.stop)
        self.before = snapshot(self.upstream_config)

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                status = cli.main(list(argv))
            except SystemExit as exit:
                status = exit.code
        return status, out.getvalue(), err.getvalue()

    def refused(self, *argv, env=None):
        with mock.patch.dict(os.environ, env or {}):
            status, out, err = self.run_cli(*argv)
        self.assertEqual(status, 2, (argv, out, err))
        self.assertIn("nilla-browser", err)
        self.assertTrue("never reads or writes" in err or "can't be resolved" in err, err)
        self.assertNotIn("planted", out)
        self.assertNotIn("Traceback", err)
        return err

    def assert_untouched(self):
        self.assertEqual(snapshot(self.upstream_config), self.before)


class ConfigTargets(Guarded):
    COMMANDS = (("config", "init"), ("config", "path"), ("config", "get"), ("config", "set", "tabLayout", "top"), ("theme", "list"), ("theme", "new", "fresh"))

    def test_the_macos_default_linked_to_the_upstream_folder_is_refused(self):
        (self.home / ".config" / "nilla").symlink_to(self.upstream_config / "config")
        with mock.patch.object(endpoint, "LINUX", False):
            for argv in self.COMMANDS:
                with self.subTest(argv=argv):
                    self.refused(*argv)
        self.assert_untouched()

    def test_a_data_dirs_config_folder_linked_upstream_is_refused(self):
        data = self.temp / "data"
        data.mkdir()
        (data / "config").symlink_to(self.upstream_config / "config")
        for argv in self.COMMANDS:
            with self.subTest(argv=argv):
                self.refused(*argv, "--data-dir", str(data))
        self.assert_untouched()

    def test_a_config_file_or_theme_linked_upstream_is_never_read_or_written(self):
        data = self.temp / "data"
        (data / "config" / "themes").mkdir(parents=True)
        (data / "config" / "config.json").symlink_to(self.upstream_config / "config" / "config.json")
        (data / "config" / "themes" / "dusk.json").symlink_to(self.upstream_config / "config" / "themes" / "dusk.json")
        for argv in (("config", "get"), ("config", "set", "tabLayout", "top"), ("config", "unset", "planted"), ("config", "check"), ("theme", "get", "dark.accent", "--theme", "dusk"), ("theme", "check", "dusk"), ("theme", "set", "dark.accent", "#112233", "--theme", "dusk")):
            with self.subTest(argv=argv):
                self.refused(*argv, "--data-dir", str(data))
        self.assert_untouched()

    def test_a_schema_linked_upstream_is_never_read(self):
        data = self.temp / "data"
        (data / "config").mkdir(parents=True)
        (data / "config-schema").symlink_to(self.upstream_config / "config")
        with self.assertRaises(endpoint.UpstreamFolder):
            config_files.find_schema(config_files.places(str(data)), "config.json")
        self.assert_untouched()

    def test_write_text_never_follows_a_link_upstream(self):
        folder = self.temp / "mine"
        folder.mkdir()
        (folder / "config.json").symlink_to(self.upstream_config / "config" / "config.json")
        with self.assertRaises(endpoint.UpstreamFolder):
            config_files.write_text(folder / "config.json", "{}\n")
        with self.assertRaises(endpoint.UpstreamFolder):
            config_files.write_text(self.upstream_config / "config" / "new.json", "{}\n", overwrite=False)
        self.assert_untouched()

    def test_relative_and_dot_dot_aliases_resolve_before_the_check(self):
        inside = self.upstream_config / "config"
        aside = self.temp / "aside"
        aside.mkdir()
        (aside / "link").symlink_to(self.home / ".config" / "sub")
        (self.home / ".config" / "sub").mkdir()
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(inside)
        for data in (".", "./themes/..", "../config", f"{aside}/link/../ardia", f"{aside}/link/../ardia/x/.."):
            with self.subTest(data=data):
                self.refused("config", "set", "tabLayout", "top", env={"ARDIA_DATA_DIR": data})
        self.assert_untouched()

    def test_a_path_that_cant_be_resolved_is_refused(self):
        with self.assertRaisesRegex(endpoint.UpstreamFolder, "can't be resolved"):
            endpoint.own_folder(Path("/tmp/a\0b"), "the data dir")

    def test_case_and_unicode_variants_match_on_macos(self):
        support = self.home / "Library" / "Application Support"
        with mock.patch.object(upstream.sys, "platform", "darwin"):
            for variant in ("ARDIA/Default", "ardia", "Com.Ardia.Browser/Chromium"):
                with self.subTest(variant=variant):
                    self.assertIsNotNone(upstream.containing_folder(support / variant))
            self.assertIsNotNone(upstream.containing_folder(self.home / "Library" / "LOGS" / "Ardia"))
            self.assertIsNone(upstream.containing_folder(support / "Nilla"))
        self.assertIsNone(upstream.containing_folder(support / "ARDIA"), "case-sensitive outside macOS")

    def test_nillas_own_folders_still_work(self):
        with mock.patch.object(endpoint, "LINUX", False):
            status, out, err = self.run_cli("config", "set", "tabLayout", "top")
        self.assertEqual(status, 0, err)
        self.assertEqual(json.loads((self.home / ".config" / "nilla" / "config.json").read_text())["settings"], {"tabLayout": "top"})
        self.assert_untouched()


class CliHomes(Guarded):
    def plant(self, home: Path, marked: bool, installed: bool) -> Path:
        home.mkdir(parents=True, exist_ok=True)
        if marked:
            (home / upstream.CLI_HOME_MARK).write_text("")
        if installed:
            (home / "0.0.1" / "bin").mkdir(parents=True)
            (home / "0.0.1" / "bin" / "ardia").write_text("#!/bin/sh\n")
            (home / "current").symlink_to("0.0.1")
        return home

    def test_an_upstream_cli_home_is_refused_with_or_without_a_planted_mark(self):
        share = self.home / ".local" / "share" / "ardia" / "cli"
        cases = (
            ("marked install", share, True, True),
            ("empty subtree", self.home / ".local" / "share" / "ardia" / "empty", False, False),
            ("marked empty", self.home / ".cache" / "ardia" / "cli", True, False),
            ("mac support", self.home / "Library" / "Application Support" / "Ardia" / "CLI", True, True),
        )
        for name, home, marked, installed in cases:
            with self.subTest(name=name):
                self.plant(home, marked, installed)
                before = snapshot(self.home)
                for linux in (True, False):
                    with mock.patch.object(endpoint, "LINUX", linux), self.assertRaises(endpoint.UpstreamFolder):
                        usage.cli_home({"ARDIA_CLI_HOME": str(home)})
                with mock.patch.dict(os.environ, {"ARDIA_CLI_HOME": str(home), "ARDIA_CONFIG_HOME": str(self.temp / "nilla-config")}), mock.patch.object(endpoint, "LINUX", True), mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.temp / "nilla-config" / "ardia"):
                    with self.assertRaises(endpoint.UpstreamFolder):
                        hooks.agent_paths(linux=True)
                self.assertIsNone(usage.recording_home({"ARDIA_CLI_HOME": str(home)}))
                self.assertEqual(snapshot(self.home), before)

    def test_a_cli_home_linked_upstream_is_refused(self):
        target = self.plant(self.home / ".local" / "share" / "ardia" / "cli", True, True)
        alias = self.temp / "alias"
        alias.symlink_to(target)
        with self.assertRaises(endpoint.UpstreamFolder):
            usage.cli_home({"ARDIA_CLI_HOME": str(alias)})

    def test_a_launcher_that_resolves_upstream_is_never_run(self):
        self.plant(self.home / ".local" / "share" / "ardia" / "cli", False, True)
        own = self.home / ".local" / "share"
        (own / upstream.CLI_HOME_MARK).write_text("")
        (own / "current").symlink_to("ardia/cli/0.0.1")
        with mock.patch.dict(os.environ, {"ARDIA_CLI_HOME": str(own), "ARDIA_CONFIG_HOME": str(self.temp / "nilla-config")}), mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.temp / "nilla-config" / "ardia"):
            paths = hooks.agent_paths(linux=True)
            with self.assertRaisesRegex(hooks.HooksError, "never reads or writes"):
                paths.owned_launcher()
            self.assertIsNone(computer.trusted_launcher({"ARDIA_CLI_HOME": str(own)}))

    def test_a_marked_cli_home_of_nillas_own_is_used(self):
        own = self.plant(self.temp / "nilla-cli", True, True)
        self.assertEqual(usage.cli_home({"ARDIA_CLI_HOME": str(own)}), own)
        self.assertEqual(computer.trusted_launcher({"ARDIA_CLI_HOME": str(own)}), own / "current" / "bin" / "ardia")
        with mock.patch.dict(os.environ, {"ARDIA_CLI_HOME": str(own), "ARDIA_CONFIG_HOME": str(self.temp / "nilla-config")}), mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.temp / "nilla-config" / "ardia"):
            self.assertEqual(hooks.agent_paths(linux=True).owned_launcher(), own / "current" / "bin" / "ardia")


@unittest.skipUnless(ON_LINUX and shutil.which("flock") and shutil.which("sha256sum"), "Linux with flock and sha256sum")
class InstallScriptRefusesUpstream(unittest.TestCase):
    setUp = InstallScript.setUp
    use_home = InstallScript.use_home
    login_shell = InstallScript.login_shell
    install = InstallScript.install

    def refused(self, env, expected):
        before = snapshot(self.home)
        status, lines, err = self.install("0.0.1", env=env)
        self.assertEqual(status, 1, (lines, err))
        self.assertTrue(lines[-1].startswith("error ") and expected in lines[-1], lines)
        self.assertEqual(snapshot(self.home), before)
        self.assertFalse(os.path.lexists(self.bin))

    def test_a_planted_mark_never_makes_the_upstream_cli_home_its_own(self):
        self.login_shell("zsh")
        upstream_home = self.home / ".local" / "share" / "ardia" / "cli"
        upstream_home.mkdir(parents=True)
        (upstream_home / upstream.CLI_HOME_MARK).write_text("")
        for env in ({"ARDIA_CLI_HOME": str(upstream_home)}, {"ARDIA_CLI_HOME": str(self.home / ".local" / "share" / "ardia" / "fresh")}, {"ARDIA_CLI_HOME": str(self.temp / "xdg" / "ardia" / "cli"), "XDG_DATA_HOME": str(self.temp / "xdg")}, {"ARDIA_CLI_HOME": str(self.home / ".config" / "ardia")}):
            with self.subTest(env=env):
                self.refused(env, "never installs into")

    def test_links_dots_and_relative_paths_are_resolved_or_refused(self):
        self.login_shell("zsh")
        (self.home / ".config" / "ardia").mkdir(parents=True)
        alias = self.temp / "alias"
        alias.symlink_to(self.home / ".config" / "ardia")
        (self.temp / "parent").symlink_to(self.home / ".config")
        self.refused({"ARDIA_CLI_HOME": str(alias / "cli")}, "never installs into")
        self.refused({"ARDIA_CLI_HOME": str(self.temp / "parent" / "ardia" / "cli")}, "never installs into")
        for value in ("relative/cli", f"{self.temp}/x/../cli", f"{self.temp}/./cli", str(self.temp / "dangling" / "cli")):
            with self.subTest(value=value):
                if value.endswith("dangling/cli"):
                    (self.temp / "dangling").symlink_to(self.temp / "nowhere")
                self.refused({"ARDIA_CLI_HOME": value}, "can't be resolved")

    def test_a_bin_dir_upstream_is_refused(self):
        self.login_shell("zsh")
        self.refused({"ARDIA_CLI_BIN_DIR": str(self.home / ".local" / "share" / "ardia" / "bin")}, "never installs into")

    def test_install_sh_lists_the_same_upstream_folders_as_the_cli(self):
        text = INSTALL_SH.read_text()
        for folder in ("Library/Application Support/Ardia", "Library/Application Support/com.ardia.browser", "Library/Logs/Ardia"):
            self.assertIn(folder, text)
        with mock.patch.dict(os.environ, {"HOME": str(self.home), "XDG_CONFIG_HOME": "", "XDG_DATA_HOME": "", "XDG_STATE_HOME": "", "XDG_CACHE_HOME": ""}):
            listed = subprocess.run(["/bin/sh", "-c", ". /dev/stdin; upstream_folders", "sh"], input="xdg_or()" + text.split("xdg_or()", 1)[1].split("refuse_upstream()")[0], capture_output=True, text=True, env=dict(os.environ, os="linux"))
            self.assertEqual(listed.returncode, 0, listed.stderr)
            self.assertEqual(sorted(set(listed.stdout.splitlines())), sorted({str(folder) for folder in upstream.folders()}))


if __name__ == "__main__":
    unittest.main()
