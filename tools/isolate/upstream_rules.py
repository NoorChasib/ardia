import re
from urllib.parse import unquote

UPSTREAM_DOMAINS = ("ardia.dev", "netnyahoo.com")
GITHUB_HOSTS = ("github.com", "api.github.com", "objects.githubusercontent.com")
EXTRA_GITHUB_HOSTS = ("raw.githubusercontent.com", "codeload.github.com", "uploads.github.com")
UPSTREAM_OWNERS = ("ardia-browser", "mantrakp04")
ALLOWED_HOSTS = ("services.helium.imput.net",)

OWNER_PATTERN = re.compile(r"(?:^|[/=%.\s])(" + "|".join(re.escape(owner) for owner in UPSTREAM_OWNERS) + r")(?:[/%&\s.]|$)", re.IGNORECASE)


def normal_host(host):
    return (host or "").strip().rstrip(".").lower()


def under(host, domain):
    return host == domain or host.endswith("." + domain)


def github_owner_in_path(host, path):
    decoded = unquote(path or "")
    segments = [segment for segment in decoded.split("?", 1)[0].split("/") if segment]
    if host == "api.github.com":
        if len(segments) >= 2 and segments[0] in ("repos", "users", "orgs") and segments[1].lower() in UPSTREAM_OWNERS:
            return True
    if segments and segments[0].lower() in UPSTREAM_OWNERS:
        return True
    return bool(OWNER_PATTERN.search(decoded))


def classify(host, path=None):
    host = normal_host(host)
    if not host:
        return "other", ""
    if any(under(host, allowed) for allowed in ALLOWED_HOSTS):
        return "allowed", "Helium bang list exception"
    for domain in UPSTREAM_DOMAINS:
        if under(host, domain):
            return "upstream", f"host under {domain}"
    if host in GITHUB_HOSTS or host in EXTRA_GITHUB_HOSTS:
        if path is None:
            return "github-unknown-path", "GitHub host contacted without a visible path"
        if github_owner_in_path(host, path):
            listed = "fixed list" if host in GITHUB_HOSTS else "extension of the fixed list"
            return "upstream", f"{host} path under an upstream owner ({listed})"
        return "other", ""
    return "other", ""
