# Linux CPU/RAM benchmark

`apps/linux/scripts/perf/bench.mjs` compares Linux UI builds (`apps/linux/dist` folders, passed to the engine as
`--ardia-ui-dir`) on one prebuilt engine, with many loaded tabs, under Xvfb. It measures CPU and context switches per
process kind, memory per process kind, shell main-thread work, interaction latency and long frames, and deterministic
shell counters, over seven scenarios. PR 3's (the CPU and RAM hill climb) stock, feature, Bun and final comparison runs
on it; the recipe is below and the results are in [pr3-linux-comparison.md](pr3-linux-comparison.md).

It needs Node 22 or later (the global `WebSocket`) and no npm dependencies, plus `Xvfb`, `xdotool`, `xdpyinfo`,
`taskset` and `flock`. For exact CPU totals and teardown it also needs a user systemd (`systemd-run --user --scope`).
Without one, the harness walks the process tree instead and says so in each result's `notes`. Every script prints its
flags with `--help`.

## Files

All of them are in `apps/linux/scripts/perf/`.

| File | What it is |
| --- | --- |
| `bench.mjs` | The CLI: `run`, `report`, `noise`. |
| `lib/options.mjs` | Flag parsing, `--builds` and `BUILD_INFO`, the ABBA launch order. |
| `lib/instance.mjs` | Templates, Xvfb, the fixture server process, chrome's launch and quit, cgroups and scopes, hashes, the lock. |
| `lib/runner.mjs` | One launch: tab seeding, the quiet gate, the scenario windows S1-S7, memory readings, and the result JSON. |
| `lib/probes.mjs` | The shell probe (`__benchProbe`: counters, observers, frame loop) and the fixture-page reader. |
| `lib/procs.mjs` | The `/proc` and cgroup sampler (a worker thread), process kinds, PSS/USS. |
| `lib/report.mjs` | Markdown tables, the sign test and Mann-Whitney U test, the paired control section, the A/A noise table. |
| `lib/fixtures.mjs` | The fixture server (also runnable on its own: `node lib/fixtures.mjs --help`). |
| `lib/cdp.mjs`, `lib/util.mjs` | A minimal CDP client, and the repo-relative defaults and helpers. |
| `cpu-audit.py` | A per-task audit of CPU time on the bench CPUs, split into benchmark, orchestrator, kernel and foreign (see "CPU isolation"). |
| `tests/` | In-memory tests: options, defaults, the DevTools endpoint, fixtures, report arithmetic, and S1-S7 run against a fake shell, sampler and xdotool. They run in `bun run --cwd apps/linux acceptance:self-test`. |

## Run it

Build two commits' UIs (here `main` against your branch), each from its own clean tree, then compare them:

```bash
engine=$(scripts/linux/fetch-engine.sh --nearest)
work=$(mktemp -d)
for pair in a=main b=HEAD; do
  label=${pair%%=*} commit=$(git rev-parse "${pair#*=}")
  mkdir "$work/src-$label" && git archive "$commit" | tar -x -C "$work/src-$label"
  if [ -f "$work/src-$label/bun.lock" ]; then (cd "$work/src-$label" && bun install --frozen-lockfile); else (cd "$work/src-$label" && pnpm install --frozen-lockfile); fi
  (cd "$work/src-$label" && bun run --cwd apps/linux build)
  cp -a "$work/src-$label/apps/linux/dist" "$work/ui-$label" && echo "$commit" > "$work/ui-$label/BUILD_INFO"
done

taskset -c 0-9 node apps/linux/scripts/perf/bench.mjs run --engine "$engine" --content-blocker "$blocker" \
  --builds a=$work/ui-a,b=$work/ui-b --runs 6 --tabs 100 --instrument light --control a --out "$work/out"
node apps/linux/scripts/perf/bench.mjs report --out "$work/out" --control a --md "$work/a-vs-b.md"
```

`$blocker` is the packaged content blocker ("Engine and content blocker" below). The CPU lists assume a 16-vCPU host:
the app gets 10-15 (`--cpus`) and the orchestrator 0-9. On a smaller host pass both; the harness checks `--cpus`
against the online CPUs and stops before launching when it names one that isn't there.

`bun run --cwd apps/linux bench -- <args>` runs the same script, with relative paths resolved against `apps/linux`.

Defaults that come from the checkout:

