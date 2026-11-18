import { sharingAgreed } from "./choice";
import { consentedCount } from "./consentedCount";

export type TabReleaseOutcome = "released" | "alreadyClosed" | "failed";

const releases = consentedCount();
const alreadyClosed = consentedCount();
const failed = consentedCount();

export function noteTabRelease(outcome: TabReleaseOutcome) {
  if (!sharingAgreed()) return;
  releases.note();
  if (outcome === "alreadyClosed") alreadyClosed.note();
  else if (outcome === "failed") failed.note();
}

export function takeTabReleaseCounts() {
  return { host_tab_releases: releases.take(), host_tab_releases_already_closed: alreadyClosed.take(), host_tab_releases_failed: failed.take() };
}
