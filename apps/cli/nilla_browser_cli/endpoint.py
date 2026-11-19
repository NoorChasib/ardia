import errno
import json
import os
import re
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

from nilla_browser_cli import upstream
from nilla_browser_cli.redact import add_secret

NOT_REACHABLE = (
    "Nilla isn't running, or \"Let the nilla-browser command control Nilla\" is off in Settings."
)
CONTROL_FILE = "ArdiaControl.json"
LINUX = sys.platform.startswith("linux")
DATA_DIR_DEFAULT = "$ARDIA_CONFIG_HOME/ardia, else $ARDIA_DATA_DIR" if LINUX else "$ARDIA_DATA_DIR, else the installed app's"
DATA_DIR_HELP = f"the Nilla data dir (default: {DATA_DIR_DEFAULT})"
DATA_DIR_CHOICE = "--data-dir, or $ARDIA_DATA_DIR without $ARDIA_CONFIG_HOME" if LINUX else "--data-dir or $ARDIA_DATA_DIR"
ID_PREFIX = "com.nilladigital"
BUNDLE_ID = f"{ID_PREFIX}.nilla"


class EndpointError(Exception):
    pass


def xdg_dir(variable: str, *fallback: str, absolute: bool = False) -> Path:
    value = os.environ.get(variable)
    if value and (os.path.isabs(value) or not absolute):
        return Path(value)
    return Path.home().joinpath(*fallback)


def config_home(absolute: bool = False) -> Path:
    return xdg_dir("XDG_CONFIG_HOME", ".config", absolute=absolute)


DATA_DIR_UNSET = (
    "set ARDIA_DATA_DIR to Nilla's data folder, or ARDIA_CONFIG_HOME to the folder that holds it: on Linux this "
    "development build never guesses, so it never reaches an installed Ardia's ~/.config/ardia"
)
UNSET_DATA_DIR = Path(os.devnull) / "nilla-browser-data-dir-unset"


class DataDirUnset(EndpointError):
    pass


def installed_data_dir(linux: bool | None = None) -> Path:
    if not (LINUX if linux is None else linux):
        return Path.home() / "Library" / "Application Support" / BUNDLE_ID
    override = os.environ.get("ARDIA_CONFIG_HOME")
    return Path(override) / "ardia" if override else UNSET_DATA_DIR


class UpstreamFolder(DataDirUnset):
    pass


class CliHomeUnset(DataDirUnset):
    pass


def own_folder(path: Path, what: str) -> Path:
    try:
        folder = upstream.containing_folder(path)
    except (OSError, ValueError) as error:
        raise UpstreamFolder(f"{what} {path} can't be resolved ({getattr(error, 'strerror', None) or error}), so nilla-browser won't use it") from None
    if folder is not None:
        raise UpstreamFolder(upstream.refusal(what, path, folder))
    return path


def real_folder(path: Path, what: str) -> Path:
    own_folder(path, what)
    try:
        return Path(upstream.resolved(path))
    except (OSError, ValueError) as error:
        raise UpstreamFolder(f"{what} {path} can't be resolved ({getattr(error, 'strerror', None) or error}), so nilla-browser won't use it") from None


def known_data_dir(path: Path) -> Path:
    if path == UNSET_DATA_DIR:
        raise DataDirUnset(DATA_DIR_UNSET)
    return own_folder(path, "the data dir")


LINUX_DATA_DIR_SHOWN = "$ARDIA_CONFIG_HOME/ardia"


def chromium_dir(root: Path, linux: bool | None = None) -> Path:
    return Path(root) if (LINUX if linux is None else linux) else Path(root) / "Chromium"


def control_file_path(root: Path) -> Path:
    return chromium_dir(root) / CONTROL_FILE


INSTALLED_DATA_DIR = installed_data_dir()
_BROWSER_PATH = re.compile(r"^/devtools/browser/[0-9A-Za-z-]{1,128}$")
_TOKEN = re.compile(r"^[\x21-\x7e]{16,1024}$")
_MAX_CONTROL_FILE = 64 * 1024


@dataclass(frozen=True)
class Endpoint:
    ws: str
    source: str
    explicit: bool
    active: str | None = None
    instance: str | None = None


def resolve(ws: str | None = None, port: int | None = None, data_dir: str | None = None) -> Endpoint:
    if ws:
        return _from_ws(ws, "--ws")
    if port is not None:
        return _from_port(port, "--port")
    env_ws = os.environ.get("ARDIA_WS")
    if env_ws:
        return _from_ws(env_ws, "ARDIA_WS")
    env_port = os.environ.get("ARDIA_PORT")
    if env_port:
        return _from_port(env_port_number(env_port), "ARDIA_PORT")
    env_cdp = os.environ.get("ARDIA_CDP_URL")
    if env_cdp:
        return _from_ws(env_cdp, "ARDIA_CDP_URL")
    return from_control_file(control_file_path(data_root(data_dir)))