| Flag | Default |
| --- | --- |
| `--engine DIR` | The cache entry under `apps/browser/build-ardiacore/prebuilt-linux-x86_64` whose directory changed last. That isn't necessarily the engine for HEAD's key (`fetch-engine.sh` touches only `.complete` on a cache hit), so the harness logs which one it took; pass the directory `fetch-engine.sh` prints. |
| `--content-blocker DIR` | `$ARDIA_BENCH_CONTENT_BLOCKER`; there is no other default. It must be the tree a packaged build ships (`lib/ardia/extensions/ublock`, with `ardia-linux-bridge.js`). The raw uBlock Origin from `scripts/linux/fetch-ubo.sh` is refused: without the Linux bridge it never starts on the Linux engine (the template launch fails with "no extension target"). `none` launches without one. |
| `--out DIR` | `output/linux-bench` (gitignored). |
| `--cpus LIST` | `10-15`, for a 16-vCPU host: the app, its Xvfb and the fixture server are pinned there. Run the orchestrator under `taskset -c` on the other CPUs. A CPU that isn't online fails the run at once. |
| `--display-base N` | `160`: the first X display tried (and up to 40 above it). |
| `--debug-port P`, `--fixture-port P` | `0`: chrome and the fixture server pick free ports. A fixed `--debug-port` is checked to be free first, and after connecting the harness asks the browser for its pid (`SystemInfo.getProcessInfo`). If another browser took the port in between, it closes that socket without sending anything else and fails the launch. |
| `--lock FILE` | `/tmp/ardia-perflab.lock`, the perflab lock the other benches use. Give a run its own file when it's a smoke or an attribution run, not a timing. |

Prepare a build by copying its `apps/linux/dist` somewhere stable (the harness reads it while it runs) and writing a
`BUILD_INFO` next to `index.html`: JSON (`{"commit":"<sha>"}`), `commit=<sha>` lines, or just the sha. Every result
records the UI dist's sha256 (with `BUILD_INFO` left out), so two labels of the same dist are an A/A pair.

The exit status is 1 when a launch failed after its retries, or when a teardown left a process behind (the run stops
there).

A smoke check of an install (about 3 minutes):

```bash
taskset -c 0-9 node apps/linux/scripts/perf/bench.mjs run --builds final=<dist> --engine "$engine" \
  --content-blocker "$blocker" --tabs 5 --runs 1 --scenarios S1 --cpus 0-9 --lock /tmp/bench-smoke.lock \
  --template-wait 45 --settle 10 --idle-seconds 20 --quiet-gate 0 --max-foreign 0 --out "$(mktemp -d)"
```

## Reproducing PR 3's comparison

### Test machine

| | |
| --- | --- |
| Host | A netcup "KVM Server" VPS (kvm), shared with other agents' builds, tests, ClickHouse and benchmark runs |
| CPU | AMD EPYC 9645, 16 vCPUs (1 thread per core, no SMT), 1 NUMA node, no guest cpufreq |
| RAM | 62,242 MiB, plus 8 GiB swap |
| OS | Ubuntu 26.04.1, Linux 7.0.0-43-generic, no `isolcpus`, `perf_event_paranoid` = 4 |
| Display | Xvfb 1920x1080x24, no window manager; Chromium composites through ANGLE on Mesa llvmpipe (`gl=egl-angle,angle=opengl`) |
| Engine | `engine-3a64a10704ff` (Chromium 157.0.8103.50), chrome sha256 `4a7cb6b15f40…`, one engine for every build |
| Pinning | App, Xvfb and fixture server on CPUs 10-15; orchestrator on 0-9; everything else confined to 0-9 by a CPU partition outside the repo (see "CPU isolation") |

### Builds

Build the UI at each of the four commits the run measured, from a clean tree of its own (`git archive`, so nothing
uncommitted gets in), into a fresh directory. Install dependencies with the package manager that commit pins: pnpm
before the Bun migration, Bun after.

| Label | Commit | What it is | Install |
| --- | --- | --- | --- |
| `stock` | 3043ac26b | upstream before this work | `pnpm install --frozen-lockfile` |
| `feature` | 50a1ef106 | PR 1, sidebar settings, before its last two commits | `pnpm install --frozen-lockfile` |
| `bun` | 48c7e3e67 | PR 2, Bun migration, on that PR 1 | `bun install --frozen-lockfile` |
| `final` | 2e9c24a46 | PR 3, the optimized build | `bun install --frozen-lockfile` |

```bash
builds=$(mktemp -d)
for pair in stock=3043ac26b feature=50a1ef106 bun=48c7e3e67 final=2e9c24a46; do
  label=${pair%%=*} commit=$(git rev-parse "${pair#*=}") src=$(mktemp -d)
  git archive "$commit" | tar -x -C "$src"
  if [ -f "$src/bun.lock" ]; then (cd "$src" && bun install --frozen-lockfile); else (cd "$src" && pnpm install --frozen-lockfile); fi
  (cd "$src" && bun run --cwd apps/linux build)
  mkdir "$builds/$label" && cp -a "$src/apps/linux/dist" "$builds/$label/linux-ui"
  printf 'commit=%s\n' "$commit" > "$builds/$label/linux-ui/BUILD_INFO"
done
```

