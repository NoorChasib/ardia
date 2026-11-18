# PR 3 on Linux: stock, feature, Bun and final

CPU and RAM of four UI builds on one engine, 100 loaded tabs, measured with the Linux harness
([linux-bench.md](linux-bench.md), which also has the reproduction steps and the limits). This page holds the light
run, the one builds are ranked by. The full-instrumentation run (edge reveal and hover card latency, frames, counters)
and the options-on run haven't been done yet; see [What isn't measured yet](#what-isnt-measured-yet).

## The run

| | |
| --- | --- |
| Run | `20261118T125405`, 16 launches, all ok: 4 per build, interleaved in ABBA blocks (stock feature bun final, final bun feature stock, ...) |
| Machine | The 16-vCPU EPYC 9645 VPS in [Test machine](linux-bench.md#test-machine); app, Xvfb and fixture server on CPUs 10-15 under the CPU partition, everything else on 0-9 |
| Display and GL | Xvfb 1920x1080, ANGLE on Mesa llvmpipe; no GPU |
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
bun; "A/A" is the largest feature-minus-bun difference in any block, the noise a real change has to clear. A block is
left out of the paired column when its foreign CPU on the app's cores went over 5 %.

| Scenario | Kind | stock | feature | bun | final | final vs bun | A/A |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| S1 idle | total | 2.02 (1.88-2.17) | 1.94 (1.76-2.06) | 1.98 (1.83-2.16) | 1.57 (1.31-2.00) | -0.47 (-24 %) | 0.40 |
| S1 idle | browser | 0.87 | 0.87 | 0.87 | 0.46 (0.38-0.97) | -0.40 (-46 %) | 0.17 |
| S2 active pages | total | 20.7 (20.0-21.1) | 19.7 (19.2-20.4) | 20.5 (20.0-21.5) | 20.4 (19.7-22.6) | -0.15 (-1 %) | 1.68 |
| S3 tab switching | total | 69.7 (61.1-70.6) | 65.0 (61.6-66.4) | 65.7 (63.1-70.1) | 53.2 (51.0-55.4) | -12.9 (-20 %) | 8.4 |
| S3 tab switching | shell | 40.1 (34.1-41.1) | 35.9 (33.8-36.9) | 38.2 (36.6-39.4) | 27.2 (25.5-29.5) | -10.3 (-27 %) | 5.4 |
| S3 tab switching | browser | 16.0 (13.8-16.5) | 15.5 (14.3-16.3) | 14.7 (13.7-16.5) | 12.1 (11.9-12.7) | -3.2 (-22 %) | 2.2 |
| S4 edge reveal | total | 70.4 (63.4-73.3) | 70.1 (68.9-72.2) | 68.8 (66.1-75.0) | 49.9 (49.2-53.3) | -17.5 (-26 %) | 3.2 |
| S4 edge reveal | shell | 53.9 (48.6-56.6) | 54.3 (52.6-55.7) | 52.7 (50.9-57.8) | 33.9 (32.5-36.6) | -17.6 (-33 %) | 3.3 |
| S5 hover sweep | total | 25.9 (24.4-27.7) | 26.0 (25.6-26.4) | 26.8 (24.1-27.9) | 16.9 (15.9-20.8) | -10.0 (-37 %) | 2.3 |
| S5 hover sweep | shell | 23.7 (22.1-25.3) | 23.8 (23.4-24.0) | 24.4 (22.0-25.4) | 14.8 (13.8-18.4) | -9.6 (-39 %) | 2.0 |
| S6 loading | total | 128.2 (125.8-142.1) | 127.3 (125.4-133.3) | 128.0 (120.8-139.1) | 25.3 (24.3-30.7) | -103.3 (-81 %) | 6.8 |
| S6 loading | shell | 105.5 (104.0-116.4) | 105.1 (102.8-109.5) | 105.2 (99.6-113.8) | 4.2 (3.9-5.4) | -102.1 (-97 %) | 5.8 |
| S7 loading pill | total | 118.5 (114.2-133.1) | 122.7 (114.7-125.1) | 117.2 (109.9-130.6) | 25.0 (24.0-28.3) | -92.6 (-79 %) | 13.2 |
| S7 loading pill | shell | 97.4 (93.5-109.1) | 100.5 (93.9-102.6) | 96.0 (90.1-106.5) | 4.2 (3.6-5.0) | -92.5 (-96 %) | 10.6 |

The GPU process stayed at 8-11 % of a core in S2-S4, S6 and S7 and about 1 % in S5 on every build: on this llvmpipe
setup the shell's savings reach the whole browser. Page renderers moved by less than the A/A spread in every scenario.
Stock, feature and bun are inside each other's A/A spread on every total and shell row: the feature work and the Bun
migration didn't change CPU here.

Every final-against-stock and final-against-bun total and shell difference in S3-S7 has all 4 blocks in the same
direction (Mann-Whitney p = 0.029, the smallest 4 against 4 allows; the sign test can't go below 0.125 at 4 blocks).

## RAM

All tabs loaded and settled, after a shell GC and 10 s, before S1. MiB, median (min-max).

| Kind | stock | feature | bun | final | final vs bun | A/A |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PSS total | 1866 (1780-1942) | 1778 (1376-1847) | 1843 (1768-1874) | 1814 (1780-1874) | -11 (-0.6 %) | 498 |
| USS total | 1540 (1523-1602) | 1529 (1169-1537) | 1549 (1527-1552) | 1536 (1524-1544) | -8 (-0.5 %) | 383 |
| PSS shell | 117.7 (113.9-122.6) | 113.3 (107.9-114.3) | 114.7 (111.7-118.6) | 108.6 (107.2-111.7) | -6.5 (-5.6 %) | 8.2 |

The final build's shell PSS is 3.7-7.0 MiB below bun's in every block (Mann-Whitney p = 0.029 against stock), but
that is inside the A/A spread, so it isn't a claim. Total memory is the same on every build. The A/A spread on totals is wide
because one feature launch ran 68 page renderers instead of 101 (Chromium put several fixture pages in one process),
which took about 400 MiB off it.

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
stays open until the full run settles it. Edge reveal and hover-card latency need the full-instrumentation probe and
aren't in this run.

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
   `showMemoryInTabHoverMenu`, `tabCloseButtonSide=left`), full instrumentation, partitioned. Stock has no row:
   it doesn't have these options. `showPagePreviewInTabHoverMenu` is hidden on Linux, which can't capture pages.
2. The full-instrumentation four-build run: S3 key->shown, S4 reveal median, p90 and reveals over 80 ms, S5 cold card,
   frames and counters.
3. #1679's share: bun rebuilt at db3139706 against bun at 48c7e3e67 on S4 and S5.
4. The F23 discard-race rerun (`discard-race2.mjs`) on quiet cores.
5. The commits after 2e9c24a46 that change the UI dist (the telemetry consent gate, the tab lifecycle's kept claims).
   This run measured 2e9c24a46. Measuring them on S1 and S3 against it would confirm they change nothing.

Until 1 and 2 are done, PR 3 claims the CPU and RAM numbers above and does not claim responsiveness parity.
