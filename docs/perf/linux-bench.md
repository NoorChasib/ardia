# Linux CPU/RAM benchmark

`apps/linux/scripts/perf/bench.mjs` compares Linux UI builds (`apps/linux/dist` folders, passed to the engine as
`--ardia-ui-dir`) on one prebuilt engine, with many loaded tabs, under Xvfb. It measures CPU and context switches per
process kind, memory per process kind, shell main-thread work, interaction latency and long frames, and deterministic
shell counters, over seven scenarios. PR 3's (the CPU and RAM hill climb) stock, feature, Bun and final comparison was
measured with it.

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
| `partition.sh`, `cpu-audit.py` | The optional CPU partition (below) and the per-task audit it can run. |
| `tests/` | In-memory tests: options, fixtures, report arithmetic, and S1-S5 run against a fake shell, sampler and xdotool. They run in `bun run --cwd apps/linux acceptance:self-test`. |

## Run it

```bash
scripts/linux/fetch-engine.sh --nearest
scripts/linux/fetch-ubo.sh
bun run --cwd apps/linux build
cp -a apps/linux/dist /tmp/ui-a && git rev-parse HEAD > /tmp/ui-a/BUILD_INFO

taskset -c 0-9 node apps/linux/scripts/perf/bench.mjs run --builds a=/tmp/ui-a,b=/tmp/ui-b --runs 6 --tabs 100 \
  --instrument light --control a --out output/linux-bench/a-vs-b
node apps/linux/scripts/perf/bench.mjs report --out output/linux-bench/a-vs-b --control a --md /tmp/a-vs-b.md
```

`bun run --cwd apps/linux bench -- <args>` runs the same script, with relative paths resolved against `apps/linux`.

Defaults that come from the checkout:

| Flag | Default |
| --- | --- |
| `--engine DIR` | The newest engine under `apps/browser/build-ardiacore/prebuilt-linux-x86_64`, where `scripts/linux/fetch-engine.sh` caches them. |
| `--content-blocker DIR` | `$ARDIA_BENCH_CONTENT_BLOCKER`, else `packages/ardiacore/vendor/ubo/ext` (from `scripts/linux/fetch-ubo.sh`). `none` launches without one. |
| `--out DIR` | `output/linux-bench` (gitignored). |
| `--cpus LIST` | `10-15`: the app, its Xvfb and the fixture server are pinned there. Run the orchestrator under `taskset -c` on the other CPUs. |
| `--display-base N` | `160`: the first X display tried (and up to 40 above it). |
| `--debug-port P`, `--fixture-port P` | `0`: chrome and the fixture server pick free ports. A fixed `--debug-port` is checked to be free first. |
| `--lock FILE` | `/tmp/ardia-perflab.lock`, the perflab lock the other benches use. Give a run its own file when it's a smoke or an attribution run, not a timing. |

Prepare a build by copying its `apps/linux/dist` somewhere stable (the harness reads it while it runs) and writing a
`BUILD_INFO` next to `index.html`: JSON (`{"commit":"<sha>"}`), `commit=<sha>` lines, or just the sha. Every result
records the UI dist's sha256 (with `BUILD_INFO` left out), so two labels of the same dist are an A/A pair.

The exit status is 1 when a launch failed after its retries, or when a teardown left a process behind (the run stops
there).

A smoke check of an install (about 3 minutes):

```bash
taskset -c 0-9 node apps/linux/scripts/perf/bench.mjs run --builds final=<dist> --tabs 5 --runs 1 --scenarios S1 \
  --cpus 0-9 --lock /tmp/bench-smoke.lock --template-wait 45 --settle 10 --idle-seconds 20 --quiet-gate 0 \
  --max-foreign 0 --out /tmp/bench-smoke
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
| Pinning | App, Xvfb and fixture server on CPUs 10-15; orchestrator on 0-9; everything else confined to 0-9 by `partition.sh` |

### Builds

Build the UI at each of the four commits from a clean tree of its own (`git archive`, so nothing uncommitted gets in).
Install dependencies with the package manager that commit pins: pnpm before the Bun migration, Bun after.

| Label | Commit | What it is | Install |
| --- | --- | --- | --- |
| `stock` | 3043ac26b | upstream before this work | `pnpm install --frozen-lockfile` |
| `feature` | 6d9c3956c | PR 1, sidebar settings | `pnpm install --frozen-lockfile` |
| `bun` | db3139706 | PR 2, Bun migration (PR 1 merged) | `bun install --frozen-lockfile` |
| `final` | PR 3's head (UI at 2e9c24a46) | PR 3, the optimized build | `bun install --frozen-lockfile` |

```bash
builds=$PWD/output/linux-bench/builds
for pair in stock=3043ac26b feature=6d9c3956c bun=db3139706 final=<PR 3 head>; do
  label=${pair%%=*} commit=$(git rev-parse "${pair#*=}") src=/tmp/ardia-$label
  mkdir -p "$src" && git archive "$commit" | tar -x -C "$src"
  if [ -f "$src/bun.lock" ]; then (cd "$src" && bun install --frozen-lockfile); else (cd "$src" && pnpm install --frozen-lockfile); fi
  (cd "$src" && bun run --cwd apps/linux build)
  mkdir -p "$builds/$label" && cp -a "$src/apps/linux/dist" "$builds/$label/linux-ui"
  printf 'commit=%s\n' "$commit" > "$builds/$label/linux-ui/BUILD_INFO"
