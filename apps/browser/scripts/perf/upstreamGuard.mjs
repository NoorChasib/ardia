export const BENCH_PROBE = "https://bench-probe.invalid/guard";

const UPSTREAM_HOSTS = /^(?:[\w-]+\.)*(?:ardia\.dev|netnyahoo\.com)$/i;
const UPSTREAM_GITHUB_HOSTS = new Set(["github.com", "api.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com", "codeload.github.com", "uploads.github.com"]);
const UPSTREAM_OWNER_IN_PATH = /(?:^|[/=%.\s])(?:ardia-browser|mantrakp04)(?:[/%&\s.]|$)/i;

const normalHost = (hostname) => hostname.trim().replace(/\.+$/, "").toLowerCase();

function decoded(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function isUpstream(url) {
  try {
    const { hostname, pathname, search } = new URL(url);
    const host = normalHost(hostname);
    return UPSTREAM_HOSTS.test(host) || (UPSTREAM_GITHUB_HOSTS.has(host) && UPSTREAM_OWNER_IN_PATH.test(decoded(pathname + search)));
  } catch {
    return false;
  }
}

export const upstreamFetches = (blocked) => blocked.filter(isUpstream);

export function probeBlocked(blocked) {
  return blocked.filter((url) => url === BENCH_PROBE).length === 1;
}
