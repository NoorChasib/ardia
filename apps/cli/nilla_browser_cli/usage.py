import os
import time
from pathlib import Path

FOLDER = "Usage"
STATE = "usage.json"
LOCK = "usage.lock"
LOCK_ATTEMPTS = 5
LOCK_RETRY_S = 0.002
MAX_STATE_BYTES = 64 * 1024
MAX_RECENT = 5
NOT_RECORDED = frozenset({"feedback", "star", "none"})


def cli_home(env=None) -> Path:
    env = os.environ if env is None else env
    return owned_cli_home(Path(env.get("ARDIA_CLI_HOME") or Path.home() / "Library" / "Application Support" / "Nilla" / "CLI").expanduser())


def owned_cli_home(home: Path) -> Path:
    from nilla_browser_cli import endpoint, upstream

    if not endpoint.LINUX:
        endpoint.own_folder(home, "the CLI home")
    if upstream.installed_elsewhere(home):
        raise endpoint.UpstreamFolder(f"the CLI home {home} holds a CLI that install.sh didn't install for nilla-browser (it has no {upstream.CLI_HOME_MARK}), so nilla-browser leaves it alone")
    return home


def recording_home(env) -> Path | None:
    from nilla_browser_cli import endpoint, telemetry

    if telemetry.is_dev_build() and not env.get("ARDIA_CLI_HOME"):
        return None
    try:
        return cli_home(env)
    except endpoint.UpstreamFolder:
        return None


def open_folder(home: Path) -> int:
    from nilla_browser_cli.browse import paths

    home.mkdir(parents=True, exist_ok=True)
    return paths.open_private(home, FOLDER)


def locked(home: Path, change):
    from nilla_browser_cli.browse import paths

    dir_fd = open_folder(home)
    try:
        lock = None
        for attempt in range(LOCK_ATTEMPTS):
            lock = paths.take_lock(LOCK, dir_fd)
            if lock is not None or attempt + 1 == LOCK_ATTEMPTS:
                break
            time.sleep(LOCK_RETRY_S)
        if lock is None:
            return None
        try:
            try:
                state = paths.read_private_json(STATE, dir_fd, {}, MAX_STATE_BYTES)
            except (OSError, ValueError, paths.PathError):
                state = {}
            state = state if isinstance(state, dict) else {}
            result = change(state)
            paths.write_private_json(STATE, dir_fd, state)
            return result
        finally:
            os.close(lock)
    finally:
        os.close(dir_fd)


def read(home: Path) -> dict:
    return locked(home, lambda state: dict(state)) or {}


def number(value, default: float = 0) -> float:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else default


def command_name(call) -> str:
    from nilla_browser_cli import telemetry

    if call.browse_argv is not None:
        name, _ = telemetry.browse_command(call.browse_argv)
        return f"{call.command} {name}"
    return " ".join(part for part in (call.command, call.subcommand) if part)


def remember(state: dict, name: str, status: int) -> None:
    recent = [entry for entry in state.get("recent") or [] if isinstance(entry, str)]
    recent.append(name if status == 0 else f"{name} (exit {status})")
    state["recent"] = recent[-MAX_RECENT:]


def record(call, status: int, env) -> None:
    home = recording_home(env)
    if home is None or call.command in NOT_RECORDED:
        return
    name = command_name(call)
    locked(home, lambda state: remember(state, name, status))


def recent_commands(home: Path) -> list[str]:
    try:
        recent = read(home).get("recent") or []
    except Exception:
        return []
    return [entry for entry in recent if isinstance(entry, str)][-MAX_RECENT:]


def mark_starred(home: Path, via: str) -> None:
    def change(state: dict) -> None:
        star = state.setdefault("star", {})
        star["done_at"] = time.time()
        star["via"] = via

    locked(home, change)


def take_feedback_slot(home: Path, digest: str, limit: int, window_s: float, now: float) -> str:
    def change(state: dict) -> str:
        sent = [entry for entry in state.get("feedback") or [] if isinstance(entry, dict) and now - number(entry.get("at")) < window_s]
        state["feedback"] = sent
        if any(entry.get("digest") == digest for entry in sent):
            return "duplicate"
        if len(sent) >= limit:
            return "limited"
        sent.append({"at": now, "digest": digest})
        return "ok"

    return locked(home, change) or "busy"


def release_feedback_slot(home: Path, digest: str) -> None:
    def change(state: dict) -> None:
        state["feedback"] = [entry for entry in state.get("feedback") or [] if isinstance(entry, dict) and entry.get("digest") != digest]

    locked(home, change)
