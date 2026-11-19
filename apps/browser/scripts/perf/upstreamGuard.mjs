export const BENCH_PROBE = "https://bench-probe.invalid/guard";

const UPSTREAM_HOSTS = /^(?:[\w-]+\.)*(?:ardia\.dev|netnyahoo\.com)$/i;
const UPSTREAM_GITHUB_HOSTS = new Set(["github.com", "api.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com", "codeload.github.com", "uploads.github.com"]);
const UPSTREAM_OWNERS = new Set(["ardia-browser", "mantrakp04"]);
const API_OWNER_ROUTES = new Set(["repos", "users", "orgs"]);
const UPSTREAM_OWNER_IN_PATH = /(?:^|[/=%.\s])(?:ardia-browser|mantrakp04)(?:[/%&\s.]|$)/i;

const normalHost = (hostname) => hostname.trim().replace(/\.+$/, "").toLowerCase();

function decoded(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function githubOwnerInPath(host, pathAndQuery) {
  const text = decoded(pathAndQuery);
  const segments = text.split("?", 1)[0].split("/").filter(Boolean);
  if (host === "api.github.com" && segments.length >= 2 && API_OWNER_ROUTES.has(segments[0]) && UPSTREAM_OWNERS.has(segments[1].toLowerCase())) return true;
  if (segments.length > 0 && UPSTREAM_OWNERS.has(segments[0].toLowerCase())) return true;
  return UPSTREAM_OWNER_IN_PATH.test(text);
}

export function isUpstream(url) {
  try {
    const { hostname, pathname, search } = new URL(url);
    const host = normalHost(hostname);
    return UPSTREAM_HOSTS.test(host) || (UPSTREAM_GITHUB_HOSTS.has(host) && githubOwnerInPath(host, pathname + search));
  } catch {
    return false;
  }
}

export const upstreamFetches = (blocked) => blocked.filter(isUpstream);

export function probeBlocked(blocked) {
  return blocked.filter((url) => url === BENCH_PROBE).length === 1;
}
