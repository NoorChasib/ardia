import { join } from "node:path";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { attach } from "./cdp.mjs";
import { tabSet } from "./fixtures.mjs";
import { SHELL_PROBE, PAGE_READ } from "./probes.mjs";
import { ProcSampler, memoryByKind } from "./procs.mjs";
import { copyProfile, launch, quit, shellSession, startFixtures, startXvfb, stopFixtures, stopXvfb, SCREEN } from "./instance.mjs";
import { js, loadAverage, log, pause, until } from "./util.mjs";

export const SCENARIOS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"];
const PERF_DELTAS = ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "LayoutCount", "RecalcStyleCount"];
const PERF_LEVELS = ["JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "JSEventListeners", "Documents", "Frames"];

class AbortedError extends Error {}

let current = null;

export function abortCurrent(reason) {
  if (current) current.abortReason ??= reason;
}

export function currentLaunch() {
  return current;
}

async function metrics(shell) {
  const { metrics: list } = await shell.send("Performance.getMetrics", {}, { timeout: 10000 });
  return Object.fromEntries(list.map(({ name, value }) => [name, value]));
}

function perfDelta(before, after) {
  const out = {};
  for (const name of PERF_DELTAS) {
    const d = (after[name] ?? 0) - (before[name] ?? 0);
    out[name.endsWith("Duration") ? `${name}Ms` : name] = name.endsWith("Duration") ? Math.round(d * 1e5) / 100 : d;
  }
  return out;
}

const perfLevels = (m) => Object.fromEntries(PERF_LEVELS.map((name) => [name, m[name] ?? null]));

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const quantile = (values, q) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const summary = (values) => ({ n: values.length, median: median(values), p90: quantile(values, 0.9), max: values.length ? Math.max(...values) : null, min: values.length ? Math.min(...values) : null });

export class Launch {
  constructor(options) {
    Object.assign(this, options);
    this.abortReason = null;
    this.result = {
      runId: this.runId,
      launchId: this.launchId,
      label: this.build.label,
      build: this.build.dir,
      commit: this.build.commit,
      buildInfo: this.build.info,
      fingerprint: this.fingerprint,
      config: this.configFingerprint,
      launchIndex: this.launchIndex,
      blockIndex: this.blockIndex,
      run: this.runIndex,
      attempt: this.attempt,
      instrument: this.instrument,
      partition: this.partition ?? null,
      startedAt: new Date().toISOString(),
      tabsRequested: this.tabs,
      scenarios: {},
      discarded: {},
      windows: [],
      notes: [],
    };
  }

  check() {
    if (this.abortReason) throw new AbortedError(this.abortReason);
    if (this.app?.exited) throw new Error(`chrome exited (${this.app.exitCode})`);
  }

  async sleep(ms) {
    this.check();
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await pause(Math.min(250, end - Date.now()));
      this.check();
    }
  }

  xdotool(args, timeout = 5000) {
    this.check();
    return new Promise((resolve, reject) => {
      const child = spawn("xdotool", args, { env: { ...process.env, DISPLAY: `:${this.xvfb.display}` }, stdio: "ignore" });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`xdotool ${args.join(" ")} timed out`));
      }, timeout);
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`xdotool ${args.join(" ")} exited ${code}`));
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  move(x, y) {
    return this.xdotool(["mousemove", "--", String(Math.round(x)), String(Math.round(y))]);
  }

  get full() {
    return this.instrument !== "light";
  }

  async readPages(t0 = null, t1 = null) {
    const { targetInfos } = await this.app.browser.send("Target.getTargets", {}, { timeout: 10000 });
    const pages = targetInfos.filter((t) => t.type === "page" && t.url.startsWith(this.fixtures.base));
    const out = [];
    let failed = 0;
    for (const target of pages) {
      this.check();
      let session;
      try {
        session = await attach(this.app.browser, target.targetId, 5000);
        const value = await session.eval(PAGE_READ(t0, t1), { timeout: 5000, userGesture: false });
        if (value) out.push({ ...value, targetId: target.targetId });
        else failed++;
      } catch {
        failed++;
      } finally {
        await session?.detach();
      }
    }
    this.lastReadAt = Date.now();
    return { pages: out, targets: pages.length, failed };
  }

  shellEval(expression, timeout = 30000) {
    this.check();
    return this.shell.eval(expression, { timeout });
  }

  state(body, timeout) {
    return this.shellEval(`(() => { const s = ardiaLinux.store.getState(); const windowId = __ardiaHost.bootstrap.windowId; const w = s.windows[windowId]; ${body} })()`, timeout);
  }

  async identifyShellPid() {
    const renderers = (await this.sampler.current()).filter((p) => p.kind === "page" || p.kind === "shell");
    const pids = renderers.map((p) => p.pid);
    if (!pids.length) throw new Error("no renderer processes found for the shell");
    const before = await this.sampler.ticks(pids);
    await this.shellEval("__benchProbe.burn(600)");
    const after = await this.sampler.ticks(pids);
    const ranked = pids.map((pid) => ({ pid, delta: (after[pid] ?? 0) - (before[pid] ?? 0) })).sort((a, b) => b.delta - a.delta);
    if (!ranked.length || ranked[0].delta < 20) throw new Error(`could not identify the shell renderer (best delta ${ranked[0]?.delta} ticks)`);
    this.result.shellPid = ranked[0].pid;
    this.result.preTabRenderers = pids.length;
    await this.sampler.setShell([ranked[0].pid]);
    return ranked[0].pid;
  }

  async validateSettings() {
    const keys = Object.keys(this.settings);
    if (!keys.length) return;
    const known = await this.state(`return ${js(keys)}.filter((k) => !(k in s.settings));`);
    if (known.length) throw new Error(`--settings keys this build does not know: ${known.join(", ")}`);
  }

  async seedTabs() {
    const set = tabSet(this.tabs);
    const urls = set.map((t) => `${this.fixtures.base}${t.path}`);
    this.tabList = await this.state(`const urls = ${js(urls)}; const first = w.activeTabIds[w.profileId]; s.navigate(first, urls[0]); const ids = [first]; for (const url of urls.slice(1)) ids.push(s.newTab(windowId, { url, background: true })); return ids;`);
    if (!Array.isArray(this.tabList) || this.tabList.length !== this.tabs) throw new Error(`created ${this.tabList?.length} tabs, wanted ${this.tabs}`);
    this.tabInfo = set.map((t, i) => ({ ...t, id: typeof this.tabList[i] === "string" ? this.tabList[i] : this.tabList[i]?.id ?? this.tabList[i], url: urls[i] }));
    for (const tab of this.tabInfo) {
      await this.state(`s.activate(${js(tab.id)}); return true;`);
      await this.sleep(300);
    }
    await this.state(`s.activate(${js(this.tabInfo[0].id)}); return true;`);
    const loaded = await until(
      () => this.state(`const ids = ${js(this.tabInfo.map((t) => t.id))}; const pending = ids.filter((id) => { const t = s.tabs[id]; return !t || s.live?.[id]?.isLoading || !t.title || t.title === t.url; }); return pending.length === 0 ? { loaded: ids.length } : false;`, 10000),
      { timeout: 60000 + this.tabs * 1000, interval: 1000, label: "all tabs loaded", abort: () => this.abortReason ?? (this.app.exited ? `chrome exited (${this.app.exitCode})` : null) },
    );
    this.result.tabsLoaded = loaded.loaded;
  }

  async verifyTabs(stage) {
    const { targetInfos } = await this.app.browser.send("Target.getTargets", {}, { timeout: 10000 });
    const fixturesTargets = targetInfos.filter((t) => t.type === "page" && t.url.startsWith(this.fixtures.base));
    const perUrl = new Map();
    for (const t of fixturesTargets) perUrl.set(t.url, (perUrl.get(t.url) ?? 0) + 1);
    const missing = this.tabInfo.filter((t) => !perUrl.has(t.url)).map((t) => t.index + 1);
    const duplicated = [...perUrl.entries()].filter(([, n]) => n > 1).map(([url]) => url);
    const stray = [...perUrl.keys()].filter((url) => !this.tabInfo.some((t) => t.url === url));
    const loading = await this.state(`return ${js(this.tabInfo.map((t) => t.id))}.filter((id) => !s.tabs[id] || s.live?.[id]?.isLoading).length;`);
    const check = { stage, targets: fixturesTargets.length, missing: missing.length, duplicated: duplicated.length, stray: stray.length, loading };
    this.result.tabChecks = [...(this.result.tabChecks ?? []), check];
    this.result.pageTargets = fixturesTargets.length;
    if (missing.length || duplicated.length || stray.length || loading) throw new Error(`tab set not intact at ${stage}: ${fixturesTargets.length} targets for ${this.tabs} tabs, missing ${missing.slice(0, 10).join(",")}, duplicated ${duplicated.length}, stray ${stray.length}, loading ${loading}`);
  }

  async gc() {
    await this.shell.send("HeapProfiler.collectGarbage", {}, { timeout: 30000 });
  }

  async quietGate() {
    if (!(this.quietGatePct > 0)) return null;
    const started = Date.now();
    let last = null;
    for (;;) {
      const a = await this.sampler.mark();
      await this.sleep(3000);
      const b = await this.sampler.mark();
      last = (await this.sampler.window(a, b)).contention?.foreignPct ?? null;
      const waitedS = Math.round((Date.now() - started) / 100) / 10;
      if (last === null) return { passed: true, waitedS, foreignPct: null };
      if (last < this.quietGatePct) return { passed: true, waitedS, foreignPct: Math.round(last) };
      if (Date.now() - started >= this.quietWaitS * 1000) return { passed: false, waitedS, foreignPct: Math.round(last) };
    }
  }

  async window(name, body, { pages = true, discard = false, prepare = null } = {}) {
    const sinceRead = Date.now() - (this.lastReadAt ?? 0);
    if (sinceRead < this.readSettleMs) await this.sleep(this.readSettleMs - sinceRead);
    const gate = await this.quietGate();
    if (prepare) await prepare();
    await this.sleep(1000);
    const loadStart = loadAverage();
    await this.shellEval("__benchProbe.reset()");
    const perf0 = await metrics(this.shell);
    const mark0 = await this.sampler.mark();
    const t0 = Date.now();
    const outcome = (await body()) ?? {};
    const mark1 = await this.sampler.mark();
    const t1 = Date.now();
    const perf1 = await metrics(this.shell);
    const probe = await this.shellEval("__benchProbe.snapshot()");
    const loadEnd = loadAverage();
    const procs = await this.sampler.window(mark0, mark1);
    const read = pages ? await this.readPages(t0, t1) : null;
    const extra = typeof outcome.extra === "function" ? outcome.extra(probe, read?.pages ?? []) : {};
    const foreign = procs.contention?.foreignPct ?? null;
    const contended = this.maxForeignPct > 0 && foreign !== null && foreign > this.maxForeignPct;
    const record = {
      window: { startedAt: new Date(t0).toISOString(), t0, t1, seconds: (t1 - t0) / 1000, loadStart, loadEnd },
      valid: (outcome.valid ?? true) && !contended,
      invalidReason: outcome.invalidReason ?? (contended ? `contended: ${Math.round(foreign)} % foreign CPU on the app's cores (ceiling ${this.maxForeignPct} %)` : null),
      contended,
      gate,
      instrument: probe.mode,
      cpu: procs.byKind,
      shellThreads: procs.shellThreads,
      aux: procs.aux,
      contention: procs.contention,
      sampling: { ...procs.sampling, samples: procs.samples },
      perf: perfDelta(perf0, perf1),
      levels: perfLevels(perf1),
      counts: probe.counts,
      chromeSend: probe.chromeSend,
      hostEvents: probe.hostEvents,
      loaf: probe.loaf,
      interactions: probe.events,
      pages: read ? pageRates(read, this.tabs) : null,
      ...extra,
    };
    this.result.windows.push({ name, discard, loadStart, loadEnd, foreignPct: foreign, gate });
    if (discard) this.result.discarded[name] = record;
    else this.result.scenarios[name] = record;
    log(`  ${name}${discard ? " (discarded)" : ""}: total CPU ${record.cpu.total.cpuPct.toFixed(1)} %, shell ${record.cpu.shell?.cpuPct?.toFixed(1) ?? "-"} %, foreign on our cores ${procs.contention?.foreignPct?.toFixed(0) ?? "-"} %, load ${loadStart?.one} -> ${loadEnd?.one}${record.valid ? "" : `, INVALID: ${record.invalidReason}`}`);
    return record;
  }

  async s1() {
    const idle = async () => {
      await this.sleep(this.idleSeconds * 1000);
      return {};
    };
    if (this.idleDiscardSeconds > 0) {
      await this.window("S1", async () => {
        await this.sleep(this.idleDiscardSeconds * 1000);
        return {};
      }, { discard: true, pages: false });
    }
    await this.window("S1", idle);
  }

  async s2() {
    const raf = this.tabInfo.find((t) => t.kind === "raf");
    const ticker = this.tabInfo.find((t) => t.kind === "ticker");
    if (!raf) {
      this.result.notes.push("S2 skipped: no raf tab in the set");
      return;
    }
    let split = null;
    let invalid = null;
    if (ticker && this.splitTicker) {
      split = await this.state(`try { return s.createSplit([${js(raf.id)}, ${js(ticker.id)}]) ?? null; } catch (e) { return { error: String(e) }; }`).catch((e) => ({ error: e.message }));
      if (!split || typeof split === "object") {
        invalid = `split failed: ${split?.error ?? "createSplit returned nothing"}`;
        split = null;
      }
    }
    await this.state(`s.activate(${js(raf.id)}); return true;`);
    await this.sleep(2000);
    const { pages } = await this.readPages();
    const visibility = Object.fromEntries(pages.filter((p) => p.url === raf.url || (ticker && p.url === ticker.url)).map((p) => [p.kind, p.visibility]));
    if (visibility.raf !== "visible") invalid ??= `rAF page is ${visibility.raf ?? "missing"}`;
    if (this.splitTicker && ticker && visibility.ticker !== "visible") invalid ??= `ticker page is ${visibility.ticker ?? "missing"}`;
    await this.window("S2", async () => {
      await this.sleep(this.activeSeconds * 1000);
      return { valid: !invalid, invalidReason: invalid, extra: () => ({ foreground: { split: !!split, visibility } }) };
    });
    if (split) await this.state(`s.separateSplit(${js(split)}); return true;`).catch(() => {});
    await this.state(`s.activate(${js(this.tabInfo[0].id)}); return true;`);
    await this.sleep(2000);
  }

  async s3() {
    const statics = this.tabInfo.filter((t) => t.kind === "static");
    if (statics.length < 2) return;
    const [one, two] = statics;
    await this.state(`s.activate(${js(two.id)}); return true;`);
    await this.sleep(1000);
    await this.state(`s.activate(${js(one.id)}); return true;`);
    await this.sleep(1500);
    const byKey = this.switchVia === "key";
    const mru = byKey && /^ctrl\+tab$/i.test(this.switchKey);
    const presses = [];
    await this.window("S3", async () => {
      if (this.full) await this.shellEval(`__benchProbe.startFrames("switch")`);
      for (let i = 0; i < this.switches; i++) {
        const want = byKey && !mru ? null : i % 2 === 0 ? two : one;
        const at = Date.now();
        if (byKey) await this.xdotool(["key", "--clearmodifiers", this.switchKey]);
        else await this.state(`s.activate(${js(want.id)}); return true;`);
        const press = { at, want: want?.id ?? null, recovered: null };
        presses.push(press);
        const left = at + this.switchIntervalMs - Date.now();
        if (left > 0) await this.sleep(left);
        if (want) {
          const now = await this.shellEval(`({ active: __benchProbe.lastActive(), open: __benchProbe.switcherOpen() })`);
          if (now.open || now.active !== want.id) {
            if (now.open) await this.xdotool(["key", "Escape"]);
            await this.sleep(150);
            await this.state(`s.activate(${js(want.id === one.id ? two.id : one.id)}); return true;`);
            await this.sleep(300);
            await this.state(`s.activate(${js(want.id)}); return true;`);
            await this.sleep(300);
            press.recovered = now.open ? "switcher-open" : "wrong-tab";
          }
        }
      }
      await this.sleep(1000);
      const frames = this.full ? await this.shellEval("__benchProbe.stopFrames()") : null;
      const recoveries = presses.filter((p) => p.recovered).length;
      const workload = { expected: this.switches, presses: presses.length, recoveries, matched: recoveries === 0 && presses.length === this.switches };
      return { extra: (probe, pagesAfter) => ({ workload, frames: framesSummary(frames), switches: switchLatency(presses, probe, pagesAfter, this.tabInfo, byKey) }) };
    });
    await this.state(`s.activate(${js(this.tabInfo[0].id)}); return true;`);
    await this.sleep(1500);
  }

  async withSettings(name, patch, body) {
    const keys = Object.keys(patch);
    if (!keys.length) return body();
    const read = () => this.state(`return Object.fromEntries(${js(keys)}.map((k) => [k, s.settings[k] ?? null]));`);
    const differ = (got, want) => keys.filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
    const previous = await read();
    try {
      await this.state(`s.updateSettings(${js(patch)}); return true;`);
      const applied = await read();
      this.result.settingsApplied = { ...this.result.settingsApplied, [name]: applied };
      const wrong = differ(applied, patch);
      if (wrong.length) throw new Error(`${name} settings did not apply: ${wrong.join(", ")}`);
      return await body();
    } finally {
      await this.state(`s.updateSettings(${js(previous)}); return true;`);
      await this.sleep(1000);
      const wrong = differ(await read(), previous);
      if (wrong.length) throw new Error(`${name} settings were not restored: ${wrong.join(", ")}`);
    }
  }

  s4() {
    const { autoHideTabs, ...patch } = this.settings;
    return this.withSettings("S4", patch, () => this.edgeScenario());
  }

  async edgeScenario() {
    await this.state(`s.updateSettings({ autoHideTabs: true }); return true;`);
    await this.move(SCREEN.width / 2, SCREEN.height / 2);
    await this.sleep(2000);
    const y = Math.round(SCREEN.height / 2);
    const rowLeft = await this.shellEval(`__benchProbe.rowLeft(${js(this.tabInfo[0].title)})`);
    const hiddenOk = typeof rowLeft === "number" && rowLeft < -1000;
    const rowProbe = `__benchProbe.rowLeft(${js(this.tabInfo[0].title)})`;
    await this.window(
      "S4",
      async () => {
        if (this.full) await this.shellEval(`__benchProbe.startFrames("edge", { rowTitle: ${js(this.tabInfo[0].title)} })`);
        let revealed = 0;
        let hidden = 0;
        for (let i = 0; i < this.edgeRepeats; i++) {
          await this.move(40, y);
          await this.move(0, y);
          await this.sleep(600);
          const shownLeft = await this.shellEval(rowProbe);
          if (typeof shownLeft === "number" && shownLeft > -1000) revealed++;
          await this.move(SCREEN.width / 2, y);
          await this.sleep(600);
          const hiddenLeft = await this.shellEval(rowProbe);
          if (typeof hiddenLeft === "number" && hiddenLeft < -1000) hidden++;
        }
        const frames = this.full ? await this.shellEval("__benchProbe.stopFrames()") : null;
        const unarmed = frames ? Math.max(0, this.edgeRepeats - frames.arms) : null;
        const workload = { expected: this.edgeRepeats, revealed, hidden, matched: revealed === this.edgeRepeats && hidden === this.edgeRepeats };
        return {
          valid: hiddenOk,
          invalidReason: hiddenOk ? null : `sidebar not hidden before S4 (row left ${rowLeft})`,
          extra: () => ({ workload, frames: framesSummary(frames), reveal: frames ? { ...summary(frames.reveals), arms: frames.arms, unarmed, timedOut: frames.misses, misses: frames.misses + unarmed, expected: this.edgeRepeats } : null }),
        };
      },
      { pages: false },
    );
    await this.state(`s.updateSettings({ autoHideTabs: false }); return true;`);
    await this.sleep(2000);
  }

  s5() {
    return this.withSettings("S5", this.settings, () => this.hoverScenario());
  }

  async hoverScenario() {
    await this.move(SCREEN.width / 2, SCREEN.height / 2);
    await this.sleep(1500);
    const rows = [];
    let unhittable = 0;
    for (const tab of this.tabInfo) {
      const rect = await this.shellEval(`__benchProbe.findRow(${js(tab.title)})`);
      if (rect && rect.clientLeft >= 0 && rect.clientTop >= 0 && rect.clientBottom <= SCREEN.height) {
        if (rect.hittable) rows.push({ title: tab.title, ...rect });
        else unhittable++;
      }
      if (rows.length >= this.hoverRows) break;
    }
    if (!rows.length) {
      this.result.notes.push("S5 skipped: no sidebar rows on screen");
      return;
    }
    const plan = rows.map((r) => ({ title: r.title }));
    const invalid = rows.length < Math.min(this.hoverRows, this.tabs) ? `only ${rows.length} hittable rows (${unhittable} covered)` : null;
    await this.window(
      "S5",
      async () => {
        const started = this.full ? await this.shellEval(`__benchProbe.startFrames("hover", { rows: ${js(plan)} })`) : null;
        for (let pass = 0; pass < this.hoverPasses; pass++) {
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const x = (r.clientLeft + r.clientRight) / 2;
            const yy = (r.clientTop + r.clientBottom) / 2;
            if (i === 0) await this.move(x - 8, yy);
            await this.move(x, yy);
            await this.sleep(i === 0 ? this.hoverFirstDwellMs : this.hoverDwellMs);
          }
          await this.move(SCREEN.width / 2, SCREEN.height / 2);
          await this.sleep(1000);
        }
        const frames = this.full ? await this.shellEval("__benchProbe.stopFrames()") : null;
        const expected = rows.length * this.hoverPasses;
        const rowInvalid = frames && started && started.rowsFound < rows.length ? `probe found ${started.rowsFound}/${rows.length} rows` : null;
        const entryInvalid = frames && frames.rowEntries < expected ? `pointer entered ${frames.rowEntries}/${expected} rows` : null;
        const reason = invalid ?? rowInvalid ?? entryInvalid;
        return {
          valid: !reason,
          invalidReason: reason,
          extra: () => {
            if (!frames) return { hover: { rows: rows.length, passes: this.hoverPasses, expected } };
            const warm = frames.hovers.filter((h) => h.warm).map((h) => h.ms);
            const cold = frames.hovers.filter((h) => !h.warm).map((h) => h.ms);
            return { frames: framesSummary(frames), hover: { rows: rows.length, passes: this.hoverPasses, expected, entries: frames.rowEntries, offRow: frames.offRow, shown: frames.hovers.length, warm: summary(warm), cold: summary(cold), superseded: frames.superseded, misses: frames.misses } };
          },
        };
      },
      { pages: false },
    );
  }

  s6() {
    return this.loadingScenario("S6", { pill: false });
  }

  s7() {
    return this.loadingScenario("S7", { pill: true });
  }

  async layoutState(tab, rowTitle) {
    return this.shellEval(`(() => { const s = ardiaLinux.store.getState(); const w = s.windows[__ardiaHost.bootstrap.windowId]; return { active: w?.activeTabIds?.[w.profileId] ?? null, loading: !!s.live?.[${js(tab.id)}]?.isLoading, pill: __benchProbe.shown('[aria-label="Loading page"]'), addressBar: s.settings.addressBar ?? null, rowLeft: __benchProbe.rowLeft(${js(rowTitle)}) }; })()`);
  }

  async pendingSlow(token) {
    const response = await fetch(`${this.fixtures.base}/pending`, { signal: AbortSignal.timeout(5000) });
    const { slow } = await response.json();
    return (slow?.[token] ?? 0) > 0;
  }

  async loadingCheck(tab, rowTitle, token, { pill, layout }) {
    const st = await this.layoutState(tab, rowTitle);
    st.pending = await this.pendingSlow(token);
    const sidebarShown = typeof st.rowLeft === "number" && st.rowLeft >= 0;
    const sidebarHidden = typeof st.rowLeft === "number" && st.rowLeft < -1000;
    const problems = [];
    if (st.active !== tab.id) problems.push(`tab 1 is not the active tab (active ${st.active})`);
    if (!st.loading) problems.push("the active tab is not loading");
    if (!st.pending) problems.push("its /slow request is not pending at the fixture server");
    if (pill) {
      if (st.addressBar !== "sidebar") problems.push(`addressBar is ${st.addressBar}, not sidebar`);
      if (!sidebarHidden) problems.push(`sidebar not hidden (row left ${st.rowLeft})`);
      if (!st.pill?.visible) problems.push(`the loading pill is not visible (${JSON.stringify(st.pill)})`);
    } else {
      if (st.addressBar !== layout.addressBar) problems.push(`addressBar is ${st.addressBar}, not ${layout.addressBar}`);
      if (!sidebarShown) problems.push(`sidebar not shown (row left ${st.rowLeft})`);
      if (st.pill?.visible) problems.push("the loading pill is visible");
    }
    st.sidebarHidden = sidebarHidden;
    st.problems = problems;
    return st;
  }

  async loadingScenario(name, { pill }) {
    const tab = this.tabInfo[0];
    const rowTitle = (this.tabInfo[1] ?? tab).title;
    const token = `${this.launchId}-${name}-${Date.now()}`;
    const slowUrl = `${this.fixtures.base}/slow/${this.slowMs}?bench=${encodeURIComponent(token)}`;
    await this.state(`s.activate(${js(tab.id)}); return true;`);
    await this.move(SCREEN.width / 2, SCREEN.height / 2);
    await this.sleep(1500);
    const before = await this.layoutState(tab, rowTitle);
    const layoutProblems = [];
    if (!(typeof before.rowLeft === "number" && before.rowLeft >= 0)) layoutProblems.push(`sidebar not shown (row left ${before.rowLeft})`);
    if (before.addressBar === "sidebar") layoutProblems.push("addressBar is already sidebar");
    if (before.active !== tab.id) layoutProblems.push(`tab 1 is not active (${before.active})`);
    if (before.loading) layoutProblems.push("tab 1 is still loading");
    if (before.pill?.visible) layoutProblems.push("the loading pill is already visible");
    if (layoutProblems.length) throw new Error(`${name}: default layout not in place before the scenario: ${layoutProblems.join("; ")}`);
    let toggled = false;
    let addressMoved = false;
    let start = null;
    try {
      if (pill) {
        addressMoved = true;
        await this.state(`s.updateSettings({ addressBar: "sidebar" }); return true;`);
        await this.sleep(500);
        toggled = true;
        await this.state(`s.toggleSidebar(windowId); return true;`);
        await this.sleep(1500);
      }
      await this.window(
        name,
        async () => {
          start = await this.loadingCheck(tab, rowTitle, token, { pill, layout: before });
          if (this.full) await this.shellEval(`__benchProbe.startFrames("loading")`);
          await this.sleep(this.loadingSeconds * 1000);
          const frames = this.full ? await this.shellEval("__benchProbe.stopFrames()") : null;
          const end = await this.loadingCheck(tab, rowTitle, token, { pill, layout: before });
          const reason = start.problems.length ? `at the start: ${start.problems.join("; ")}` : end.problems.length ? `at the end: ${end.problems.join("; ")}` : null;
          return {
            valid: !reason,
            invalidReason: reason,
            extra: () => ({ frames: framesSummary(frames), loading: { pill, slowMs: this.slowMs, warmupMs: this.loadingWarmupMs, pillShown: !!(start.pill?.visible && end.pill?.visible), sidebarHidden: start.sidebarHidden && end.sidebarHidden, start, end } }),
          };
        },
        {
          pages: false,
          prepare: async () => {
            await this.state(`s.navigate(${js(tab.id)}, ${js(slowUrl)}); return true;`);
            await this.sleep(this.loadingWarmupMs);
          },
        },
      );
    } finally {
      await this.endLoading(tab, { name, toggled, addressMoved, before, rowTitle });
    }
  }

  async endLoading(tab, { name, toggled, addressMoved, before, rowTitle }) {
    await this.state(`s.navigate(${js(tab.id)}, ${js(tab.url)}); return true;`);
    await until(() => this.state(`const t = s.tabs[${js(tab.id)}]; return !!t && !s.live?.[${js(tab.id)}]?.isLoading && t.title === ${js(tab.title)};`, 10000), {
      timeout: 30000,
      interval: 500,
      label: `${tab.title} reloaded after the slow load`,
      abort: () => this.abortReason ?? (this.app.exited ? `chrome exited (${this.app.exitCode})` : null),
    });
    if (toggled) await this.state(`s.toggleSidebar(windowId); return true;`);
    if (addressMoved) await this.state(`s.updateSettings({ addressBar: ${js(before.addressBar)} }); return true;`);
    await this.sleep(2000);
    const after = await this.layoutState(tab, rowTitle);
    const problems = [];
    if (after.addressBar !== before.addressBar) problems.push(`addressBar ${after.addressBar}, was ${before.addressBar}`);
    if (!(typeof after.rowLeft === "number" && after.rowLeft >= 0)) problems.push(`sidebar not shown (row left ${after.rowLeft})`);
    if (after.active !== tab.id) problems.push(`tab 1 not active (${after.active})`);
    if (after.loading) problems.push("tab 1 still loading");
    if (after.pill?.visible) problems.push("the loading pill is still visible");
    if (problems.length) throw new Error(`${name} did not restore the layout: ${problems.join("; ")}`);
  }

  async readMemory() {
    const processes = await this.sampler.current();
    const perf = await metrics(this.shell);
    const mem = memoryByKind(processes);
    return { processes, record: { byKind: mem.byKind, readErrors: mem.readErrors, processesRead: mem.expected, shell: perfLevels(perf), load: loadAverage() } };
  }

  async memory() {
    await this.gc();
    await this.sleep(10000);
    const { processes, record } = await this.readMemory();
    this.result.memory = record;
    this.result.processes = processes.map(({ pid, kind, cmdline }) => ({ pid, kind, type: cmdline.find((a) => a.startsWith("--type=")) ?? null, sub: cmdline.find((a) => a.startsWith("--utility-sub-type=")) ?? null }));
    const gpu = processes.find((p) => p.kind === "gpu");
    this.result.gpuFlags = gpu ? gpu.cmdline.filter((a) => /^--(use-gl|use-angle|enable-unsafe-swiftshader|ozone|gpu)/.test(a)) : null;
  }

  async scenario(name) {
    for (let attempt = 1; attempt <= 1 + this.contentionRepeats; attempt++) {
      const budget = this.scenarioDeadlineMs + 2 * this.quietWaitS * 1000;
      const timer = setTimeout(() => {
        this.abortReason ??= `scenario ${name} timed out after ${budget} ms`;
      }, budget);
      try {
        await this[name.toLowerCase()]();
      } finally {
        clearTimeout(timer);
      }
      const record = this.result.scenarios[name];
      if (!record?.contended || attempt > this.contentionRepeats) return;
      this.result.discarded[`${name} contended ${attempt}`] = record;
      delete this.result.scenarios[name];
      log(`  ${name} was contended; repeating it`);
      await this.sleep(2000);
    }
  }

  async execute() {
    const data = join(this.out, "scratch", `${this.launchId}`);
    const logPath = join(this.out, "logs", `${this.launchId}.log`);
    await mkdir(join(this.out, "logs"), { recursive: true });
    try {
      this.fixtures = await startFixtures({ cpus: this.cpus, port: this.fixturePort ?? 0 });
      this.xvfb = await startXvfb({ base: this.displayBase, cpus: this.cpus, logDir: join(this.out, "logs") });
      await copyProfile(this.template, data);
      this.check();
      this.app = await launch({ chrome: this.chrome, data, uiDir: this.build.dir, contentBlocker: this.contentBlocker, extraArgs: this.extraArgs, debugPort: this.debugPort ?? 0, display: this.xvfb.display, cpus: this.cpus, unit: `ardia-bench-${this.launchId}`, logPath }).catch((error) => {
        this.startupTeardown = error.teardown ?? null;
        throw error;
      });
      Object.assign(this.result, { chrome: this.chrome, launcher: this.app.launcher, scopeMode: this.app.scopeMode, cgroup: this.app.cgroup, args: this.app.args, env: this.app.env, display: this.xvfb.display, cpus: this.cpus, log: logPath, fixturePort: this.fixtures.port, loadAtLaunch: loadAverage() });
      if (!this.app.cgroup) this.result.notes.push("no systemd scope: process membership from the session/tree walk, total CPU from sampled processes only");
      this.result.gpu = await this.app.browser.send("SystemInfo.getInfo", {}, { timeout: 15000 }).then(({ gpu }) => ({ renderer: gpu?.auxAttributes?.glRenderer ?? null, vendor: gpu?.auxAttributes?.glVendor ?? null, implementation: gpu?.auxAttributes?.glImplementationParts ?? gpu?.auxAttributes?.glImplementation ?? null, devices: (gpu?.devices ?? []).map((d) => d.deviceString || `${d.vendorId}:${d.deviceId}`) }), (error) => ({ error: error.message }));
      this.sampler = new ProcSampler(this.app.pid, { cgroup: this.app.cgroup, cpus: this.cpus, aux: { xvfb: this.xvfb.pid, fixtures: this.fixtures.pid } });
      await this.sampler.start();
      this.shell = await shellSession(this.app);
      this.result.perfTimeDomain = await this.shell.send("Performance.enable", { timeDomain: "threadTicks" }).then(() => "threadTicks", () => this.shell.send("Performance.enable").then(() => "timeTicks"));
      await this.shell.send("Runtime.enable").catch(() => {});
      this.result.probe = await this.shellEval(SHELL_PROBE(this.instrument));
      await this.validateSettings();
      await this.identifyShellPid();
      log(`  shell renderer pid ${this.result.shellPid}; cgroup ${this.app.cgroup ? "yes" : "no"}; seeding ${this.tabs} tabs`);
      await this.seedTabs();
      log(`  ${this.result.tabsLoaded} tabs loaded; settling ${this.settleSeconds} s`);
      await this.sleep(this.settleSeconds * 1000);
      await this.verifyTabs("before scenarios");
      await this.gc();
      await this.sleep(10000);
      this.result.memoryAtRest = (await this.readMemory()).record;
      for (const name of this.scenarios) {
        await this.scenario(name);
        this.check();
      }
      await this.verifyTabs("after scenarios");
      await this.memory();
      this.result.ok = true;
    } finally {
      await this.finish(data);
    }
    return this.result;
  }

  async finish(data) {
    this.result.finishedAt = new Date().toISOString();
    await this.sampler?.stop().catch(() => {});
    const app = this.app ? await quit(this.app).catch((e) => ({ clean: false, error: e.message })) : this.startupTeardown ?? { clean: true };
    const xvfb = await stopXvfb(this.xvfb).catch(() => false);
    const fixtures = await stopFixtures(this.fixtures).catch(() => false);
    this.result.teardown = { app: app.clean, leftover: app.leftover ?? [], xvfb, fixtures, ...(this.startupTeardown ? { duringStartup: true } : {}) };
    if (!app.clean || !xvfb || !fixtures) this.result.teardownFailed = true;
    if (!app.clean) this.result.notes.push(`scratch profile kept at ${data}: chrome may still be running`);
    else if (!this.keepProfiles) await rm(data, { recursive: true, force: true }).catch(() => {});
  }
}