Before measuring, check that each build's UI sha256 in the first lines of the run's log (and in the report header)
matches the published run's; a different hash means a different dist. A pnpm build and a Bun build of 50a1ef106 gave
the same 72 files, byte for byte, and so do the measured `feature` and `bun` dists: in this run `bun` against
`feature` is an A/A pair, and their spread is part of the noise a real difference must leave.

PR 3's commits after 2e9c24a46 that touch `apps/browser/src` or `apps/linux/src` (the review's telemetry consent gate
and the tab lifecycle's kept claims) build a different UI dist; the PR says which scenarios were measured again on
it. The rest only change the harness and its docs.

**What `final` against `bun` measures.** `final` contains PR 1's last two commits (#1679: a tab dragged off the
sidebar peek holds it out), and the measured `bun` and `feature` don't: they came from earlier heads of PRs 1 and 2.
So final against bun is PR 3 plus #1679, not PR 3 alone. #1679 adds one store subscription to the peek's holds and a
check in its hold test, and S4 reveals the peek 20 times, so it runs through that code. To bound #1679's share, run
`bun` rebuilt at db3139706 (PR 2's head, with #1679) against `bun` at 48c7e3e67 on S4 and S5, or use db3139706 as the
control. Branch-tip rebuilds (`feature` at 6d9c3956c, `bun` at db3139706) have a different UI sha256 from the measured
labels and can't be pooled with the published run.

### Engine and content blocker

```bash
engine=$(scripts/linux/fetch-engine.sh --nearest)
```

From any of the four commits this resolves to `engine-3a64a10704ff`: no Linux engine is published for their own
engine keys, so `--nearest` takes the nearest earlier key and warns. Pass its directory as `--engine`.

The run used the content blocker as `scripts/linux/package.py` ships it: uBlock Origin from `scripts/linux/fetch-ubo.sh`,
plus the Linux bridge and the seeded compiled engine. To get the same tree, package the stock build and unpack it:

```bash
ubo=$(scripts/linux/fetch-ubo.sh)
pkg=$(mktemp -d)
python3 scripts/linux/package.py --out "$engine" --ui "$builds/stock/linux-ui" --destination "$pkg/ardia.tar.xz" --content-blocker "$ubo"
tar -xJf "$pkg/ardia.tar.xz" -C "$pkg" && blocker=$pkg/ardia/lib/ardia/extensions/ublock
```

Every result records the blocker tree's sha256, so a different blocker shows up in the report header and stops
`report --all` from pooling.

### The command

PR 3's four-build run used the harness's first protocol, the scenario code as committed in a7abec0e0. The harness in
this tree is protocol 2: S4 reads tab 1's row after every hold and S3 records its put-backs, so its windows do slightly
different work, every result records its `protocol`, and `report --all` refuses to pool runs of different protocols.
To reproduce the published numbers exactly, run a7abec0e0's harness. Take only `bench.mjs` and `lib`, which are all
it runs:

```bash
harness=$(mktemp -d)
git archive a7abec0e0 apps/linux/scripts/perf/bench.mjs apps/linux/scripts/perf/lib | tar -x -C "$harness"
bench=$harness/apps/linux/scripts/perf/bench.mjs
```

For new measurements, including the options-on run below, use this tree's `apps/linux/scripts/perf/bench.mjs`.

Four builds, 4 launches each, interleaved (stock feature bun final, then final bun feature stock, and so on), all
seven scenarios, 100 tabs, light instrumentation, paired against `bun`, with the run holding the lock from the first
template to the last launch:

```bash
out=$(mktemp -d)
taskset -c 0-9 node "$bench" run --engine "$engine" --content-blocker "$blocker" \
  --lock-scope run --builds stock=$builds/stock/linux-ui,feature=$builds/feature/linux-ui,bun=$builds/bun/linux-ui,final=$builds/final/linux-ui \
  --runs 4 --tabs 100 --instrument light --control bun --display-base 240 --out "$out"
node "$bench" report --out "$out" --control bun --md "$out/report.md"
```

Each launch takes about 6.5 minutes, and each template about 2 minutes, so the run takes about 2 hours. `--instrument
light` is the mode to rank CPU and RAM by (see "Two kinds of run"). For counters, frames and latencies, run the same
command with `--instrument full` (the default) into another `--out`. PR 3's run had CPUs 10-15 to itself (see "CPU
isolation"). Without that, other processes can use them, and the quiet gate and the contended-window repeat are what
keep the windows usable.

**With PR 1's options on.** Stock doesn't know PR 1's settings, so a run that includes it measures S4 and S5 with the
defaults. The options-on comparison is a second run on the three builds that have them:

```bash
taskset -c 0-9 node apps/linux/scripts/perf/bench.mjs run --engine "$engine" --content-blocker "$blocker" \
  --lock-scope run --builds feature=$builds/feature/linux-ui,bun=$builds/bun/linux-ui,final=$builds/final/linux-ui \
  --runs 6 --tabs 100 --scenarios S4,S5 --settings sidebarRevealSpeed=faster --settings showMemoryInTabHoverMenu=true \
  --settings tabCloseButtonSide=left --control bun --display-base 240 --out "$(mktemp -d)"
```

Run it once per reveal speed (`faster`, `slower`; the four-build run covers `default`). It uses full instrumentation,
since the reveal and hover-card latencies need the probe. `showPagePreviewInTabHoverMenu` isn't measured: on Linux
the row is hidden in Settings because the engine can't capture pages (`hostCapabilities.ts`), so the setting has no
effect there.

**Reading the statistics.** At `--runs 4` the sign test over blocks can't go below p = 0.125 (two-sided, 4 blocks),
so its column can never show significance; only the Mann-Whitney column (smallest p about 0.029 at 4 against 4) and
effects well beyond the A/A floor below can be called. The bold primary rows are the only ones read for significance;
every other row is exploratory, and with about 100 rows per build pair some p-values under 0.05 are expected by chance.
For a headline row that has to stand on the sign test, use `--runs 6` or more.

## What one launch does

0. Before any launch, the harness hashes the engine's `chrome`, the content blocker tree and every UI dist. Then it
   makes or reuses each build's template profile before the first timed launch, so no side pays for a template inside
   its block.
1. **Lock.** It runs `flock <--lock>` through a child that dies with the harness. `--lock-scope block` (the default)
   holds the lock for the templates, then for each ABBA block. `run` holds it throughout, and `launch` holds it per
   launch.
2. **Template profile**, once per build (`<out>/templates/<label>`). It is reused while the UI, engine and blocker
   hashes, the paths, the extra args, the CPUs and `--template-wait` all match. To make one, the harness seeds a
   profile (onboarding done, one window filling the screen, the welcome page skipped) and opens a fixture page. Then
   it waits `--template-wait` (90 s) for uBlock Origin to build its rulesets and selfie, checks that the page loaded
   and an extension target exists, and quits.
3. **Fixtures and display.** It starts a fixture server and an `Xvfb :N -screen 0 1920x1080x24` on the first free
   display from `--display-base`, both pinned to `--cpus`.
4. **Profile.** It copies the template into `<out>/scratch/<launch>` (`cp -a --reflink=auto`), resets the session to
   the seed and drops Chromium's `Sessions`.
5. **Launch.** It runs chrome in its own scope (`systemd-run --user --scope … taskset -c <cpus> chrome`, or a child
   cgroup with `--scope delegated`). The flags are the acceptance suite's (`ozone=x11`, extensions on), plus
   `--ardia-ui-dir`, the window geometry, `--lang=en-US` and the content blocker. The environment is the acceptance
   one: HOME and XDG inside the profile, no session bus, no CUPS, `ARDIA_BACKGROUND=1`. The scope's cgroup holds every
   process chrome starts, and its `cpu.stat` counts processes that lived and died between samples.
6. **Shell.** It attaches to `chrome://ardia/` over CDP and enables `Performance` (thread ticks where the engine has
   them). It installs the shell probe and rejects `--settings` keys the build doesn't know. It finds the shell
   renderer's pid by having the shell spin for 600 ms and picking the renderer whose CPU jumped.
7. **Tabs.** It creates N tabs through the app's store (`newTab(windowId, { url, background: true })`), activates
   each in order 300 ms apart, and waits until every tab has loaded and has its title. Then it settles `--settle`
   (60 s), requires exactly one page target per fixture URL (none missing, none stray, none loading), and runs a shell
   GC. 10 s later it takes the at-rest memory reading.
8. **Scenarios.** It runs the selected scenarios in order, then a GC, 10 s quiet and the end-of-run memory reading.
   Each scenario has a deadline (`--scenario-deadline`, 300 s); past it, the launch fails.
9. **Teardown.** It quits (`Browser.close`, then SIGTERM and SIGKILL to the process group, then `cgroup.kill`), stops
   Xvfb and the fixture server, and checks that the scope is empty and both pids are gone before it releases the lock.
   It writes `<out>/results/<launch>.json`. A failed launch is retried once (`--retries`).

Launch order across builds is ABBA: A B, then B A, then A B. With more builds it runs forward, then reversed.

## Tab set

Tabs come by index from a fixed 20-slot pattern, so every run and every N gets the same pages in the same order:
`S S T S R S S T S H S S T S S S T S S S`. That is 70 % static, 20 % ticker, 5 % rAF canvas and 5 % heavy. Tab 1
is always static.

| Kind | Path | Page |
| --- | --- | --- |
| static | `/p/<n>` | a coloured header, 30 paragraphs and an SVG favicon; no timers, no rAF |
| ticker | `/t/<n>` | static, plus a 1 s `setInterval` that rewrites a clock line |
| raf | `/raf/<n>` | an 800x400 canvas redrawn (24 circles) on every rAF |
| heavy | `/heavy/<n>` | a 1,000 x 5 table, about 5,000 DOM nodes |

Every page carries `window.__bench`. It holds rAF and timer counts in 100 ms buckets keyed by the page's visibility, a
visibility log, and the time of the second rAF after each change to visible. `/slow/<ms>` answers after up to 600 s,
and `/pending` lists its open requests.

## Scenarios

| | What runs | Window |
| --- | --- | --- |
| S1 idle | Nothing; tab 1 (static) is active. An untimed idle window of `--idle-discard` runs first and is kept under `discarded`. | `--idle-seconds` (60 s) |
| S2 active | The first rAF tab, split with the first ticker tab (`createSplit`), so both are in the foreground. Not comparable when the split fails or either page isn't visible. | `--active-seconds` (45 s) |
| S3 tab switching | Tabs 1 and 2 (both static), then 40 real `xdotool key ctrl+Tab` presses 500 ms apart. On Linux ctrl+Tab goes to the most recent tab, so every press must land on the other one. A press that leaves the switcher open or lands elsewhere is put back (Escape, then two store activations) and counted as a miss. The put-back runs inside the window, so the report shows each window's put-backs (`workload recoveries`) beside its CPU rather than dropping the window: at 100 tabs nearly every window has one to five. To rank S3 CPU with no put-backs at all, run it with `--switch-via store` and keep the key run for latency. | about 21 s |
| S4 sidebar edge reveal | `--settings` applied and read back (without `autoHideTabs`), then `autoHideTabs: true`, then 20 times: pointer to x=40, then x=0 at mid-height, hold 600 ms, read tab 1's row, back to the middle, hold 600 ms, read it again. A reveal means the row's left edge is on screen (left >= 0) and a hide that it is parked again (left < -1000), the same tests the latency probe uses; when a read misses, the harness polls every 100 ms up to 1.5 s from the move and counts the step as late. Not comparable unless tab 1's row was off screen first; a window where any reveal or hide didn't happen keeps only its latency and workload rows, so a broken reveal can't look cheaper. The settings go back afterwards, and the launch fails if they don't. | about 25 s |
| S5 hover sweep | `--settings` applied and read back. Over the first 24 sidebar rows whose centre hit-tests to the row, 3 passes: row 1 for 1,200 ms (the card's cold delay), rows 2-24 for 300 ms each, then the pointer away for 1 s. The settings go back afterwards, and the launch fails if they don't. | about 3 x 9 s at N >= 24 |
| S6 loading | Tab 1 loads `/slow/<--slow-ms>` and stays loading in the default layout (address field in the toolbar, the reload button breathing, the row spinner). The window counts only if tab 1 is active and loading and its request is open, at its first and its last moment. | `--loading-seconds` (45 s) |
| S7 pill | As S6, with the address field in the sidebar and the sidebar hidden, so the LoadingPill shows over the page. | `--loading-seconds` (45 s) |

`--settings` is applied around S4 and S5, and a key the build doesn't know fails the launch. So a run that includes
stock measures both with the defaults, as PR 3's four-build run did; "With PR 1's options on" above has the
options-on run. Each launch records what it applied under `settingsApplied`, per scenario.

Before every window a quiet gate waits (up to `--quiet-wait`, 240 s) until other processes' CPU on the app's cores is
under `--quiet-gate` (100 % of one core). It measures over 3 s from `/proc/stat`, minus the launch's own cgroup, Xvfb
and fixture server. A window whose mean foreign CPU still exceeds `--max-foreign` (150 %) is contended: the scenario
runs once more, and a window that is contended again is marked not comparable. Every window also starts at least
`--read-settle` (5 s) after the harness last read the fixture pages over CDP, because attaching to 100 pages wakes
their renderers.

### Two kinds of run

`--instrument full` (the default) patches `getBoundingClientRect`, `getAnimations`, `elementFromPoint`,
`getComputedStyle`, `requestAnimationFrame` and `chrome.send`. It adds a MutationObserver, LoAF and Event Timing
observers and a host-event listener, and in S3-S7 a rAF loop that reads geometry every frame. These cost shell CPU in
proportion to what they count, so part of a build's CPU drop can be the probe's. Use full runs for counters, frames
and latencies. Use `--instrument light` runs (no patches, no observers, no frame loop) for the CPU and memory rows you
rank builds by. In S6 and S7, the frame loop keeps the shell producing frames even when a build's loading animation
needs none, so rank those only from light runs.

## Metrics

Process kinds come from `/proc` for every pid in the launch's cgroup, classified by `cmdline`: `browser`, `shell` (the
renderer found by the spin), `page` (other renderers), `extension`, `gpu`, `utility:<sub-type>`, `zygote`, `crashpad`,
`other`, `unattributed` and `total`.

| Metric | Definition |
| --- | --- |
| CPU % `total` | Δ `usage_usec` of the launch's cgroup / window seconds x 100 (100 = one core). Exact, including processes that start and exit between samples. |
| CPU % per kind | Δ(utime + stime) per process, identified by (pid, start time) and sampled every 1 s by a worker thread. |
| CPU % `unattributed` | `total` minus the sum of the kinds: what the 1 s sampler couldn't pin on a process. |
| CPU % `shell thread:*` | Per thread of the shell: `main`, `compositor`, `io`, `threadpool`, `other`. |
| CPU % (outside total) | The launch's Xvfb and fixture server. |
| foreign CPU % on the app's cores | Busy time of the `--cpus` cores minus the launch's cgroup, Xvfb and fixture server: other work on the benchmark cores. |
| ctx switches/s | Δ(voluntary + nonvoluntary) per thread, summed per kind; a wakeup proxy (`perf` needs root). |
| perf `*Ms`, `LayoutCount`, `RecalcStyleCount` | Shell `Performance.getMetrics` deltas over the window. |
| level `*` | Shell JS heap used and total, `Nodes`, `JSEventListeners`, `Documents` and `Frames` at the window's end. |
| count `*`, chrome.send `*`, host event `*` | (full) Shell probe counters, every `chrome.send` by route, and native events by `module:event`. |
| LoAF `*` | (full) Long animation frames inside the window: `count`, `blockingMs`, `durationMs`, `maxMs`. |
| event timing `*` | (full) Shell Event Timing entries over 16 ms, per event (not INP): `count`, `p75`, `max`. |
| rAF `*` | (full, S3-S7) The frame probe's loop: frames, gaps over 25 ms in buckets, max gap. |
| switch `*` (S3) | From the shell's receipt of the engine's `ArdiaShell:onCommand` for the press, to the store's active-tab change (`key->store`) and to the new page's second rAF after it becomes visible (`key->shown`), with misses by cause. |
| edge reveal `*` (S4, full) | From the shell `pointermove` at `clientX <= 2` to the first frame with tab 1's row on screen; `unarmed` arrivals count as misses. |
| hover card `*` (S5, full) | From the `pointermove` into a planned row to the first frame with a visible card holding that row's title; `cold` and `warm`, entries, cards shown, misses. |
| page rAF/s, timer ticks/s (S1-S3) | The fixture pages' counts inside the window over the page-seconds they spent visible or hidden. |
| PSS MiB, USS MiB | `smaps_rollup` `Pss` and `Private_Clean + Private_Dirty`, summed per kind. Read at rest (the primary reading) and at the end of the run. |

Counters, CPU, context switches and process counts read 0 when a launch measured the window and saw none, so a build
that removes a route shows a drop to 0.

The report has one table per scenario plus the memory tables. Each cell is median (min-max, n) over launches. For
every other build it gives the difference of medians, the ABBA blocks in which that build was higher, with a sign
test over those blocks, and a Mann-Whitney U test over all launches. Primary metrics (bold) are prespecified: total,
shell, GPU, page and browser CPU, switch key->shown, edge reveal, cold hover card, total PSS and USS, and shell PSS.
The rest are exploratory. `--control LABEL` adds a paired section: each build's per-block difference from the control,
with the A/A pair (a label with the control's UI sha256) as the spread a real difference must leave. `noise` prints
each metric's A/A spread and floor.

Each `<out>/results/<launch>.json` records the build, its fingerprints, the exact chrome argv and environment, the
display, CPUs, scope and partition, load averages, every scenario window (with `valid` and `invalidReason`), memory,
the process list, the GL renderer and the teardown check.

## CPU isolation

Taskset alone keeps the app on 10-15, but nothing keeps other processes off them. PR 3's run moved every other
systemd unit onto CPUs 0-9 for its duration with a partition script that lives outside the repo. Doing that takes
root: it rewrites the CPU sets of system units and arms a root service that puts them back if the run dies. That
belongs to the machine's administrator, not to a script run from a checkout, so the repo doesn't carry one. Use one
of these instead:

- **A dedicated host or a Boat VM** used only for the benchmark. Nothing else competes, and the quiet gate and the
  contended-window repeat catch what's left.
- **A cpuset the administrator sets up**: a root-owned helper and root-owned state (under `/run`), installed by an
  administrator, with fixed unit names and restore paths and a sudoers rule for exactly that helper. Never give a
  user passwordless `tee`, `rm` or `systemctl` for this: those are root-equivalent. Run only one partition per host.

The harness works inside such a partition. Put the run in a `Delegate=yes` unit, start the orchestrator under
`taskset -c <rest CPUs>`, and pass `--scope delegated` (or `ARDIA_BENCH_SCOPE=delegated`). The harness then moves
itself into a child cgroup of its own unit, and gives Xvfb, the fixture server and each chrome child cgroups pinned to
`--cpus`, checked through `cpuset.cpus.effective`. `ARDIA_PARTITION=<rest>|<bench>` makes it check that `--cpus` is
the bench set and the orchestrator is on the rest; when `ARDIA_PERFLAB_LEASE` names the `--lock` file and
`ARDIA_PARTITION_STATE` exists, the partition already holds the lock and the run takes none of its own.
`cpu-audit.py --out FILE --bench 10-15 --until-pid <pid>` samples every task in `/proc` and splits CPU time on the
bench CPUs into benchmark, orchestrator, kernel and foreign.

Root-cgroup tasks and unbound kernel threads still keep every CPU (about 3 % of one core in PR 3's dry runs). Only a
dedicated host isolates fully.

## Limits of comparability

- **Xvfb and software GL.** There is no GPU, real display or vsync, so frame gaps and latencies are only meaningful
  relative between builds measured the same way, never as absolute numbers or against macOS. Where compositor work
  lands depends on the GL backend, and the two setups PR 3 used disagree:
  - **The harness** passes no GL flags (every result's `gpuFlags` is empty), and on this host the engine chose ANGLE on
    Mesa llvmpipe by itself (`gpu.implementation` `(gl=egl-angle,angle=opengl)`, at 1920x1080). The GPU process
    stays small on every build, about 7-11 % of a core in S6 and S7, so the shell's drop reaches the whole browser.
    In the integration's contended full-instrumentation run of the loading scenarios, the shell went from 106-112 % to
    13-14 % of a core in S6 and total CPU from 127-136 % to 35-38 %, with the GPU process at 9-10 % on both builds.
    The partitioned light run's figures are in [pr3-linux-comparison.md](pr3-linux-comparison.md).
  - **SwiftShader**, forced: the instances PR 3's screen recordings came from were launched with
    `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, at 1600x1000. The GPU process dominates:
    moving the loading animation to the compositor took the shell from 27-31 % to 1.4-1.9 % of a core, while the GPU
    process stayed at 160-212 % on both builds, and the whole-browser ranges overlap in that attribution run.

  So the whole-browser drop holds on the path the engine picks by default on this host, and the SwiftShader numbers
  only show what happens when that path is forced. On a machine with a GPU, compositor work is cheaper still.
- **No window manager.** The window sits at 0,0 and has focus because nothing else does. There is no occlusion
  tracking, so the window always counts as visible.
- **A shared VPS.** Other agents' builds, tests, ClickHouse and Postgres used 100 to 500 % of a core on the bench CPUs
  before the partition. Memory bandwidth, caches, the kernel and disk stay shared with the partition on. The A/A noise
  floor at 3 launches per side on stock (`stock` against a byte-identical copy, 100 tabs, quiet gate on):

  | Area | Median | Floor |
  | --- | ---: | ---: |
  | at rest, total PSS / USS | 1759 / 1531 MiB | 1.8 / 1.2 % |
  | S1 idle, total CPU | 1.4-2.0 % of a core | about 1 point of a core |
  | S2 total CPU | 17.2 % | about 18 % |
  | S3 total / shell CPU | 64.8 / 36.2 % | about 9 % |
  | S4 total / shell CPU | 66.1 / 51.6 % | about 15 % |
  | S5 total / shell CPU | 27.7 / 24.9 % | about 22 % |
  | S3 key->shown, S4 reveal, S5 cold card | 27, 127, 876 ms | 20, 10.5, 1.7 % |
  | DOM counters, S3-S5 | | 2.5-9 % |
  | `capturePicture`, `tab.viewport`, host events | | exact |

  Counters and at-rest memory repeat nearly to the digit and are the rows to trust at small n. Don't call a CPU
  difference smaller than the floor unless it repeats in a second interleaved round.
- **No performance counters.** `perf_event_paranoid` is 4, so the harness can't count retired instructions, which
  contention barely moves. CPU is time, and time moves with the host's load. Context switches stand in for wakeups.
- **Pinning.** Six CPUs for the whole browser, so CPU % is per process kind on a 6-core pin, not what a laptop shows.
  Keep `--cpus` the same on every side.
- **One engine.** Every build runs on `3a64a10704ff`. A UI call newer than the engine fails in the log on every side
  alike.
- **Sampling.** Per-kind CPU and context switches come from 1 s samples. A process or thread that exits keeps its
  count up to its last sample (`unattributed` shows the gap), and one that lives less than a second can be missed.
  `total` CPU has no such gap.
- **DevTools.** The harness keeps one CDP session on the shell and attaches briefly to each fixture page around
  S1-S3. Every side pays the same.
- **Hidden-tab sleeping.** Balanced sleeps tabs hidden for 60 minutes, so every tab stays loaded for a launch;
  `tabsLoaded` and `pageTargets` in each result confirm it.
- **Labels and commits.** The measured `final` includes #1679 and the measured `bun` and `feature` don't, so final
  against bun is PR 3 plus #1679; the measured `bun` and `feature` dists are byte-identical, an A/A pair (see
  "Builds"). A rebuild of `feature` and `bun` at 6d9c3956c and db3139706 isn't byte-identical to the measured dists.
  Compare UI sha256 in the report header before pooling with the published run.
- **Harness protocol.** The four-build run is protocol 1: its S4 windows never confirmed a reveal, so their CPU rows
  are unchecked, and its S3 windows include their put-backs. Protocol 2 results can't be pooled with it.
- **Options.** The four-build run measures S4 and S5 with PR 1's options at their defaults, because stock doesn't
  have them; the options-on numbers come from the separate run in "With PR 1's options on".

## Open leads

Attribution-grade signals from PR 3's experiments that lean toward the optimized build being slower. None was measured
on quiet cores, and each needs the rerun named here before PR 3 can claim responsiveness parity on it:

| Lead | What was seen | Rerun that settles it |
| --- | --- | --- |
| Default-speed reveals over 80 ms (E1) | 20 of 64 against 8 of 64, equal medians, under load 12-28 | Not reproduced by the partitioned full run on the PR heads with PR 1's options on ([pr3-linux-comparison.md](pr3-linux-comparison.md)): PR 3's reveal median is 121.6 ms against PR 2's 127.7 (lower in 4 of 5 blocks), p90 130.3 against 145.6 (5 of 5), 100 of 100 reveals confirmed on each. The probe's first-visible time is over 105 ms on every reveal of every build, so "over 80 ms" no longer separates them; the reveal's settled time isn't measured |
| Reveal and hover timing at Faster and Slower (screen-recording A/B) | Faster 850 against 750 ms, Slower 1017 against 983 ms, hover after a card opens 200-333 against 167-267 ms, 8 visits each, SwiftShader at about 95 % load | The options-on S4/S5 run, partitioned |
| Discard refused during a switch (F23, integration) | 12 of 40 loops against 5 of 40 (Fisher p about 0.09) at about twice the load; every refused tab discarded on the retry 1.5 s later | `discard-race2.mjs`, 20 loops x about 4 launches per side, on quiet cores |
| ctrl+Next p90 with switches every 500 ms (E4) | 41 to 52 ms at 20 tabs, in step with the 2 s volatile save | The partitioned full run (PR 2 head, e02d6c59c before E4, PR 3 head, 5 launches each) puts it in the tail, not the p90: p90 38, 37 and 38 ms, but PR 3 has 4 of 197 presses at 67-85 ms against none over 50 on the other two (Fisher p = 0.06), each reaching the store in 7-11 ms. In S3 the builds before and after differ only by E4. Open until the harness records each `session.write` time so the slow presses can be lined up with the saves ([pr3-linux-comparison.md](pr3-linux-comparison.md), item 4) |
| Pointer resting at x=0 hovers the row level with it (screen recordings) | The final build showed that row's ✕ (3 of 3), the PR 2 build didn't (0 of 3), inside the long demo session | Not reproduced in fresh instances: with the pointer moved to x=40 and then x=0 and left there 1.8-2.5 s, neither build hovers the row (0 of 7 each, at Faster and Slower, on llvmpipe and on SwiftShader), and both hover it with the pointer on the row. Rows start at x=18, so a hover at x=0 needs the shell to have kept an older pointer position; repeat inside a recorded session before attributing it |
| Loading scenarios on quiet cores | Every integration CPU window for S6 and S7 was contended | Settled by the partitioned light run ([pr3-linux-comparison.md](pr3-linux-comparison.md)): final's S6 and S7 total is 79-81 % below bun's in every block |
| S3 key->shown p90 (partitioned light run) | Final 40 ms against bun's 33, higher in 4 of 4 blocks (Mann-Whitney p = 0.14); medians inside the A/A spread | Not repeated against PR 2's head: the partitioned full run has a per-window p90 of 38 ms on both (PR 3 higher in 3 of 4 blocks that differ, Mann-Whitney p = 0.99). The tail above it is the E4 row |
| ctrl+Tab leaves the switcher open (every build, stock included) | 2.5-12.5 % of S3's presses in the light run needed a put-back, every one of them a switcher still open after `xdotool key --clearmodifiers ctrl+Tab`, never a wrong tab. A guess to check: the engine delivers the key as an `onCommand` while the page has focus, and the Control release reaches the page before `restoreShortcutFocus` gives the shell focus, so the shell never sees the keyup (`apps/linux/src/shortcutsRuntime.ts`) | Log `switcherReleased` and the shell's Control keyup per press in a full S3 run; if the release is lost, reproduce it with a person's quick ctrl+Tab before calling it a product bug |