done
```

The commits after 2e9c24a46 on PR 3 only add this harness and its docs, so they build the same dist.

The measured run's `feature` and `bun` dists came from earlier heads of PRs 1 and 2: 50a1ef106 and 48c7e3e67. A pnpm
build and a Bun build of 50a1ef106 gave the same 72 files, byte for byte. 6d9c3956c and db3139706 add PR 1's last two
commits (#1679: a tab dragged off the sidebar peek holds it out), so a rebuild at those commits has a different UI
sha256 than the measured `feature` and `bun` labels. They add one more store subscription to the peek's holds and a
check in its hold test. The hold itself only engages during a tab drag, which no scenario does.

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
python3 scripts/linux/package.py --out "$engine" --ui "$builds/stock/linux-ui" --destination /tmp/ardia.tar.xz --content-blocker "$ubo"
tar -xJf /tmp/ardia.tar.xz -C /tmp && blocker=/tmp/ardia/lib/ardia/extensions/ublock
```

Every result records the blocker tree's sha256, so a different blocker shows up in the report header and stops
`report --all` from pooling.

### The command

Four builds, 4 launches each, interleaved (stock feature bun final, then final bun feature stock, and so on), all
seven scenarios, 100 tabs, light instrumentation, paired against `bun`, inside the CPU partition, with the run holding
the lock from the first template to the last launch:

```bash
apps/linux/scripts/perf/partition.sh run --audit output/linux-bench/final-light/audit.json -- \
  taskset -c 0-9 node apps/linux/scripts/perf/bench.mjs run --engine "$engine" --content-blocker "$blocker" \
  --lock-scope run --builds stock=$builds/stock/linux-ui,feature=$builds/feature/linux-ui,bun=$builds/bun/linux-ui,final=$builds/final/linux-ui \
  --runs 4 --tabs 100 --instrument light --control bun --display-base 240 --out output/linux-bench/final-light
node apps/linux/scripts/perf/bench.mjs report --out output/linux-bench/final-light --control bun --md output/linux-bench/final-light/report.md
```