export function framesSummary(frames) {
  if (!frames) return null;
  return { frames: frames.frames, gapsOver25: frames.gapsOver25, maxGapMs: Math.round(frames.maxGapMs * 10) / 10, gaps: frames.gaps };
}

export function pageRates(read, expected) {
  const byKind = {};
  for (const p of read.pages) {
    const w = p.window;
    if (!w) continue;
    const o = (byKind[p.kind] ??= { pages: 0, visibleS: 0, hiddenS: 0, rafVisible: 0, rafHidden: 0, ticksVisible: 0, ticksHidden: 0, transitions: 0 });
    o.pages++;
    o.visibleS += w.visibleMs / 1000;
    o.hiddenS += w.hiddenMs / 1000;
    o.rafVisible += w.rafVisible;
    o.rafHidden += w.rafHidden;
    o.ticksVisible += w.ticksVisible;
    o.ticksHidden += w.ticksHidden;
    o.transitions += w.transitions;
  }
  const rate = (n, s) => (s > 0.5 ? Math.round((n / s) * 1000) / 1000 : null);
  const rates = {};
  for (const [kind, o] of Object.entries(byKind)) {
    rates[kind] = {
      pages: o.pages,
      visiblePageS: Math.round(o.visibleS * 10) / 10,
      hiddenPageS: Math.round(o.hiddenS * 10) / 10,
      transitions: o.transitions,
      rafPerVisibleS: rate(o.rafVisible, o.visibleS),
      rafPerHiddenS: rate(o.rafHidden, o.hiddenS),
      ticksPerVisibleS: rate(o.ticksVisible, o.visibleS),
      ticksPerHiddenS: rate(o.ticksHidden, o.hiddenS),
    };
  }
  return { coverage: { expected, targets: read.targets, read: read.pages.length, failed: read.failed }, byKind: rates };
}

