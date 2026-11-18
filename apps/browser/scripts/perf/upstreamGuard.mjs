export const BENCH_PROBE = "https://bench-probe.invalid/guard";

const UPSTREAM_HOSTS = /^(?:[\w-]+\.)*(?:ardia\.dev|netnyahoo\.com)$/i;
const UPSTREAM_GITHUB_HOSTS = new Set(["github.com", "api.github.com", "objects.githubusercontent.com"]);
const UPSTREAM_OWNERS = /^\/(?:repos\/)?(?:ardia-browser|mantrakp04)(?:\/|$)/i;

export function isUpstream(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return UPSTREAM_HOSTS.test(hostname) || (UPSTREAM_GITHUB_HOSTS.has(hostname.toLowerCase()) && UPSTREAM_OWNERS.test(pathname));
  } catch {
    return false;
  }
}

export const upstreamFetches = (blocked) => blocked.filter(isUpstream);

export function probeBlocked(blocked) {
  return blocked.filter((url) => url === BENCH_PROBE).length === 1;
}
