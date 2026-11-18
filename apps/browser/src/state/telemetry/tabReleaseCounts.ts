export type TabReleaseOutcome = "released" | "alreadyClosed" | "failed";

const NONE = { host_tab_releases: 0, host_tab_releases_already_closed: 0, host_tab_releases_failed: 0 };
let counts = { ...NONE };

export function noteTabRelease(outcome: TabReleaseOutcome) {
  counts.host_tab_releases++;
  if (outcome === "alreadyClosed") counts.host_tab_releases_already_closed++;
  else if (outcome === "failed") counts.host_tab_releases_failed++;
}

export function takeTabReleaseCounts() {
  const taken = counts;
  counts = { ...NONE };
  return taken;
}