def env_port_number(text: str) -> int:
    try:
        return int(text)
    except ValueError:
        raise EndpointError(f"ARDIA_PORT must be a port number, not {text!r}") from None


def data_root(data_dir: str | None = None) -> Path:
    explicit = explicit_data_root(data_dir)
    return explicit if explicit is not None else known_data_dir(INSTALLED_DATA_DIR)


def env_data_dir(env=None) -> str | None:
    env = os.environ if env is None else env
    chosen = env.get("ARDIA_DATA_DIR") or None
    if LINUX and env.get("ARDIA_CONFIG_HOME") and INSTALLED_DATA_DIR != UNSET_DATA_DIR:
        if chosen:
            own_folder(Path(chosen).expanduser(), "ARDIA_DATA_DIR")
        return None
    return chosen


def explicit_data_root(data_dir: str | None = None) -> Path | None:
    root = data_dir or env_data_dir()
    return own_folder(Path(root).expanduser(), "the data dir") if root else None


def require_control(root: Path) -> Endpoint:
    return from_control_file(control_file_path(root))


def _from_ws(url: str, source: str) -> Endpoint:
    parts = urlsplit(url)
    if parts.scheme not in ("ws", "wss") or not parts.netloc or not parts.path.startswith("/devtools/browser/"):
        raise EndpointError(f"{source} must be a ws://host:port/devtools/browser/<id> URL")
    for token in parse_qs(parts.query).get("token", []):
        add_secret(token)
    return Endpoint(url, source, True, instance=f"{parts.netloc}{parts.path}")


def _from_port(port: int, source: str) -> Endpoint:
    import urllib.request

    if not 0 < port < 65536:
        raise EndpointError(f"{source} must be between 1 and 65535, not {port}")
    try:
        direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with direct.open(f"http://127.0.0.1:{port}/json/version", timeout=3) as response:
            info = json.loads(response.read(_MAX_CONTROL_FILE))
    except Exception as error:
        raise EndpointError(f"no DevTools server answers on 127.0.0.1:{port} ({_reason(error)})") from None
    ws = info.get("webSocketDebuggerUrl") if isinstance(info, dict) else None
    if not isinstance(ws, str):
        raise EndpointError(f"127.0.0.1:{port}/json/version has no webSocketDebuggerUrl")
    return _from_ws(ws, f"{source} {port}")


def _reason(error: Exception) -> str:
    reason = getattr(error, "reason", None)
    return str(reason or error) or type(error).__name__


def from_control_file(path: Path) -> Endpoint:
    path = Path(path)
    opened = real_folder(path.parent, "the control file's folder") / path.name
    try:
        fd = os.open(opened, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        raise EndpointError(NOT_REACHABLE) from None
    except OSError as error:
        reason = "is a symbolic link" if error.errno == errno.ELOOP else error.strerror
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} {reason})") from None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise EndpointError(f"{NOT_REACHABLE} ({path.name} isn't a regular file)")
        if info.st_uid != os.getuid():
            raise EndpointError(f"{NOT_REACHABLE} ({path.name} belongs to another user)")
        if stat.S_IMODE(info.st_mode) != 0o600:
            raise EndpointError(f"{NOT_REACHABLE} ({path.name} must be mode 0600)")
        raw = os.read(fd, _MAX_CONTROL_FILE + 1)
    finally:
        os.close(fd)
    try:
        control = json.loads(raw)
    except ValueError:
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} isn't valid JSON)") from None
    if not isinstance(control, dict):
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} isn't valid)")
    port = control.get("port")
    browser = control.get("browser")
    token = control.get("token")
    pid = control.get("pid")
    generation = control.get("generation")
    if not (isinstance(port, int) and 0 < port < 65536):
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} has no valid port)")
    if not (isinstance(browser, str) and _BROWSER_PATH.match(browser)):
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} has no valid browser path)")
    if not (isinstance(token, str) and _TOKEN.match(token)):
        raise EndpointError(f"{NOT_REACHABLE} ({path.name} has no valid token)")
    add_secret(token)
    if not (isinstance(pid, int) and pid > 1 and _alive(pid)):
        raise EndpointError(NOT_REACHABLE)
    query = f"token={quote(token, safe='')}"
    return Endpoint(
        f"ws://127.0.0.1:{port}{browser}?{query}",
        str(path),
        False,
        f"http://127.0.0.1:{port}/ardia/active?{query}",
        f"{pid}:{generation if isinstance(generation, int) else 0}:{browser}",
    )


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return False
    return True
