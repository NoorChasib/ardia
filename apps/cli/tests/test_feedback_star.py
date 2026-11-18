import contextlib
import io
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ardia_cli import caller, cli, endpoint, star, telemetry, usage
from test_telemetry import CLEARED, Stub, scratch_dir


class Case(unittest.TestCase):
    def setUp(self):
        self.temp = scratch_dir()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.data = self.temp / "data"
        self.data.mkdir()
        self.home = self.temp / "cli"
        self.stub = Stub()
        self.addCleanup(self.stub.close)
        env = {k: v for k, v in os.environ.items() if k not in CLEARED + ("ARDIA_CLI_HOME", "ARDIA_STAR_PROMPT", "CI", "GITHUB_ACTIONS", "BUILDKITE", "JENKINS_URL")}
        env.update({"ARDIA_CLI_HOME": str(self.home), telemetry.TEST_URL_ENV: self.stub.url})
        for patch in (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.data),
            mock.patch.object(caller, "_current", caller.Caller("Claude Code")),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        spawn = mock.patch.object(telemetry, "spawn_flusher")
        self.spawn = spawn.start()
        self.addCleanup(spawn.stop)

    def run_cli(self, *argv, stdin=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch.object(sys, "stdin", stdin or io.StringIO("")):
            try:
                status = cli.main(list(argv))
            except SystemExit as stop:
                status = stop.code
        return status, out.getvalue(), err.getvalue()


def call(argv):
    return SimpleNamespace(argv=argv, command="browse", subcommand=None, browse_argv=argv)


class UsageRecordTest(Case):
    def record(self, argv, at, status=0, env=None):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), mock.patch.object(usage.time, "time", return_value=at):
            usage.record(call(argv), status, os.environ if env is None else env)
        return err.getvalue()

    def state(self):
        return usage.read(self.home)

    def test_never_nudges_for_a_star_however_much_work_is_done(self):
        shown = "".join(self.record(["open", "https://a.test"], index * 3600) + self.record(["click", "@e1"], index * 3600 + 5) for index in range(12))
        self.assertEqual(shown, "")
        self.assertNotIn("star", self.state())
        self.assertNotIn("tasks", self.state())
        self.assertFalse(hasattr(usage, "STAR_PROMPT"))

    def test_a_checkout_without_a_cli_home_records_nothing(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ARDIA_CLI_HOME")
            self.assertIsNone(usage.recording_home(os.environ))
            with mock.patch.object(usage, "locked") as locked:
                usage.record(call(["open", "x"]), 0, os.environ)
            locked.assert_not_called()

    def test_runs_through_the_cli_quietly(self):
        with mock.patch("ardia_cli.browse.cli.main", return_value=0):
            for at in (0, 7200):
                with mock.patch.object(usage.time, "time", return_value=at):
                    status, out, err = self.run_cli("browse", "open" if at == 0 else "click", "https://a.test")
        self.assertEqual(status, 0)
        self.assertEqual(out, "")
        self.assertEqual(err, "")
        self.assertEqual(self.state()["recent"], ["browse open", "browse click"])

    def test_recent_keeps_the_last_five_names_and_exit_codes(self):
        for index, name in enumerate(["open", "click", "fill", "press", "snapshot", "eval"]):
            self.record([name, "secret-arg"], index, status=1 if name == "eval" else 0)
        self.assertEqual(self.state()["recent"], ["browse click", "browse fill", "browse press", "browse snapshot", "browse eval (exit 1)"])


class StarTest(Case):
    def args(self, data_dir=None):
        return SimpleNamespace(data_dir=data_dir)

    def star(self, run, which, data_dir=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = star.run(self.args(data_dir), run=run, which=which)
        return status, out.getvalue(), err.getvalue()

    def fake_run(self, codes):
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            code = codes[0] if "api" in command else codes[1]
            return subprocess.CompletedProcess(command, code, "", "")

        return run, calls

    def test_stars_through_gh_when_it_works(self):
        run, calls = self.fake_run((0, 0))
        status, out, _ = self.star(run, lambda name: "/opt/homebrew/bin/gh")
        self.assertEqual(status, 0)
        self.assertEqual(calls, [["/opt/homebrew/bin/gh", "api", "--method", "PUT", "/user/starred/NoorChasib/nilla", "--silent"]])
        self.assertIn("Starred", out)
        self.assertEqual(usage.read(self.home)["star"]["via"], "gh")

    def test_opens_the_page_in_a_new_ardia_tab_when_gh_isnt_signed_in(self):
        run, calls = self.fake_run((4, 0))
        status, out, _ = self.star(run, lambda name: "/usr/local/bin/gh", data_dir="/tmp/d")
        self.assertEqual(status, 0)
        self.assertEqual(len(calls), 2)
        browse = calls[1]
        self.assertEqual(browse[:4], [sys.executable, "-I", "-m", "ardia_cli"])
        self.assertEqual(browse[4:], ["--data-dir", "/tmp/d", "browse", "--session", star.SESSION, "open", star.URL, "--show"])
        self.assertIn("Ask the user to click Star", out)
        self.assertEqual(usage.read(self.home)["star"]["via"], "browser")

    def test_skips_gh_when_it_isnt_installed(self):
        run, calls = self.fake_run((0, 0))
        status, _, _ = self.star(run, lambda name: None)
        self.assertEqual(status, 0)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("api", calls[0])

    def test_reports_when_neither_works_and_remembers_it_ran(self):
        run, _ = self.fake_run((1, 2))
        status, out, err = self.star(run, lambda name: "/usr/bin/gh")
        self.assertEqual(status, 1)
        self.assertIn(star.URL, err)
        self.assertTrue(usage.read(self.home)["star"]["done_at"])

    def test_gh_timeout_falls_back(self):
        def run(command, **kwargs):
            if "api" in command:
                raise subprocess.TimeoutExpired(command, 20)
            return subprocess.CompletedProcess(command, 0, "", "")

        status, out, _ = self.star(run, lambda name: "/usr/bin/gh")
        self.assertEqual(status, 0)
        self.assertIn("new Ardia tab", out)

    def test_star_command_is_wired_into_the_cli(self):
        with mock.patch.object(star, "star_with_gh", return_value=True) as gh:
            status, out, _ = self.run_cli("star")
        self.assertEqual(status, 0)
        gh.assert_called_once()
        self.assertIn("Starred", out)


if __name__ == "__main__":
    unittest.main()
