import assert from "node:assert/strict";
import { test } from "node:test";
import { BENCH_PROBE, isUpstream, probeBlocked, upstreamFetches } from "./upstreamGuard.mjs";

test("the bench probe is not an upstream address, so no real request has to be exempted for it", () => {
  assert.equal(isUpstream(BENCH_PROBE), false);
  assert.equal(new URL(BENCH_PROBE).hostname.endsWith(".invalid"), true);
});

test("a real request to the old telemetry endpoint is caught even right after the probe", () => {
  const blocked = [BENCH_PROBE, "https://ardia.dev/otel/v1/logs", "https://example.com/x"];
  assert.deepEqual(upstreamFetches(blocked), ["https://ardia.dev/otel/v1/logs"]);
  assert.equal(probeBlocked(blocked), true);
});

test("every fixed-list address is upstream and other addresses are not", () => {
  for (const url of ["https://lab.ardia.dev/", "https://netnyahoo.com/a", "https://github.com/ardia-browser/ardia/releases", "https://api.github.com/repos/mantrakp04/ardia", "https://objects.githubusercontent.com/ardia-browser/x"]) assert.equal(isUpstream(url), true, url);
  for (const url of ["https://github.com/NoorChasib/nilla", "https://notardia.dev/", "https://example.com/ardia.dev", "not a url"]) assert.equal(isUpstream(url), false, url);
});

test("the probe counts as blocked only when it was blocked exactly once", () => {
  assert.equal(probeBlocked([]), false);
  assert.equal(probeBlocked([BENCH_PROBE, BENCH_PROBE]), false);
});
