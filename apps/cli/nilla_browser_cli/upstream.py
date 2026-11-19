import errno
import os
import stat
import sys
import unicodedata
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


MAX_LINK_HOPS = 40


def _parts(text: str) -> list[str]:
    return [part for part in text.split(os.sep) if part not in ("", ".")]


def _lstat(path: str):
    try:
        return os.lstat(path)
    except FileNotFoundError:
        return None


def resolved(path) -> str:
    text = os.path.expanduser(os.fspath(path))
    if "\0" in text:
        raise ValueError("the path holds a NUL byte")
    if not os.path.isabs(text):
        text = os.path.join(os.getcwd(), text)
    pending = _parts(text)[::-1]
    real = os.sep
    absent = 0
    hops = 0
    while pending:
        name = pending.pop()
        if name == "..":
            real = os.path.dirname(real)
            absent = max(absent - 1, 0)
            continue
        candidate = os.path.join(real, name)
        if absent:
            real, absent = candidate, absent + 1
            continue
        status = _lstat(candidate)
        if status is None:
            real, absent = candidate, 1
        elif stat.S_ISLNK(status.st_mode):
            hops += 1
            if hops > MAX_LINK_HOPS:
                raise OSError(errno.ELOOP, f"the link {candidate} doesn't lead to a real path")
            target = os.readlink(candidate)
            if os.path.isabs(target):
                real = os.sep
            pending.extend(_parts(target)[::-1])
        elif not stat.S_ISDIR(status.st_mode) and pending:
            raise OSError(errno.ENOTDIR, f"{candidate} isn't a folder")
        else:
            real = candidate
    return real


def _comparable(path) -> str:
    real = resolved(path)
    return unicodedata.normalize("NFC", real).casefold() if sys.platform == "darwin" else real


def containing_folder(path) -> Path | None:
    candidate = _comparable(path)
    for folder in folders():
        root = _comparable(folder)
        if candidate == root or candidate.startswith(root.rstrip(os.sep) + os.sep):
            return folder
    return None


def refusal(what: str, path, folder: Path) -> str:
    return f"{what} {path} is inside {folder}, an installed Ardia's folder; nilla-browser never reads or writes Ardia's data, config, CLI or logs"


def _exists(path: Path) -> bool:
    return _lstat(os.fspath(path)) is not None


def marks_own_cli_home(cli_home) -> bool:
    status = _lstat(os.fspath(Path(cli_home) / CLI_HOME_MARK))
    return status is not None and stat.S_ISREG(status.st_mode)


def installed_elsewhere(cli_home) -> bool:
    home = Path(resolved(cli_home))
    status = _lstat(os.fspath(home))
    if status is None or not stat.S_ISDIR(status.st_mode) or marks_own_cli_home(home):
        return False
    if _exists(home / "current"):
        return True
    with os.scandir(home) as entries:
        return any(entry.name[:1].isdigit() and entry.is_dir() for entry in entries)