export function switchLatency(presses, probe, pages, tabInfo, byKey) {
  const indexOf = new Map(tabInfo.map((t) => [t.id, t.index]));
  const urlOf = new Map(tabInfo.map((t) => [t.id, t.url]));
  const pageByUrl = new Map(pages.map((p) => [p.url, p]));
  const keyDowns = (probe.keys ?? []).filter(([, type, ctrl]) => type === "down" && ctrl).map(([t]) => t);
  const commands = probe.commands ?? [];
  let nextCommand = 0;
  const spawnToCommand = [];
  const activations = probe.activations ?? [];
  const usedShown = new Map();
  let nextActivation = 0;
  let nextKey = 0;
  const keyToStore = [];
  const keyToShown = [];
  const raw = [];
  const tally = { shown: 0, noActivation: 0, wrongTab: 0, alreadyVisible: 0, notShown: 0, keyNotReceived: 0, recovered: 0 };
  presses.forEach((press, i) => {
    const limit = presses[i + 1]?.at ?? press.at + 2000;
    let start = press.at;
    let source = byKey ? "spawn" : "store-call";
    if (byKey) {
      while (nextCommand < commands.length && commands[nextCommand] < press.at - 5) nextCommand++;
      while (nextKey < keyDowns.length && keyDowns[nextKey] < press.at - 5) nextKey++;
      if (nextCommand < commands.length && commands[nextCommand] < limit) {
        start = commands[nextCommand++];
        source = "command";
        spawnToCommand.push(start - press.at);
      } else if (nextKey < keyDowns.length && keyDowns[nextKey] < limit) {
        start = keyDowns[nextKey++];
        source = "keydown";
      } else tally.keyNotReceived++;
    }
    while (nextActivation < activations.length && activations[nextActivation][0] < press.at - 5) nextActivation++;
    const activation = nextActivation < activations.length && activations[nextActivation][0] < limit ? activations[nextActivation++] : null;
    const entry = { at: press.at, startSource: source, want: press.want ? indexOf.get(press.want) : null, recovered: press.recovered };
    if (press.recovered) {
      tally.recovered++;
      raw.push({ ...entry, tab: activation ? indexOf.get(activation[1]) ?? null : null, storeMs: activation ? Math.round((activation[0] - start) * 10) / 10 : null, outcome: `recovered:${press.recovered}` });
      return;
    }
    if (!activation) {
      tally.noActivation++;
      raw.push({ ...entry, outcome: "no-activation" });
      return;
    }
    entry.tab = indexOf.get(activation[1]) ?? null;
    entry.storeMs = Math.round((activation[0] - start) * 10) / 10;
    if (press.want && activation[1] !== press.want) {
      tally.wrongTab++;
      raw.push({ ...entry, outcome: "wrong-tab" });
      return;
    }
    const url = urlOf.get(activation[1]);
    const page = pageByUrl.get(url);
    const used = usedShown.get(url) ?? new Set();
    usedShown.set(url, used);
    const shownIndex = (page?.shown ?? []).findIndex(([visibleAt], k) => !used.has(k) && visibleAt >= start - 5 && visibleAt < limit);
    if (shownIndex >= 0) {
      used.add(shownIndex);
      const shownMs = Math.round((page.shown[shownIndex][1] - start) * 10) / 10;
      tally.shown++;
      keyToStore.push(entry.storeMs);
      keyToShown.push(shownMs);
      raw.push({ ...entry, shownMs, outcome: "shown" });
      return;
    }
    const before = (page?.vis ?? []).filter(([t]) => t < start).at(-1);
    if (before?.[1] === "visible") {
      tally.alreadyVisible++;
      raw.push({ ...entry, outcome: "already-visible" });
    } else {
      tally.notShown++;
      raw.push({ ...entry, outcome: page ? "not-shown" : "no-page" });
    }
  });
  const misses = presses.length - tally.shown;
  return { presses: presses.length, keyToStore: summary(keyToStore), keyToShown: summary(keyToShown), spawnToCommand: summary(spawnToCommand), misses, ...tally, raw };
}

export async function runLaunch(options) {
  const launchRun = new Launch(options);
  current = launchRun;
  try {
    return await launchRun.execute();
  } catch (error) {
    launchRun.result.ok = false;
    launchRun.result.error = error.message;
    return launchRun.result;
  } finally {
    current = null;
  }
}

export async function writeResult(out, result) {
  await mkdir(join(out, "results"), { recursive: true });
  const file = join(out, "results", `${result.launchId}.json`);
  await writeFile(file, JSON.stringify(result, null, 2));
  return file;
}
