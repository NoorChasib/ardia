# Performance and architecture audit, 2026-11-18

This report recommends; it changes no code. It was written on 2026-11-18 on top of PR 3 (`phase3/final-candidate` at
`d3a803217`): PR 1's sidebar settings, PR 2's move to Bun, and all six Phase 3 experiments (E1-E6). Every measurement
ran on Linux. Paths are relative to the repository root unless they start with `~`. Labels used throughout:
- **M** (measured): a number from the 2026-11-18 runs or the repo's own benches, with n given.
- **C** (code-verified): the mechanism was read at the cited lines, but its cost wasn't measured.
- **H** (hypothesis): an inference that still needs the experiment listed with it.

**What "final" means.** The build measured as "final" is `2e9c24a46`, PR 3 as it stood when the partitioned bench
started. PR 3 then gained five commits. Two change shipped JS and were not benchmarked:
- `a7abec0e0` and `82b4f2c2f`: the Linux benchmark harness moves into the repo (`apps/linux/scripts/perf/`, documented
  in `docs/perf/linux-bench.md`), with review fixes;
- `d1fdb96ce` (shipped JS): session writes and Linux shell counts need both the saved and the shown choice on (item 1);
- `26dfa28d9` (shipped JS): a close acknowledgement drops a kept tab claim only once the tab has left the store;
- `d3a803217`: the bench doc's limits and open leads.

The measured PR 1 (`50a1ef106`) and PR 2 UI (`48c7e3e67`) builds predate PR 1's #1679 fix, which final contains, so
final against PR 2's UI measures PR 3 plus #1679 (`docs/perf/linux-bench.md`, "Builds").

**Brought up to PR 3's final head.** After the report was written, PR 3 gained four telemetry consent commits
(`74aaed6be`, `a24d2df08`, `0e13aba6e`, `e15125104`) and docs, ending at `e2edc6a78`. Its last measurement ran S3-S5
with full instrumentation on the PR heads (PR 2 `db3139706`, PR 3 before E4 `e02d6c59c`, PR 3 `e15125104`), partitioned,
n = 5 per build, with PR 1's hover options on (run `20261118T174444`, `docs/perf/pr3-linux-comparison.md`). Section 1a's
open risks and items 14, 48 and section 6 item 11 carry its results. Three other statements below predate the final
head, and this paragraph wins over them:
- **Item 1a's gate landed in PR 3.** `74aaed6be` gates the hourly extras and `consentedCount` on both choices,
  `a24d2df08` moves the boundary into `client.capture` and the Linux relay with a consent epoch the leader checks, and
  `0e13aba6e` and `e15125104` close the related gaps a review found.
- **Codex reviewed E1, E3, E4 and E5** at `3700dddb9` and found each handled. Its consent findings over three rounds
  are all fixed in the commits above (most predate PR 3), and its final pass at `e15125104` found no blockers.
- **Mac:** PR 2's and PR 3's JS ran on the Mac through Metro on PR 1's Debug binary, using pnpm's `node_modules`. The
  phone project has installed with Bun and passed TypeScript 7 there; the root and browser app's Bun install and
  TypeScript 7 on macOS are still unverified (section 6 item 12).

**Sources.** Five audit angles: architecture and IPC, rendering and state, reliability, maintainability and tooling,
and a Rust evaluation. The reliability and Rust angles ran at `e522661dd`; every finding of theirs used here was
re-checked at `2e9c24a46`, and two were corrected. Phase 3's round-1 profiles and its six experiments, the Phase 3
integration and its bench, the partitioned bench, the PR 3 media run, and the Mac verification of PR 1. The harness
and its recipe are in the repo. The reports, raw data and scratch benches live in an audit workspace (`~/ardia-work`)
on the measuring host, off the repository, so **the numbers quoted inline are the record** (appendix 7). A
completeness critic, a review council and a final review challenged the rankings; appendix 8 lists what a reader
should still treat with care.

**Item numbers are stable IDs, not ranks.** Items split by scope carry a letter (1a, 1b); section 3's table gives the
score order. Lead numbers in section 4 are stable IDs too.

**Where PR 3 stands at `d3a803217`:**
- It merges the integration branch `phase3/perf-hill-climb` (E1, E2, E3, E5 and E6, plus two interaction fixes:
  `368694d01`, one consent-gated source for the Linux shell counts and `paintMotion.test.mjs` in `test:host`; and
  `e02d6c59c`, no `tab.viewport` send for a hidden-to-hidden rect change). It also merges E4 (`9a828f35e`, E4's head
  `e8dd9cafa` after a second review round), PR 1's #1679 fix (`2e9c24a46`) and the five commits above.
- The integration's S6/S7 bench finished, on contended cores.
- A partitioned light bench of stock, PR 1, PR 2's UI and final, on cores 10-15, ran 4 launches per build (section 1b).
- No Codex review has run for E1, E3, E4, E5, the integration's commits or `d1fdb96ce` and `26dfa28d9`, and five
  responsiveness risks are open (section 1a, "Finish PR 3 first").

## 1. Summary for the owner

**Decisions for the owner.** Each unblocks the item named; the default is what happens if you say nothing.
1. **The hidden-tab wait** (item 18): shorten Balanced's 60-minute `hiddenMs`, or lower the per-GiB rate. Default:
   keep today's policy and run only item 18's RAM-ceiling measurement.
2. **A named Mac builder** for nightly engine prebuilts (item 10b). Default: no nightly Mac prebuilts; 10a and 10c go
   ahead without it.
3. **The exact-match engine contract** (item 10c): may the Mac app degrade with `respondsToSelector:` instead of
   failing? Default: the preflight fails at launch with a clear message, and the contract stays.
4. **The Linux modifier for ⌥-click** (item 3): Alt, or Ctrl+Shift where the window manager takes Alt. Default: Alt,
   after a check on a real GNOME or KDE desktop.
5. **The "a newer session is overwritten" policy** in `docs/conventions.md` (item 5). Default: the policy stays, and 5a's
   set-aside, which deletes nothing, can still go ahead.
6. **Kill switches without update checks** (item 32): fetch them even when automatic update checks are off. Default:
   fetch only with update checks on, as today.
7. **CI on the fork** (section 6 item 11): settled. The owner's PRs pass the vouch gate, so every workflow runs by
   itself, and upstream's CLA, Vouch, Vouch manage, Linked issue and Deploy workflows are switched off on the fork.
   Windows CI can't fetch an engine until the fork publishes its own Windows engine.
8. **A worktree exception for automated workflows** (section 6 item 13). Default: no exception, and item 23's guard
   hook blocks `git worktree add`.
9. **E4's crash-loss window** (section 1b): up to 2 s of active-tab and title changes lost on a crash, and other
   windows up to 2.6-2.9 s behind a switch. Default: accepted, as PR 3 ships it.
10. **Item 2 upstream**: whether to propose the CI-queue changes to the upstream maintainers. Default: nothing
    changes; only 2a's measurement runs.

### 1a. Top recommendations

Scoring: **score = impact × evidence ÷ (effort × risk)**.
- Impact: 1 negligible, 2 small, 3 moderate, 4 large, 5 very large, for users or contributors. For the measurement
  items (48-51), impact is the value of what the result unblocks.
- Evidence: 3 means measured and repeated (counts to the digit, a failure that reproduces every time in a test that
  has been run, or an interleaved A/B with separated ranges); 2 means partly measured, or a reproduced mechanism with
  its size extrapolated; 1 means code only. A deterministic code path with a ready test counts as 3 once the test has
  been run, and as 1 until then.
- Effort: 1 is S (a day or less, no engine build); 2 is M (several days, or one engine patch that rides a batched
  engine release that something else triggers); 3 is L (a week or more, engine-side feature work across platforms, or
  an engine patch that would need its own release).
- Risk: 1 low, 2 medium, 3 high. Anything in AGENTS.md's risky classes (races, lifetimes, security, migrations, sync,
  native lifetime, focus, quit) scores risk 2 or more.
- Each score covers one scope. Where a cheap first step and the full proposal differ, they are scored as separate
  items (1a and 1b, 2a and 2b, 5a and 5b, 10a-10c, 11a and 11b), and impact is credited only for what that scope
  delivers.

Ties go to higher impact, then to the lower item ID. The full list (58 rows) is in section 3.

**The biggest levers, highest impact first.** The formula rewards cheap, safe and well-evidenced work, so it buries
large items whose evidence is code only. This view sorts the items with impact 3 or more by impact, then evidence:

| Items | What | I | E | Formula score (rank) | Why it matters | First step |
|---|---|---|---|---|---|---|
| 10a, 10b, 10c | Engine keys, nightly prebuilts, Mac skew preflight | 4 (10c: 3) | 3 | 3.0 (10), 2.0 (18), 4.5 (4) | The nearest prebuilts are 44 (Mac) and 47 (Linux) key-moving commits behind; PR 1's Mac run needed a test-only shim (M). Every engine item below gets cheaper | 10c's preflight (S), then 10a's replay; 10b needs a named Mac builder |
| 49 | Mac baseline at scale | 4 | 2 | 4.0 (5) | The main app: the repo measures it at 1-20 tabs and a 200-row restore (+420 ms to content, M), nothing at 50-100 tabs or while a tab loads | Blocked on Mac access and an exact prebuilt (item 10); then extend `native-bench.mjs` |
| 18 | Hidden-tab budget | 4 | 2 | 2.67 (16) | About 12 MiB per slept tab on Linux, 22-46 MB per tab on the Mac (M per tab, H for the saving) | An owner decision on the 60-minute wait |
| 45 | Sidebar and strip windowing | 4 | 2 | 0.89 (56) | 961 MB at 2,000 tabs and 1,419 MB at 3,000 on the Mac (M, older build) | After item 49 |
| 5a, 5b, 13, 20 | Reliability bundle: session set-aside, its telemetry, the launch guard | 4 | 1 | 2.0, 1.0, 1.5, 1.0 | Total tab loss and an app that won't open (C); item 13 measures how often | 5a's JS-only copy and its unit test |
| 21 | Sync simulation | 4 | 1 | 1.33 (45) | Two sync changes were reverted for P1 data-loss bugs (C) | Build the simulator |
| 38 | History mirror | 4 | 1 | 1.0 (48) | Up to 100,000 entries in every JS heap (C) | Read the field `history` size buckets |
| 1a | One consent gate where the hourly counts are taken | 3 | 3 | 9.0 (1) | Every ungated hourly count from a Linux user with several windows can cross a consent change; reproduced at PR 3's head (M) | Gate `takeHourlyExtras` on `sharingAgreed()` |
| 48 | Profile S3, S4 and S5 on the final build | 3 | 2 | 6.0 (2) | The largest measured shell costs left: reveals 32.5-36.6 %, switching 25.5-29.5 %, hover 13.8-18.4 % of a core (M) | A full-instrumentation profile |
| 19 | Chrome's hidden toolbar repaint (C4) | 3 | 2 | 1.5 (34) | The largest measured loading cost left: S6 browser process 11-14 % against 0.3-0.6 % with nothing loading (M) | Toggle only the progress view on the final build |
| 50 | Linux at N = 300 and 1,000, three windows | 3 | 2 | 3.0 (13) | Every number here is at N ≤ 100 in one window; field installs carry 1,383-3,051 tabs | The same S1-S7 at larger N |

**Do this week: the formula's top seven.** These score highest because they are cheap and safe. Two are measurements
(items 48 and 49), scored on what their results unblock; one is a privacy fix (1a); the other four are hygiene. Apart
from 1a, they are not the biggest levers above.

| Rank | Item | Subsystem | Recommendation | I | E | F | R | Score | Measured or hypothesis |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1a | Telemetry consent (Linux multi-window) | One gate at the choke point: `takeHourlyExtras` drains every source and returns nothing unless `sharingAgreed()`; `consentedCount.note` needs both flags too | 3 | 3 | S | low | 9.0 | M: the pending opt-in leak reproduces at `d3a803217` on `find_opens` and `find_steps`, an ungated source that predates PR 3; 18 of the 22 hourly sources have no gate of their own (C). PR 3 fixed four sibling counters one at a time |
| 2 | 48 | Shell UI on Linux (S3-S5) | Profile switching, reveals and hover on the final build: full instrumentation, partitioned cores, n ≥ 4, store switching, plus a real-input latency run | 3 | 2 | S | low | 6.0 | M: the costs (n = 4, final ranges below every other build). Their cause on the final build is H; `mountLayout`'s settle (item 52) is the first CPU hypothesis and E4's volatile save the first latency one |
| 3 | 4 | Test infrastructure | `test:host` by directory discovery, plus a repo-wide orphan-test check | 2 | 3 | S | low | 6.0 | M: 2 orphan suites, left out on purpose for parity, must each be run, fixed, deleted or allowlisted |
| 4 | 10c | Mac launch | Check the prebuilt engine against what the app needs at launch, and fail with a clear message instead of crashing | 3 | 3 | S | medium | 4.5 | M: 0 of 2 needed `ArdiaCore.h` members in the nearest Mac prebuilt; PR 1's Mac run needed a test-only shim. Degrading instead of failing relaxes a documented contract (owner decision 3) |
| 5 | 49 | Mac app | Mac baseline at 20/50/100 tabs, while a tab loads, and on a 200-row and four-window restore. **Blocked on Mac access and an exact prebuilt** | 4 | 2 | M | low | 4.0 | M at 1-20 tabs and for restore in `docs/perf`; nothing at 50-100 tabs (H) |
| 6 | 3 | Linux input (react-native-web) | Deliver ⌥/Alt-click on Linux: RNW's `PressResponder` drops `onPress` whenever Alt is held | 2 | 2 | S | low | 4.0 | C (`PressResponder.js:313`) plus a manual report on the split pane's ✕; never run with xdotool |
| 7 | 6 | Linux acceptance F23 | Make F23 wait for the old pane's hide before it discards | 2 | 2 | S | low | 4.0 | M: refused 6/14 (base) vs 9/14, and 5/40 vs 12/40 under rising load; both inconclusive. The mechanism rests on 6 timestamped refusals |

Ranks 8 and 9 also score 4.0: item 7, the RAM line (measure the cold first reply before changing the wait, M on the
round-1 build and the PR 3 media), and item 8, a path check for the docs (about 30 dead paths, M).

**Finish PR 3 first.**
- **Codex reviews.** AGENTS.md asks for a Codex review of risky logic (races, lifetimes, security, migrations, sync).
  None has run for:
  - E1 (frame ordering);
  - E3 (hit testing and page placement under switch-ahead: an ordering race);
  - E4 (persistence and merge: the echo fast path and the carried save class). Its in-run reviewer found a real bug
    in its second round: a structural save queued behind an in-flight write reached disk 2,372 ms after the change
    instead of 377 ms (fixed in `e8dd9cafa`);
  - E5 (lifetimes);
  - the integration's `e02d6c59c` (a skipped viewport send) and `368694d01` (consent gating);
  - `d1fdb96ce` (consent gating) and `26dfa28d9` (a kept tab claim across a deferred close, a lifetime change).

  E2 (compositor animation, Reduce Motion) and E6 (same-value `setState`, map pruning) fall outside those classes and
  had their in-run reviewer, which is enough for them.
- **Item 1a's gate.** PR 3 has patched the consent class counter by counter (`368694d01`, E5, `d1fdb96ce`), and the
  pending opt-in leak still reproduces at `d3a803217` on an older counter (item 1). The one gate in `takeHourlyExtras`
  is small enough to land in PR 3 with the per-counter fixes.
- **Open responsiveness risks.** PR 3's final run on the PR heads (partitioned, n = 5 per build, PR 1's options on)
  settled most of these; one tail is left. The list mirrors the "Open leads" table in `docs/perf/linux-bench.md`:

  | Risk | What was seen | Rerun that settles it |
  |---|---|---|
  | S3 switch latency | Light run: key→shown p90 37-44 ms on final against 32-36 ms on PR 2's UI (n = 4, Mann-Whitney p = .029). On the PR heads it doesn't repeat: median 28 ms and p90 38 ms on both. Above the p90, PR 3 alone had 4 of 197 presses at 67-85 ms, against none over 50 ms on PR 2 and none over 44 ms before E4 (Fisher p = 0.06); the slow presses reached the store in 7-11 ms | A run that timestamps each session save on the switch timeline (item 48) |
  | E4's switch tail | p90 41 → 52 ms at N = 20 with a switch every 500 ms, higher in 3 of 4 blocks (`e4-result.md:158-161`). E4 is the only substantive change in S3's path between `e02d6c59c` and PR 3's head, so the slow presses above implicate it; there is no 2 s clustering, and the harness doesn't timestamp saves | The same run. If it holds, move the volatile save off the press cadence (about 150 ms after the last switch, capped at 2 s) rather than revert E4 |
  | E1's Default reveal tail | **Not reproduced.** Every reveal on every build takes at least 105.9 ms to first show, so "over 80 ms" can't separate builds, and PR 3 is faster: median 121.6 against 127.7 ms (p .032), p90 130.3 against 145.6 ms (p .016), rAF gaps over 25 ms 5 against 44 | Settled |
  | Reveal and hover timing in the PR 3 recordings | Faster 850 against 750 ms, Slower 1,017 against 983 ms; hover after a card opens 200-333 against 167-267 ms; 8 visits each, SwiftShader at about 95 % load (item 28). The options-on run on PR 1's build then measured Slower at +245 ms (designed 250) and Faster at −22 ms, with unchanged CPU per reveal; the cold card is equal on all three PR heads | Faster and Slower on PR 3's head; the warm card with `--hover-dwell 500` |
  | F23 discard refusals | 12 of 40 loops against 5 of 40 (Fisher p = 0.099) at about twice the load; every refused tab discarded on the retry | `discard-race2.mjs` on quiet cores, about 4 launches per side (item 6) |

- **The perflab.** The partitioned CPU A/B reached n = 4 per build (section 1b); the floor report asks for 6 per side
  before calling differences under its bar.

### 1b. What PR 3 already fixed (don't redo it)

**Phase 3's starting point** (ranking §0, M with 4 + 4 launches): high CPU with many tabs is not an idle problem. With
static tabs at N = 100, the whole app uses 1.2-2.0 % of a core and the shell ≤ 0.1 %. The cost appears the moment
anything in the shell mutates the DOM or animates (a loading tab, a reveal, hover, switching, a retitling background
tab), and then grows linearly to quadratically with loaded tabs.

Each experiment was measured against the Phase 3 start (`48c7e3e67`, `~/ardia-work/builds/bun/linux-ui`) at N = 100
loaded tabs on Linux. Each side had n = 4 launches, interleaved, unless noted. All CPU numbers are attribution-grade.

**Against the noise-floor bar.** `bench-noise-floor.md` asks for at least 6 launches per side, and a second interleaved
round, before calling a CPU difference under about 10 % (S3, S4) or 20 % (S2, S5). Phase 3 used n = 4 on shared
cores and one round. E1's and E2's CPU gains, E3's on top of E1 (−27 %) and E4's S3 shell gain (−19 %, ranges
separate) are above that bar's size threshold, though at n = 4 rather than 6. One result is not: E3 alone, −9 % shell
CPU in S3, S4 and S5, with ranges that separate but under the 10 % bar. Treat that one as not yet shown for CPU; its
counts still stand.

