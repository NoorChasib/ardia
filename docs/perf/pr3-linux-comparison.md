# PR 3 on Linux: stock, feature, Bun and final

CPU and RAM of four UI builds on one engine, 100 loaded tabs, measured with the Linux harness
([linux-bench.md](linux-bench.md), which also has the reproduction steps and the limits). This page holds the light
run, the one builds are ranked by, and the [full-instrumentation run on the PR heads](#full-instrumentation-on-the-pr-heads-options-on)
(S3-S5 latency, frames and counters, with PR 1's options on). What is still open is in
[What isn't measured yet](#what-isnt-measured-yet). [Leads not taken](#leads-not-taken) lists the optimizations PR 3
found and left for later.

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
bun is PR 3 plus #1679. The [full run](#full-instrumentation-on-the-pr-heads-options-on) compares PR heads that both
carry it.

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
stayed open until the full run and the E4 ablation below. Edge reveal and hover-card latency need the
full-instrumentation probe and aren't in this run.

## Full instrumentation on the PR heads, options on

| | |
| --- | --- |
| Run | `20261118T174444`, 15 launches, all ok: 5 per build in ABBA blocks (pr2 pre-e4 pr3, pr3 pre-e4 pr2, ...), every S3, S4 and S5 window valid and uncontended |
| Machine | As above, partitioned; foreign CPU on the app's cores averaged 0.1 % of a core over the run (`cpu-audit.py`) |
| Harness | protocol 2, this tree's (`ddfa35a63`), `--instrument full`, `--scenarios S3,S4,S5`, `--tabs 100`, `--runs 5` |
| Settings around S4 and S5 | `showMemoryInTabHoverMenu=true`, `showPagePreviewInTabHoverMenu=true`, `tabCloseButtonSide=left`, `sidebarRevealSpeed=default`; read back as applied in both scenarios of all 15 launches |
| Engine, blocker | `engine-3a64a10704ff`, the same packaged content blocker as the light run |

| Build | Commit | UI sha256 | What it is |
| --- | --- | --- | --- |
| pr2 | db3139706 | `8aba21f1867e` | PR 2's head, with #1679 |
| pre-e4 | e02d6c59c | `7c176e356de9` | PR 3's integration with E1, E2, E3, E5 and E6, before E4 and #1679 |
| pr3 | e15125104 | `1bf0c0c37c4b` | PR 3's head, with #1679 and the review's telemetry and tab-lifecycle commits |

pr3 against pr2 is PR 3 alone: both contain #1679. pre-e4 against pr3 is E4 plus #1679 plus the review commits; of
those, only E4 runs in S3 (S3 drags and closes nothing).

Median over 5 launches (min-max); "vs pr2" is the median per-block difference, with the blocks where the build was
higher and the Mann-Whitney p. CPU is percent of one core under the full probe, whose patched calls cost CPU in
proportion to what they count (pr2 makes 21 to 38 times more patched geometry and style calls than pr3 in S4 and S5), so rank
CPU from the light run, not from this table.

| Metric | pr2 | pre-e4 | pr3 | pre-e4 vs pr2 | pr3 vs pr2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| S3 key->shown median, ms | 28 (27-28) | 27 (25-28) | 28 (25.5-30) | -0.5, 0/3, p 0.24 | 0, 2/4, p 1.0 |
| S3 key->shown p90 per window, ms | 38 (36-39) | 37 (34-39) | 38 (36-41) | -1, 1/4, p 0.51 | 0, 3/4, p 0.99 |
| S3 key->shown over all presses, p50 / p90 / p99 / max, ms | 28 / 38 / 48 / 50 | 27 / 36 / 43 / 44 | 27 / 38 / 68 / 85 | | |
| S3 presses over 50 ms | 0 of 199 | 0 of 199 | 4 of 197 (67, 68, 78, 85) | | Fisher p 0.06 |
| S3 CPU total | 65.1 (63.3-67.5) | 58.8 (58.0-59.9) | 52.2 (51.5-53.1) | -7.1, 0/5, p 0.008 | -12.9 (-20 %), 0/5, p 0.008 |
| S3 LoAF count | 36 (34-39) | 13 (3-15) | 6 (4-11) | -23, 0/5 | -28, 0/5 |
| S3 `session.write` per window | 40 | 40 | 11 (10-11) | 0 | -29 |
| S4 reveal median, ms | 127.7 (123.2-130.6) | 122.8 (120.8-124.4) | 121.6 (120.1-123.8) | -3.8, 0/5, p 0.016 | -7.6, 1/5, p 0.032 |
| S4 reveal p90, ms | 145.6 (137.4-152.8) | 137.1 (131.9-141.0) | 130.3 (126.4-138.9) | -8.5, 0/5, p 0.056 | -11.2, 0/5, p 0.016 |
| S4 reveal max, ms | 148.3 (146.1-158.9) | 138.6 (136.7-142.1) | 138.0 (134.6-142.3) | | |
| S4 reveals confirmed, late steps | 20 of 20, 0 | 20 of 20, 0 | 20 of 20, 0 | | |
| S4 LoAF count | 0 | 0 | 0 | | |
| S4 rAF gaps over 25 ms, max gap | 44 (39-59), 50 ms | 8 (6-17), 33-50 ms | 5 (4-11), 33 ms | -36, 0/5 | -40, 0/5 |
| S4 CPU total | 68.6 (66.1-70.6) | 48.6 (47.0-54.2) | 47.8 (46.5-54.9) | -18.7, 0/5, p 0.008 | -19.7 (-29 %), 0/5, p 0.008 |
| S5 cold card, ms | 873.2 (871.6-897.3) | 872.6 (869.7-874.3) | 871.9 (869.0-873.9) | -2.0, 1/5, p 0.60 | -2.7, 2/5, p 0.31 |
| S5 warm cards shown | 0 of 69 | 0 of 69 | 0 of 69 | | |
| S5 memory-line reads (`engine.tasks`) per window | 2 | 2 | 2 | 0 | 0 |
| S5 LoAF count, rAF gaps over 25 ms | 1 (1-2), 10 (4-30) | 0, 0 | 0, 0 (0-1) | | |
| S5 CPU total | 30.5 (29.7-32.5) | 23.7 (23.5-25.8) | 23.4 (22.8-23.9) | -6.8, 0/5, p 0.008 | -7.3 (-24 %), 0/5, p 0.008 |

- **Edge reveal, options on.** PR 3 reveals the sidebar sooner than PR 2 at every percentile the probe records,
  has no rAF gap over 33.4 ms in S4, and every reveal and hide on every build was confirmed by the row read, so
  S4's rows count. "Over 80 ms" doesn't separate builds with this probe: it times the first frame with tab 1's row on
  screen at the Default speed, and no reveal on any build came in under 105 ms. E1's earlier 20 of 64 against 8 of 64
  isn't reproduced: here pr3 is the faster side. The harness has no "settled" time (the end of the reveal animation),
  so that row stays unmeasured.
- **Hover card, options on.** The cold card is the same on all three builds (about 872 ms, the card's own delay).
  The warm card isn't measured: at the harness's 300 ms dwell no build showed a card for a second row before the
  pointer moved on (69 of 72 row entries superseded on every build), so the "hover after a card opens" lead needs a
  run with `--hover-dwell` of 400 ms or more. The memory line reads the engine twice per sweep on every build.
- **S3's tail.** The p90 is level: 38 ms on pr2 and pr3, 37 on pre-e4, and the light run's 40 against 33 doesn't repeat
  against PR 2's head under the full probe. Above the p90 pr3 has a tail the other two don't: 4 of 197 presses at
  67-85 ms, in 3 of 5 windows, against none over 50 ms on pr2 and none over 44 on pre-e4 (Fisher p = 0.06 against
  either). Those presses reached the store in 7-11 ms, so the time goes after the store change, in the shell's frame
  or the page's show. Since pre-e4 and pr3 differ in S3 only by E4, E4 is implicated in the tail but not proven: the
  harness doesn't record when each session write lands, so the slow presses can't be lined up with E4's 2 s save, and
  press time modulo 2 s shows no clustering.

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

Settled by the [full run on the PR heads](#full-instrumentation-on-the-pr-heads-options-on): S3 key->shown median
and p90, S4 reveal latency with every reveal confirmed, S5 cold card, frames and counters, all with PR 1's options on at
the Default reveal speed; #1679's share, since pr2 and pr3 both carry it; and the E4 ablation, which puts pr3's S3 difference in the tail
above the p90 rather than in the p90. Still open:

1. The options-on S4 and S5 rows at `sidebarRevealSpeed` faster and slower: the recipe in linux-bench.md ("With PR 1's
   options on"), on pr2 against pr3. Stock has no row: it doesn't have these options. `showPagePreviewInTabHoverMenu`
   is hidden on Linux, which can't capture pages.
2. The S5 warm card: the same run with `--hover-dwell 500`, since no build shows a second card within 300 ms.
3. S4's "settled" time (the end of the reveal animation): the probe records only the first frame with the row on
   screen.
4. S3's tail: whether pr3's presses over 50 ms land on E4's session writes. That needs the harness to record each
   `session.write` time beside each press, then a key run at `--runs 6` or more on pre-e4 against pr3, and a
   `--switch-via store` run for S3 CPU without put-backs. If they line up, the volatile save should wait for a pause
   in switching.
5. The F23 discard-race rerun (`discard-race2.mjs`) on quiet cores.
6. S1 on the commits after 2e9c24a46 that change the UI dist (the telemetry consent gate, the tab lifecycle's kept
   claims). The full run's pr3 includes them in S3-S5; S1 against 2e9c24a46 would confirm they change nothing at idle.

PR 3 claims the CPU and RAM numbers above, and responsiveness parity with PR 2 on S3's median and p90, S4's reveal and
S5's cold card. It doesn't claim parity on S3's tail above the p90.

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
