# PR 3 on Linux: stock, feature, Bun and final

CPU and RAM of four UI builds on one engine, 100 loaded tabs, measured with the Linux harness
([linux-bench.md](linux-bench.md), which also has the reproduction steps and the limits). This page holds the light
run, the one builds are ranked by. The full-instrumentation run (edge reveal and hover card latency, frames, counters)
and the options-on run haven't been done yet; see [What isn't measured yet](#what-isnt-measured-yet). [Leads not
taken](#leads-not-taken) lists the optimizations PR 3 found and left for later.

## The run

| | |
| --- | --- |
| Run | `20261118T125405`, 16 launches, all ok: 4 per build, interleaved in ABBA blocks (stock feature bun final, final bun feature stock, ...) |
| Machine | The 16-vCPU EPYC 9645 VPS in [Test machine](linux-bench.md#test-machine); app, Xvfb and fixture server on CPUs 10-15 under the CPU partition, everything else on 0-9 |
| Display and GL | Xvfb 1920x1080, no GPU. The harness passes no GL flags (`gpuFlags: []` in every result), and the engine chose ANGLE on Mesa llvmpipe |
| Engine | `engine-3a64a10704ff`, chrome sha256 `4a7cb6b15f40` |
| Instrumentation | light (no probe patches, no frame loop) |
| Harness | protocol 1: the scenario code of a7abec0e0. S3's windows include their put-back presses, and S4 never checked that a reveal happened (see [How to read S3 and S4](#how-to-read-s3-and-s4)) |
| Load average (1 min) at launch | 10-31 on the host; the app's cores were partitioned off from that load |

| Build | Commit | UI sha256 |
| --- | --- | --- |
| stock | 3043ac26b | `8ca7fd413907` |
| feature | 50a1ef106 | `da8f642c0f1c` |
| bun | 48c7e3e67 | `da8f642c0f1c` (byte-identical to feature: an A/A pair) |
| final | 2e9c24a46 | `e4db64f61996` |

`final` includes PR 1's #1679 (the tab-drag peek hold), and the measured `feature` and `bun` don't, so final against
bun is PR 3 plus #1679. Its share hasn't been bounded yet.

## CPU

Percent of one core, median over 4 launches (min-max). "final vs bun" is the median per-block difference against
bun, over the number of blocks in "blocks"; "A/A" is the largest feature-minus-bun difference in any block, the noise
a real change has to clear. A block is left out of the paired columns when its foreign CPU on the app's cores went over
5 %, which is why S2 has 2 blocks and S3, S5, S6 and S7 have 3. S1 and S2 are no claim: their differences are inside
the noise or not consistent across blocks. S4's rows are unchecked (see
[How to read S3 and S4](#how-to-read-s3-and-s4)).

| Scenario | Kind | stock | feature | bun | final | final vs bun | blocks | A/A |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| S1 idle, no claim | total | 2.02 (1.88-2.17) | 1.94 (1.76-2.06) | 1.98 (1.83-2.16) | 1.57 (1.31-2.00) | -0.47 (-24 %) | 4 | 0.40 |
| S1 idle, no claim | browser | 0.87 | 0.87 | 0.87 | 0.46 (0.38-0.97) | -0.40 (-46 %) | 4 | 0.17 |
| S2 active pages, no claim | total | 20.7 (20.0-21.1) | 19.7 (19.2-20.4) | 20.5 (20.0-21.5) | 20.4 (19.7-22.6) | -0.15 (-1 %) | 2 | 1.68 |
| S3 tab switching | total | 69.7 (61.1-70.6) | 65.0 (61.6-66.4) | 65.7 (63.1-70.1) | 53.2 (51.0-55.4) | -12.9 (-20 %) | 3 | 8.4 |
| S3 tab switching | shell | 40.1 (34.1-41.1) | 35.9 (33.8-36.9) | 38.2 (36.6-39.4) | 27.2 (25.5-29.5) | -10.3 (-27 %) | 3 | 5.4 |
| S3 tab switching | browser | 16.0 (13.8-16.5) | 15.5 (14.3-16.3) | 14.7 (13.7-16.5) | 12.1 (11.9-12.7) | -3.2 (-22 %) | 3 | 2.2 |
| S4 edge reveal, unchecked | total | 70.4 (63.4-73.3) | 70.1 (68.9-72.2) | 68.8 (66.1-75.0) | 49.9 (49.2-53.3) | -17.5 (-26 %) | 4 | 3.2 |
| S4 edge reveal, unchecked | shell | 53.9 (48.6-56.6) | 54.3 (52.6-55.7) | 52.7 (50.9-57.8) | 33.9 (32.5-36.6) | -17.6 (-33 %) | 4 | 3.3 |
| S5 hover sweep | total | 25.9 (24.4-27.7) | 26.0 (25.6-26.4) | 26.8 (24.1-27.9) | 16.9 (15.9-20.8) | -10.0 (-37 %) | 3 | 2.3 |
| S5 hover sweep | shell | 23.7 (22.1-25.3) | 23.8 (23.4-24.0) | 24.4 (22.0-25.4) | 14.8 (13.8-18.4) | -9.6 (-39 %) | 3 | 2.0 |
| S6 loading | total | 128.2 (125.8-142.1) | 127.3 (125.4-133.3) | 128.0 (120.8-139.1) | 25.3 (24.3-30.7) | -103.3 (-81 %) | 3 | 6.8 |
| S6 loading | shell | 105.5 (104.0-116.4) | 105.1 (102.8-109.5) | 105.2 (99.6-113.8) | 4.2 (3.9-5.4) | -102.1 (-97 %) | 3 | 5.8 |
| S7 loading pill | total | 118.5 (114.2-133.1) | 122.7 (114.7-125.1) | 117.2 (109.9-130.6) | 25.0 (24.0-28.3) | -92.6 (-79 %) | 3 | 13.2 |
| S7 loading pill | shell | 97.4 (93.5-109.1) | 100.5 (93.9-102.6) | 96.0 (90.1-106.5) | 4.2 (3.6-5.0) | -92.5 (-96 %) | 3 | 10.6 |

The GPU process stayed at 8-11 % of a core in S2-S4, S6 and S7 and about 1 % in S5 on every build: on this llvmpipe
setup the shell's savings reach the whole browser. Page renderers moved by less than the A/A spread in every scenario.
Stock, feature and bun are inside each other's A/A spread on every total and shell row: with PR 1's options at their
defaults, the feature work and the Bun migration didn't change CPU here.

Over all 4 launches per build, every final-against-stock and final-against-bun total and shell difference in S3, S5,
S6 and S7 has final lower in all 4 blocks (Mann-Whitney p = 0.029, the smallest 4 against 4 allows; the sign test can't
go below 0.125 at 4 blocks). S4's rows go the same way, but its windows never confirmed a reveal, so they aren't claimed
until the protocol 2 run.

## RAM

All tabs loaded and settled, after a shell GC and 10 s, before S1. MiB, median (min-max).

| Kind | stock | feature | bun | final | final vs bun | A/A |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PSS total | 1866 (1780-1942) | 1778 (1376-1847) | 1843 (1768-1874) | 1814 (1780-1874) | -11 (-0.6 %) | 498 |
| USS total | 1540 (1523-1602) | 1529 (1169-1537) | 1549 (1527-1552) | 1536 (1524-1544) | -8 (-0.5 %) | 383 |
| PSS shell | 117.7 (113.9-122.6) | 113.3 (107.9-114.3) | 114.7 (111.7-118.6) | 108.6 (107.2-111.7) | -6.5 (-5.6 %) | 8.2 |

The final build's shell PSS is 3.7-7.0 MiB below bun's in every block (Mann-Whitney p = 0.029 against bun: final's
highest launch, 111.67 MiB, is under bun's lowest, 111.68), but that is inside the A/A spread, so it isn't a claim.
Total memory is the same on every build. The A/A spread on totals is wide because one feature launch ran 68 page
renderers instead of 101 (Chromium put several fixture pages in one process), which took about 400 MiB off it.

## Responsiveness

The light run records S3's key-to-shown latency (from the page's own frame timestamps, no probe patches):

| | stock | feature | bun | final |
| --- | ---: | ---: | ---: | ---: |
| key->shown median, ms | 27.0 (26-28) | 26.5 (24-29) | 25.3 (23-25.5) | 26.8 (26-29) |
| key->shown p90, ms | 36.5 (34-39) | 35.0 (31-41) | 33.0 (32-36) | 40.0 (37-44) |
| key->store median, ms | 7.5 (6-9) | 6.5 (5-11) | 6.5 (6-7.5) | 5 (5-6) |
| put-back presses per 40 | 3.5 (2-5) | 1.5 (1-3) | 4 (2-5) | 2 (0-4) |

The median is inside the A/A spread (final 3 ms above bun, spread 6 ms). The p90 leans the wrong way: final is higher
than bun in 4 of 4 blocks, 40 against 33 ms (Mann-Whitney p = 0.14). That matches E4's earlier ctrl+Next p90 lead and
stays open until the full run and the E4 ablation (item 3 below) settle it. Edge reveal and hover-card latency need
the full-instrumentation probe and aren't in this run.

## How to read S3 and S4

- **S3** windows include their put-back presses: when ctrl+Tab leaves the switcher open, the harness presses Escape
  and activates the tabs through the store inside the window. Every window here kept its CPU rows, and the put-back
  count sits beside them. They don't explain the gap: final's window with 0 put-backs used 51.2 % total and its window
  with 4 used 55.4 %, against 63.0-70.1 % for bun with 2-5. Every put-back on every build, stock included, was the
  switcher left open; none landed on the wrong tab. That is listed as an open lead in linux-bench.md.
- **S4** windows here came from the protocol 1 harness, which only checked that the sidebar started hidden. Nothing in
  this run confirms that each reveal happened, so S4's CPU rows are unchecked. The current harness (protocol 2) reads
  tab 1's row after every hold, and a window where a reveal or hide didn't happen loses its CPU rows. Its results
  can't be pooled with this run's (`report --all` refuses).

## What isn't measured yet

1. The options-on S4 and S5 run on feature, bun and final (`sidebarRevealSpeed` at faster and slower,
   `showMemoryInTabHoverMenu`, `tabCloseButtonSide=left`): the recipe in linux-bench.md ("With PR 1's options on"),
   this tree's harness (protocol 2), full instrumentation, `--runs 6`, partitioned. Stock has no row: it doesn't have
   these options. `showPagePreviewInTabHoverMenu` is hidden on Linux, which can't capture pages. A separate light run
   of the feature build with its defaults patched (off, on at slower, on at faster) measures what turning PR 1's
   options on costs on PR 1's own build. It is PR 1 evidence: it compares neither final with bun nor any reveal or
   hover-card latency.
2. The full-instrumentation four-build run (protocol 2, `--runs 6`): S3 key->shown median and p90, S4 reveal median,
   p90 and reveals over 80 ms, S5 cold card, frames and counters. S4 counts only if every build has 20 of 20 reveals
   and `workload late` at 0; then S4's CPU rows stop being unchecked.
3. E4's share of the S3 p90: a build of e02d6c59c (E1, E2, E3, E5 and E6, before E4 and #1679) against final on S3,
   partitioned, full instrumentation, `--runs 6`, plus a `--switch-via store` run for CPU. If the gap is E4's, the
   volatile save should wait for a pause in switching; otherwise E4 can be split from the rest.
4. #1679's share: bun rebuilt at db3139706 against bun at 48c7e3e67 on S4 and S5.
5. The F23 discard-race rerun (`discard-race2.mjs`) on quiet cores.
6. The commits after 2e9c24a46 that change the UI dist (the telemetry consent gate, the tab lifecycle's kept claims).
   This run measured 2e9c24a46. Measuring them on S1 and S3 against it would confirm they change nothing.

Until 1 to 3 are done, PR 3 claims the CPU and RAM numbers above and does not claim responsiveness parity.

## Leads not taken

Optimization leads that PR 3's first profiling round measured or found and that PR 3 didn't take. They are separate
from the open leads in linux-bench.md, which are signals that the optimized build may be slower.

| Lead | Measured size | Confidence | Why not in PR 3 | Next step |
| --- | --- | --- | --- | --- |
| The engine's hidden toolbar repaints its progress bar at about 56 Hz while the active tab loads (`ac_linux_host.cc` `LayoutOverlay` hides only the contents view) | Browser +9.5 % (9.1-9.9), GPU +12 % (11.2-12.9) of a core while loading, from a minimal-shell counterfactual, n = 2 | Strong | Engine change: needs new Linux and Mac engines | Hide the top container, or stop `LocationBarProgressView` updates when Ardia owns the window; check toolbar-anchored bubbles and extension popups |
| Chromium's `TabMemoryMetricsReporter`, which only feeds UMA, which Ardia doesn't upload | About 1.3-1.4 s of CPU per memory-dump burst at 100 tabs, at about 1 and 5 minutes after load | Strong | Engine change | Disable it in the engine and measure the bursts at 100 tabs |
| The shell backdrop is re-blended on every page frame (one full-window layer with an even-odd `clip-path`, `shaders.tsx`, `pageHoles.ts`) | GPU 10.2 % against 7.8 % of a core (+32 %) under a 60 fps page, 29 against 17 quads per frame, n = 6 windows per side | Strong on Xvfb software GL; unmeasured on the WebGL2 path | Needs visual parity work on the GL backdrop and its fallback | Paint the backdrop only outside the page rect, as strips; never with `will-change` (+31 GPU points) |
| Page renderers hold most of the RAM | 69 % of PSS at 100 tabs, 12.2-12.6 MiB per loaded tab | Strong | A policy decision for the owner: sleeping more hidden tabs pauses their timers and notifications | Choose a tighter `loadedTabBudget` for hidden, silent, unpinned tabs or an earlier sleep; expect about 12 MiB per slept tab |
| `mountLayout`'s first settle forces a layout on every mount (`shims/web/mountLayout.ts`) | `frameOf` 500-900 ms per 40 switches at 100 tabs, from about 55 mounts per ctrl+Tab switch | Medium | A broad change to `onLayout` timing; E6 showed that removing one mount only moves the forced layout to the next one | Defer the first settle into the existing rAF and timeout batch, then rerun S3 |
| The tab card's memory line reads `engine.tasks` twice (`taskSampler.ts` `FIRST_SAMPLE_MS`, 2.2 s) for a CPU figure the card doesn't show | Halves the reads; the card's "measuring" wait is at least 2.2 s | Medium; `tabMemory.ts` changed after the profiled build | Unmeasured on the current code | Measure again, then drop the second read and shorten the engine sampler's 15 s idle stop |
| Sidebar scroll | Unmeasured | - | The harness has no scroll scenario | Add one (60 wheel notches, `xdotool click 4/5`) at 20 and 100 tabs; read LoAF, rAF gaps and measures per scroll event |
| Load storm: opening 30 tabs with 100 loaded | Unmeasured | - | The harness has no such scenario | Profile `delivery` and `metadata` before and after E5 |
| Multiple windows: one shell renderer per window, and windows behind others keep animating on X11 (no occlusion tracking) | Unmeasured; each window would multiply the shell's own costs | - | The harness runs one window | Add a two-window launch |
| E6, dropped: keep the window-control strip mounted across the tab hand-over | Strip mounts per switch fall to 0, but fibers rendered per switch rise by 114 and shell CPU, key->shown and LoAF don't move | Counts exact, 2 launches per side; CPU and timing attribution-grade | Nothing a user would feel improved | None; `mountLayout` above is the lever |
| E6, dropped: Linux `FadeLabel` calls `setOverflows` only when the value changes | Stops 6 pending updates per row per hover sweep, but raises the shell's JS heap at rest by 2.4 MiB at 100 tabs (0.5 MiB at 20), repeatable to 0.1 MiB | Measured | The base's redundant renders were compacting React's hook lists; breaking even would take about 70,000 hover resizes | Fewer `ResizeObserver` callbacks instead, if the pending queue ever shows up in CPU |