| Exp. | Change | Headline numbers | Status |
|---|---|---|---|
| E1 (`8bb7b6e22`) | One viewport coordinator and one input-region flush per frame | Viewport callbacks and flushes per loading frame: N → 1.0 at N = 20 and 100. Shell CPU while loading: 103.9 → 64.4 % (ranges separate; reviewer's rerun 106.3 → 62.3). S4: rAF gaps over 25 ms 88.5 → 21.5, reveal 140 → 121 ms. S3 long-frame blocking 606 → 138 ms. Listeners 2,106 → 1,017. The `contains` scan, 3.6 s per 30 s, is gone | KEEP; merged (`b7c773e0b`); Codex review pending. Its frame counts now go through `shellCounts.ts` (`368694d01`) |
| E2 (`d7aa349e5`) | Loading loops (reload breathe, LoadingPill) run on the compositor (WAAPI) | Default layout while loading: shell 106 → 4.0 %, whole app 128 → 25 %; N = 20: 35 → 3.6 %. Pill layout with E1's paint-motion contract: 97 → 3.5 %. GPU unchanged (~9 %). Visual parity within 0.065 px | KEEP; merged (`855b8f299`). Its telemetry (`linux_compositor_load_loops`) and its test's move into `test:host` landed in `368694d01` |
| E3 (`27170843f`) | Hidden panes `display:none` (Linux opt-in) | `elementFromPoint` 0.60 → 0.12 ms per call, flat in N. Shell while loading: alone 105.8 → 96.7 %; with E1 64.9 → 47.5 % (−27 %). S3 p90 38 → 33.5 ms | KEEP (with the round-2 switch-ahead fix); merged (`e71cf08d7`). On the E1 + E3 stack its extra viewport send (54 against 36 per 18 switches) is fixed by `e02d6c59c`, and its switch-ahead count, which leaked past consent, by `368694d01`. Codex review pending |
| E4 (`2973d607a`; CPU rows at `91f98a1be`; merged head `e8dd9cafa`) | Session saves: a 2 s delay for volatile-only changes, and an echo fast path | At `91f98a1be`, light, n = 4 ABBA on shared cores (`e4-result.md:125-141`): S3 shell CPU 36.09 → 29.38 % (−19 %), browser 13.44 → 10.37 % (−23 %), whole app 62.10 → 51.67 % (−17 %), all with separate ranges. Writes 40 → 11 per 40 switches (full, n = 1; round 1: 38.5 → 11.5). Bytes 2.97 MB (31 writes) → 1.05 MB (11 writes). Shell TaskDuration 4,574 → 4,044 ms per 40 switches (n = 1, −13 ms per switch). At the merged head, one full rerun (n = 1): 41 → 11 writes, −16 ms per switch. No latency gain is shown: key→shown 29/40 → 29/38 ms (n = 1) and long-frame blocking not separable. A tail regression is: with a switch every 500 ms at N = 20, p90 41 → 52 ms, higher in 3 of 4 blocks, because the 2 s volatile save lands on a switch; at 600 ms and at N = 100 the tails match (`e4-result.md:158-161`). Costs: up to 2 s of active-tab and title changes lost on a crash; other windows see a switch up to 2.6-2.9 s later | KEEP; merged (`9a828f35e`) after a second review round. That round found a structural save queued behind an in-flight write relabelled cosmetic (2,372 ms to disk, now 377 ms), and `session_kb_written` counting the submitted snapshot's UTF-16 instead of the acknowledged session's UTF-8. Codex review pending |
| E5 (`72660a666`) | HostTab release leak, and one event dispatcher | HostTabs after 300 closes: 310 → 10 (1.4 MiB → 11.5 KiB). Dispatch 27.8 → 0.40 µs per event, flat in N. Load-storm CPU didn't separate (about 40 ms of a 9-10 s storm) | KEEP; merged (`ae9c4c9c5`); Codex review pending |
| E6 (`ef6f0445c`, head `8e36458f3`) | Same-value `setState` in `SelectedRowPill`; `ListMotion` map pruning | Pending updates 955 → 3; `sources` after churn 295 → 1. **No CPU change.** The strip remount (no CPU change) and FadeLabel (+2.4 MiB heap) were dropped | KEEP 2 of 4; merged (`9d67b3094`) |

**The integrated stack** (`phase3/integration.md` §4a). Setup: frozen build of `e02d6c59c` against the Phase 3 base,
S6 (default layout) and S7 (the loading pill) at N = 100 with the active tab loading. Two launches per side, ABBA,
full instrumentation. Other jobs put 195-904 % foreign CPU on cores 0-9, so the CPU figures are indicative only. The
counts don't depend on load and repeat to the digit.

| Per second, or per 45 s window | Base S6 | Integrated S6 | Base S7 | Integrated S7 |
|---|---|---|---|---|
| rAF callbacks /s | 5,622-6,085 | **0** | 5,868-6,136 | **0** |
| `getBoundingClientRect` and `getAnimations` /s (each) | 11,023-11,990 | **0** | 11,526-12,052 | **0** |
| `getComputedStyle` /s | 81,789-88,968 | **0** | 122,202-127,778 | **0** |
| `elementFromPoint` /s | 276-300 | **0** | 287-300 | **0** |
| Mutation records /s | 110-120 | **0** | 154-162 | **0** |
| Shell TaskDuration per 45 s | 37.3-40.2 s | **3.3-3.6 s** | 30.9-34.2 s | **4.1-4.3 s** |
| Shell CPU (contended) | 105.6-112.0 % | 12.7-13.9 % | 92.9-99.1 % | 14.9-15.2 % |

- Shell JS event listeners at rest: 2,109 → 1,022 (E1's −11 per tab).
- `tab.viewport` sends per 18 Ctrl+PgDn switches: 36 on base, 54 on the stack before `e02d6c59c`, 36 after.
- E1 and E2 combine as predicted. In S7, E2 alone left about 180 rAF/s even at N = 2; E1's paint-motion exclusion is
  what takes the pill's watchers to zero.

**The final build on partitioned cores** (M, n = 4 per build, all 16 launches). Setup: `bench.mjs run --runs 4 --tabs
100 --instrument light --control bun` on cores 10-15, in a cgroup, under the perflab lock, interleaved (the recipe is in
`docs/perf/linux-bench.md`). Foreign CPU on those cores had a median of 0.55 % per window and reached 22.1 % in one
window (PR 2's UI, S2); 26 of 112 windows were above 2 %, none was contended, and every window passed the quiet gate.
On cores 0-9, foreign CPU ran 78-904 % through the day. "Whole app" is every process in the app's cgroup: browser, GPU,
shell, pages, extension and utilities. Each cell is the range over the four launches; the change is mean against mean:

| Scenario | Stock `3043ac26b` | PR 1 `50a1ef106` | PR 2's UI `48c7e3e67` | Final `2e9c24a46` | Final against PR 2 | Foreign CPU in the row's windows |
|---|---|---|---|---|---|---|
| S1 idle, whole app | 1.9-2.2 % | 1.8-2.1 % | 1.8-2.2 % | 1.3-2.0 % | same (no usable floor) | 0-3.0 % |
| S2 active split, whole app | 20.0-21.1 % | 19.2-20.4 % | 20.0-21.5 % | 19.7-22.6 % | same | 0-22.1 % |
| S3 switching, shell | 34.1-41.1 % | 33.8-36.9 % | 36.6-39.4 % | **25.5-29.5 %** | −28 % | 0-14.4 % |
| S3 switching, whole app | 61.1-70.6 % | 61.6-66.4 % | 63.0-70.1 % | **51.0-55.4 %** | −20 % | (same windows) |
| S4 edge reveals, shell | 48.6-56.6 % | 52.6-55.7 % | 50.9-57.8 % | **32.5-36.6 %** | −36 % | 0-3.1 % |
| S4 edge reveals, whole app | 63.3-73.3 % | 68.9-72.2 % | 66.1-75.0 % | **49.2-53.3 %** | −27 % | (same windows) |
| S5 hover sweep, shell | 22.1-25.3 % | 23.4-24.0 % | 22.0-25.4 % | **13.8-18.4 %** | −36 % | 0-6.9 % |
| S6 loading, shell | 104.0-116.4 % | 102.8-109.5 % | 99.6-113.8 % | **3.9-5.3 %** | −96 % | 0-9.6 % |
| S6 loading, whole app | 125.8-142.1 % | 125.4-133.3 % | 120.8-139.1 % | **24.3-30.7 %** | −80 % | (same windows) |
| S6 loading, GPU process | 9.5-11.0 % | 9.7-10.4 % | 9.2-10.9 % | 8.8-11.0 % | same | (same windows) |
| S6 loading, browser process | 11.8-14.1 % | 12.1-12.9 % | 11.6-13.9 % | 11.1-13.9 % | same | (same windows) |
| S7 loading pill, whole app | 114.2-133.1 % | 114.7-125.1 % | 109.9-130.6 % | **24.0-28.3 %** | −78 % | 0-10.7 % |

- **Every final range is below all three other builds** in S3-S7. Each gain is above the noise floor's size bar
  (about 9 % for S3, 15 % for S4, 18-22 % for S5), but at n = 4, under the floor report's 6 launches per side. Final
  also contains #1679, which the measured PR 1 and PR 2 builds don't (see "What final means" at the top).
- **PR 1 and PR 2's UI are a true A/A pair:** their UI bundles are byte-identical (the same dist fingerprint), while
  stock's differs. At n = 4 every one of their ranges in this table overlaps, and so does every stock range with
  theirs. PR 1 and PR 2 didn't move CPU in any way this bench can resolve.
- **Idle was never the problem.** S1 and S2 are the same on all four builds.
- **The GPU and browser processes didn't change** while loading (S6 GPU 8.8-11.0 %, browser 11.1-14.1 % across all
  builds). On this setup the loading animation's cost went away; it didn't move into the GPU process.
- **S3 used the keyboard path,** with switcher recoveries on every build (stock 2-5, PR 1 1-3, PR 2's UI 2-5, final
  0-4 per launch). Its CPU drop doesn't show faster switching: final's key→shown p90 was 37-44 ms against 32-36 ms on
  PR 2's UI (stock 34-39, PR 1 31-41). The A/A pair alone spans 31-41 ms, so the gap leans toward noise, but at n = 4
  on the keyboard path it was **unresolved** at n = 4. The full run on the PR heads then measured the same median and p90 (28 and 38 ms)
  on PR 2 and PR 3, with a tail above the p90 left open (section 1a, open risks). Repeat S3 with
  `--switch-via store` for CPU and a separate real-input latency run (item 48).

**The GPU-less caveat** (`~/ardia-work/media/pr3/README.md:62-77`; the two setups are described in
`docs/perf/linux-bench.md`, "Limits of comparability"). The PR 3 media run tells a different story about the whole
browser. Setup: PR 2's UI against final, 100 tabs, a 1600×1000 window, one tab loading `/slow/60000`, on **SwiftShader**
(`--use-gl=angle --use-angle=swiftshader`). Eight interleaved 8 s windows on cores 0-9, which were 78-95 % busy, with no
quiet gate, and its own process accounting (`/proc/<pid>/stat`). The bench instead ran on **ANGLE over Mesa llvmpipe**
at 1920×1080 (every result JSON's `gpu.renderer` and `implementation: (gl=egl-angle,angle=opengl)`).

| | Shell (UI) renderer | GPU process | Whole browser |
|---|---|---|---|
| PR 2's UI | 27.4-31.0 % | 174-191 % | 206-225 % |
| Final | 1.4-1.9 % | 161-212 % | 165-217 % |

- The shell's drop (about 16× in the media run, about 23× in the bench) is clear in both runs (M).
- In the media run, SwiftShader's GPU process dominates and its ranges overlap between builds, so the whole browser
  isn't shown to fall. The media says so on screen.
- **The two runs disagree on more than the GPU process.** The GPU process is about 16× larger in the media run
  (161-212 % against 8.8-11.0 %). The shell's own baseline is about 4× smaller there: PR 2's UI shell is 27-31 % in the
  media run against 100-114 % in the bench's S6.
- **The first candidate cause is the renderer.** The two setups used different GL backends (M for the difference:
  SwiftShader against llvmpipe); how much of the gap it explains is H. Window size, busy cores and the real slow page
  differ too. Lead 34 varies the renderer first.
- **H: frame back-pressure**, second, for the shell's 4× smaller baseline. When the GPU process saturates, frames drain
  slowly and the shell's per-frame work is throttled with them. If so, the shell's cost, and PR 3's saving, scale with
  how fast frames drain, and a 120 Hz Mac display could see a larger saving.
- **This report doesn't adopt the media README's reading** that "the loading animation's cost moved from the shell to
  software compositing". The README's own GPU ranges overlap between builds (174-191 % against 161-212 %), so they
  are inconclusive, not evidence of a move.
- **What can be claimed:**
  - the shell's per-frame loading work is gone (counts at 0/s, M); the saving per second depends on frame rate (H);
  - the whole-app drop is measured only on the bench's Xvfb + ANGLE/llvmpipe setup;
  - on SwiftShader the whole browser isn't shown to fall; on a real GPU, and on the Mac, it is unmeasured.

What PR 3 leaves:
- **Loading:** the shell costs 4-5 % at N = 100 (bench). What's left of the whole app's 24-31 % is the browser
  process (11-14 %) and the GPU process (9-11 %), both engine-side. The round-1 minimal-shell probe (old engine,
  N = 10, n = 2) put C4 (item 19) at +9.5 browser and +12 GPU points. The bench confirms the browser part (S6 browser
  11-14 % against 0.3-0.6 % in S2, M) but not the GPU part: S6's GPU process is the same as S2's (9.7-11.8 %). So
  item 19's recoverable share on the final build is about the browser's 8-10 points (H), not a GPU saving.
- **Interactions are now the largest shell costs:**
  - edge reveals (S4): 32.5-36.6 % of a core;
  - switching (S3): 25.5-29.5 %;
  - hover (S5): 13.8-18.4 %.

  Item 48 profiles them on the final build; item 52 (`mountLayout`'s first settle) and item 11 (the session merge)
  are the next hypotheses for switching, and item 28 for reveals.
- **E5** didn't change switching cost: through the store, 28.9 vs 28.4 % of shell CPU.

## 2. Method and evidence base

**Machine (all measurements):**

| | |
|---|---|
| Host | a KVM VPS: AMD EPYC 9645, 16 vCPU (no SMT), 62 GiB, Ubuntu 26.04.1, Linux 7.0.0-43 |
| Shared | other agents' builds, tests, ClickHouse and benchmarks |
| Isolation | no `isolcpus`; `perf_event_paranoid` = 4, so no hardware counters |
| Display | Xvfb 1920×1080, no window manager, no vsync |
| GPU | The bench: ANGLE on Mesa llvmpipe (`gl=egl-angle,angle=opengl`, in every result's `gpu.renderer`). The media runs only: SwiftShader (`--use-angle=swiftshader`) at 1600×1000 |
| Input | real X input through xdotool |
| Pinning | app on cores 10-15 for the baseline and the final partitioned bench (a cgroup; foreign CPU median 0.55 % per window, at most 22.1 %); cores 0-9, shared, for the Phase 3 experiments, the integration and the media run (78-904 % foreign CPU) |

**Builds:**
- Stock: `3043ac26b`.
- Profiling build: `e522661dd` (`builds/perf-r1*`).
- Phase 3 base and PR 2's UI: `48c7e3e67` (`builds/bun/linux-ui`; its dist is byte-identical to the pnpm build of `50a1ef106`).
- PR 1: `50a1ef106` (`builds/feature/linux-ui`). PR 1's head is `6d9c3956c` and PR 2's `db3139706`; both add #1679 after
  the measured builds. Integration: `e02d6c59c` (`builds/p3-int`). Final: `2e9c24a46` (`builds/final`); PR 3's head is
  `d3a803217` (see "What final means" at the top).
- One build per experiment: `builds/p3-e{1..6}`.
- Engine: `engine-3a64a10704ff` (Chromium 157.0.8103.50) for every run. It is 47 key-moving engine commits behind the UI
  (verified: `engine/engine-key.sh` walked back over `git log` to the first commit with a published key).

**Harness:** `apps/linux/scripts/perf/bench.mjs` (in PR 3 since `a7abec0e0`; what it measures, the recipe for PR 3's
four-build run and its limits are in `docs/perf/linux-bench.md`). The runs here used the same harness before it moved
into the repo. `82b4f2c2f` then changed S3's and S4's workload accounting (S4 now reads a row after each hold), so new
S4 CPU figures aren't comparable with this report's.
- Scenarios:
  - S1 idle;
  - S2 active split;
  - S3, 40 ctrl+Tab switches;
  - S4, 20 edge reveals;
  - S5, a hover sweep of 24 rows × 3;
  - S6, the active tab loading in the default layout;
  - S7, the same with the loading pill.
- Fixture tabs: 70 % static, 20 % ticker, 5 % rAF canvas, 5 % heavy.
- Two instrumentation levels: `light` for CPU and RAM, `full` for counters, long frames and latency.
- The quiet gate waits for idle cores before each window.
- Other tools: the round-1 probes (`probe-run.mjs` loading and title variants, `memlab.mjs`, `heapan.mjs`, `ix.mjs`,
  `idle-probe*.mjs`) and the experiments' own probes.

**Noise floor** (gated A/A, 3 launches per side, `bench-noise-floor.md`):

| Metric | Floor |
|---|---|
| Memory at rest | 1.8 % PSS, 1.2 % USS |
| S3 CPU | ~9 % |
| S4 CPU | ~15 % |
| S2 and S5 CPU | 18-22 % |
| S1 idle CPU | unusable as a % (±1 point of a core) |
| S3 key→shown latency | 5.5 ms |
| S4 reveal latency | 13 ms |
| S5 cold hover card | 15 ms |
| `capturePicture`, `tab.viewport`, host events | exact (0) |
| DOM counters in S3-S5 | 2.5-9 % |

The Phase 3 experiments ran on shared cores 0-9 (load 3-66). They called a gain only when ranges separated with n ≥ 4.
Counts repeat to the digit. That is below the noise-floor report's own bar for small CPU differences (at least 6
launches per side and a second interleaved round under about 10 % in S3 and S4, or 20 % in S2 and S5); section 1b
names the two results it affects.

**What was measured and what was read:**
- **Measured:**
  - Linux CPU, RAM, counters and latency at N = 1, 20, 50 and 100;
  - churn of 6 cycles × 50 tabs;
  - load storms of N tabs;
  - GPU quads and frames;
  - the engine's periodic bursts.
- **Measured for this report:**
  - the repo's `micro-bench.mjs` (omnibox, entries);
  - a scratch micro-bench of the Linux session merge at 101 and 1,010 tabs, against a memoised variant
    (`scratch/session-bench*.mjs`, `*.out`);
  - the key distance of the prebuilts;
  - the `ardia` CLI's start-up (`ardia --help`, n = 5) for the Rust section.
- **Re-checked at `2e9c24a46`:** every reliability and Rust finding used here, `test:host` (98 files),
  `loadedTabBudget.ts`, `snapshotHostSession`, the Linux session read and write path, both document stores' name
  rules, `checks.yml`, the engine sampler, the Windows feature flags and system state, `packages/ardiacore/scripts/ubo*.sh`,
  `docs/agent-brief.md`'s selector rule, and the Mac and Windows docs.
- **Re-checked at `d3a803217`:** the consent helpers, `hourlyExtras.ts` and its sources (item 1), and the in-repo
  harness and `docs/perf/linux-bench.md`.
- **Regenerated:** section 1b's partitioned bench, from its per-launch JSON (appendix 7).
- **Read only:** every Mac and Windows path (architecture-ipc F4-F8 and F11, rendering-state R1-R11) and the sync
  implementations.

**Limits:**
- Linux only for this audit's measurements. The Mac is the main app, and none of these CPU numbers transfer to it.
  C3-C7 are Linux-specific mechanisms. Of Phase 3's fixes, E1-E5 and `368694d01`'s shell counts are Linux-only; only
  E6's shared changes (`SelectedRowPill`, `ListMotion` pruning) reach the Mac. The Mac did run PR 1's checks on
  2026-11-18: A to G passed except a tab-drag peek bug that
  predates PR 1 (#1679), which PR 1 now fixes (30/30 in 5 of 5 runs). That run used a Debug build with a test-only
  shim, because the nearest prebuilt Mac engine lacks two `ArdiaCore.h` members (item 10). PR 2 wasn't run on the
  Mac at all (section 6 item 12).
- No Windows run. The Windows rows (items 17, 24, 26, and part of 25) come from reading code and counting files. A
  Windows performance or reliability angle (a Windows VM with the tours and a tab-count sweep) was not attempted; it
  is a gap, not a finding that Windows is fine (item 51).
- Xvfb with software GL: GPU and frame-gap numbers are relative between builds only. The backdrop finding (C7) may
  shrink on a real GPU.
- One window and N ≤ 100: the multi-window cost (each Linux window is its own renderer and store) and the cost at
  field tab counts are unmeasured (item 50).
- The old engine (`3a64a10704ff`) affects both sides of each A/B alike, but engine-side findings (C4, TabMemoryMetricsReporter)
  are of that engine.
- Field data (tab counts of 1,383 to 3,051) comes from a Mac commit message (`38c49fd91`), not from this audit.

**Mac evidence already in the repo** (historical; not re-run for this audit). The release gates measure the Mac with
`native-bench`, interleaved against the previous release (`docs/perf/0.2.44-to-0.2.45.md`, 20 gate files in
`docs/perf`):
- launch to window shown 451 ms (427-480, n = 6); with its content 570 ms;
- idle CPU at 20 tabs 0.74 % (0.72-0.77, n = 2);
- memory 288 / 698 / 918 MB at 1 / 10 / 20 tabs (n = 2), so 22-46 MB per added tab, against the Linux fixture's
  12.2-12.6 MiB per page renderer;
- memory after closing back to 1 tab 610 MB (369-852, n = 2);
- tab switch to shown 9 ms.

`docs/perf/launch-critical-path.md:95-107` measures large-session launch: about 200 sidebar rows add +420 ms from first
commit to content (native view creation), and a four-window profile adds +770 ms to window key. What the repo lacks is
anything at 50 or 100 tabs, while a tab loads, or in the interactions PR 3 targeted (item 49).

## 3. Ranked recommendations

The full ranking, 58 rows. Ties follow the stated rule: higher impact first, then the lower item ID. The Item column
is the stable ID used in every cross-reference. Items 22-27, 32-35, 38 and 40-47 are short items, in the table at the
end of this section; the detailed sections below run in item order.

**Scale caveat.** Scores assume what was measured: Linux, N ≤ 100, one window, software GL. Items 11, 12, 22, 45 and
47 matter mainly at larger tab counts or with several windows; re-score them after item 50 (and items 18, 45, 46 and
47 after item 49).

| Rank | Item | Recommendation | I | E | F | R | Score | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | 1a | Consent: one gate in `takeHourlyExtras`, and `consentedCount` needs both flags (Linux multi-window) | 3 | 3 | 1 | 1 | 9.0 | E1, E5, integration, `d1fdb96ce`, final review |
| 2 | 48 | Profile S3, S4 and S5 on the final build | 3 | 2 | 1 | 1 | 6.0 | bench, council |
| 3 | 4 | Test discovery and the orphan check | 2 | 3 | 1 | 1 | 6.0 | maint, Phase 2 |
| 4 | 10c | Mac: engine skew preflight at launch | 3 | 3 | 1 | 2 | 4.5 | Mac verification |
| 5 | 49 | Mac baseline at scale (50-100 tabs, loading, restore; blocked on Mac access) | 4 | 2 | 2 | 1 | 4.0 | `docs/perf`, council |
| 6 | 3 | ⌥-click on Linux | 2 | 2 | 1 | 1 | 4.0 | Phase 1 |
| 7 | 6 | F23 discard race | 2 | 2 | 1 | 1 | 4.0 | E5, integration |
| 8 | 7 | RAM line: measure the cold first reply, then return early | 2 | 2 | 1 | 1 | 4.0 | round 1, PR 3 media |
| 9 | 8 | Docs: a path check for docs, AGENTS.md and skills | 2 | 2 | 1 | 1 | 4.0 | maint §13 |
| 10 | 10a | Engine: per-platform key | 4 | 3 | 2 | 2 | 3.0 | maint §4 |
| 11 | 1b | Consent: one declared-counter primitive and a two-window fixture | 3 | 2 | 2 | 1 | 3.0 | maint §8, E1, E5 |
| 12 | 12 | ListMotion: cull off-screen slides | 3 | 1 | 1 | 1 | 3.0 | rendering |
| 13 | 50 | Linux at N = 300 and 1,000, three windows, start and restore | 3 | 2 | 2 | 1 | 3.0 | council |
| 14 | 15 | One shared web-shims package (Linux and demo) | 2 | 3 | 2 | 1 | 3.0 | maint §3 |
| 15 | 17 | Windows: unit tests for `packages/expo-windows` | 2 | 3 | 2 | 1 | 3.0 | maint §7 |
| 16 | 18 | Hidden-tab budget (policy) | 4 | 2 | 1 | 3 | 2.67 | round 1 |
| 17 | 5a | Session file on Mac and Windows: set aside what can't be read (JS) | 4 | 1 | 1 | 2 | 2.0 | reliability R2 |
| 18 | 10b | Engine: nightly prebuilts (needs a Mac builder) | 4 | 3 | 3 | 2 | 2.0 | maint §4 |
| 19 | 2b | CI: fold the four browser shards after Bun | 2 | 1 | 1 | 1 | 2.0 | maint §1, Phase 2 |
| 20 | 9 | Flaky `browserCommandRoute.test.mjs` | 2 | 1 | 1 | 1 | 2.0 | 2026-11-18 runs |
| 21 | 11a | Linux session merge: memoise (step 1 alone) | 2 | 2 | 1 | 2 | 2.0 | this audit |
| 22 | 16 | Engine: turn off TabMemoryMetricsReporter (ride-along) | 2 | 3 | 3 | 1 | 2.0 | round 1 |
| 23 | 22 | Sidebar entries recomputed for every window (R11) | 2 | 1 | 1 | 1 | 2.0 | rendering |
| 24 | 23 | Git guard hook: the three incident rules | 2 | 1 | 1 | 1 | 2.0 | maint §11 |
| 25 | 24 | Windows memory pressure: flag off, engine reports it | 2 | 1 | 1 | 1 | 2.0 | this audit |
| 26 | 25 | Tab-strip protocol: acknowledge in the reply, time out | 2 | 1 | 1 | 1 | 2.0 | reliability R6 |
| 27 | 26 | Windows import: decode in the C++ host | 2 | 1 | 1 | 1 | 2.0 | Rust F2 |
| 28 | 27 | Sync format: one vector set for every implementation | 2 | 1 | 1 | 1 | 2.0 | Rust F5, maint §12 |
| 29 | 51 | Windows: CPU and RAM from the CI tours | 2 | 1 | 1 | 1 | 2.0 | council |
| 30 | 2a | CI: measure the queue by workflow, then coalesce Checks (upstream) | 3 | 1 | 1 | 2 | 1.5 | maint §1 |
| 31 | 11b | Linux session merge: memoise and keep identities | 3 | 2 | 2 | 2 | 1.5 | this audit |
| 32 | 13 | Failure telemetry for persistence and restore | 3 | 1 | 2 | 1 | 1.5 | reliability R3 |
| 33 | 14 | Startup: isolate each starter | 3 | 1 | 1 | 2 | 1.5 | reliability R5 |
| 34 | 19 | Engine: Chrome's hidden toolbar repaint (C4) | 3 | 2 | 2 | 2 | 1.5 | round 1, bench |
| 35 | 28 | Linux reveal: the white page frames | 3 | 2 | 2 | 2 | 1.5 | Phase 1, PR 3 media |
| 36 | 29 | Linux: compositor driver for transform and opacity Animated | 3 | 2 | 2 | 2 | 1.5 | E2 |
| 37 | 30 | Engine: Linux page capture | 3 | 3 | 3 | 2 | 1.5 | Phase 1 |
| 38 | 31 | Linux adapter manifest and drift guard | 3 | 2 | 2 | 2 | 1.5 | maint |
| 39 | 32 | Kill switches: room, and a reliability class | 3 | 1 | 1 | 2 | 1.5 | reliability R4 |
| 40 | 33 | Persistence and lifecycle conformance pack | 3 | 1 | 2 | 1 | 1.5 | reliability R7 |
| 41 | 34 | Mac native lifecycle checks in CI | 3 | 1 | 2 | 1 | 1.5 | reliability R8 |
| 42 | 35 | Hang telemetry | 3 | 1 | 2 | 1 | 1.5 | reliability R10 |
| 43 | 52 | `mountLayout`'s first settle | 3 | 2 | 2 | 2 | 1.5 | E6, round 1 |
| 44 | 36 | Lean hidden panes and a thinner `MacView` | 2 | 3 | 2 | 2 | 1.5 | round 1 |
| 45 | 21 | Sync: a deterministic multi-device simulation | 4 | 1 | 3 | 1 | 1.33 | reliability R9 |
| 46 | 5b | Session file on Linux: keep malformed bytes, no lossy downgrade | 4 | 1 | 2 | 2 | 1.0 | reliability R2, council |
| 47 | 20 | Launch guard on Mac and Linux | 4 | 1 | 2 | 2 | 1.0 | reliability R1 |
| 48 | 38 | History: stop copying 100k entries into every JS heap | 4 | 1 | 2 | 2 | 1.0 | Rust F1 |
| 49 | 39 | Engine: Linux bridge and session protocol | 3 | 2 | 3 | 2 | 1.0 | arch, E4 |
| 50 | 40 | Shell backdrop over the page (C7) | 2 | 3 | 2 | 3 | 1.0 | round 1 |
| 51 | 41 | Shared UI: an `exports` map as the package boundary (step 1) | 2 | 1 | 1 | 2 | 1.0 | maint §14 |
| 52 | 37 | Engine: Linux cross-window tab ids in `engine.tasks` (ride-along) | 1 | 3 | 3 | 1 | 1.0 | docs |
| 53 | 42 | Switcher card rebuilds its data URI per render (R10) | 1 | 1 | 1 | 1 | 1.0 | rendering |
| 54 | 43 | Mac demo icon check | 1 | 1 | 1 | 1 | 1.0 | Mac verification |
| 55 | 44 | Mac `engineError` re-parses whole replies | 1 | 1 | 1 | 1 | 1.0 | Rust F11 |
| 56 | 45 | Sidebar and strip windowing | 4 | 2 | 3 | 3 | 0.89 | Mac field data |
| 57 | 46 | Mac dock slide and `Fold` animate layout (R5) | 3 | 1 | 2 | 2 | 0.75 | rendering |
| 58 | 47 | Drag pickup measures every row (R8) | 2 | 1 | 2 | 2 | 0.5 | rendering |

**Where the formula undersells reliability.** Every reliability item is code-verified, not measured, so each has
evidence 1, and those touching migrations, launch or sync carry risk 2. Items 5a, 5b, 20 and 21 guard against total
tab loss, an app that won't open, and sync data loss. Each incident there is severe, but nobody has measured how often
one happens. Item 13 is what would measure it, so do item 13 together with items 5a and 20. Section 1a's
impact-first view lists them as one bundle.

**How engine items are scored for effort.** An engine patch that rides a release something else triggers is scored
effort 2. A patch that would never justify a release by itself is marked **ride-along only** and scored standalone,
at effort 3: items 16 (2.0; 3.0 in a batch) and 37 (1.0; 1.5 in a batch). Items 19 and 39 are the patches that could
trigger a release; items 30 and 39 are effort 3 for their engine-side feature work. Item 5b's Linux host change also
rides a release.

**The engine release itself is a recommendation, with a trigger:** cut one Linux engine release when item 19 or item
39 is greenlit, and carry items 5b, 16, 30 and 37 in it. Until then none of the ride-along patches should be built.

**The cost of any engine change** applies to items 5b, 16, 19, 30, 37 and 39.
- `engine/engine-key.sh` hashes all of `engine/` plus the offline game. So any change under `engine/`, Linux-only or
  not, needs both:
  - a new Mac engine: an incremental build on the Mac, holding the chromium lock (about 7 min plus the ThinLTO
    relink; a first build about 2.5 h, `docs/engine-build.md:416`);
  - a new Linux engine: built on a Boat builder VM (`scripts/linux/build.sh --apply`), published with
    `publish-engine.sh --upload`, plus a TSV row.
- Release CI fails without a Mac prebuilt for the key.
- Since 2026-10-29, 80 of 185 engine commits (43 %) changed one platform and still moved both keys
  (maintainability-tooling §4).
- **Recommendation:** batch them into the one Linux engine release above, which then costs one Mac engine. Better
  still, do item 10a first, so that Linux-only changes stop costing a Mac engine.
- Windows' engine lives in `scripts/windows/engine/` and is unaffected.

### Item 1. Telemetry consent: one gate where the hourly counts are taken (1a), then one consent-safe counter (1b)

- **Subsystem:** `apps/browser/src/state/telemetry/` (`hourlyExtras.ts`, `consentedCount.ts`, `client.ts`). The code is
  shared, but the leak needs the follower-to-leader relay, which only Linux installs (`setTelemetryRelay` is called
  only from `apps/linux/src/hostTelemetry.ts`). A follower's `capture` hands every event to the relay without checking
  its own choice (`client.ts:131-132`), and the leader checks only its own. So the open defect is **Linux multi-window
  only (C)**; the Mac and Windows have no relay, and their consent boundary drains counts at each change.
- **Bottleneck:**
  - **C:** `takeHourlyExtras` spreads 23 takes from 22 source modules into each hourly `usage_counts` event
    (`hourlyExtras.ts:30`). At `d3a803217`, 18 of the 22 have no consent check in their own file (a grep of each for
    `consentedCount`, `sharingAgreed`, `isSharing`, `sameSharingPeriod`, "sharing" or "consent"; delegated platform
    modules were not traced). They count whatever the choice. `shellCounts` drains every source and returns counts
    only under `sharingAgreed()`, at take time; `sessionWrites`, `tabReleaseCounts` and `inputSourceKeys` gate when
    they note.
  - **M (pending opt-in, reproduced at `d3a803217`, a scratch test, n = 1 run):** the same doubles as PR 3's
    `shellCountsConsent.test.mjs`: a real `BroadcastChannel`, production `choice`, `relay` and `hourlyExtras`, and a
    modelled leader. A follower with sharing off calls `noteFind` three times, the leader opts in, and the follower
    flushes before it applies the opt-in. The leader's queue receives `{"find_opens":1,"find_steps":2}`. `findCounts.ts`
    and the relay path are on stock `3043ac26b`, so this predates PR 3. It was not run on two live windows.
  - **C (delayed opt-out):** `consentedCount()` counts while `isSharing()`, the saved choice, is true, and resets when
    the shown switch flips (`consentedCount.ts`). On a Linux follower the shown switch flips at once and the saved
    choice catches up later, so a count noted in between survives the reset. `d1fdb96ce` added `sharingAgreed()` (both
    flags) to the same file for `sessionWrites` and `tabReleaseCounts`, but `note` and `add` still check only the saved
    choice. `notificationRequestCounts.ts` (two counters) and `webNotificationCounts.ts` (one) use them; not reproduced.
    `notificationRequestCounts.ts`'s third counter, `notification_requests_auto_denied`, has no consent check at all.
  - **PR 3 fixed this class four times, one counter at a time** (M, each reproduced by a test that was red before its
    fix):
    - **Delayed opt-out** (E5 round 2, `host_tab_releases`). The test (`real-follower.test.mjs`) uses an injected
      channel and replays the captures by hand. E5 fixed only `tabReleaseCounts.ts`, with a both-flags rule.
    - **Pending opt-in** (E1 round 2, E1's frame counts), with a real `BroadcastChannel` and production `choice`,
      `relay` and `hourlyExtras`.
    - **Pending opt-in** (the integration, `368694d01`): E3's `linux_switch_aheads` went through `platformCounts.ts`
      with no gate.
    - **Pending opt-in and delayed opt-out** (`d1fdb96ce`): E4 made every Linux window count acknowledged session
      saves through `noteSessionWrite`, which had no consent check, and `takeHourlyExtras` spread them ungated
      (`session_writes`, `session_cosmetic_writes`, `session_kb_written`). Shell counts leaked after an optimistic
      opt-out.
  - Two older bugs are the same class (a count crossing a consent boundary) by a different mechanism: E1 round 1 (a
    long-animation-frame record from before a consent change counted after it, `e1-result.md:55`) and Phase 1's G-03
    (work in flight across an opt-in, fixed with `sameSharingPeriod`, `phase1/integration.md:258`).

  Every new counter re-derives consent by hand, which is why the class keeps coming back.
- **What blocks a fix today:** nothing technical. No experiment owned the shared path, so each fixed its own counter.
- **Already done (in PR 3, not yet on `main`):** `368694d01` replaced E1's and E3's counters with
  `apps/browser/src/state/telemetry/shellCounts.ts`: named sources, drained on every hourly take. `d1fdb96ce` made that
  take return counts only under `sharingAgreed()`, which is 1a's rule for one module. `shellCountsConsent.test.mjs`
  covers the frame and switch-ahead sources, a follower's session writes and an optimistic opt-out.
- **Proposed solution:**
  - **1a (scored I 3, E 3, F 1, R 1 = 9.0).** One gate at the choke point. `takeHourlyExtras` drains every source and
    returns nothing unless `sharingAgreed()`, as `takeShellCounts` already does, so a count from before a consent change
    never reaches the next period. Also make `consentedCount`'s `note` and `add` require `sharingAgreed()`, for the
    delayed opt-out on the counters outside the hourly extras, and decide whether
    `notification_requests_auto_denied` should be gated. The rule is inert on the Mac and Windows. Consider landing it
    in PR 3, which already carries the per-counter fixes.
  - **1b (scored I 3, E 2, F 2, R 1 = 3.0).** One `defineCount(key, { copy, section })` primitive, grown from
    `shellCounts.ts`. It owns consent gating, the reset on a sharing flip and the follower relay, and "What's Sent"
    renders from those declarations. This is maintainability-tooling §8. It is a maintainability item that every
    platform's code benefits from, even though only Linux has the relay. It also removes the hot-file contention: on
    2026-11-18 E1, E3 and E5 all edited `copy.ts`, and E2's telemetry had to wait for the integration because nobody
    owned `usage.ts`. A shared two-window fixture (a real `BroadcastChannel`, a follower and a leader) runs every
    hourly extra.
- **Smallest experiment:**
  - **1a.** Extend the scratch test into the two-window fixture and drive every hourly source's note function on the
    follower, in three cases: pending opt-in, delayed opt-out, and a valid post-consent control.
    - Pass: no key in the leader's queue in the first two cases, and exactly the control's keys in the third.
    - Today the pending opt-in case fails on `find_opens` and `find_steps` (M); expect more ungated keys once every
      source is driven.
    - Separately, run the notification counters through the delayed opt-out case, and check
      `noteNotificationRequestAutoDenied` with sharing off: today it counts (C).
  - **1b.** The What's Sent text rendered from declarations equals today's on all three platforms
    (`platformWording.test.mjs` green, and a snapshot diff of the rendered list is empty). A test that enumerates the
    hourly payload keys finds none without a declaration, and every declared counter runs through the fixture.
- **Impact:** 1a is moderate (3): it keeps the consent model honest (AGENTS.md: "sharing on only") for every hourly
  count from a Linux user with several windows, not only the counters fixed so far. 1b ends a review finding that
  repeats in every telemetry change; moderate.
- **Effort:** S for 1a. M for 1b, because the What's Sent copy has to be regrouped and the fixture built.
- **Risk:** low. 1a sends less, never more. The privacy copy is user-facing, so diff the rendered list before and
  after 1b.

### Item 2. CI queueing: measure first (2a), then fold the browser shards (2b)

- **Subsystem:** GitHub Actions, `.github/workflows/checks.yml` and the hosted-runner pool every PR workflow shares
  (maintainability-tooling §1). **Where it was measured:** the upstream repository, `mantrakp04/ardia`, not the fork
  this PR lives in. On the fork every PR workflow runs for the owner's PRs (section 6 item 11), and its queue is
  unmeasured and likely small. Changing upstream's CI is an upstream-maintainer decision.
- **Bottleneck:**
  - **M** (small sample: the latest 3 completed runs per workflow, from one 80-minute burst, `gh api …/runs/<id>/jobs`,
    2026-11-18): Checks jobs queue a median 17.8 min (max 25.3) and then run 2.5 min (max 3.4). The 6-second Linked
    issue job queued 58.8 min, longer than Checks, and Android 24.9 min.
  - **M:** 200 workflow runs were created in 80 minutes; about 67 commits a day land straight on `main`.
  - **C:** Checks' push concurrency group is per SHA (`checks.yml:31-33`), so every push to `main` runs the full
    6-job matrix (rest, 4 browser shards, bundle), each with its own checkout and install. PR runs already cancel per
    ref (`:33`). Linux, Windows and iOS group by `github.ref`, so their pending pushes coalesce.
  - **H:** that per-SHA Checks runs are the main cause. A 6-second job queuing longer than Checks points instead at
    the shared pool or the account's concurrency limit, with Checks as one contributor.
- **What blocks a fix:** a decision, and missing data. Per-commit Checks on `main` serve bisecting, and Bonzai triages
  failing deploys from per-commit results, so coalescing has a cost. The four browser shards exist because the
  Node-era suite took 144-164 s; on Bun it takes 17-20 s.
- **Proposed solution:**
  - **2a (scored I 3, E 1, F 1, R 2 = 1.5).** Step 0 is the decisive experiment: one day of `gh api` runs for all
    workflows, split by event (push or pull request), summing queued and running runner-minutes per workflow, with
    queue p50 and p90 and n. Only if Checks is the largest share: push group `checks-main` with
    `cancel-in-progress: false` (one running, one pending), plus per-PR `concurrency` groups for the vouch, CLA and
    Linked issue workflows.
  - **2b (scored I 2, E 1, F 1, R 1 = 2.0).** Once PR 2 (Bun) lands, fold the 4 browser shards into `rest`, or keep 2.
    Fewer jobs per push, whatever the cause of the queue. The suite time is measured; the queue relief is H.
- **Smallest experiment for the coalescing:** Checks listens for `push` only on `main` (`checks.yml:24-25`), so a
  branch push starts nothing. Use a branch-scoped copy of the workflow (or temporarily add the test branch to
  `push.branches`) with the new group. Hold the first run active and push 4 more commits within a minute. Pass: one
  run executes, one is pending for the newest SHA, and the three in between never start. Then compare queue p50 and
  p90 over at least 20 runs across a comparable day, before and after (H for the size of any drop).
- **Impact:** moderate for upstream contributors and agents if Checks is the driver; unknown otherwise. **Effort:** S
  (a few YAML lines, plus the measurement). **Risk:** medium for 2a: bursts lose per-commit Checks results on `main`,
  which costs bisecting and Bonzai's triage. Low for 2b.

### Item 3. ⌥-click is dropped on Linux

- **Subsystem:** Linux shell input. react-native-web 0.21.4 `Pressable`.
- **Bottleneck (C, plus a manual report):**
  - `node_modules/react-native-web/dist/modules/usePressEvents/PressResponder.js:313` calls `onPress` only if
    `event.altKey === false`, for every enabled `Pressable` click.
  - So a shared ⌥-click behaviour built on `Pressable` can't fire on Linux. One confirmed case: the split pane's ✕
    ("leave the split and keep both tabs"). Phase 1's manual checklist records it as "can't be pressed on Linux"
    (`phase1/integration.md:206`); no acceptance check failed on it, and it was not reproduced with xdotool.
  - It was not the only Linux failure in PR 1's run: acceptance F26 also failed, on a known settings-gating bug
    (§4 lead 31).
  - `apps/browser/src` has 26 non-test reads of Alt/Option modifiers. How many sit behind a `Pressable` is
    unmeasured (H), so "26 affected interactions" is not a finding.
  - The repo's RNW patch only touches the responder system. The site demo (`packages/demo`) uses the same patched RNW,
    so it likely drops ⌥-click too (H).
- **What blocks a fix:** a product question first. On many Linux desktops Alt+click and Alt+drag move the window, so
  "⌥-click" may need a different Linux modifier, the same way `shortcutText.ts` rewrites ⌘. Xvfb has no window manager,
  so it can't answer that.
- **Proposed solution:**
  1. Decide the Linux modifier (Alt, or Ctrl+Shift) and route it through `clickModifiers.ts`, which already maps
     `altKey` to `option`.
  2. Prefer a scoped fix: deliver the modified press for the handlers that read a modifier, before changing every
     `Pressable` through `patches/react-native-web@0.21.4.patch` (`PressResponder.js:313`).
  3. Add a Linux acceptance check for the modified click.
- **Smallest experiment:**
  - Scenario: on the base build, split two tabs, then Alt-click the right pane's ✕ (xdotool `keydown alt click 1`), on
    Xvfb and again on a real desktop session with a window manager (GNOME or KDE defaults).
  - Expect: nothing happens today on Xvfb; on the desktop the window manager may take the gesture before the page sees
    it.
  - Pass: with the fix, the pane leaves the split and both tabs stay (2 tabs, 0 splits) under the chosen gesture on the
    desktop, and a plain click on the ✕ still closes the pane. Check the site demo with the same gesture.
- **Impact:** small. These are Linux feature gaps for power users. **Effort:** S. **Risk:** low. A plain click is
  unchanged; the modified path is new.
- **Score:** I 2, E 2, F 1, R 1 = 4.0. Evidence is 2, not 3: the cause is read in code and the symptom comes from a
  manual report, but the failing gesture was never run.

### Item 4. Test discovery: no hand-kept lists

- **Subsystem:** `apps/linux/package.json` `test:host`, and the repo test scripts.
- **Bottleneck (M):**
  - `test:host` is an explicit list: 97 files at `50a1ef106`, 98 at the final candidate. Two suites (`telemetryChoice`,
    `themeSwatch`) run nowhere, and `packages/demo`'s `test:shims` runs nowhere.
  - The two Linux orphans were left out on purpose. Phase 2 kept them out "for parity" (`phase2/C-tests.md:62`,
    `phase2/final.md:44`), and both predate Phase 1. So turning on discovery deliberately changes what runs; it is not
    only a gap fix.
  - The hand-kept list cost work on 2026-11-18. With `package.json` frozen, E2 imported `paintMotion.test.mjs` from
    `module-graph.test.mjs` to get it run, and E3 appended tests to `tabSwitchAhead.test.mjs` instead of adding a file.
    The integration has since moved `paintMotion.test.mjs` into `test:host` (`368694d01`). E3's tests do run, inside
    a related file, so that case is maintenance friction, not missing coverage.
- **What blocks a fix:** some files must run under Node. Phase 2's `scripts/lib/bun-tests.mjs` already handles that
  with `--default=./src` plus a `--node-only` JSON list.
- **Proposed solution:**
  - `test:host` = the runner over `./src` with `host-node-tests.json`.
  - A `test:root` check that every tracked `*.test.*` is selected by some script or sits on an allowlist (about 50
    lines).
  - Then move E3's switch-ahead tests to their own file.
- **Smallest experiment:**
  - On a branch, switch `test:host` to discovery and run it.
  - Expect today's count (847 + 60 Node-only at the integration's head `e02d6c59c`, plus E4's new cases) plus the orphans' cases. The orphans may fail on
    their first run. Each of the two must end up explicitly run, fixed, deleted or allowlisted, since they were parked
    on purpose.
  - The orphan check must fail when a new `x.test.mjs` is added and not wired.
- **Impact:** small per change, but it compounds: no new test can silently not run. **Effort:** S. **Risk:** low.

### Item 5. An unreadable or newer session file is lost: set it aside on the Mac and Windows (5a), fix the Linux host (5b)

- **Subsystem:** the shared `apps/browser/src/state/session/persist.ts` and `apps/browser/src/lib/savedDocument.ts`
  (Mac and Windows); on Linux, `apps/linux/src/hostSession.ts` over the native host's `linux-session.json`
  (`engine/ardiacore-linux/src/ardia/linux/ac_linux_host.cc`). Source: reliability R2, re-checked at `2e9c24a46`. The
  two paths fail differently, so they are scored separately.
- **Bottleneck, Mac and Windows (C):**
  - `parseSaved` returns `null` for bad JSON, for a version newer than the app, and for a missing migration step
    (`savedDocument.ts:10-40`).
  - `loadSession` then returns `null` (`persist.ts:250-252`), and `startPersistence` hydrates `{}` (`:296-300`). The
    next store change saves over the file (`save`, `:316-335`).
  - The Mac writes atomically (`DocumentStore.swift:91`) but keeps no previous copy.
  - `docs/conventions.md:197-200` makes this policy: a newer version "reads as nothing … and is overwritten on the next
    save. Downgrades aren't supported."
- **Bottleneck, Linux (C for the code, H for the outcome):** Linux doesn't go through `parseSaved`.
  - The native host reads the file (`ReadSession`, `ac_linux_host.cc:758-764`) and returns nothing for malformed JSON.
    The shell then starts empty, and the next write merges over an empty previous session and replaces the file
    (`MergeAndWriteSession`, `:772-785`). The malformed bytes are gone before JS sees them, so no JS-side hook can keep
    them.
  - A newer file is not rejected. `linuxSessionShape` shape-sniffs a version at or above `SESSION_VERSION` and uses it
    as is (`hostSession.ts:143-147`), and every save stamps the current `SESSION_VERSION` (`:279`). So an older build
    likely keeps the tabs it can read and drops fields it doesn't know: a possible lossy downgrade (H).
- **How an older build meets a newer file:** `SESSION_VERSION` is 11 (`persist.ts:30`), and that line changed in 9
  commits between 2026-10-26 and 2026-11-12 (`git log -G`). Reinstalling an older DMG and a reverted version bump
  (`2ab2661df` reverted a nightly) run older code on a newer file. Moving from nightly to stable does so only while
  stable is older than the nightly that last wrote the file (H).
- **What is lost:** the open tabs and every reopen list (`closedTabs`, `closedWindows`, the cleaned tabs, parked pins).
- **H:** how often this happens. Probably rare on stable, and likelier for nightly users who switch channels. Nothing
  counts it today (item 13).
- **What blocks a fix:** the policy, and that nothing tells "no file" from "a file we couldn't read".
- **Proposed solution:**
  - **5a, Mac and Windows (scored I 4, E 1, F 1, R 2 = 2.0).** JS-only, through the existing document API. Before
    persistence starts, when the session text fails to parse or is newer, copy the raw text from
    `read(SESSION_DOCUMENT)` to `session.unreadable-v<saved version>-<stamp>.json` with `write(name, text)`
    (`packages/shell/src/documents.ts`). Both stores accept a new name: the Mac's `DocumentStore.url` takes the last
    path component, and Windows' `DocumentStore::Url` rejects only empty, dot and reserved-character names
    (`DocumentsModule.h:219-236`). If the copy can't be confirmed (`documentSaved`), freeze saving
    (`persist.ts` has a `frozen` flag) rather than overwrite. Optional later steps: a native rename and a
    once-per-launch `session.previous.json` rotation (M), and opening a newer file read-only with a notice.
  - **5b, Linux (scored I 4, E 1, F 2, R 2 = 1.0).** The host keeps malformed bytes (rename them aside in
    `ReadSession` instead of returning nothing), and the shell refuses to save over a file stamped newer than itself
    unless the user agrees. This is engine C++, so it moves the engine key and rides the batched engine release.
  - **Both:** additive fields don't need a new version if readers ignore unknown fields; a `readableBy` minimum would
    move only on a breaking change.
- **Smallest experiment:**
  - **5a.** Unit test: `startPersistence` with a fake document store whose session is `{"version": 99}`, then again
    with corrupt bytes. Today it writes the session within one save delay (C). Pass: the original text is preserved
    byte for byte under the new name before any session write; if the preservation write fails, no session write
    happens at all. Then a Mac hidden instance in a scratch data dir with the same file: open a tab, quit; the original
    survives.
  - **5b.** A Linux hidden Xvfb instance with a `"version": 99` session carrying identifiable tabs and an unknown
    field, and again with a malformed file. Record what is restored and what is written back. Pass after the fix: the
    malformed bytes survive byte for byte, and the newer file is not rewritten with fields dropped.
- **Impact:** large per incident: every tab and every reopen list. **Effort:** S for 5a; M for 5b (engine).
  **Risk:** medium (2) for both: this is migration and persistence code, which AGENTS.md puts in the Codex-review class.
  One extra file on disk; nothing is deleted.

### Item 6. Acceptance F23 races the viewport hide

- **Subsystem:** Linux acceptance (`F23`). The engine's `TabBinding::Discard`.
- **Bottleneck (M):**
  - F23 discards a tab right after activating another one.
  - The engine refuses while the old tab is still `presented || pane_visible`. The failure then cascades into 4 zoom
    checks, so a run shows 5 failures.
  - 14 interleaved runs per side: refused 6/14 on base and 9/14 on E5 (Fisher p ≈ 0.45, not significant). Another 3
    base runs (1 on E5) failed only on other timeouts (history menu jump, back history), not on the refusal. With E5's
    `discard-race` tools: 9/140 against 17/140 (p ≈ 0.15, not significant).
  - The mechanism rests on the 6 refusals that `discard-race2.mjs` timestamped (2 on base, 4 on E5): in each, the
    shell's `tab.viewport {visible:false}` went out after the discard; in every timestamped success it went out before
    (E5 §5.3). Hence evidence 2, not 3.
  - The integration rechecked it (`phase3/integration.md` §4b): `discard-race2.mjs`, 20 loops × 2 launches per side,
    refused 5/40 on base against 12/40 on the integrated stack (Fisher p = 0.099). Host load rose from 12 to 28 during
    the integrated launches and every step ran about twice as late; every refused tab discarded on the retry 1.5 s
    later. Inconclusive: it leans the wrong way, so it needs the quiet interleaved rerun the integration asked for.
  - The race is in shipping code, not only in the test: `hostViewport.ts`'s hide report lags the switch (viewport
    hide 56-118 ms after it), and the engine refuses a discard while the pane still counts as visible. The
    integration's `e02d6c59c` doesn't change this, because a visibility change is still sent.
- **Can users hit it (H):** rarely, and safely. The refusal leaves the tab loaded; nothing is lost. The loaded-tab
  budget only asks tabs hidden for 30-120 minutes (10 under memory pressure) to sleep (`loadedTabBudget.ts:23-30`), so
  it never discards within 200 ms of a switch. A user would need a discard command on a tab they left a fraction of
  a second earlier. No user report exists.
- **What blocks a fix:** nothing for the test. The engine-side queue (step 2 below) is optional and rides the engine
  release.
- **Proposed solution:**
  1. F23 waits for the old tab's hide acknowledgement (the presentation and viewport hide sends, or the engine's
     visibility) before it discards. Give it a deadline.
  2. If users can hit the same race (discard right after a switch), the engine should queue the discard until the
     pane hides rather than refuse. That would ride with the item 39 engine release (H: no user report).
- **Smallest experiment:**
  - First, the quiet interleaved rerun of `discard-race2.mjs` (base against final, about 4 launches per side, cores
    10-15) to settle whether the final shell sends the outgoing hide later than base.
  - Then run `acceptance/discard-race.mjs` (20 sequences × 4 launches) with the wait added.
  - Pass: zero refusals sent before the hide (0 of 80), and the restored tab's history correct after each discard.
    Report other failures (the history menu jump and back-history timeouts in E5 §5.3) separately; they are not this
    race.
  - Then run F23 14 times: 14/14 clean of refusals.
- **Impact:** small: a trustworthy acceptance row. Every Phase 3 experiment had to explain F23 away. **Effort:** S
  for the test. An engine change that queues discards (step 2) is not part of this score. **Risk:** low.

### Item 7. The RAM line: measure the cold first reply before changing the wait

- **Subsystem:** `state/tabs/taskSampler.ts` and `tabMemory.ts` (shared), and the engine sampler
  `engine/chromium/src/chrome/browser/ardia/ac_process.cc:95-160`.
- **Bottleneck:**
  - **C:** `sampleTasks` reads `engine.tasks`, waits until `FIRST_SAMPLE_MS = 2200` after sampling started, then
    reads again (`taskSampler.ts:3-20`). The wait exists to get a CPU figure. Workspace usage needs that figure; the
    card doesn't.
  - **M (round-1 build `e522661dd`):** reads at 2.9 s and 5.1 s after the hover started (`interactions.md:405-406`).
    With the card drawn at about 0.8-1.1 s, the value lands about 5 s after the hover, so the card shows "Memory:
    measuring…" for about 4 s.
  - **M (final build, PR 3 media):** the Heavy page card reads "measuring…" for about 2-3 s before its value
    (`media/pr3/README.md:49`; one take, from video). The card is drawn about 1.1 s after arrival on both PR 2's UI
    and final.
  - **H:** 1.3-2.2 s is only a lower bound, derived from `FIRST_SAMPLE_MS`; nothing measured it.
  - **M:** each activation keeps the engine's TaskManager observer refreshing CPU, GPU memory and memory footprint
    every 2 s for 15 s. At N = 100 (4 of 4 rounds) that costs about +0.6 % of a core of browser CPU per card, and about
    1,500 extra wake-ups per activation (`interactions.md:21`, `:421`).
- **Why the obvious fix is unsafe (C):**
  - The engine sends `memory: 0` when TaskManager has no footprint yet (`ac_process.cc:158-159`), so "the first reply
    whose footprint is finite" is satisfied by the very reply the wait is there to avoid. Zero is finite.
  - An unrelated process having a footprint doesn't make the hovered tab attributable. `attributeTabMemory` already
    returns `measuring` unless every process attributed to the tab has a positive footprint (`tabMemory.ts:62-99`),
    and `measureTabMemory` adds renderer-generation and cache checks (`:103-123`).
  - Every `engine.tasks` call restarts the engine's 15 s idle timer (`ac_process.cc:103-110`). Re-reading every
    500 ms would add reads and keep the sampler awake longer, the opposite of the goal.
- **What blocks a fix:** whether the first reply ever carries an attributable footprint.
- **Proposed solution (ranked here: the measurement):**
  1. **Gate:** on the final build, time the first attributable value for cold, warm and just-woken tabs.
  2. If the first reply is attributable often enough: memory-only callers return early when
     `attributeTabMemory` gives `exact`, `estimate` or `shared`, reusing the existing read-generation rule, with one
     bounded fallback read at today's 2.2 s. Guard reads per card and Workspace CPU sampling.
  3. If it is not: the UI-only fix is dropped, and the item becomes an engine change (answer memory-only callers on
     the first refresh, and a shorter idle stop) that rides the batched engine release, rescored at effort 2.
- **Smallest experiment:**
  - Log the raw first `engine.tasks` reply at N = 20 and N = 100 for 12 cold, 12 warm and 12 just-woken tabs; record
    hover-to-value with real input.
  - Pass for the fix in step 2: median hover-to-value under 1.2 s; `engine.tasks` reads per card no higher than
    today's 2; browser CPU per card no higher than today's +0.6 % of a core; and the CPU line in Workspace usage
    unchanged.
- **Impact:** small (2), but it is the UX of a feature shipping in PR 1. If about 4 s of "measuring…" holds on the
  final build, impact is 3. **Effort:** S for the measurement and the UI path. **Risk:** low.
- **Score:** I 2, E 2, F 1, R 1 = 4.0, for the measurement and step 2.

### Item 8. Docs point at paths that no longer exist

- **Subsystem:** `docs/`, `AGENTS.md`, `.claude/skills/**` (maintainability-tooling §13).
- **Bottleneck:**
  - **M:** a scan of backticked and linked repo paths in 76 docs found 47 that don't resolve. About 15 are build outputs
    (false positives), so about 30 are real drift. The split was made by hand, so the real count is approximate.
  - Examples: 13 in `docs/phone.md` (`apps/ios`, `apps/android`, `docs/android.md`); `packages/cef` in four docs
    including `agent-brief.md`; `docs/testing.md` and `docs/sync.md` pointing at a moved script.
  - **C:** the prebuilt TSV header names `scripts/fetch-engine.sh`, while the script is
    `packages/ardiacore/scripts/fetch-engine.sh`; the same header says the key is "engine/'s git tree", but it also
    covers the offline game (`engine-key.sh:10`). That is the doc a contributor reads for item 10's problem.
  - Agents read these docs first: the docs total 17,687 lines.
- **What blocks a fix:** nothing; nothing checks them.
- **Proposed solution:** a `test:root` check that every backticked repo path in `docs/**`, `AGENTS.md` and
  `.claude/skills/**` resolves, with an allowlist for build outputs. Fix the 30 once.
- **Smallest experiment:** run the scan as a test on `main`. Pass: it lists the known 47, takes about 1 s, and fails
  when a doc gains a path to a deleted file.
- **Impact:** small per reader, but every agent session starts from these docs. **Effort:** S. **Risk:** low.

### Item 9. A flaky Linux host test: `browserCommandRoute.test.mjs`

- **Subsystem:** `apps/linux/src/browserCommandRoute.test.mjs` (121 lines), one of the 98 files in `test:host`
  (`apps/linux/package.json:11`, which runs them with `--parallel --timeout=0`).
- **Bottleneck:**
  - **M (observed, not counted):** it failed intermittently in full Linux host suite runs under load on 2026-11-18,
    with other agents' builds and benches on the same cores, and passed alone 6/6 on stock and on PR 1. The failure
    rate wasn't counted.
  - **C:** it runs real-time windows over a real `BroadcastChannel`:
    - gather windows (`gatherMs`) of 20-50 ms and answer windows (`answerMs`) of 20-100 ms;
    - a late claim sent at 80 ms;
    - fixed waits of 30-150 ms (`settle`, `:15`, used through `:114`).

    On a loaded host, a message delivered after its window changes which window answers.
  - **H:** that these windows are the cause. The failing assertion wasn't captured, so a real routing regression that
    shows only under suite load is not ruled out. A standalone pass is triage evidence, not grounds to dismiss a
    failing suite.
- **What blocks a fix:** the missing assertion. Capture it first.
- **Proposed solution:** a fake clock alone doesn't make a real `BroadcastChannel` deterministic, because delivery is
  still asynchronous. Give the ordering tests a test-owned clock and a controllable transport (or explicit delivery
  acknowledgements), and keep one real-channel smoke test. `routeToBrowserWindow` takes its timer and transport from
  the caller. This is the same family of fix as the 7 × 1.1 s real waits in maintainability-tooling §10.
- **Smallest experiment:**
  - Before: run `test:host` 20 times while `stress-ng --cpu 10` loads cores 0-9; record the failure rate and the
    failing assertion. If the assertion points at routing rather than timing, this becomes a bug, not a test fix.
  - Pass: 0 of 20 after the change, the real-channel smoke test still passes, and the file runs faster, because it no
    longer sleeps.
- **Impact:** small, but the cost recurs: every red suite under load costs an agent a rerun and erodes trust in the
  suite. **Effort:** S. **Risk:** low.
- **Score:** I 2, E 1, F 1, R 1 = 2.0. Evidence is 1 until the failing assertion is captured.

### Item 10. Engine keys and prebuilts: contributors run stale engines (10a key, 10b prebuilts, 10c Mac preflight)

- **Subsystem:** `engine/engine-key.sh`, `packages/ardiacore/prebuilt-engines*.tsv`, `fetch-engine.sh --nearest`, and
  the Mac app's launch against `ArdiaCore.h` (`packages/ardiacore/ios`).
- **Bottleneck (M, verified 2026-11-18):**
  - The nearest prebuilts trail `50a1ef106`:
    - Mac: `8b7edf233fae`, 44 key-moving commits behind (at `991f98e9e`, 2026-11-15);
    - Linux: `3a64a10704ff`, 47 behind (at `1bd3ca961`, 2026-11-15).
  - The Mac prebuilt's `ArdiaCore.h` has neither `pictureInPictureCloses` nor `preloadPages` (0 matches at
    `991f98e9e`, 2 at HEAD). The app calls new selectors directly by design (`docs/agent-brief.md:129-132`: "the app
    calls new selectors directly (no `respondsToSelector:`)"), so a stock Debug app crashes at launch on that prebuilt.
    PR 1's Mac verification needed a test-only shim for it.
  - One key covers both platforms: 43 % of engine commits since 2026-10-29 moved the other platform's key for
    nothing (maintainability-tooling §4).
  - Every Linux result in this report ran on an engine three days old. An engine-touching PR can't be tested off the
    Mac, and Linux contributors have no Chromium tree.
- **What blocks a fix:**
  - The key is a git tree hash, which is simple and robust. A per-platform key needs an exact list of the inputs each
    platform's build reads, and `scripts/linux/syntax_check_156.py:66` reaches into Mac sources.
  - Nothing publishes a prebuilt for every key. The Mac engine is built only on the owner's Mac, with its
    `~/chromium-build` cache, under the chromium lock: a first build takes about 2.5 h and an incremental one about
    7 min plus the ThinLTO relink (`docs/engine-build.md:416`). No CI job builds the Mac engine.
  - In a fork, publishing prebuilts into upstream's TSV is not the fork owner's to do.
- **Proposed solution:**
  - **10a. Per-platform key (scored I 4, E 3, F 2, R 2 = 3.0).** `engine-key.sh --platform mac|linux` hashes the
    `series` lines that apply to the platform, that platform's layer folders, `engine/chromium/src` and the Mac's
    offline game, and excludes `**/tests/**`, `*.md` and the Python test tooling. Get a Codex review (build and
    release logic).
  - **10b. Nightly prebuilts (scored I 4, E 3, F 3, R 2 = 2.0).** A nightly job that builds and publishes the engine
    for `main`'s key on each platform when it lacks one, so the nearest engine is at most a day old. It needs a named
    Mac builder: a dedicated macOS machine with a warm Chromium tree, or a scheduled job on the owner's Mac under the
    chromium lock. Linux can use the Boat builder VM. A CI smoke job that launches the current UI on the newest
    published prebuilt belongs with item 34's macOS job.
  - **10c. Mac skew preflight (scored I 3, E 3, F 1, R 2 = 4.5).** No engine change. At launch, compare the prebuilt's
    key (or the presence of the members JS needs) with what the app was built for, and fail with a clear message
    naming the missing members and the key to fetch, instead of crashing. Degrading with `respondsToSelector:` at
    the call sites would also have removed PR 1's test-only shim, but it relaxes the documented exact-match contract,
    so that variant needs the owner's agreement. Risk is 2 for that contract question and because this is launch code
    on the main app.
- **Smallest experiment:**
  - **10a.** Implement `--platform` as a pure function and replay it over the 185 engine commits since 2026-10-29.
    Expect about 40 % fewer distinct Mac keys and no two published prebuilts colliding on one per-platform key. The
    replay can't prove the input list complete, so also: build one deliberately mismatched pair (a Linux-only change
    that the new key says leaves the Mac alone) and check that the Mac build output is byte-identical, or that the
    build reads none of the excluded paths (a file-access trace of one Mac build).
  - **10c.** A stock Debug Mac app on `8b7edf233fae`. Today it crashes at launch. Pass: it shows the preflight
    message (or, in the degrade variant, launches with picture-in-picture closes and page preloading off), and a
    matching prebuilt launches normally.
- **Impact:** large for contributor throughput and for every engine fix in this report (10a, 10b); moderate for 10c,
  which makes the skew visible rather than removing it. **Effort:** M (10a), L with infrastructure and cost (10b), S
  (10c). **Risk:** medium: a missed input gives a stale prebuilt (10a); launch code (10c).

### Item 11. Linux session merge is O(size × depth): memoise, then diff

- **Subsystem:** `apps/linux/src/hostSessionMerge.ts` (80 lines) and `hostSession.ts` `receive`.
- **Bottleneck (M, measured for this report):**
  - Scratch micro-bench on a real saved session, cores 0-9, load 11-18, two runs each. **The runtime and revision
    weren't recorded:** the script imports the primary checkout's `hostSessionMerge.ts` (unchanged since `35e0d0b9c`,
    so the code is the same at `50a1ef106` and `2e9c24a46`) and ran under Node (V8) or Bun (JavaScriptCore); which
    one is unverified. The Linux shell runs V8 in a WebUI renderer, so the in-app cost is H until measured there:

    | | 101 tabs (47 KiB) | 1,010 tabs (441 KiB) |
    |---|---|---|
    | `JSON.stringify` | 0.05-0.08 ms | 0.40-0.60 ms |
    | `canonicalSessionValue` (sorted keys) | 0.47-0.69 ms | 5.2-7.5 ms |
    | `mergeSession`, one title changed | 3.0-4.3 ms | 48-58 ms |
    | `shareSessionValue`, one title changed | 2.2-2.9 ms | 41-51 ms |

  - `equalSessionValue` re-canonicalises every subtree at every level (`hostSessionMerge.ts:16`, `:36`), so a merge
    re-serialises the session about depth times.
  - E4 cut how often this runs: a save at most every 2 s for volatile changes. But every same-profile window still
    runs `receive` (merge + patch + share) on every save from any window.
  - At 1,000 tabs that is about 90-110 ms per receive per window (H for the in-app figure, and for the runtime). That
    would be a long frame on each save.
  - E4's per-tab cache "bought nothing" at 100 tabs, which fits: about 3-7 ms per save there.
- **What blocks a fix:** the merge semantics (base, local, canonical, close tokens) are subtle. The tests that pin
  them exist (`session.test.mjs`, `hostSessionMerge.test.mjs`, `hostSessionSync.test.mjs`).
- **Proposed solution:**
  1. Memoise canonical strings per object identity (a `WeakMap` in `canonicalSessionValue`; prototype in
     `scratch/hostSessionMerge.memo.ts`):

     | Path | Today | Memoised | Source |
     |---|---|---|---|
     | Warm `mergeSession`, 101 tabs | 3.0-4.3 ms | 0.6-0.7 ms | `session-bench*.out`, `cold.out` |
     | Warm `mergeSession`, 1,010 tabs | 48-58 ms | 8.2-10.2 ms (one noisy run 34.4) | same |
     | Cold `mergeSession`, 1,010 tabs (fresh objects) | 53.4-80.3 ms | 32.7 ms (one GC-noisy run 107.6) | `cold.out` |
     | Cold `shareSessionValue`, 1,010 tabs (fresh objects) | 43.3-49.5 ms | 7.1-18.4 ms | `cold.out` |

     n = 2 runs per side, load 11-18, GC-noisy. **The production path is mostly cold.** `snapshotHostSession`
     (`hostSession.ts:257-262`) copies every tab into a fresh object on each snapshot, and a received session is
     freshly parsed JSON, so a per-identity memo only stops the repeated work inside one call. Cold, memoisation gives
     about 1.6-2.5× on the merge (33 against 53-80 ms) and 2.4-7× on the share step. The warm 5-6× applies only once
     step 2 keeps identities.

  2. Merge tables of records by id, comparing records by identity first. The store keeps identity for unchanged
     tabs, but `snapshotHostSession` copies every tab, so make it reuse unchanged tab objects first.
  3. The longer-term fix is item 39: the engine sends peers a revision and changed ids, not two whole sessions.
- **Smallest experiment:**
  - Scenario: two windows of the same profile at N = 300 and 1,000 (seeded session). Retitle one background tab every
    3 s for 60 s.
  - Metric: receiving-window `receive` time per save (a CDP profile) and long frames.
  - Pass for step 1 alone: cold `receive` at 1,000 tabs at least 1.5× faster than today, merge tests green.
  - Pass for steps 1 and 2: `receive` under 8 ms at 1,000 tabs and no long frame from it. Memoisation alone can't
    reach 8 ms (cold memoised merge is about 33 ms).
- **Impact and scoring, one scope each:**
  - **11a, step 1 alone (I 2, E 2, F 1, R 2 = 2.0).** About 1.6-2.5× on the cold merge (33 against 53-80 ms at 1,010
    tabs), not the 90-110 ms to 8 ms. Small.
  - **11b, steps 1 and 2 (I 3, E 2, F 2, R 2 = 1.5).** The warm 5-6× once snapshots keep identities. Moderate for
    heavy and multi-window Linux users; at 100 tabs and one window it is small.
  - Both scores assume the measured sizes (101 and 1,010 tabs in a micro-bench); re-score after item 50's sweep.
- **Effort:** S for 11a, M for 11b. **Risk:** medium. Get a Codex review (sync and merge). Validate the end-to-end
  `receive` cost in a final-build WebUI renderer before using these numbers to rank impact.

### Item 12. ListMotion animates every row below a change

- **Subsystem:** `components/sidebar/ListMotion.tsx` (shared).
- **Bottleneck (C):**
  - `buildPlan` adds a move for every kept entry after the change (`:101-110`), and the layout effect starts one
    `Animated.timing` per move (`:261-282`). Closing the first of N tabs starts N−1 animations, visible or not.
  - On the Mac each one creates native animated nodes over the legacy bridge.
  - On Linux each is a per-frame React re-render (item 29).
  - `slides.size` is exposed in dev (`:192`) but was never measured (H).
- **What blocks a fix:** nothing. Offsets already come from state, and the scroll offset is known in
  `SidebarGeometry`.
- **Proposed solution:**
  - Entries whose old and new offsets both fall outside [scrollY − margin, scrollY + viewport + margin] jump.
  - Cap moves at about 2 × rows per viewport.
  - Count the overflow (`noteSidebarMotion("culled")`).
- **Smallest experiment:**
  - Scenario: a hidden instance (Linux Xvfb, or a Mac hidden instance) with 300 tabs. Close the first tab.
  - Metric: `slides.size` (expect about 299 today), then shell main-thread ms and long frames over the slide (the
    frame rig at 50 and 300 tabs).
  - Pass: `slides.size` ≤ 2 × the rows per viewport, and shell ms per close ≥ 50 % lower at 300 tabs. The
    `slideSettle` tests stay green.
- **Impact:** moderate at 300+ tabs. **Effort:** S. **Risk:** low: off-screen rows can't be seen moving.

### Item 13. Persistence and restore failures send nothing

- **Subsystem:** `apps/browser/src/state/session/persist.ts`, `state/telemetry/sessionWrites.ts`, and the Mac's
  `packages/shell/ios/DocumentStore.swift` and `QuitFlow.swift`. Source: reliability R3, re-checked at `2e9c24a46`.
- **Bottleneck (C):**
  - `noteSessionWrite` runs only after a write succeeds (`persist.ts:328`).
  - On the Mac, `writeDocument` queues the write and returns at once, so JS `write()` always succeeds. A real failure
    is only logged with `NSLog` and retried with a backoff of up to 60 s, forever (`DocumentStore.swift:103-105`).
  - The "can't save your session right now" alert at quit (`QuitFlow.swift:61`) isn't counted.
  - `sessionRestoredAtLaunch()` is read only by automation (`state/automation/lifecycleEvents.ts:33`).
  - `hydrate` drops saved rows whose profile or window is gone, without a trace.
  - So items 5 and 20 can't be seen in the field, and Bonzai can't watch for them.
- **What blocks a fix:** nothing technical. Each new field needs What's Sent copy and a dashboard row.
- **Proposed solution** (counts and enums only, inside the consent model, through item 1b's primitive):
  - `app_launched.session_restore`: `restored | empty | none | unreadable | newer | read_failed`;
  - counts of dropped tabs and windows at hydrate;
  - hourly `document_write_failures` and `document_write_retries`, plus an enum of which document failed;
  - `quit_save_late_alerts`.
- **Smallest experiment:** item 5a's `"version": 99` fixture, plus a scratch data dir made read-only (`chmod a-w`).
  Pass:
  - the fields appear in the local telemetry queue with sharing on, and are absent with it off;
  - item 1b's two-window fixture passes for each new count.
- **Impact:** moderate. It turns the reliability items from hypotheses into measured rates. **Effort:** M (2): Swift
  changes in `DocumentStore.swift` and `QuitFlow.swift`, What's Sent copy on three platforms, and dashboard rows.
  **Risk:** low. **Score:** I 3, E 1, F 2, R 1 = 1.5.

### Item 14. Startup is one unguarded chain

- **Subsystem:** `apps/browser/src/main.tsx`. Source: reliability R5, re-checked at `2e9c24a46`.
- **Bottleneck (C):**
  - `main.tsx:44-74` calls `installErrorReporting()`, then 25 `start*()` functions at module evaluation, with nothing
    between them; three more wait for the first window. `startPersistence` is the first (`:46`), and
    `startTelemetry` is the 21st (`:66`).
  - A throw in any starter is a JS fatal error with no window. Examples: a migration edge case, or a native module
    answering in an older shape (item 10's skew).
  - Crash reports are read on a 1 s or 5 s timer after `startTelemetry` (`usage.ts:352`), so a crash that repeats
    sooner on every launch is never reported.
  - Kill switches are fetched only after the first window, and only with automatic update checks on
    (`platform/killSwitchesLaunch.ts:6-9`).
  - On Mac and Linux this feeds a crash loop with no guard (item 20).
  - **H:** how often a starter throws in the field.
- **What blocks a fix:** nothing.
- **Proposed solution:**
  - `startAll([["persistence", startPersistence], …])` wraps each starter in try/catch. It reports
    `captureException` with the starter's name as an enum (our module names, not user data), and rethrows in
    `__DEV__`.
  - If persistence throws, hydrate empty and freeze saving, so the file isn't overwritten (item 5).
  - Read the previous crash right after `installErrorReporting`.
- **Smallest experiment, in two steps:**
  1. **Runnable now (S):** extract `startAll` and give it a Bun unit test with a throwing starter in a harness. Pass:
     later starters still run, one `$exception` with the starter's name is captured, `__DEV__` rethrows, and a
     throwing `startPersistence` leaves saving frozen.
  2. **Needs a seam first (S to build):** a scratch bundle where `startTranslate` throws. Today the instance shows no
     window. Pass: the window opens without Translate, and one `$exception` with `source=start` is queued. Repeat on a
     Linux Vite build in a hidden Xvfb instance.
- **Impact:** moderate (severe per incident, frequency H). **Effort:** S. **Risk:** medium (2): wrapping 25 ordered
  starters can leave the app half-initialised, with persistence or consent state in a combination no test covers.
  The dev rethrow and the telemetry keep errors visible; list which starters may be skipped and which must abort the
  launch. **Score:** I 3, E 1, F 1, R 2 = 1.5.

### Item 15. Two drifting copies of the web shims (Linux and the site demo)

- **Subsystem:** `apps/linux/src/shims` and `packages/demo/src/shims` (maintainability-tooling §3). Split out of
  item 31, which keeps the override manifest.
- **Bottleneck (M):**
  - 39 files share a path; 3,525 lines are identical (of 4,839 Linux lines in those files); 15 files are
    byte-identical.
  - The rest have started to drift (`macView.tsx` 0.79 similar, `chrome.tsx` 0.80), and in 6 months no commit changed
    both copies of `swipe.ts`, `pager.ts`, `chrome.tsx`, `surface.ts`, `macView.tsx`, `glassRim.ts` or `sources.ts`.
  - Phase 3's Linux shim fixes (E2's paint motion, E3's hidden panes, item 36's `MacView` work) reach only one copy.
- **What blocks a fix:** no shared home. `packages/demo` is an app (item 41), and `apps/linux` aliases its shims
  through its own Vite config. The demo's `test:shims` runs nowhere (item 4).
- **Proposed solution:** a `packages/web-shims` workspace for the identical and near-identical files. Each app keeps
  only its deltas (host webviews, `RefusedPage`, `framePool`). Generate `symbols/data.ts` once.
- **Smallest experiment:** move the 15 byte-identical files and point both Vite configs at them. Pass: `apps/linux/dist`
  and `packages/demo/dist` are byte-identical before and after (Phase 2's dist-listing harness), and `test:graph` and
  `test:symbols` pass.
- **Impact:** small to moderate: about 3.5k fewer lines, and shim fixes reach the site demo. **Effort:** M.
  **Risk:** low, checked by the dist comparison.

### Item 16. Engine: turn off Chromium's `TabMemoryMetricsReporter`

- **Subsystem:** Chromium `chrome/browser/resource_coordinator/tab_memory_metrics_reporter.cc`, through an Ardia patch.
- **Bottleneck (M):**
  - At about 1 and 5 minutes after loads, it requests 2 memory dumps per tab: 200 requests at N = 100.
  - Each burst costs 1.28-1.42 s of MemoryInfra CPU, 4.0-4.4 % of a core over a 30 s window.
  - It is linear in tabs loaded, and the same with or without the shell.
  - It exists for UMA, which Ardia doesn't upload.
  - Measured on Linux. The Mac runs the same Chromium code (H that it fires there too).
- **What blocks a fix:** it's an engine change, so it costs a new Mac and Linux engine (see the engine cost above).
  The Mac had no engine build or perf run on 2026-11-18.
- **Proposed solution:** a one-line patch that never starts the reporter, in `engine/patches/` for both platforms.
  Ship it in the batched engine release.
- **Smallest experiment:**
  - Scenario: `idle-probe` long trace (12 × 30 s) at N = 100, minimal shell.
  - Pass: 0 `tab_memory_metrics_reporter.cc` tasks and no MemoryInfra bursts; browser CPU in those windows drops by
    about 3-4 points.
- **Impact:** small (periodic): about 1.3 s of MemoryInfra CPU twice per session. **Ride-along only:** it would never
  justify an engine release by itself. **Effort:** L (3) standalone, M (2) inside a release that something else
  triggers; the patch itself is XS. **Risk:** low. **Score:** 2.0 standalone (I 2, E 3, F 3, R 1), 3.0 in the batch.

### Item 17. Windows: the TS layer has no unit tests

- **Subsystem:** `packages/expo-windows/src` (maintainability-tooling §7). The audit's only measured Windows item: no
  Windows build or run happened on 2026-11-18.
- **Bottleneck:**
  - **M (count, re-checked at `50a1ef106`):** 17,457 TS lines and 0 `*.test.*` files.
  - **C:** Windows behaviour is checked only at runtime: 52 `selfCheck/` modules run inside the app from
    `scripts/windows/launch-smoke.ps1` (`ARDIA_TEST=selfCheckStage=…`), plus the runner tours. Those jobs have 60-90 min
    timeouts (`windows.yml`). A regression in pure logic is found after a full Windows build, not in seconds.
  - **H:** several modules look pure (`engine/coverClip.ts`, `engine/keptFollow.ts`, `engine/openedTabs.ts`,
    `engine/domains/systemState.ts`'s `systemStateOf`, `defaults.ts`).
- **What blocks a fix:** much of the package calls TurboModules. The pure modules need to be picked by reading them.
- **Proposed solution:** run the pure modules' tests on Ubuntu with the shared Bun runner, in the `rest` job. Start with
  the modules whose logic is shared-contract code (system state, opened tabs, link addresses). Add a coverage floor
  later (non-gating lcov first).
- **Smallest experiment:** one test file for `systemStateOf` (memory load 84 / 85 / 95 → normal / warning / critical,
  missing readings) and one for `openedTabs`. Pass: they run in under 1 s on Linux in `rest`, and a deliberate
  off-by-one in a threshold fails them.
- **Impact:** small now; it grows with every Windows change. **Effort:** M. **Risk:** low.

### Item 18. Page renderers are 69 % of RAM: the loaded-tab budget (owner decision)

- **Subsystem:** `state/tabs/loadedTabBudget.ts:23-40` (shared) and the sleep and freeze policy.
- **Bottleneck (M):**
  - At N = 100: 1.77 GiB PSS in all. Page renderers take 1,226-1,231 MiB (69 %), 12.2-12.6 MiB per loaded tab. Heavy
    pages take 25-27 MiB.
  - Chrome's process sharing alone swings the total by about 430 MiB (64 against 101 renderers).
  - The shell is 6 %.
  - Today's budget in Balanced mode is max(10, 1 per GiB), and hidden tabs sleep after 60 min.
- **What the 69 % does and doesn't show (C):**
  - The bench is a stress state the default policy never acts on within a run. The bench host has 62 GiB, so
    Balanced's budget there is 62 tabs (`loadedTabBudget.ts:36-40`), and `tabsOverBudget` only picks tabs hidden for
    at least `hiddenMs`, 60 minutes in Balanced (`:77`). A bench run lasts minutes, so nothing could sleep whether
    or not the budget was on. The harness doesn't set or record the Memory Saver setting.
  - On a typical 16 GiB machine Balanced already keeps 16 tabs loaded, and Linux has Chrome's Memory Saver on by
    default too (Helium's `memory-saving-by-default.patch`, `docs/linux-port.md:1059-1075`). So the policy lever is
    the 60-minute wait and the per-GiB rule, not the absence of a policy.
  - The 12.2-12.6 MiB per tab comes from the bench's synthetic fixture pages (70 % static). Real pages are larger,
    so this probably understates the saving (H).
  - Renderers are shared under load (64 against 101 at N = 100), so a slept tab doesn't always free a process; the
    saving per slept tab can be less than 12 MiB (H).
- **The simplest alternative:** tune the numbers that exist. `MODES` (floor, per-GiB, `hiddenMs`) and
  `HIDDEN_UNDER_PRESSURE_MS` are one-line changes; a new tier is only needed if tuning isn't enough.
- **What blocks a fix:** policy, not code. Sleeping pauses timers, notifications and page state, and the tab
  reloads on its next activation. That is a behaviour change, and it needs the owner (pre-read M4).
- **Proposed solution:** first try the one-line tuning: Balanced's `hiddenMs` from 60 to about 15-20 minutes, or a
  lower per-GiB rate. Only if that isn't enough, a stricter tier for tabs that are hidden, silent, unpinned and not
  playing media (for example, at most 30 such tabs loaded). Measure a reload-on-switch cost to set against it.
- **Smallest experiment, in two parts:**
  - **The RAM ceiling.** Dropping `hiddenMs` alone can't get 100 tabs to 30 inside a short bench: the sweeper runs
    once a minute and asks at most `SLEEPS_PER_SWEEP = 4` tabs per sweep, before exemptions
    (`loadedTabBudget.ts:20-34`, `:93-110`, `:140-149`). So force it: call the dev hook
    (`acLoadedTabBudget.sleepTabsOverBudget`) repeatedly with the budget at 30 and `hiddenMs` at 0 until
    `tabsLoaded` reaches 30, then run `memlab.mjs sweep` at N = 100. Repeat with a few real-site fixtures to check the
    per-tab figure.
  - **The policy.** Separately, run the real sweeper with the tuned numbers over a long session and count sleeps,
    exemptions and wakes within a minute; that is the behaviour the owner decides on.
  - Metric: page-kind PSS, plus S3 key→shown when switching to a slept tab.
  - Expect: page PSS falls by about 12 MiB per slept tab on Linux, so about 850 MiB (H). On the Mac each added tab
    costs 22-46 MB in the release gate (`docs/perf/0.2.44-to-0.2.45.md`: 288 / 698 / 918 MB at 1 / 10 / 20 tabs), so
    the saving per slept tab there is likely larger (H).
  - Pass: total PSS at least 30 % lower, `tabsLoaded` equal to the budget, and the slept-tab wake shown in under 1 s
    on a static page.
- **Impact:** large (4): still the biggest RAM lever, but the default policy already
  sleeps tabs hidden over an hour, so the gain is for tabs hidden less than that and for big-RAM machines.
  **Effort:** S in code; the work is the decision.
  **Risk:** high for behaviour. Contain it with a setting, a pinned and audible exemption, and telemetry on how often
  users wake a slept tab within a minute (a count).

### Item 19. Engine (C4): Chrome's hidden toolbar repaints at 56 Hz while the active tab loads

- **Subsystem:** `engine/ardiacore-linux/src/ardia/linux/ac_linux_host.cc`.
  - `ShellHostView::LayoutOverlay` (`:3330-3340`) hides only `GetActiveContentsWebView()`.
  - `StripCommand` `activate` (`:6305-6325`) makes the Ardia tab Chrome's active tab.
- **Bottleneck:** `LocationBarProgressView` animates behind the shell, costing one browser compositor frame and one
  viz draw per tick.
  - **M (old engine, round 1, n = 2, N = 10 only):** in a minimal-shell counterfactual, making the loading tab
    Chrome's active tab added +9.5 % browser (9.1-9.9) and +12.0 % GPU (11.2-12.9) of a core, with
    `View::Paint{LocationBarProgressView}` at 56.5/s (`browser-renderer-gpu.md:162-192`). That probe predates E2,
    which removed most shell-driven GPU work, and in it Ardia's own loading GPU was 28.6 %.
  - **M (final build, partitioned bench, n = 4 per build):** the browser part shows up. S6 (active tab loading)
    browser CPU is 11.1-14.1 % on every build against 0.3-0.6 % in S2 (no loading). The GPU part does not: S6's GPU
    process is 8.8-11.0 %, the same as S2's 9.7-11.8 %. So on the bench, C4's GPU share may be close to zero, and a
    12-point GPU saving can't come out of a GPU process that uses about 10 points in all.
  - **H:** that the toolbar repaint accounts for the S6 browser excess on the final build. The two compositors share
    display draws, so the old counterfactual can't be subtracted from the integrated build.
  - **Software GL only.** Every bench GPU number here is Xvfb + ANGLE/llvmpipe; on a real GPU the size is H. On
    SwiftShader (the media run) the same host's GPU process ran 160-212 % (section 1b).
- **What blocks a fix:**
  - The engine cost (section 3).
  - Toolbar-anchored bubbles (page info, extension popups) may lose their anchor if the whole toolbar is hidden.
  - The docs already note that companion windows' bubbles have none.
- **Proposed solution:** the narrow fix. Stop `LocationBarProgressView` updates, or hide only the progress view, while
  an Ardia host owns the window. Hide the whole top container only if the acceptance suite shows bubbles unaffected.
- **Smallest experiment:**
  - On one final-build setup, toggle only the progress view (everything else identical), with `idle-probe3.mjs
    --active-kinds loading` at N = 10 and 100, and then S6 on the partitioned bench.
  - Metric: `View::Paint{LocationBarProgressView}` and browser `STEP_SUBMIT_COMPOSITOR_FRAME` per second, plus a paired
    browser and GPU CPU delta.
  - Pass, in bench terms: paints 55/s → 0; S6 browser 11-14 % → ≤ 4 %; S6 GPU unchanged or lower (H); F09
    (extension popups) 11/11 with bubble anchors intact. Expected whole-app S6: 24-31 % → about 15-21 % (H).
  - Real-GPU check: repeat the paired toggle on one machine with a hardware GPU (a Linux desktop, or a Boat VM with a
    GPU) before claiming any GPU saving.
- **Impact:** moderate (3) for the browser process on Linux, whenever a page loads (M on software GL only; real-GPU
  size H). **Effort:** M (engine). **Risk:** medium (bubble anchors).
- **Score:** I 3, E 2, F 2, R 2 = 1.5. Evidence is 2: the repaint mechanism is measured on the old engine, and the
  share recoverable on the final build is a hypothesis.

### Item 20. Mac and Linux have no launch guard

- **Subsystem:** launch on the Mac (`packages/ardiacore/ios`, `ArdiaHost+Launch.mm`) and on Linux (the host's start
  path in `engine/ardiacore-linux`, or the launcher). Windows already has the guard. Source: reliability R1, re-checked
  at `2e9c24a46`.
- **Bottleneck (C):**
  - **Windows** counts unfinished starts. After two in a row it moves the restore files aside
    (`scripts/windows/engine/src/ardia/win/launch_guard.cc:150` `SetRestoreStateAside`, `:450`), and a settled start
    clears the count (`:502` `MarkStartSettled`). It writes `launch-guard.json`, which the shared JS already turns into
    `app_launched` fields (`state/telemetry/launchEvents.ts:16`, `launchGuardProperties`).
  - **Mac and Linux:** searching `packages/shell/ios`, `packages/ardiacore/ios`, `engine/ardiacore-linux` and
    `apps/linux/src` finds no launch counter, recovery folder or `SetRestoreStateAside`.
  - **Crash reports arrive too late** to catch a loop: they are read 1 s (after an unclean exit) or 5 s after
    `startTelemetry` (`usage.ts:352`), which runs after 20 other starters (item 14).
  - **Kill switches arrive too late** too: they are fetched after the first window (`killSwitchesLaunch.ts:6`), so they
    can't turn off whatever crashes first.
  - So a crash at launch on the Mac, the main app, repeats on every launch, and neither the user nor telemetry sees
    why.
- **What blocks a fix:** there is no native launch counter, and no test seam that crashes at launch, on either
  platform. On Linux the host lives under `engine/`, so a host-side guard moves the engine key. A guard in the Linux
  launcher script would not (H: check that the launcher can see an unfinished start).
- **Proposed solution:** port the Windows rule.
  - A `launch-starts` counter in the data dir, raised before React Native (Mac) or the shell (Linux) starts, and
    cleared 15 s after the first window is painted. A clean quit before then counts as finished.
  - After two unfinished starts in a row:
    - move `session.json`, `launch-look.json`, `switches-cache.json` and `bookmarks-cache.json` to `Recovery/<stamp>`;
    - clear Chromium's GPU caches;
    - write `launch-guard.json`.
  - On recovery, also apply the cached kill-switch values natively. `ArdiaLaunchConfig.mm` already reads
    `switches-cache.json` before JS starts.
- **Smallest experiment, in two steps:**
  1. **Build the seam (S):** a test hook modelled on `legacyCrashAfter` that crashes only while a seeded restore
     artifact is present (a marker inside a scratch `session.json`), not unconditionally. An unconditional crash would
     still crash after the session is set aside, so it can't show recovery.
  2. **Run it:** launch a hidden instance with the seeded session three times. Today the third launch still crashes.
     Pass: it opens with the session in `Recovery/<stamp>`, and `app_launched.launch_restore_state_set_aside=true` is
     in the local telemetry queue. Controls: a normal second launch, and a clean quit within 15 s of launch, each set
     nothing aside.
- **Impact:** large: "Ardia won't open" becomes "Ardia opened with your last session set aside", and crash loops
  become visible. **Effort:** M (native on two platforms; on Linux a host-side guard is engine work and moves the
  key). **Risk:** medium (2): native launch code on the main app. Two quick force-quits could set a session aside by
  mistake (false recovery). Windows' rule (two in a row, under 15 s) keeps that rare and the files are moved, never
  deleted, but there is no UI to restore a set-aside session; add one (a "Restore previous session" row) with the
  guard. **Score:** I 4, E 1, F 2, R 2 = 1.0.

### Item 21. Sync correctness is caught by review, not by tests

- **Subsystem:** `apps/browser/src/state/sync/` and `packages/sync/src`. Source: reliability R9, re-checked at
  `2e9c24a46`.
- **Bottleneck (C, from history):**
  - Two sync changes were reverted after a Codex review found data-loss bugs:
    - `7b334d078` reverted "tombstones go only once stable; silent Macs retire and rebase". The review found four P1s,
      among them "the passwords adapter could republish an old password over a newer one".
    - `4daf335ca` went back to per-adapter publish-then-apply: "an edit typed while another adapter was reading could
      be held back and lost".
  - 50 commits touch `state/sync/engine.ts`.
  - The only randomized sync test is one fixed seed at the scope level (`packages/sync/src/scope.test.ts:258`,
    `seed = 7`). It doesn't run the adapters: passwords, bookmarks, pinned order.
- **What blocks a fix:** a simulator needs fake devices, a fake file transport and a clock. None exists.
- **Proposed solution:** a deterministic multi-device simulation through the real adapters.
  - Events: edits, removals, crash and restart, restoring a backup, files arriving late.
  - Invariants, taken from the reverted P1 classes: no older value wins, no local edit is lost, nothing comes back
    after a tombstone inside the hold.
  - 500 seeds in Checks and 10,000 nightly, printing the failing seed.
- **Smallest experiment:** build the simulator, then put each reverted change back in a scratch copy. Pass: the
  simulator finds each P1 within 500 seeds, and `main` passes all 500.
- **Impact:** large: synced passwords and bookmarks. **Effort:** L (3): a deterministic multi-device simulator through
  the real adapters, with a fake transport and clock. **Risk:** low (tests only). Get a Codex review of the invariants
  (sync). **Score:** I 4, E 1, F 3, R 1 = 1.33.

### Item 28. Linux edge reveal: the page often goes white for up to 20 frames

- **Subsystem:** the Linux reveal path: `apps/linux/src/inputRegions.ts` (reveal gate `REVEAL_DEADLINE_MS = 150`,
  `SETTLE_FRAMES = 12`), `shellAbove.ts` `conceal`, `pageHoles.ts`, and the engine's `Restack`.
- **Bottleneck:**
  - **M under Xvfb + SwiftShader only** (video pixels at 30 fps, `~/ardia-work/media/pr1/README.md`; its line 80 says
    the numbers include the blank frames and SwiftShader): on the sampled reveals the page view blanks white
    from "display reacts" (+100 ms) until the sidebar is drawn (+333-350 ms), 4-8 frames on a lighter host. Default
    and Faster can't be told apart on Linux; the 100 against 150 ms slide is hidden behind the blank frames. Phase 1's
    own estimate of the reveal is 170-200 ms.
  - **H** (cause): `conceal` hides the overlay, not the page, so the white is either:
    - (a) the shell backdrop losing its page hole for a few frames (E3 saw a similar "hole dropped" state when a
      region send carried 0 pages); or
    - (b) the engine's `Restack` or `SetWebContents` hiding the native page while the input region changes.
  - E1's effect on it is unknown (reveal 140 → 121 ms in S4; blank frames not measured).
  - **M (PR 3 media, under load, 8 visits per speed, `media/pr3/README.md:93-104`):** Faster blanked 14-19 frames on
    final and 0-19 on PR 2's UI (one PR 2 visit had no blank at all); Slower 11-18 on final and 11-20 on PR 2's UI.
    So the blanking is pre-existing and common in this setup, not universal, and its length tracks host load on
    SwiftShader. The ranges overlap, which doesn't rule out a PR 3 tail regression at n = 8 (final's median draw is
    35-100 ms later); that stays open.
- **What blocks a fix:** the cause is unknown. Xvfb has no vsync, so the result must be checked on a real Linux
  desktop.
- **Proposed solution:**
  1. Diagnose: timestamp `shell.inputRegions` sends, backdrop `clip-path` changes and engine `Restack` and visibility
     calls against x11grab frames.
  2. If (a): keep the previous hole until the new region set is acknowledged, like E3's switch-ahead fix.
  3. If (b): an engine change that keeps the page attached under an overlay.
- **Smallest experiment:**
  - Scenario: 12 reveals at Default with real input, x11grab at 60 fps, plus the shell and engine timestamps above.
  - Metric: blank frames per reveal, and which event precedes the first blank frame. Compare blank reveals with
    no-blank reveals: an event that comes first in both may just be part of every normal reveal.
  - Pass for the diagnosis: toggling one path at a time (keep the previous hole; skip the engine `Restack`) removes
    the blank in ≥ 11/12 while the other toggle doesn't. Reproduce on hardware first, then compare final against base
    for the tail.
  - Pass for the fix: 0 blank frames in 12/12, Faster first-drawn earlier than Default by ≥ 1 frame, and S4 reveal
    misses 0.
- **Impact:** moderate (scored 3, H). The blank frames were seen only on Xvfb with SwiftShader and no vsync. If a
  real Linux desktop shows the same 4-8 frames, it is large (4): every Linux reveal flashes white and PR 1's speed
  setting barely shows. The diagnosis step answers that first.
  **Effort:** M. **Risk:** medium (pages drawing over the sidebar is the failure the gate prevents).

### Item 29. Linux: drive transform and opacity Animated on the compositor

- **Subsystem:** `apps/linux/src/shims/react-native.tsx:162-178`, which forces `useNativeDriver: false`, and RNW 0.21.4
  `useAnimatedProps`.
- **Bottleneck:**
  - **M** (for loops): E2 proved the mechanism. Moving two endless loops to WAAPI took the shell from 106 % to 4 %.
  - **C** (for everything else):
    - each JS-driven frame is a `useReducer` re-render of the component that hosts `useAnimatedProps`;
    - `useShift` hosts it inside `TabRow`, so every frame of a list slide re-renders whole rows;
    - 110 `useNativeDriver: true` call sites in the shared UI are JS-driven on Linux.
  - **H:** `useShift` freezes `drawn.current` while a slide runs (`EntryMotion.tsx:37-39`), so Linux list slides may
    never draw; the rows would snap after 140 ms. No Linux test covers it.
  - E2 stage B (`Marquee`, `RefreshSpinner`, `LiveItemCard`) wasn't done.
- **What blocks a fix:** RNW has no off-React style path, and shared code relies on `useAnimatedProps` semantics:
  `stop()`, interruption through `__getValue`, `Animated.event`.
- **Proposed solution:** a Linux "compositor driver" in the shim. For `useNativeDriver: true` configs whose props are
  only `transform` and/or `opacity`:
  - run WAAPI from the token easing (E2's `paintMotion.ts`, 32-step `linear()`);
  - mark the node `data-ardia-paint-motion`;
  - render once at the end;
  - keep `__getValue` from `animation.currentTime`;
  - fall back to the JS driver for anything else.
- **Smallest experiment:**
  - Scenario: 50 tabs, close tab 1. Log `getComputedStyle(row10).transform` every rAF, plus React commits.
  - Today (H): the old offset for 140 ms, then a jump, and about 9 commits × 49 rows.
  - Pass: a monotone slide over 140 ms ± 1 frame, ≤ 2 commits, and shell ms per close down ≥ 70 %.
  - Repeat with E2 stage B.
- **Impact:** moderate (Linux motion correctness and CPU). **Effort:** M. **Risk:** medium; scope it to
  transform and opacity.

### Item 30. Engine: Linux page capture (`tab.capturePicture`)

- **Subsystem:** `engine/ardiacore-linux` (no capture command) and `apps/linux/src/shims/web/HostWebView.tsx:90`, which
  answers null when the host lacks `tab.capturePicture`.
- **Bottleneck (M + C):** no Linux engine serves capture. The hover-card page preview (PR 1), the switcher pictures,
  the pin handoff and the drag preview are therefore all off on Linux. The shared UI lights them up by itself once
  the host advertises the command (`docs/linux-port.md:1859`).
- **What blocks a fix:** the engine cost above. The capture path must also follow the M2 rules before it ships, or it
  becomes a cost on every load:
  - capture only after the dwell;
  - one decoded image;
  - scale respected;
  - pictures counted by bytes, not number (pre-read M1).
- **Proposed solution:**
  - `tab.capturePicture` through `content::RenderWidgetHostView::CopyFromSurface` at the card's size, JPEG-encoded off
    the UI thread.
  - Advertise it in the capabilities list.
  - Ship it in the batched engine release.
- **Smallest experiment:**
  - Scenario: Phase 1's preview checks 8-16 on Linux.
  - Measure S5 with the preview on: browser CPU per card and bytes held in `tabPictures`.
  - Pass: a real picture appears in 12/12 cards; S5 browser CPU rises ≤ 1 point at N = 100; RAM held ≤ 40 pictures ×
    the encoded size.
- **Impact:** moderate (feature parity). **Effort:** L (engine plus the cost rules). **Risk:** medium.

### Item 31. The Linux adapter layer: make overrides visible

- **Subsystem:** `apps/linux/vite.config.ts` replacements, `linuxWording.ts` text patches, `shims/`.
- **Bottleneck (M + C):**
  - Linux replaces 56 shared files and text-patches 67 spots. 268 of 289 commits to those shared files changed only
    the Mac side.
  - 3,525 lines are copied between `apps/linux/src/shims` and `packages/demo/src/shims` (now item 15).
  - Phase 3 added two more replacements (E2) and new Linux-only adapters, so every Phase 3 fix lives in this layer.
  - A Mac-side fix to a replaced file never reaches Linux.
- **What blocks a fix:** nothing marks a shared file as overridden. A missed wording patch fails only in the Linux Vite
  build, which the `rest` job doesn't run.
- **Proposed solution:**
  - An exported override manifest, and a conventions rule: a change to a replaced shared file without a change to its
    Linux counterpart prints a reminder, with a baseline.
  - Run the Linux wording plugins' dry pass in Checks.
- **Smallest experiment:**
  - Move the 5 onboarding wording entries to `PLATFORM_TERMS`. Pass: the Linux dist differs only in the affected
    chunks.
  - Replay the drift rule over the last 300 commits. Pass: it flags the 268 Mac-only edits, and spot-checking 20 of
    them finds at least one real Linux gap.
- **Impact:** moderate (maintainability). **Effort:** M. **Risk:** medium (Linux copy). Contain it with a dist diff.

### Item 36. Lean hidden panes and a thinner `MacView` (shell RAM and hooks)

- **Subsystem:** `components/window/TabWebView.tsx`, `TabPane.tsx`, and `apps/linux/src/shims/web/motion/macView.tsx:115-133`.
- **Bottleneck (M):**
  - The shell grows by +0.52 MiB PSS and +0.22 MiB of V8 heap per loaded tab: about 586 hooks and 47 subscriptions
    each.
  - Even after E3 a hidden pane still mounts `TabWebView` (about 33 hooks and 6 subscriptions).
  - Each Linux `View` adds 7 `MacView` hooks, about 100 per tab.
  - The shell is 6 % of RAM at N = 100, about 50 MiB.
- **What blocks a fix:** the HostWebView lease must stay bound for a hidden page. That is E3's "deeper RAM step".
- **Proposed solution:**
  - For hidden, non-warm panes, mount only the `HostWebView` slot without `TabWebView`'s callbacks.
  - `MacView` returns a bare RNW `View` when no Mac-only prop (hover, cursor, `onLayout`) is present.
- **Smallest experiment:**
  - Scenario: `memlab.mjs sweep`, then `heapan.mjs fibers` at n50 and n100.
  - Pass: V8 slope 0.22 → ≤ 0.15 MiB per tab, and hooks per tab −130 or more. S3 key→shown unchanged (26-28 ms) and
    F01/F28 pass.
- **Impact:** small (RAM and the census ratchet). **Effort:** M. **Risk:** medium (lease lifetimes).

### Item 37. Engine: Linux `engine.tasks` names only the current window's tabs

- **Subsystem:** `engine/ardiacore-linux` task listing.
- **Bottleneck (C, documented):** the engine names only tabs of the same window, so a renderer shared with a tab in
  another window reads as "shared with other pages" (`docs/linux-port.md:1865-1866`). The Mac names them.
- **What blocks a fix:** the engine cost, and a cross-window tab-id mapping in the Linux host.
- **Proposed solution:** the host resolves tab ids across every Ardia window of the profile when it builds `tasks`.
  Ship it in the batched release.
- **Smallest experiment:** two windows with `--renderer-process-limit=1`, then hover a tab whose renderer is shared
  across windows. Pass: the card names the other window's tab.
- **Impact:** negligible to small. **Ride-along only:** it would never justify an engine release by itself.
  **Effort:** L (3) standalone, M (2) inside a release something else triggers. **Risk:** low. **Score:** 1.0
  standalone (I 1, E 3, F 3, R 1), 1.5 in the batch.

### Item 39. Engine: the Linux bridge and session protocol

- **Subsystem:** `ac_linux_host.cc` `HostMessageHandler` (`:1863-1868`, `:1903-1907`), `session.write` (`:6970-7008`), and
  `bootstrap.js`.
- **Bottleneck:**
  - **M:** about 96 KB per session write at N = 100 (it carries `base` and `session`), plus a reply and a broadcast of
    about the same size; E4 cut how often, not how big. Each save still costs about 20-30 ms of shell work at N = 100.
    E5 has to match the engine's bare `No owned live tab` message text.
  - **C:**
    - every reply and event is delivered as an evaluated script (`CallJavascriptFunction`), unbatched;
    - placement verbs (`tab.viewport`, `tab.presentations`) each wait for an empty reply;
    - the 256 in-flight cap fails silently.
- **What blocks a fix:** the engine cost, plus ordering (the session echo and page snapshots depend on reply and event
  order) and per-message trust checks.
- **Proposed solution, in the batched release:**
  - a per-handler outbox flushed once per task;
  - payloads over 4 KB sent as JSON strings;
  - ack-only session replies when the merge equals what was submitted;
  - peers get changed ids and a revision, and the source window is left out;
  - `base` tracked natively by revision;
  - an error code for already-released tabs;
  - fire-and-forget placement verbs;
  - counters for the maximum in-flight count and rejections.
- **Smallest experiment:**
  - Scenario: an S3 Chrome trace of the shell renderer at N = 100.
  - Count `v8.compile` / evaluate-script entries starting with `__ardiaReply` and `__ardiaEvent`, and their ms per
    switch. Do the batching item only if they total ≥ 5 ms per switch.
  - For the session items: bytes per 40 switches 1.05 MB (E4's final, 11 writes) → ≤ 0.2 MB, and `receive` ms per save down ≥ 50 %.
- **Impact:** moderate (Linux switching, multi-window, load storms). **Effort:** L. **Risk:** medium. Get a Codex
  review (sync).

### Item 48. Profile S3, S4 and S5 on the final build: the largest measured shell costs left

- **Subsystem:** the shared shell UI on Linux: reveal, tab switching and the hover sweep.
- **Bottleneck (M for the cost, H for the cause):**
  - After PR 3, interactions are the largest shell costs (partitioned bench, n = 4, final ranges below every other
    build): edge reveals (S4) 32.5-36.6 % of a core, switching (S3) 25.5-29.5 %, hover (S5) 13.8-18.4 %, at N = 100.
  - No profile of the final build exists. Round 1's profiles (`interactions.md`) ran on `e522661dd`, before E1-E6.
  - The first CPU hypothesis is item 52: `mountLayout`'s first settle, which cost 500-900 ms of `frameOf` per 40
    switches at N = 100 on E6's build.
  - The first latency hypothesis is E4's volatile save: about 20-30 ms of shell work at N = 100, at most every 2 s,
    which can land on a switch. It raised E4's 500 ms-cadence p90 from 41 to 52 ms (`e4-result.md:158-161`, `:358`) and
    is implicated in the 4 slow presses (67-85 ms, of 197) that PR 3 alone showed above an unchanged p90 in the final
    full run.
- **What blocks a fix:** nothing but perflab time on cores 10-15.
- **Proposed solution:** a full-instrumentation profile of S3, S4 and S5 on the final build, on the partitioned
  cores, n ≥ 4 per side against the PR 2 UI build, with `--switch-via store` for the CPU rows (the keyboard switcher's
  recoveries inflate S3; §4 lead 19) and a separate real-input latency run.
- **Smallest experiment:** `node apps/linux/scripts/perf/bench.mjs run --instrument full --switch-via store --tabs 100`
  for S3-S5, plus a 200 µs CPU profile of the shell per scenario, and S3 with `--switch-via key` for latency, with
  the session-save times marked on the switch timeline.
  - Pass: the top five self-time functions per scenario, with ms per interaction, and one fix candidate each, ranked
    by the same formula. The final full run settled the p90 (38 ms on PR 2 and on PR 3); also settle whether the slow
    presses above it coincide with a session save (section 1a, open risks).
- **Impact:** moderate (3): these are the costs a user meets on every switch, reveal and hover. **Effort:** S.
  **Risk:** low (measurement only). **Score:** I 3, E 2, F 1, R 1 = 6.0. Evidence is 2: the cost is measured and
  repeated, but its cause is not.

### Item 49. Mac baseline at scale: the main app's CPU, RAM and restore cost at 50-100 tabs

- **Subsystem:** the Mac app (`apps/browser` on `engine/ardiacore`), measured with the repo's own
  `native-bench.mjs`.
- **Bottleneck (M where the repo has it, H beyond):**
  - The release gates already measure the Mac (`docs/perf/0.2.44-to-0.2.45.md`, native-bench, interleaved, n = 2-6):
    launch to window shown 451 ms (427-480); idle CPU at 20 tabs 0.74 % (0.72-0.77); memory 288 / 698 / 918 MB at
    1 / 10 / 20 tabs, so 22-46 MB per added tab; memory after closing back to 1 tab 610 MB (369-852); tab switch to
    shown 9 ms.
  - Large-session launch is measured too (`docs/perf/launch-critical-path.md:95-107`): with about 200 sidebar rows,
    first commit to content on screen takes +420 ms (native view creation: RCTUIManager about 260 ms, CA commit about
    290 ms), tab FCP +456 ms; a four-window profile adds +770 ms to window key, building the windows one after
    another with the focused one last.
  - What is missing: anything at 50 or 100 tabs, anything while a tab loads, and every interaction PR 3 targeted (S3-S7).
    Field installs carry 1,383-3,051 tabs (`38c49fd91`). E1-E5 are Linux-only; of Phase 3, only E6's shared changes
    reach the Mac.
- **What blocks it:** a Mac with an engine that matches the key (item 10), and perf time on it. Neither exists today:
  PR 1's Mac run on 2026-11-18 needed a test-only shim, and PR 2 had no Mac run (section 6 item 12). Until then this item
  is blocked, though it ranks fifth on what its result would unblock.
- **Proposed solution:** extend `native-bench.mjs` idle and memory to 50 and 100 tabs, add a loading-tab phase and
  a 200-row and four-window restore phase, interleaved against 0.2.45, in a hidden instance with the DEBUG counters
  (arch F11).
- **Smallest experiment:** on an exact-prebuilt Mac, n ≥ 2 with ranges: idle CPU and memory at 20 / 50 / 100 tabs;
  whole-app CPU while the active tab loads; start-to-content, first-tab FCP and native mount time for a small, a
  200-row and a four-window session. Pass: a table comparable to the Linux S1 and S6 rows, and a verdict on whether
  deferring offscreen rows or non-focused windows is worth an experiment.
- **Impact:** large (4): the main app, and the input that would re-rank items 18, 45, 46 and 47. **Effort:** M (2).
  **Risk:** low. **Score:** I 4, E 2, F 2, R 1 = 4.0. Evidence is 2 because the launch cost of large sessions is
  already measured; the rest is unmeasured.

### Item 50. Linux at field scale: N = 300 and 1,000, three windows, cold start and restore

- **Subsystem:** the Linux shell and host at the tab counts users run.
- **Bottleneck (M at N ≤ 100, H beyond):** every number in this report is at N ≤ 100 in one window, while field
  installs carry 1,383-3,051 tabs. Round 1 measured shell cost growing linearly to quadratically with loaded tabs.
  Items 11, 12, 22, 45 and 47 matter mainly at that scale, and their scores assume today's N = 100 or code-only
  evidence. Launch-to-first-window and session-restore time aren't measured on Linux at any N, though items 5, 14 and
  20 sit on that path, and the Rust angle's premise ("launch time is spent creating native views") is the Mac's
  measurement, not Linux's.
- **What blocks it:** a seeded 1,000-tab session and a multi-window S3 in `bench.mjs` (section 6 item 4).
- **Proposed solution:** the same S1-S7 on the final build at N = 300 and 1,000, one and three windows, plus cold
  start to first window and to restored content.
- **Smallest experiment:** partitioned cores, n ≥ 3. Pass: a table per N, with any metric whose slope is above
  linear flagged; then re-score items 11, 12, 22, 45 and 47 from it.
- **Impact:** moderate (3). **Effort:** M (2), for the fixtures and the multi-window scenario. **Risk:** low.
  **Score:** I 3, E 2, F 2, R 1 = 3.0.

### Item 51. Windows: CPU and RAM from the CI tours, then a tab-count sweep

- **Subsystem:** `.github/workflows/windows.yml` (the tour and launch-smoke jobs) and the Windows app, where each
  tab's page lives in its own window under the app's (`docs/windows.md:213-224`).
- **Bottleneck (H):** Windows has no CPU or RAM number at any tab count, and no profile. Its per-page child windows
  carry z-order, resize and hit-test work (`HostedFrameView::NonClientHitTest`, the `PreTranslate` message hook,
  `WM_SETCURSOR`) that the other platforms don't have (§4 lead 39).
- **Proposed solution:** sample whole-app CPU and private bytes during the existing tour job and upload them as
  artifacts; then a 20 and 100-tab restore-and-switch sweep on a Windows VM, with native placement and IPC counts and
  key-to-shown.
- **Smallest experiment:** one PowerShell sampler (`Get-Process` every second over the Ardia process tree) in the
  tour job. Pass: two consecutive runs on `main` agree within the noise of the runner, and the artifact gives CPU and
  RAM per tour step.
- **Impact:** small (2): Windows ships as an alpha. **Effort:** S: the job already runs. **Risk:** low.
  **Score:** I 2, E 1, F 1, R 1 = 2.0.

### Item 52. `mountLayout`'s first settle forces a layout on every switch

- **Subsystem:** `mountLayout.ts` (`watchLayout` → `settle` → `frameOf`, `:46-55`, `:122-126`), shared, through
  `onLayout` on the Linux shims.
- **Bottleneck (M on E6's build):** about 55 component mounts per ctrl+Tab switch (80 per store switch) remain after
  E6: a `PageOverlayRegion` subtree and row overlays keyed per tab. Each first `onLayout` settle reads `offsetWidth`
  and forces a synchronous layout: `frameOf` takes 500-900 ms per 40 switches at N = 100 (`e6-result.md:78-79`, lead 1
  at `:289`), and its cost grows with DOM size (`interactions.md:360`).
- **What blocks a fix:** `onLayout` timing is relied on across the shared UI. E6's caveat applies: deferring the
  forced layout may only move it to the next frame rather than remove it.
- **Proposed solution:** defer `mountLayout`'s first settle to a batched read after the commit (one layout read for
  all new mounts in a frame), or skip it for components that are hidden.
- **Smallest experiment:** S3 at N = 100 with full instrumentation, before and after, store switching. Pass: `frameOf`
  inclusive time per 40 switches down ≥ 50 % and `LayoutCount` per window not higher, with shell CPU in S3 below
  the noise floor's bar, and the `onLayout`-dependent tests green.
- **Impact:** moderate (3). **Effort:** M (2). **Risk:** medium (2). **Score:** I 3, E 2, F 2, R 2 = 1.5. Run item 48
  first: if `frameOf` is no longer the top self time on the final build, drop this.

### Short items (items 22-27, 32-35, 38 and 40-47)

| Rank | Item | Evidence | Smallest experiment and pass | Why it ranks here |
|---|---|---|---|---|
| 22 | **Sidebar entries recomputed for every window** (rendering-state R11). `sameEntriesInputs` compares the whole `s.windows` record by identity (`state/sidebar/entries.ts:36-44`), so a switch in window A recomputes `computeEntries` for every profile page of every window: O(W × P × N) per switch. Fix: compare `s.windows[windowId]` after checking that `computeEntries` reads no other window | C | Census tab switch with 3 windows × 300 tabs. Pass: `useCapturedSidebarEntries` selector time in windows B and C drops to about 0 per switch in A, and entries tests stay green | Cheap and safe, but it matters only with several windows, which nobody measured (§4 lead 7) |
| 23 | **Git guard hook misses three incident rules** (maintainability-tooling §11). `scripts/agent/guard-git` blocks checkout, stash, `reset --hard` and others, but not `git commit … -- <paths>`, `git apply --unidiff-zero` or `git worktree add`, the AGENTS.md rules that came from incidents. Fix: three regexes | C | Pipe sample tool-call JSONs into the hook. Pass: the three forms exit non-zero, and the allowed forms exit 0. Don't allowlist any workflow's worktrees in the hook without the owner's decision (section 6 item 13) | XS effort, but the payoff is one prevented incident class, not measured |
| 24 | **Windows memory pressure: the flag says off, the engine reports it.** `platformFeatures.windows.ts` has `memoryPressure: false`, which only drops the phrase ", the Mac's memory pressure" from What's Sent (`platformWording.ts:11`). Windows's `systemStateOf` does report pressure, from memory load ≥ 85 % (warning) and ≥ 95 % (critical) (`expo-windows/src/engine/domains/systemState.ts:6-18`). So (a) the 10-minute diagnostics note and `page_process_gone` likely send `memory_pressure` on Windows while the copy leaves it out (C: routing read, not run), and (b) the loaded-tab budget's pressure tier (floor tabs, 10-minute hidden time, `loadedTabBudget.ts:39`) runs on a load threshold that macOS and Linux don't use (H for its behaviour). Fix: set the flag to true with Windows wording, or stop sending the field on Windows; pin the thresholds with item 17's test | C | On a Windows VM, read one diagnostics note with sharing on. Pass for the copy fix: every field sent is named in What's Sent. For the budget: 30 tabs on an 8 GB VM for 10 minutes of normal use; count `tab_slept_over_budget` with load under 85 % (expect 0) | Same class as item 1 (copy must match what is sent), but small and unverified on a real Windows run |
| 25 | **Tab-strip protocol can wedge** (reliability R6). `chromeTabs.ts` holds `inflight[strip]` until a transaction carries its command id (`:22`, `:72-77`), and `project()` skips any strip in flight (`:126`), with no timeout. The Mac acknowledges every command, refusals included. Linux's refusals ("No such tab strip", "arrange requires…", "Unsupported tab strip operation", "The strip is not owned by this window", `ac_linux_host.cc:6311, 6330, 6355, 7106`) fail the call and send no transaction. `sendTabStripCommand` drops the call's result (`void call(...)`, `packages/ardiacore/src/tabs.ts:54-57`), and the first `tabStrips()` has no catch (`chromeTabs.ts:44`). One refusal stops that strip's reconciliation for the session. Windows doesn't implement the protocol (`forwarded.json`: `strips`, `stripCommand`). Fix: the reply carries `{rev}` or `{rejected}`; on rejection or timeout clear `inflight` and back off; catch and retry the snapshot | C; frequency H | A `test:host` fake host that answers `tabs.stripCommand` with a failure once. Today later plans for that strip never send. Pass: the next plan sends within the backoff, and `acChromeTabs.state().inflight` is empty after closing a window mid-drag on a Linux instance | Cheap, but nobody has seen a wedge in the field; on Windows the gap is "extensions see Chrome's own order" (H) |
| 26 | **Windows import decodes byte by byte in Hermes** (Rust F2). `loadFirefoxSession` reads up to 64 MB as base64, then `fromBase64`, `lz4Block` (one byte per copy) and `utf8` (`out += String.fromCodePoint(…)`, `packages/expo-windows/src/import/bytes.ts:5-39, 141-179`) all run on the JS thread before `JSON.parse`. Fix: decode mozLz4 and UTF-8 in the C++ host that already reads the file (`apps/browser/windows/Ardia/ImportFiles.h`) and return the parsed tabs | C; size H | `bytes.ts` on a synthetic 20 MB jsonlz4 under the Hermes CLI and under Node: time and peak heap. Pass for the fix: under 200 ms on the Windows runner and peak heap under 2× the decoded size. Hypothesis to kill: today it freezes the UI for over 1 s | Only during an import, only on Windows, for heavy Firefox and Zen profiles |
| 27 | **Sync format: one vector set for every implementation** (Rust F5; maintainability §12). The vault format (NNS1) exists in Swift, Kotlin, Linux C++ (`engine/ardiacore-linux/src/ardia/linux/ac_linux_sync_*.cc`) and Windows C++ (`apps/browser/windows/Ardia/Sync*.h`). The shared vectors (`packages/sync/tests/fixtures/sync-vectors`) are run by the Swift and Kotlin tests only (`git grep` at `2e9c24a46`). Linux checks against its own JS reference (`engine/ardiacore-linux/tests/sync_reference.mjs`, `test_sync.py`, run on the engine builder) plus one Mac vector string. Windows runs primitive known-answer self-tests at runtime (`SyncSelfTest.h`: GCM, KDF, phrase), not the format vectors. So Linux is tested, but against a fifth implementation | C | Feed the shared vectors to Windows `SyncCrypto.h` in a console harness on the Windows runner, and to the Linux code in `test_sync.py`. Pass: all vectors match, and flipping one byte of `expected.json` fails both | Drift would show up as cross-device decrypt failures, but every implementation has some test; it's the Rust section's alternative to a Rust core |
| 32 | **Kill switches have no room and no reliability class** (reliability R4). The registry is full: 8 of `MAX_SWITCHES = 8` (`platform/killSwitches.ts:17`), and 7 of the 8 expire on 2026-12-15. All 8 are speed features; none covers session restore, tab-strip reconciliation, the loaded-tab budget or sync. The fetch runs only after the first window and only with automatic update checks on (`killSwitchesLaunch.ts:6-9`). Fix: retire the expiring 7, add `sessionRestore`, `chromeTabsProjection` and `loadedTabBudget` switches read natively from the cache before JS (as `ArdiaLaunchConfig.mm` already does), and fetch regardless of the update setting | C | `ARDIA_SWITCHES=sessionRestore=off` on a hidden instance with a seeded session. Pass: it starts empty and leaves `session.json` byte-identical | Fetching without the update setting is an owner policy call (risk 2); the cap is a deliberate test |
| 33 | **Persistence and lifecycle exist in three copies** (reliability R7). The Mac's Swift store is whole-document, last writer wins. Linux merges window snapshots three ways in its native layer (`docs/linux-port.md`), with `hostSession.ts` and `hostSessionMerge.ts` on top. Windows has its own C++ `SerialQueue`, whose `Sync` gives up after 30 s and carries on (`DocumentsModule.h`). Only Linux has contract tests (`session.test.mjs`, `hostContract.test.mjs`). Fix: one JSON scenario pack run against each adapter (node for Linux and Windows TS, `scripts/agent/ac eval` with a fixture data dir on the Mac): a save-load-save fixed point, a newer and a corrupt file (item 5), two windows editing within 50 ms, a move while closing, a close while a tab is lent | C | The fixed-point and newer-file scenarios on Linux and Windows first. Pass: they run in `rest` under 2 s, and the newer-file scenario fails today on the Mac as item 5a expects; Linux and Windows are unverified (item 5b) | M effort; its value is catching item 5 and item 25 on every platform |
| 34 | **The Mac has the least per-change native coverage** (reliability R8, and the 2026-11-18 verification). Checks runs only on `ubuntu-latest` (`checks.yml:38`); no PR workflow uses a macOS runner for the Mac app (`ios.yml`'s `xcode-27` jobs build the phone). Linux and Windows build, launch and tour on every PR. The Mac's 188 acceptance checks (reliability's count) (`quit`, `relaunch-profile`, `restore-after-close`, `tab-close-while-lent`, `crash-reload` …) run only locally, and `quit` only checks for one marker URL. The 2026-11-18 verification showed the cost: PR 1's Mac run needed a person's Mac, a Debug build and a test-only shim (item 10); PR 2 couldn't be checked on the Mac at all (section 6 item 12). Fix: a nightly and per-merge job on the `xcode-27` runner, running the lifecycle subset against the pinned prebuilt plus a full-session round trip. The same job can smoke-launch the current UI on the newest published prebuilt (item 10b) | C | One workflow on a branch running `acceptance.mjs <Ardia.app> <scratch> quit relaunch-profile restore-after-close` on `xcode-27`. Pass: green on `main`, red when the session's windows or groups don't round-trip (a seeded break) | Runner minutes, and the prebuilt must match the key (item 10) |
| 35 | **No field signal for hangs** (reliability R10). No hourly count measures a main-thread or JS-thread stall; the only stall count is the sidebar's scroll gap (`sidebarScrollCounts.ts`). A stuck JS thread shows only as the quit alert, which isn't counted (item 13). Phase 3's averages and per-frame counts don't show one 3 s stall either. Fix: a native 1 Hz heartbeat to the JS thread, plus main-thread stall detection; hourly counts of stalls over 1, 2 and 5 s, the longest, and a bucketed loaded-tab count | C (absence, by search) | `while (Date.now() < t + 3000) {}` from the dev harness on a hidden instance. Pass: exactly one stall over 2 s is counted, and the timer adds under 1 wake-up/s against the idle baseline | Needs native work on three platforms; it's the field check for every many-tab finding here |
| 38 | **Chrome's whole history is copied into every JS heap** (Rust F1). Each opened profile loads up to `MAX_HISTORY = 100_000` entries with `MAX_VISIT_TIMES = 50` (`state/history/history.ts:21-22`, `engineSync.ts:204`). The engine reads every visit row (`ac_history.cc:247-248`: `KEEP_ALL_DUPLICATES`, `max_count = 0`), builds the list on the UI thread and sends it as one JSON string. Every visit batch rebuilds the whole list, and on Linux every window's shell runs `startHistory` (`apps/linux/src/hostData.ts:10`). Suggestions use only 5,000 + 2,000 entries. The bench seed has 5,000 (`seed.mjs:96`), so nothing measures it. Fix: the engine sends the suggestion set (newest 5,000 plus the 2,000 most frequent); the History page and sync query the engine | C; size H (about 20 MB of JSON at 100k entries) | Step 0: read the share of users in the `<100k` and `100k+` buckets of the field `history` size (`state/telemetry/journeys.ts:272`, on the dashboard or through Bonzai's `get_status`) and score impact from it. Then add `SEED_HISTORY=100000` to `seed.mjs`. On a hidden instance at 5k and 100k, interleaved: main-thread time in the history reply, JS heap before and after `startHistory` (Hermes on the Mac, V8 on Linux), one `applyHistoryChanges`, and the History page's keystroke. Hypotheses to kill: ≥ 100 ms of main thread at launch, ≥ 30 MB of heap per profile, ≥ 5 ms per visit | Large for heavy-history users if the hypotheses hold, but the size is unmeasured, the fix touches the engine (item 10's cost) and the History page's behaviour |
| 40 | **Shell backdrop over the page (C7).** The full-window backdrop with an even-odd `clip-path` re-blends the page rect on every page frame: GPU 10.2 against 7.8 % with a 60 fps canvas, 29 against 17 quads per frame (`shims/shaders.tsx:22-38`, `pageHoles.ts:165-168`). Fix: paint the backdrop as strips outside the page rect. Never add `will-change` (+31 GPU points) | M on software GL only | The round-1 GPU probe with a 60 fps canvas tab, on the webgl2 path as well as software GL. Pass: quads per frame back to about 17 and GPU within 1 point of the no-backdrop control, with a pixel diff of the backdrop under 1 % | High visual-parity risk; the size on a real GPU is H |
| 41 | **Shared UI has no package boundary** (maintainability-tooling §14). `apps/linux/src` has 395 relative imports into `apps/browser/src`; `packages/demo` imports deep into it; import direction is enforced only inside `apps/browser/src`. Step 1 only: an `exports` map on `apps/browser/package.json` listing what Linux, demo and Windows import, with `test:graph` failing on imports outside it. Moving the folder is L | C (facts), H (payoff) | Add the map and the check. Pass: `test:graph` passes today and fails on a new deep import | Long-term value, but the payoff is a hypothesis and the full move touches Metro, Vite and the Node loader |
| 42 | **Switcher card rebuilds its data URI per render** (rendering-state R10). `TabSwitcher.tsx:151-153` builds a multi-hundred-KB base64 string inline on every render; `tabPreview.ts:44` already memoises the same string. Fix: memoise per `picture` identity | C | Open the switcher with 20 captured tabs and count string allocations over 10 renders (heap profile). Pass: one URI per picture | Bounded by awake session tabs, so small |
| 43 | **Mac demo icon check.** The Mac verification on 2026-11-18 reported it fails on five SF Symbols with no web equivalent. **H here:** `packages/demo/scripts/icons/check.mjs` skips itself off macOS ("needs macOS (CoreGlyphs symbol names)"), so it was not reproduced on Linux. Fix: map them, or baseline them, so the check is green on base | lead fact, not reproduced | On a Mac at HEAD, run `node packages/demo/scripts/icons/check.mjs`. Expect 5 missing names today. Pass: exit 0 after the map or baseline, and it still fails when a new unmapped symbol is used | A check that fails on base hides real failures, but the impact is small |
| 44 | **The Mac's `engineError` re-parses whole replies** (Rust F11; arch F6). `EngineCall.swift:83-86` parses a whole reply with `JSONSerialization` whenever the text `"error"` appears anywhere in it. A 100k-entry history reply (item 38) with one page titled "error" is enough. Engine errors are always a top-level `{"error":…}`. Fix: check the prefix | C | A unit test with a large reply containing `"error"` in a title: no parse. Pass: the Swift test passes, and error replies still map | XS, and µs except on huge replies |
| 45 | **Sidebar and strip windowing.** Every row of every visited profile page is mounted (`PageRows.tsx:125-133`, `:50-52` `visited` latch): about 15 native views per tab, 961 MB at 2,000 tabs and 1,419 MB at 3,000 (Mac, `38c49fd91`); field installs carry 1,383-3,051 tabs. Blocked by drag's `measureAll` (item 47), `Fold`'s `onLayout`, reveal fallback and accessibility | M (memory, Mac, earlier), C (rest) | Force `cap = rows` (`PageRows.tsx:52`) on a seeded 2,000-tab session and A/B native-bench `memory`. Pass: at least 50 % less sidebar memory, with drag, scroll anchoring and reveal unchanged | Large for heavy users, but L effort and high risk (drag, scroll anchoring) |
| 46 | **Mac dock slide and `Fold` animate layout** (rendering-state R5). Docking runs `Animated.timing(dock, { useNativeDriver: false })` on the content row's padding (`SidebarDock.tsx:86-87,128-153`), so the page is resized every frame (and on Linux each frame also sends `tab.viewport` and an engine `Restack`); `useFold` animates a height, so every row below relayouts | C; cost H | First a Dia capture: does Dia resize the page live or once? Then native-bench ⌘S with a 5k-node page, counting renderer `LayoutCount` per toggle over CDP. Pass for a translate-then-resize fix: 1 page layout per toggle, at the same frame timing as Dia | Blocked on a parity measurement; Mac-only cost not measured in this audit |
| 47 | **Drag pickup measures every row** (rendering-state R8). `dragController.ts:106-115` runs 2 async `measure` calls per registered row: about 2,000 at 1,000 tabs, each a bridge round trip on the Mac's legacy architecture. It is also what blocks item 45. Fix: frames from state geometry, measuring only visible rows | C; latency H | Frame rig with a `gesture` drag at 50, 300 and 1,000 tabs. Pass: drag threshold to first ghost frame flat in N, and `dragZones.test.mjs` green | Medium at 1,000 tabs, but M effort and medium risk, and it lands with item 45 |

## 4. Leads not pursued, and why

| # | Lead | Source | Status | Why not pursued |
|---|---|---|---|---|
| 1 | Sidebar scroll cost (pre-read L4; a new S8 of 60 wheel notches at N = 20/100, section 6 item 4) | ranking §3.4 | H | No scenario exists. E1 now defers non-slot scrolls to the next frame, so measure on the final build |
| 2 | Load storm at scale (a new S9, section 6 item 4) | ranking §3.5 | **M** (E5): a 100-tab storm is 9.4-9.7 s of shell task time; lease validation is only 0.4 %; the rest is C1 and React | Done as far as E5 goes. A post-E1+E3 storm profile is the next step |
| 4 | Slower's 40 ms edge probe (C11) | ranking §3.9 | M at `e522661dd` (+27-41 ms per reveal), stale | `d87e981cb` changed it, and it wasn't re-measured. E1 removes most of its cost path anyway |
| 5 | `mountLayout`'s first settle forces layout | ranking §3.10; E6 lead 1 | **M**: `frameOf` 500-900 ms per 40 switches at N = 100, from about 55 mounts per switch | Now item 52, behind item 48's profile |
| 6 | Per-row subscriptions (M3, `usePinnedWithMediaControls`) | ranking §3.12 | **M, refuted as CPU** (React render flat in N) | Count-only cleanup for the ratchet |
| 7 | Multiple windows: one renderer, store and session merge per window; X11 windows behind others keep animating; `sidebarEntries` recomputed for every window (rendering-state R11, now item 22) | ranking §3.13; arch F7 | H | Every scenario on 2026-11-18 used one window. Now part of item 50 (S3 with 1 against 3 windows: shell CPU per window and summed PSS) |
| 8 | Visual jank check after E1 (x11grab of S4) | ranking §3.14 | H | Xvfb has no vsync. Needs a real desktop |
| 9 | Warm hover card about 1,090 ms against 880 ms cold; Chromium's tab thumbnailer runs on 8 of 10 switches | ranking §3.15 | M | UX, engine-side; not CPU-ranked |
| 10 | Mac: capture scale ignored, pictures counted by number not bytes, the preview's data-URI copy, Mac idle and memory at 20/50/100 tabs | ranking §3.16; arch F6, F8; rendering R10 (item 42) | H | No Mac perf run on 2026-11-18. The idle and memory baseline is now item 49, which also uses the Mac numbers already in `docs/perf` |
| 11 | E2 stage B (`Marquee`, `RefreshSpinner`, `LiveItemCard`) | E2 §1 | H | Out of time. Folded into item 29 |
| 12 | The reload breathe ignores Reduce Motion turned on mid-load (`ReloadGlyph` doesn't see the media change), on base too | E2 §4 | M (pre-existing) | Not E2's regression. One-line follow-up: use `onReduceMotion` from `paintMotion.ts` |
| 13 | E3: one extra `tab.viewport` IPC per switch (+0.86) from the departing pane's 0×0 report | E3 §6; `phase3/integration.md` §2e | M, **fixed in PR 3** | `e02d6c59c` skips a hidden-to-hidden rect change in `HostTab.viewport`: 54 → 36 sends per 18 switches, equal to base. Include it in the Codex review |
| 14 | E1's Default reveal tail: more reveals over 80 ms (20/64 against 8/64) under load, with no shell long frame | E1 review | M, **not reproduced** | The partitioned full run on the PR heads: every reveal at least 105.9 ms on every build, and PR 3 faster (median 121.6 against 127.7 ms) |
| 15 | E1's `plainViewport` per-frame cache | E1 §1 | refuted by reasoning | Every target frame is a mutation frame, so the cache would never hit |
| 16 | E4's per-tab canonical-JSON cache | E4 | **M, refuted at 100 tabs** (no CPU change, +90 KB heap) | Matters only at 1,000+ tabs and with several windows (item 11) |
| 17 | E4: drop `base` from the session payload | E4 §risks | C | Engine protocol (item 39) |
| 18 | E6: the strip remount (no CPU change) and FadeLabel dedupe (+2.4 MiB heap from alternate hook lists) | E6 | M, dropped | FadeLabel's pending queue (+6 per row per sweep) remains. Not worth +2.4 MiB |
| 19 | S3's switcher-open misses inflate keyboard S3 CPU (every flush measures the switcher overlay) | E5 §4.4 | M | A harness race. Use `--switch-via store` for CPU A/Bs |
| 20 | `ArdiaShell.setMenuState` sends depend on which window has focus under Xvfb (a coin flip with no window manager) | E1 §3c | M | Harness: give the window focus explicitly before S3 |
| 21 | Linux `MacView` creates a new ref callback on every render (ref churn × rows) | rendering R7 | C | Low. Fold into item 36 |
| 22 | Settle steps that scan all tabs on every publish (`livePinTables`, `settleShownTabs`) | rendering R9 | C | Micro-bench first. The repo's `micro-bench.mjs` shows entries at 1,000 tabs take 0.15 ms per title change, so small |
| 23 | Mac call path: JSON parsed twice, uncached `dlsym`, reply re-parsed on `"error"` | arch F6 | C | µs per call. Do it if a Mac signpost shows it |
| 24 | Mac strip mirroring: a full strip on every insert, remove or activate (O(k·N) on restore) | arch F5 | C, H for the cost | Needs the Mac DEBUG counters (arch F11) |
| 25 | Three page-event transports (Mac Paper events, Linux leases, Windows keyed topic) | arch F4 | C | Maintainability, L effort. Converge on Windows's keyed shape when the next event bug forces a triple fix |
| 26 | The New Architecture on the Mac | arch F11 | C | Not a perf lever. Revisit with the next RN macOS upgrade |
| 27 | Sync vectors not run by Linux and Windows | maint §12 | C, corrected | Now item 27. Linux and Windows do run their own tests, just not the shared vectors |
| 28 | Checks doesn't coalesce pushes to `main` (17.8 min queue against 2.5 min run) | maint §1 | M (n = 3 runs) | Now item 2 |
| 29 | Browser process RAM grows +1.14 MiB per tab (80 → 193-197 MiB at N = 100) | ranking §1b R2 | **M** (strong) | Engine-side (Chromium's per-tab state). No app lever was found; a Mac measurement should come first, since the Mac's browser process is the one users run |
| 30 | Background renderers' idle wake-ups (pre-read M4) | pre-read M4; brg (`browser-renderer-gpu.md:106-112`) | **M, not an app cost**: 100 hidden renderers together wake about 1/s each (main threads 20-26/s, 0.3-0.5 % CPU), Chromium's floor, the same in both shell modes | Not pursued. The only lever is a freeze policy (item 18's decision) |
| 31 | Linux acceptance F26: Settings shows `general.defaultBrowser` and `general.openAtLogin` | `phase1/integration.md:158-161` | M (known failure, on base too) | A Linux settings-gating bug, not perf. Worth its own `bug` issue; it keeps F26 red, the same way F23 (item 6) muddies every A/B |
| 32 | Parked and handed-off native tabs sit outside the loaded-tab budget (`ArdiaTabParking.mm` holds them strongly; `loadedTabBudget` counts only mounted `webviews`) | reliability R11 | H | Move 20 loaded tabs into a window that's never shown, shorten `hiddenMs`, then compare renderer count, `webviews.size` and a parked count (needs a dev seam). If confirmed: count parked tabs in the budget |
| 33 | Linux's per-window stores lose updates in cross-window races (move a tab and rename a group within 50 ms) | reliability R12 | H | 50 xdotool repetitions, quit, relaunch, diff against the expected session. Pairs with item 33's conformance pack |
| 34 | The media run and the bench disagree while a tab loads, in the GPU process (161-212 % against 8.8-11.0 %) and in the shell's baseline (PR 2's UI shell 27-31 % in the media run against 100-114 % in the bench). Both show the GPU process unchanged between builds | 1b | M (both, and the renderer difference); how much each cause explains is H | The two setups used different renderers: ANGLE/llvmpipe at 1920×1080 for the bench, SwiftShader at 1600×1000 for the media (`docs/perf/linux-bench.md`, "Limits of comparability"). Vary that first: run the bench's S6 once with `--use-gl=angle --use-angle=swiftshader` on cores 10-15, PR 2's UI against final, and record the GPU process, shell CPU, shell rAF callbacks per second and display draws per second. If the GPU process jumps to the media's size, the renderer explains the GPU gap. Then vary geometry and contention one at a time for the shell's 4× smaller baseline, where frame back-pressure is the second hypothesis: if rAF/s is far lower under SwiftShader, frames are being throttled |
| 35 | A shared Rust crate for the import readers | Rust F4 | C | Section 5, row 14. Credible only for the C++ copies, and only if it beats shared TS readers over native byte decoders; pilot one reader only if parity across platforms becomes a goal |
| 36 | TypeScript 7's native checker, oxc or esbuild for the test loader, Rolldown | Rust F10 | H | Mostly done by PR 2: the suites run on Bun, and `test-loader.mjs`'s `transpileModule` serves only the node-only subset. TypeScript 7 has no compiler API, which `page-operations.mjs` needs |
| 37 | The interactions PR 3 didn't target: S4 reveal 32.5-36.6 %, S3 switching 25.5-29.5 %, S5 hover 13.8-18.4 % of a core at N = 100 | 1b | M (n = 4) | Now item 48 |
| 38 | The Mac runs two page engines: WebKit tabs (11 files in `packages/shell/ios` and `packages/ardiacore/ios` use `WKWebView`, with their own content rules from uBO Lite through `ubol.sh`) beside Chromium tabs (full uBO through `ubo.sh`) | arch; Rust F4 | C | A maintenance and parity cost: every page feature, blocker update and fix is two paths. Experiment: count the commits in the last 90 days that touch a WebKit-only path, and list the page features each engine lacks |
| 39 | Windows hosts each tab's page in its own child window under the app's (`docs/windows.md:213-224`: `NonClientHitTest`, the `PreTranslate` hook, `WM_SETCURSOR`, leave tracking) | `docs/windows.md` | C | Z-order, resize and hit-test cost and complexity the other platforms don't carry. Experiment: in item 51's sweep, count child-window moves and resizes per tab switch and per sidebar resize at 20 and 100 tabs |

## 5. Rust evaluation

**Question:** is there a workload where Rust gives a credible, meaningful gain over the simplest fix in the current
stack, once FFI or IPC, copying, packaging and maintenance are counted?

**Answer: no workload clears the bar today.** The Rust angle (`rust-evaluation.md`), written separately and from the
repo's own perf docs, reached the same verdict. The costs measured on 2026-11-18 are almost all DOM-bound (layout
reads, hit testing, React commits), compositor-bound or engine-side C++. Rust can't make those faster. The one
CPU-bound JS hotspot found, the Linux session merge, is an algorithm and protocol problem in the current stack: a memo
in JS (1.6-2.5× on the realistic cold path), identity-preserving snapshots, then changed-id deltas from the engine
(items 11 and 39). Rust or WASM would shorten none of those steps, and the merge explains only part of what a save
costs. Revisit: workload 3 (on a sync format v2) and workload 14 (import readers), the only one where Rust is
credible at all; there the payoff is maintenance, and memory safety for the C++ copies, not speed.

**Coverage.** The table covers every workload the evidence or the code suggested: the session merge, the omnibox, sync
crypto, content blocking, the shell hot paths, engine-side costs, the Mac call path and favicons, browser import, the
`ardia` CLI, image work, and the dashboard and infra services. The Data size and Where-time-goes columns mark each row M, C or H; rows 3, 7, 8, 10, 11, 12 and 13 and part of row 9's
alternatives are code-only or unmeasured.

**The FFI path on each platform** (common to every candidate):
- **macOS:** shared JS runs on Hermes, with no JIT. Native code is reached through Expo modules over JSI.
  - Rust would sit behind a C ABI called from an ObjC++ or Swift module (`cxx` or a plain `extern "C"`), as a static
    library inside the already-signed app. The Mac engine is arm64 only (`out/Release_GN_arm64`), so one Rust target,
    plus Xcode build phases.
  - Arguments cross today as JSON strings parsed twice (arch F6), so a Rust call adds at least one serialise and parse
    unless it takes JSI values directly.
- **Linux:** the UI is a `chrome://ardia/` WebUI renderer. It has no native addons, so Rust in the shell means WASM:
  - inputs are serialised into linear memory and results are rebuilt as JS objects, losing identity, which
    `shareSessionValue` and the store depend on;
  - the shell CSP would need `wasm-unsafe-eval` (unverified);
  - the Vite build would need a Rust toolchain.

  The alternative is the engine, which is already C++ in the Chromium tree. Chromium can build first-party Rust
  (unverified against Chromium 157), but every change there pays the engine cost (section 3).
- **Windows:** RN Windows, New Architecture. Rust would sit behind a C++ TurboModule, built with cargo for x64 and
  ARM64 MSVC in `windows.yml`.
- **Phone:** Kotlin and Swift through Expo modules. UniFFI would give bindings; that means 4 Android ABIs plus an iOS
  xcframework.

| # | Workload | Where and how often | Data size | Where time or memory goes (numbers) | Simplest fix in today's stack | Rust path and its costs | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **Linux session canonicalise, merge and share** (`apps/linux/src/hostSessionMerge.ts`, `hostSession.ts`) | In every same-profile Linux window on every save. After E4, at most every 2 s for volatile changes and 300 ms for structural ones | 47 KiB at 101 tabs, 441 KiB at 1,010 (M). About 96 KB per write payload | **M (scratch micro-bench, 2026-11-18; runtime unrecorded, V8 or JavaScriptCore):** canonical 0.5-0.7 / 5-7.5 ms; merge with one change 3-4 / 48-58 ms; share 2-3 / 41-51 ms at 101 / 1,010 tabs. It is O(size × depth) because `equalSessionValue` re-serialises at every level. **In the app:** about 20-30 ms of shell per save at N = 100 (E4 §Risks 5). Merge, share and canonicalise explain about 7 ms of that. **H:** the other 13-23 ms is the snapshot copy (`snapshotHostSession`), reply and event delivery as evaluated scripts (item 39), and store updates; nobody has profiled the split, so the merge is not the whole hotspot | Memoise the canonical strings per object (prototype, cold path: merge about 1.6-2.5× faster, share 2.4-7×; warm merge 5-6× once identities are kept), merge records by id, and have the engine send changed ids (items 11, 39). The engine already merges natively, on the file thread | WASM: stringify, copy and parse in, then serialise and `JSON.parse` out. **H (derived, not measured):** about 1.5-2 ms at 1,000 tabs before any work, from the scratch bench's `JSON.stringify` (0.4-0.6 ms) and `JSON.parse` (0.7-0.8 ms) plus the copy. Identity sharing is lost, so `shareSessionValue` would still run in JS. That adds a toolchain and CSP change for an 80-line module, and it can't touch the unattributed part of a save. Even a 3-5× faster Rust merge (H) keeps the same complexity class | **Not worth it.** The algorithm and protocol fix in the current stack wins by more and costs less. Profile a save first (item 39's experiment) |
| 2 | **Omnibox suggestions** (`packages/core`) | Every keystroke in the address and command bars; prepare on open; bookmark index rebuilt after visits | Seed profile: 5,000 history and 1,000 bookmarks; stress: 25k and 50k bookmarks | **M (Node, V8, 2026-11-18, `micro-bench.mjs`):** warm key median 0.037 ms (URL 0.07, phrase 0.37), slowest warm key 2.0 ms, cold prepare 56 ms, rebuild's longest slice 7.2 / 11.3 ms at 25k / 50k bookmarks. **M (Hermes, `docs/perf/README.md:314`):** suggestion compute 0.4 ms (URL) and 0.85 ms (phrase) per key after the J2 sprint (was 1.3 and 2.4). **M (whole keystroke, Hermes):** 5.5-6.5 ms store update to commit (`docs/perf/render-census.md:98`), 6.2 ms median in the lab and 6 ms p50 in the field (`docs/perf/sprint-baseline.md:26`). So suggestions are about a tenth of a keystroke; React work is the rest. Hermes cold prepare is not measured (H: several times V8's 56 ms) | Already optimised in JS (J2). Next: precompute or persist the prepared index; slice the 50k rebuild under 4 ms. A faster keystroke is a React problem, which Rust can't help | The index data lives in the JS store, so Rust needs a synced copy (double memory, a copy on every bookmark or history change). Results cross back per keystroke. It would need builds for 3 platforms plus WASM for Linux and the site demo | **Not worth it.** Revisit only if Mac field telemetry shows a cold prepare over 150 ms or a keystroke p95 over 8 ms on Hermes |
| 3 | **Sync vault crypto** (Swift `SyncCrypto.swift` + `SyncVault.swift` 417 lines on CryptoKit; Kotlin `SyncVault.kt`; Linux `ac_linux_sync_crypto.cc` + `_vault.cc` 884 lines on BoringSSL; Windows `SyncCrypto.h` + `SyncVault.h` 600 lines on BCrypt) | Seal and open per synced file; HKDF key derivation at unlock | Small payloads | None measured; performance is irrelevant (H). The cost is maintenance: 4 implementations of one format. Only Swift and Kotlin run the shared vectors; Linux tests against its own JS reference and Windows runs known-answer self-tests (item 27). Correction to maintainability-tooling §12: `apps/cli/.../vault.py` is keychain storage, not a fifth crypto implementation | Make `packages/sync/tests/fixtures/sync-vectors` the conformance suite for all 4. CI fails when `expected.json` changes without every consumer | One Rust core (UniFFI for Swift and Kotlin, `cxx` for both C++ hosts) would end format drift. But it swaps platform crypto (CryptoKit, BoringSSL, BCrypt) for a Rust crypto crate that needs auditing. The Linux copy lives under `engine/` (engine key; Chromium's Rust vendoring). It adds 4 build targets plus the phone ABIs | **Not now.** Do the vectors (S). **Revisit when** the vault format gets a v2 or a fifth implementation is needed: write v2 once in Rust then |
| 4 | **Content blocking.** Linux and the Mac's Chromium tabs both embed full uBlock Origin 1.76.0 (`packages/ardiacore/scripts/ubo.sh`; `docs/linux-port.md:570`). `ubol.sh` converts uBO Lite's rulesets into WebKit content rules, for the Mac's WebKit tabs only. Windows has no content blocker (`contentBlocker: false`) | Always on; filter matching per request; lifecycle events fan out to the extension | Filter lists of tens of MB (H) | **M (Linux, `memory.md:146`):** the "uBlock + bridge" process is 91 MiB PSS at N = 1 (26 % of a 344 MiB total) and 95-97 MiB at N = 100 (5 %). About 1-1.5 ms/s of extension renderer while Chrome's freezing policy cycles. A 280 ms storage write once | Nothing is needed at today's tab counts; the cost is flat. **If low-tab RAM becomes a goal, the simplest step is uBO Lite on Chromium too:** an MV3 extension whose rules Chromium's network stack matches declaratively, with no always-running extension page. The repo already pins and fetches uBO Lite (`ubol.sh`). H: most of the 91 MiB goes; that "bridge" share and the lost features (dynamic filtering, element picker, cosmetic depth) need measuring | A Rust filter engine in the browser process (Brave's `adblock-rust` model) could drop the extension process (H: −60 to −80 MiB). But it is an engine change on both platforms, needs filter-list update infrastructure, and loses uBO's UI (element picker, per-site controls), a user-visible feature. uBO Lite may get a similar saving with no engine change (H: its packaging on Chromium and its PSS saving are untested) | **Not worth it.** If RAM at 1 tab becomes a goal, try uBO Lite on Chromium first: PSS at N = 1 with each, plus a blocking-parity check on a fixed site list |
| 5 | **The measured shell hot paths** (viewport watchers, input regions, hit testing, React commits, compositor frames) | Every frame while something animates | Tens to thousands of DOM reads per second | **M:** the time is in `getBoundingClientRect`, `elementFromPoint` (0.60 ms per call at N = 100), `getAnimations`, `getComputedStyle` and React render. Region arithmetic is trivial (E1's whole flush is 17.5 ms/s) | E1-E3 (done), item 29 | WASM can't call layout faster, and every number here is a DOM or layout cost | **Not applicable** |
| 6 | **Engine-side costs** (TabMemoryMetricsReporter, toolbar repaint, task sampler, the bridge, the native session merge) | Periodic or per event | Small | **M:** see items 16, 19 and 39 | One-line Chromium patches and C++ protocol changes | Rust in the Chromium tree adds nothing over a C++ patch for these, and the engine cost is the same | **Not applicable** |
| 7 | **The Mac call path and favicons** (`EngineCall.swift`, `ArdiaFavicons.mm`) | Per engine call; per favicon mount | Small | C: µs per call; base64 favicon strings as image keys (H for the cost) | Swift fixes (arch F6), a native favicon URL loader (arch F8) | Adds a language for µs | **Not worth it** |
| 8 | **Browser import** (`packages/import`; Swift on the Mac, `ios/Core`) | Once per import | Up to whole profiles | Not measured at real profile sizes (no timing in this audit) | If a large import is slow, profile it first; the parsing is already native on the Mac | One-off workload; a slow import is a progress-UI problem before it is a language one | **Not worth it** (unmeasured) |
| 9 | **The `ardia` CLI** (`apps/cli`, Python, about 30k lines in `ardia_cli`; one dependency, `websockets`; shipped as a versioned tarball by `install.sh`) | Per command; agents may call it in loops | Small: commands to a running Ardia over websockets | **M (this report, Linux, Python 3.14, warm, n = 5):** `ardia --help` takes 0.14-0.15 s wall and 30 MiB max RSS, against 0.01 s for a bare interpreter. The work behind each command is the browser's | Lazy imports in `cli.py` to cut start-up; keep commands batched (`ardia browse` sessions) | A single static binary: start-up in ms and no Python runtime to ship. But it is a 30k-line rewrite, plus cross-builds for macOS and Linux, for about 0.13 s per call | **Not worth it.** Revisit if the browser-agent bench shows agents making hundreds of calls per task, where 0.1 s each adds up |
| 10 | **Images and favicons** | Per capture, per favicon, per switcher card | Pictures of up to hundreds of KB | C: decoding and encoding happen in Chromium/Skia and the platform image stacks. The shell's own cost is base64 strings as image keys (item 42, arch F8) | Memoise data URIs (item 42), a native favicon URL loader (arch F8), and the M2 rules for capture (item 30) | Nothing to move: the pixel work is already native | **Not applicable** |
| 11 | **Dashboard and infra services** (`apps/dashboard`, `infra/telemetry` collector, ClickHouse) | Server-side, not in the app | Telemetry volume | Not measured. ClickHouse does the heavy lifting; Bonzai watches production health | n/a | Out of the app's path; nothing in this audit points at them | **Not evaluated** beyond this; no evidence of a bottleneck |
| 12 | **History mirror** (`state/history/*`, `ac_history.cc`; Rust F1) | Every profile at launch; every visit batch | Up to 100k entries × 50 visit times (H: about 20 MB of JSON) | C: one JSON reply built on the UI thread, copied five times, rebuilt on every visit; one copy per Linux window. Size never measured | Item 38: the engine sends only the suggestion set; the History page and sync query the engine | A Rust index would be a third copy, next to Chrome's SQLite and the JS objects the UI still needs | **Not Rust.** Change the design (item 38) |
| 13 | **Windows import decoding** (`packages/expo-windows/src/import/bytes.ts`; Rust F2) | Per import | Files up to 64 MB | C: base64, LZ4 and UTF-8 decoded one byte at a time on Hermes, which has no JIT. H: seconds of frozen UI | Item 26: decode in the C++ host that already reads the file | Only as part of row 14 | **Not Rust on its own** |
| 14 | **Import readers, three copies** (Mac Swift `packages/import/ios/Core` 6,191 lines; Linux C++ `ac_linux_import_*` 7,376; Windows TS 3,184 + C++ `Import*.h` 2,894; re-counted at `2e9c24a46`; Rust F4) | Per import | Other browsers' files: SNSS, jsonlz4, SQLite, plist | C: about 19,600 lines in three languages. Coverage already differs (Dia's SQLCipher `tabs.db` is Mac only; Arc's sidebar isn't read on Linux). Two of the copies are already memory-safe (Swift 6,191 lines, TS 3,184); only the Linux C++ (7,376) and Windows C++ (2,894) would gain safety. Linux parses other apps' files in C++ inside the browser process, which Chromium's rule of 2 steers away from. No importer incident, crash report or fuzz finding is known: the safety case is asserted, not evidenced | Three current-stack alternatives: (1) keep the Swift readers as the reference and port only when a reader changes; (2) one shared TS reader set over native byte decoders (item 26's C++ decode on Windows, Swift on the Mac), which the repo's cross-platform language already supports, with its Hermes cost and the Linux file-access path stated; (3) for the rule of 2 alone, move Linux parsing out of the browser process, in any language; the isolation comes from being out of process | **Rust:** a pure-parser crate (bytes in, the existing result shapes out), as a staticlib on Mac and Windows; on Linux either a helper binary beside `chrome` (one engine change, then reader changes don't move the key) or Chromium's `rust_static_library` (crates vendored through gnrt, the key moves on every change). Costs: a fourth toolchain in three CI systems, about 20 formats to re-port, and an unknown: whether Bonzai's dependency updates cover Cargo | **Conditional: credible only for the C++ copies, and only if it beats shared TS readers.** Pilot one reader (Firefox `sessionstore.jsonlz4`, which all three have) only if cross-platform import parity becomes a goal. Step 0: count importer-path `$exception` and crash-report frames over the last 90 days, and fuzz the Linux C++ reader with malformed `sessionstore.jsonlz4` and SNSS; if both are zero, the rationale is maintenance only. Pass bar: identical results on the shared fixtures on all three platforms, bounded handling of malformed input, net lines deleted, and a 20 MB session decoded no slower than Swift. Compare against Swift, the Linux C++, Windows' current path and the shared-TS variant, measured the same way: bytes copied, peak memory, and packaged end-to-end latency including helper start-up and IPC, or static FFI |
| 15 | **Build and test tooling** (Rust F10) | Every check and agent loop | 116k lines typechecked in `apps/browser` | H: TypeScript 7's Go checker and Rust bundlers are faster | Already done in PR 2: Bun runs the suites, TypeScript 7.0.2 with the 6.0 API kept for the tools that need it | Use third-party Rust and Go tools; write none | **Not applicable** (no Rust of our own) |

**What would change the verdict:**
- (a) A Mac profile showing a CPU-bound pure-data path (not React, not layout) over 16 ms on Hermes in a common
  interaction. None is known; the Mac had no perf run on 2026-11-18 (item 49).
- (b) A sync format v2.
- (c) An owner goal for import parity across platforms (row 14), with step 0's crash and fuzz data.

**What would change the non-Rust plan:** an owner goal for RAM at low tab counts would make uBO Lite on Chromium
(row 4) worth testing; its alternative is not Rust.

Until one of these happens, a second language would cost a toolchain on 4 build systems, signing and packaging work,
and reviewers who know Rust, for no measured gain.

**The verdict in two sentences.** No workload clears the bar: the measured costs are DOM, compositor or engine C++
work, and the one CPU-bound JS path (the Linux session merge) needs an algorithm and protocol fix in the current stack
(a memo in JS, identity-preserving snapshots, then changed-id deltas from the engine), none of which Rust or WASM
would shorten. Rust is credible only as a parser crate replacing the two C++ copies of the import readers, and only
if it beats shared TS readers over native decoders; that is a maintenance bet, with a safety case still to be
evidenced, to pilot with one reader if import parity becomes a goal, not a speed fix.

## 6. Process and tooling recommendations (from 2026-11-18)

**Measure first.** Every number in this report is Linux, at N ≤ 100, in one window, on software GL. Before scheduling
the larger items, run the four measurement items: item 48 (profile S3-S5 on the final build), item 49 (Mac baseline
at scale), item 50 (Linux at N = 300 and 1,000, three windows, cold start and restore) and item 51 (Windows CPU and RAM
from the CI tours). Items 11, 12, 18, 22, 45, 46 and 47 should be re-scored from their results.

1. **Prebuilt engines for contributors** (item 10):
   - the Mac skew preflight (10c), which needs no engine change;
   - per-platform keys (10a);
   - an engine for `main`'s key every night on both platforms (10b), which needs a named Mac builder;
   - a CI smoke job on the newest prebuilt (with item 34).

   On 2026-11-18 both platforms ran engines three days old. The Linux engine (`3a64a10704ff`, 47 commits behind) ran
   every Linux measurement, PR 2's package smoke and the media. The Mac's would crash a stock Debug app, so PR 1's
   Mac run needed a test-only shim for the two missing `ArdiaCore.h` members. Neither platform could test an
   engine-touching change.
2. **Benchmark isolation.**
   - Every Phase 3 CPU number is attribution-grade:
     - the A/A floor is 9-22 % for S2-S5, and S1 has no usable floor;
     - the experiments ran at load 3-66 with 100-900 % foreign CPU on their cores.
   - Need one of: a cpuset that keeps other jobs off the bench cores, `isolcpus`, or `kernel.perf_event_paranoid` ≤ 1
     so retired instructions can be counted.
   - **The partition works.** The final bench on cores 10-15, in a cgroup under the perflab lock, saw a median of
     0.55 % foreign CPU per window and at most 22.1 % (one S2 window), against 78-904 % on cores 0-9 through the day;
     every window passed the quiet gate. It is not perfect: 26 of 112 windows saw more than 2 %. Make it the
     default for every CPU A/B, keep builds and agents on 0-9, and record foreign CPU per row.
   - A dedicated perflab slot to take the final PR 3 A/B from n = 4 per build to the floor report's 6, and for the
     open risks in section 1a (S3 latency, E1's reveal tail, the options-on S4/S5 run, F23).
   - Pass: a gated A/A at N = 100 with 6 launches per side gives an S3 CPU floor under 5 % and S4 under 8 % (today
     about 9 % and 15 %), or retired-instruction counts that repeat within 2 %.
3. **An allocator for displays and ports.** Two incidents on 2026-11-18:
   - E4's kill test drew on E6's display and port (`:206`/9406);
   - E6's input went to E4's Xvfb.

   A tiny lease tool (`lease display|port`) with stale-PID cleanup would prevent both. Pass: two agents starting 20
   instances each at once never share a display or port, and a lease whose PID died is reclaimed on the next request.
4. **Harness coverage** (`apps/linux/scripts/perf/bench.mjs`, which already has S1-S7, including S6 loading and S7
   the loading pill, `lib/runner.mjs:11`):
   - S8, sidebar scroll (§4 lead 1);
   - S9, a load storm (§4 lead 2);
   - a multi-window S3 and a 1,000-tab fixture (item 50);
   - `--switch-via store` as the default for CPU rows (the keyboard switcher race);
   - payload bytes per route;
   - an explicit focus step;
   - a Mac runner with the DEBUG counters (arch F11, item 49).

   **The Mac is the largest blind spot:** the release gates measure it at 1, 10 and 20 tabs (section 2), but nothing
   at 50 or 100 tabs, while a tab loads, or in the interactions PR 3 targeted.
5. **Count ratchets as CI gates.** Exact counters repeat to the digit even on this noisy host, so they make good gates
   where CPU % doesn't. DOM counters in S3-S5 have a 2.5-9 % floor, so gate on exact counts and on the loading
   scenario's zeros only:
   - viewport callbacks and region flushes per frame (≤ 1 while loading);
   - `tab.viewport` sends and host events per scenario;
   - HostTabs after the churn test (= base tabs);
   - session writes per 40 switches;
   - mutation records per second while loading (0 with E2);
   - ms per `elementFromPoint` flat in N, as a probe with a tolerance rather than an exact gate.

   Several already exist as unit tests (E1, E5, E6); a few need the Linux harness in CI.
6. **Required reviews.** E1, E3, E4 and E5 (all merged in PR 3), the integration's `368694d01` and `e02d6c59c`, and
   `d1fdb96ce` (consent) and `26dfa28d9` (a kept tab claim, a lifetime change) have had no Codex review (section 1a
   lists why each needs one, and why E2 and E6 don't). Run the reviews before landing.
7. **Test infrastructure:**
   - discovery-based `test:host` and an orphan check (item 4);
   - the F23 fix (item 6);
   - Mac native tests on push, not only at release (maint §9);
   - unit tests for `packages/expo-windows` (item 17: 17,457 TS lines at `50a1ef106`, 0 test files);
   - fake timers instead of the 7 × 1.1 s real waits (maint §10).
8. **CI queueing:** now item 2, measured first, with its experiment and pass criteria there.
9. **Widen the conventions checker** to `apps/linux/src`, `engine/ardiacore-linux`, Windows and phone, with a baseline
   (47 violations; `ac_linux_host.cc` is 8,434 lines against a 600 cap; maint §5). Split `ac_linux_host.cc` along its
   command table, placement code and event plumbing before the item 39 protocol work. Pass: the widened checker runs
   in `test:root` with the 47 violations as a committed baseline, fails on a new one, and the baseline only shrinks.
10. **A flaky host test** (item 9). `browserCommandRoute.test.mjs` fails intermittently in the full Linux `test:host`
    under load and passes alone 6/6 on stock and PR 1. Until its assertion is captured and its timing made
    test-owned, a red `test:host` on a busy host needs that file's failing assertion read before the run is
    dismissed; a standalone pass is triage, not proof that nothing regressed.
11. **CI on the fork.**
    - The owner's PRs pass the vouch gate, so every workflow ran by itself on PRs 1 and 2.
    - Their failures don't come from the PRs. Windows x64 and arm64 stop at "Fetch the engine", because upstream's
      pinned Windows engine release (`windows-engine-20261117-9`) isn't public ("release not found"); every fork branch
      fails there. Linux `checks` fails the engine's `test_live`, which already fails on stock
      (`live_provider_contract.test.mjs:184`).
    - Upstream's CLA, Vouch, Vouch manage, Linked issue and Deploy workflows are switched off on the fork, following the
      owner's decision to drop upstream governance.
12. **Mac access for verification.** On 2026-11-18 the Mac's network ran at about 3-35 KB/s, so a Bun install on macOS
    wasn't possible and PR 2, the toolchain change PRs 3 and 4 sit on, is unverified there. PR 1's Mac check worked only because its delta to an existing Debug
    build was JS-only. A Mac with a warm Bun cache and a matching prebuilt, or item 34's macOS CI job, removes this
    dependency.
13. **Worktrees against AGENTS.md.** The automated workflow that produced PRs 1-4 created its branches with
    `git worktree add` (more than twelve under one scratch folder), although AGENTS.md says "No git worktrees, ever."
    Decide whether automated workflows get a written exception. Item 23's guard hook should block `git worktree add`
    without one, and allowlist nothing until that decision is made.

## 7. Appendix: evidence index

The sources below live in the audit workspace on the measuring host (`~/ardia-work`), off the repository, and won't
survive that host. **The numbers quoted inline in this report are the record.** The section 1b bench tables were
regenerated from the per-launch JSON with a short script that reads, for each launch in
`bench/out/final-light/results/*.json`, `scenarios.<S>.cpu.<process>.cpuPct` and `scenarios.<S>.contention.foreignPct`,
(`cpu.total.cpuPct` for the whole app) and takes the range per build.

**Phase 3:**
- Pre-read: `~/ardia-work/reports/inspect/phase3-perf-preread.md`.
- Round 1:
  - `~/ardia-work/reports/phase3/r1/shell-idle-active.md`
  - `~/ardia-work/reports/phase3/r1/interactions.md`
  - `~/ardia-work/reports/phase3/r1/browser-renderer-gpu.md`
  - `~/ardia-work/reports/phase3/r1/memory.md`
  - `~/ardia-work/reports/phase3/r1/ranking.md`
- Experiments:
  - `~/ardia-work/reports/phase3/r1/e1-result.md` (data `~/ardia-work/data/phase3/e1/`)
  - `~/ardia-work/reports/phase3/r1/e2-result.md` (`data/phase3/e2/`)
  - `~/ardia-work/reports/phase3/r1/e3-result.md` (`data/phase3/e3/`)
  - `~/ardia-work/reports/phase3/r1/e4-result.md` (`data/phase3/e4/`)
  - `~/ardia-work/reports/phase3/r1/e5-result.md` (`data/phase3/e5/`, reviews `data/phase3/e5-review*`)
  - `~/ardia-work/reports/phase3/r1/e6-result.md` (`data/phase3/e6/`)
- Round-1 raw data: `~/ardia-work/data/phase3/r1/` (`brg/`, `memory/`, `interactions/`, `shell-idle-active/`).
- Integration: `~/ardia-work/reports/phase3/integration.md` (final, 13:37, with §4a's S6/S7 bench), branch
  `phase3/perf-hill-climb` (head `e02d6c59c`), data `~/ardia-work/data/phase3/int/`. `integrated-measure.md` was
  never written; §4a holds those numbers.
- Measured final: `2e9c24a46` (E4 merged at `9a828f35e`). PR 3's head when this report was written: `d3a803217`.
- Partitioned bench of stock, PR 1, PR 2's UI and final: `~/ardia-work/bench/out/final-light/` (`results/`, one log per
  launch in `logs/`; all 16 launches, 4 per build, finished at 15:22 UTC, after which section 1b was regenerated).
- PR 3 media and its CPU A/B: `~/ardia-work/media/pr3/README.md` (`data/cpu-shell-bun-vs-final.json`,
  `cpu-by-process-type.json`, `reveal-display-bun-vs-final.json`).

**Baselines and harness:**
- Harness and recipe, in the repo: `apps/linux/scripts/perf/` and `docs/perf/linux-bench.md` (scenarios, the four-build
  recipe, CPU isolation, limits and open leads). The off-repo copy the runs used: `~/ardia-work/bench/harness/`.
- `~/ardia-work/reports/bench-baseline-linux.md` (tables `~/ardia-work/bench/results/stock-baseline/tables.md`)
- `~/ardia-work/reports/bench-noise-floor.md` (`~/ardia-work/bench/out/aa-100-gated/noise.md`, `report.md`)

**First-pass audits:**
- `~/ardia-work/reports/audit/architecture-ipc.md`
- `~/ardia-work/reports/audit/rendering-state.md`
- `~/ardia-work/reports/audit/maintainability-tooling.md`
- `~/ardia-work/reports/audit/reliability.md` and `~/ardia-work/reports/audit/rust-evaluation.md` (both at
  `e522661dd`, re-checked at `2e9c24a46`)

**Phases 1 and 2:**
- `~/ardia-work/reports/phase1/integration.md` (Council and Fable sections; logs `~/ardia-work/reports/phase1/integration/`),
  `~/ardia-work/reports/phase1/manual-checklist.md`
- `~/ardia-work/reports/phase2/final.md`, `merge.md`, `bundling.md` (and `A-deps.md`, `B-build.md`, `C-tests.md`, `D-ci.md`)
- `~/ardia-work/media/pr1/README.md` (reveal blank frames; `reveal-measurement.csv`, `reveal-timeline.csv`)
- `~/ardia-work/reports/setup-linux.md`
- PR descriptions: `~/ardia-work/prs/pr1.md` (the Mac A-G run and #1679), `~/ardia-work/prs/pr2.md` (Mac not
  verified, fork CI gating)

**Measured for this report** (scratch, outside the repo; nothing in the repo changed):
- `~/ardia-work/reports/audit/scratch/session-bench.mjs`, `session-bench-memo.mjs`, `hostSessionMerge.memo.ts`,
  `session-bench.out`, `session-bench-memo.out`, `cold.out`. These are session-merge timings at 101 and 1,010 tabs on
  `~/ardia-work/data/phase3/e4/bytes/e4-n100/Default/Ardia/linux-session.json`.
- `~/ardia-work/reports/audit/scratch/ungated-consent.test.mjs`: item 1a's pending opt-in reproduction, run with
  `bun test --preload ./src/test-preload.mjs` from `apps/browser` of a `d3a803217` checkout (it imports that checkout's
  `src`).
- `~/ardia-work/reports/audit/scratch/micro-bench.out`: the repo's `apps/browser/scripts/perf/micro-bench.mjs` at
  `50a1ef106`.
- Engine key distance: `engine/engine-key.sh` over `git log -- engine apps/browser/assets/offline-game*`.
  - Mac nearest `8b7edf233fae` at `991f98e9e`, 44 commits.
  - Linux nearest `3a64a10704ff` at `1bd3ca961`, 47 commits.
  - `ArdiaCore.h` members: 0 at `991f98e9e`, 2 at HEAD.

**Code citations checked at `50a1ef106` or `2e9c24a46`** (the consent files and the harness at `d3a803217`):
- `engine/ardiacore-linux/src/ardia/linux/ac_linux_host.cc:3330-3340` (`LayoutOverlay`) and `:6930` (`No owned live tab`)
- `engine/chromium/src/chrome/browser/ardia/ac_process.cc:95-121`
- `apps/browser/src/state/tabs/taskSampler.ts:3-20`
- `apps/browser/src/state/telemetry/consentedCount.ts` (used by `notificationRequestCounts.ts`, `webNotificationCounts.ts`,
  and in PR 3 by `tabReleaseCounts.ts` and `sessionWrites.ts`; `sharingAgreed` added in `d1fdb96ce`),
  `hourlyExtras.ts:30` and `client.ts:131-132`, at `d3a803217`
- `apps/linux/scripts/perf/lib/runner.mjs:11` (S1-S7) and `:499` (S6), at `d3a803217`
- `apps/browser/src/state/tabs/loadedTabBudget.ts:23-40,58-84`, `apps/linux/src/hostSession.ts:257-262`
- `apps/browser/src/lib/platformFeatures.windows.ts`, `apps/browser/src/state/telemetry/platformWording.ts:11`,
  `packages/expo-windows/src/engine/domains/systemState.ts:6-18`
- `packages/ardiacore/scripts/ubo.sh`, `ubol.sh`, `embed.sh:35-51`; `packages/demo/scripts/icons/check.mjs:5-8`
- `node_modules/react-native-web/dist/modules/usePressEvents/PressResponder.js:313`
- `apps/linux/src/hostSessionMerge.ts:11-16,36-80`
- `apps/linux/src/inputRegions.ts:9-10,194-195`
- `apps/linux/src/shims/web/HostWebView.tsx:90`
- `docs/linux-port.md:1859-1866`

## 8. Appendix: review trail

A completeness critic, a four-member review council and a final review checked this report against its sources; each
accepted correction was re-checked before it was applied, and a script recomputes every score and the sort order.
What a reader should still treat with care:
- **Section 1b's CPU gains** are at n = 4 per build, under the noise-floor report's 6 per side, and the final build
  measured is `2e9c24a46`: `d1fdb96ce` and `26dfa28d9` changed shipped JS after it, unmeasured.
- **S3 switch latency** on the final build is unresolved (section 1a, open risks), not a proven regression or parity.
- **Every GPU and frame number is software GL**, and the bench (ANGLE/llvmpipe) and the media run (SwiftShader) used
  different renderers (section 1b).
- **Item 1a's reproduction** is one scratch test with a modelled leader, not two live windows; the 18-of-22 split is a
  grep of each source file, not a trace of its delegates.
- **Item 11's merge timings** come from a micro-bench whose runtime (V8 or JavaScriptCore) wasn't recorded.
- **Ready tests that were never run:** item 3's Alt-click and item 5's `{"version": 99}` fixture, hence their
  evidence 2 and 1. Item 43 can't run off macOS and is labelled H.
- **Item 2's CI queue** was measured upstream on 3 runs from one burst; its cause is in doubt.
- **Mac and Windows paths were read, not run** (section 2, Limits). The reliability and Rust angles were re-checked
  at `2e9c24a46`; only the consent files and the harness were re-read at `d3a803217`.
- **The ranking is the rubric plus judgement:** item 48 ranks second on an evidence score of 2, and the impact of the
  measurement items (48-51) is the value of what they unblock.
