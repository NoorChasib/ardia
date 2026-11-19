import os
import sys
from pathlib import Path

CLI_HOME_MARK = ".nilla-cli"


def _xdg(variable: str, *fallback: str) -> Path:
    value = os.environ.get(variable)
    return Path(value) if value and os.path.isabs(value) else Path.home().joinpath(*fallback)


def folders() -> list[Path]:
    home = Path.home()
    support = home / "Library" / "Application Support"
    return [
        _xdg("XDG_CONFIG_HOME", ".config") / "ardia",
        home / ".config" / "ardia",
        _xdg("XDG_DATA_HOME", ".local", "share") / "ardia",
        home / ".local" / "share" / "ardia",
        _xdg("XDG_STATE_HOME", ".local", "state") / "ardia",
        home / ".local" / "state" / "ardia",
        _xdg("XDG_CACHE_HOME", ".cache") / "ardia",
        home / ".cache" / "ardia",
        support / "Ardia",
        support / "com.ardia.browser",
        home / "Library" / "Logs" / "Ardia",
    ]


def _comparable(path) -> str:
    resolved = os.path.realpath(os.path.abspath(os.path.expanduser(str(path))))
    return resolved.lower() if sys.platform == "darwin" else resolved


def containing_folder(path) -> Path | None:
    candidate = _comparable(path)
    for folder in folders():
        root = _comparable(folder)
        if candidate == root or candidate.startswith(root.rstrip(os.sep) + os.sep):
            return folder
    return None


def refusal(what: str, path, folder: Path) -> str:
    return f"{what} {path} is inside {folder}, an installed Ardia's folder; nilla-browser never reads or writes Ardia's data, config, CLI or logs"


def installed_elsewhere(cli_home) -> bool:
    home = Path(cli_home)
    if (home / CLI_HOME_MARK).exists() or not home.is_dir():
        return False
    if os.path.lexists(home / "current"):
        return True
    return any(entry.name[:1].isdigit() and entry.is_dir() for entry in home.iterdir())