Each launch takes about 6.5 minutes, and each template about 2 minutes, so the run takes about 2 hours. `--instrument
light` is the mode to rank CPU and RAM by (see "Two kinds of run"). For counters, frames and latencies, run the same
command with `--instrument full` (the default) into another `--out`. Without the partition, drop the `partition.sh run
… --` prefix. The run still works, but other processes can use CPUs 10-15, and the quiet gate and the
contended-window repeat are what keep the windows usable then.

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
| S3 tab switching | Tabs 1 and 2 (both static), then 40 real `xdotool key ctrl+Tab` presses 500 ms apart. On Linux ctrl+Tab goes to the most recent tab, so every press must land on the other one. A press that leaves the switcher open or lands elsewhere is put back and counted as a miss. | about 21 s |
| S4 sidebar edge reveal | `autoHideTabs: true`, then 20 times: pointer to x=40, then x=0 at mid-height, hold 600 ms, back to the middle, hold 600 ms. Not comparable unless tab 1's row was off screen first. | about 25 s |
| S5 hover sweep | `--settings` applied and read back. Over the first 24 sidebar rows whose centre hit-tests to the row, 3 passes: row 1 for 1,200 ms (the card's cold delay), rows 2-24 for 300 ms each, then the pointer away for 1 s. The settings go back afterwards, and the launch fails if they don't. | about 3 x 9 s at N >= 24 |
| S6 loading | Tab 1 loads `/slow/<--slow-ms>` and stays loading in the default layout (address field in the toolbar, the reload button breathing, the row spinner). The window counts only if tab 1 is active and loading and its request is open, at its first and its last moment. | `--loading-seconds` (45 s) |
| S7 pill | As S6, with the address field in the sidebar and the sidebar hidden, so the LoadingPill shows over the page. | `--loading-seconds` (45 s) |

`--settings` is applied only around S5, and a key the build doesn't know fails the launch. So a run that includes
stock measures S5 with the defaults, and so did PR 3's four-build run. To measure hover with PR 1's options on, run
S5 on the builds that have them, for example `--builds feature=…,bun=…,final=… --scenarios S5 --settings
showMemoryInTabHoverMenu=true --settings tabCloseButtonSide=left`. S4 always runs at the default
`sidebarRevealSpeed`.

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

## The CPU partition (optional)

Taskset alone keeps the app on 10-15, but nothing keeps other processes off them. `partition.sh run … -- <command>`
moves everything else onto the rest CPUs for one run and always gives them back:

1. **Checks.** It refuses overlapping or offline CPU lists, and sudo rules that don't cover the commands it needs. It
   refuses a `bench.mjs` whose `--cpus` isn't `--bench` or that doesn't start with `taskset -c <subset of --rest>`,
   and a process outside the benchmark slice pinned only to the bench CPUs (`--force` overrides that last one).
2. **Locks.** It takes the host-wide partition lock (`/run/lock/ardiabench-partition.lock`) and a shared lease on the
   perflab lock (`ARDIA_PERFLAB_LOCK`, default `/tmp/ardia-perflab.lock`), so no benchmark that takes the perflab lock
   can start until the CPUs are back.
3. **State.** It records `AllowedCPUs`, `EffectiveCPUs` and the runtime drop-in of every active top-level unit
   (`system.slice`, `user.slice`, `init.scope`, `machine.slice` and any other) in a state file
   (`ARDIA_PARTITION_STATE`, default `~/.local/state/ardia/linux-bench-partition.state`). It also records what no unit
   setting reaches: root-cgroup tasks, and cgroups outside systemd.
4. **Guard.** It arms a root service, `ardiabench-guard-*` (`Restart=on-failure`). The guard runs `restore` as soon as
   the script is gone (SIGKILL included) or the deadline passes (`--max-hours` + 10 min), and retries every 15 s until a
   restore verifies.
5. **Confine.** It confines the recorded units to the rest CPUs with `systemctl set-property --runtime` and checks
   each one's `EffectiveCPUs`.
6. **Run.** It runs the command as `ardiabench-run-*` in `ardiabench.slice` (`Delegate=yes`, your uid and gid, the
   current directory). With `ARDIA_BENCH_SCOPE=delegated`, the harness moves itself into a child cgroup with the rest
   CPUs, and puts Xvfb, the fixture server and each chrome in child cgroups with the bench CPUs, checked through
   `cpuset.cpus.effective`. `--audit FILE` runs `cpu-audit.py` on the rest CPUs: every task's CPU on the bench CPUs,
   split into benchmark, orchestrator, kernel and foreign.

`restore` runs on exit, INT, TERM and HUP, from the guard, or by hand (`partition.sh restore`). It takes the partition
lock, stops the benchmark service and waits until its cgroup is empty (it never reopens the CPUs while the benchmark
runs). It puts every recorded unit back to its recorded `AllowedCPUs` and drop-in, and runs `daemon-reload` when a
drop-in changed. Then it checks `AllowedCPUs`, `EffectiveCPUs` and `NeedDaemonReload`. Only when all of that verifies
does it delete the state file and stop the guard; on any failure both stay and the guard tries again.
`partition.sh status` shows each unit's CPUs, the state file, the guard and anything the partition doesn't confine.

It needs passwordless sudo for `systemctl`, `systemd-run`, `tee`, `rm`, `rmdir`, `truncate`, `test`, `base64` and
`install`. Changing system units' CPUs and starting root transient services are root operations. The script checks
`sudo -n -l` for each one before it changes anything.

Root-cgroup tasks and unbound kernel threads still keep every CPU (about 3 % of one core in the dry runs). Only a
dedicated host isolates fully.

## Limits of comparability

- **Xvfb and software GL.** There is no GPU, real display or vsync. Chromium composites through ANGLE on llvmpipe on
  the CPU, so the `gpu` process's CPU is large and noisy. Frame gaps and latencies are only meaningful relative between
  builds measured the same way, never as absolute numbers or against macOS. Moving work to the compositor moves its
  cost into this software GPU process instead of removing it. On PR 3's loading animation, the shell's CPU went from
  27-31 % to 1.4-1.9 % of a core, while the GPU process stayed at 160-212 % on both builds, and the whole-browser
  ranges overlap in an attribution run. On a machine with a GPU, that work is cheap.
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
- **Rebuilt labels.** A rebuild of `feature` and `bun` at 6d9c3956c and db3139706 isn't byte-identical to the
  measured dists (see "Builds"). Compare UI sha256 in the report header before pooling with the published run.
