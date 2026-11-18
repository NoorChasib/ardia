function shellProbe(mode) {
  if (window.__benchProbe) return { state: "present", mode: window.__benchProbe.mode };
  const full = mode !== "light";
  const original = {
    raf: window.requestAnimationFrame.bind(window),
    gbcr: Element.prototype.getBoundingClientRect,
    getAnimations: Document.prototype.getAnimations,
    elementFromPoint: Document.prototype.elementFromPoint,
    gcs: window.getComputedStyle,
    send: chrome.send,
  };
  const zero = () => ({ rafCallbacks: 0, getBoundingClientRect: 0, getAnimations: 0, elementFromPoint: 0, getComputedStyle: 0, mutationRecords: 0, chromeSend: 0, hostEvents: 0 });
  let counts = zero();
  let sends = {};
  let events = {};
  let resetAt = performance.now();
  const bump = (map, key) => (map[key] = (map[key] ?? 0) + 1);

  const store = ardiaLinux.store;
  const windowId = __ardiaHost.bootstrap.windowId;
  const activeOf = (s) => {
    const w = s.windows[windowId];
    return w ? w.activeTabIds[w.profileId] : null;
  };
  let activations = [];
  let lastActive = activeOf(store.getState());
  let lastActivationAt = Date.now();
  store.subscribe((s) => {
    const active = activeOf(s);
    if (active !== lastActive) {
      lastActive = active;
      lastActivationAt = Date.now();
      if (activations.length < 5000) activations.push([lastActivationAt, active]);
    }
  });

  if (full) {
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      counts.getBoundingClientRect++;
      return original.gbcr.call(this);
    };
    if (original.getAnimations) {
      Document.prototype.getAnimations = function getAnimations() {
        counts.getAnimations++;
        return original.getAnimations.call(this);
      };
    }
    Document.prototype.elementFromPoint = function elementFromPoint(x, y) {
      counts.elementFromPoint++;
      return original.elementFromPoint.call(this, x, y);
    };
    window.getComputedStyle = function getComputedStyle(element, pseudo) {
      counts.getComputedStyle++;
      return original.gcs.call(window, element, pseudo);
    };
    window.requestAnimationFrame = function requestAnimationFrame(callback) {
      return original.raf((time) => {
        counts.rafCallbacks++;
        return callback(time);
      });
    };
    chrome.send = function send(name, args) {
      counts.chromeSend++;
      let key = String(name);
      if (name === "ardiaRequest" && Array.isArray(args)) {
        const route = args[1];
        const payload = args[2] ?? {};
        if (route === "host.invoke") key = payload.method === "tab.command" ? `invoke:tab.command:${payload.args?.command}` : `invoke:${payload.method}`;
        else if (route === "engine.call") key = `engine:${payload.name}`;
        else key = `request:${route}`;
        if (key === "invoke:tab.command:capturePicture") bump(sends, Date.now() - lastActivationAt >= 1400 ? "capturePicture after:>=1.4 s settled" : "capturePicture after:<1.4 s of a switch");
      }
      bump(sends, key);
      return original.send.apply(this, arguments);
    };
    __ardiaHost.onEvent((module, event) => {
      counts.hostEvents++;
      bump(events, `${module}:${event}`);
    });
    new MutationObserver((records) => {
      counts.mutationRecords += records.length;
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }

  let loafEntries = [];
  let eventEntries = [];
  if (full) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (loafEntries.length < 20000) loafEntries.push([entry.startTime, entry.duration, entry.blockingDuration ?? 0]);
      }).observe({ type: "long-animation-frame", buffered: false });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (eventEntries.length < 20000) eventEntries.push([entry.startTime, entry.name, Math.round(entry.duration)]);
      }).observe({ type: "event", durationThreshold: 16, buffered: false });
    } catch {}
  }

  let commands = [];
  __ardiaHost.onEvent((module, event) => {
    if (module === "ArdiaShell" && event === "onCommand" && commands.length < 5000) commands.push(Date.now());
  });
  let keys = [];
  const epochOf = (event) => performance.timeOrigin + event.timeStamp;
  addEventListener("keydown", (event) => {
    if (event.code === "Tab" && keys.length < 5000) keys.push([epochOf(event), "down", event.ctrlKey]);
  }, true);
  addEventListener("keyup", (event) => {
    if ((event.key === "Control" || event.code === "Tab") && keys.length < 5000) keys.push([epochOf(event), event.key === "Control" ? "ctrl-up" : "tab-up", event.ctrlKey]);
  }, true);

  const hoverRegion = () => document.querySelector('[data-testid="ardia-sidebar-hover"]');
  let frames = null;
  addEventListener(
    "pointermove",
    (event) => {
      if (!frames) return;
      frames.onPointer(event);
    },
    true,
  );

  function findRow(title) {
    for (const leaf of document.querySelectorAll("span, div")) {
      if (leaf.childElementCount || leaf.textContent.trim() !== title) continue;
      let row = leaf;
      for (let i = 0; i < 8 && row.parentElement; i++) {
        row = row.parentElement;
        const r = original.gbcr.call(row);
        if (r.height >= 28 && r.height <= 44 && r.width >= 100) return row;
      }
    }
    return null;
  }

  function cardShowing(title) {
    const card = hoverRegion()?.firstElementChild;
    if (!card || !card.textContent.includes(title)) return false;
    const r = original.gbcr.call(card);
    if (r.width < 20 || r.height < 20 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    for (let el = card; el && el !== document.documentElement; el = el.parentElement) {
      const cs = original.gcs.call(window, el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.5) return false;
    }
    return true;
  }

  function startFrames(kind, plan = {}) {
    const gaps = { "25-33": 0, "33-50": 0, "50-100": 0, "100-250": 0, "250+": 0 };
    const state = { mode: kind, frames: 0, maxGapMs: 0, gaps, gapsOver25: 0, reveals: [], arms: 0, hovers: [], misses: 0, superseded: 0, offRow: 0, rowEntries: 0, running: true };
    let previous = null;
    let edge = { armed: false, arrive: 0, hiddenSeen: true };
    let hover = null;
    let row = null;
    const rowEls = (plan.rows ?? []).map((r) => ({ title: r.title, el: findRow(r.title) }));
    state.rowsFound = rowEls.filter((r) => r.el).length;
    state.onPointer = (event) => {
      if (kind === "edge") {
        if (event.clientX <= 2 && !edge.armed && edge.hiddenSeen) {
          edge = { armed: true, arrive: event.timeStamp, hiddenSeen: false };
          state.arms++;
        }
      } else if (kind === "hover") {
        const target = rowEls.find((r) => r.el && r.el.contains(event.target));
        if (!target) {
          if (hover && !hover.done) state.superseded++;
          if (event.clientX >= 0 && event.clientX < 400) state.offRow++;
          hover = null;
          return;
        }
        if (hover && hover.title === target.title) return;
        if (hover && !hover.done) state.superseded++;
        state.rowEntries++;
        hover = { title: target.title, arrive: event.timeStamp, warm: !!hoverRegion()?.firstElementChild, done: false };
      }
    };
    state.pendingHover = () => !!(hover && !hover.done);
    const tick = (time) => {
      if (!state.running) return;
      const now = performance.now();
      state.frames++;
      if (previous !== null) {
        const gap = time - previous;
        state.maxGapMs = Math.max(state.maxGapMs, gap);
        if (gap > 25) {
          state.gapsOver25++;
          gaps[gap <= 33 ? "25-33" : gap <= 50 ? "33-50" : gap <= 100 ? "50-100" : gap <= 250 ? "100-250" : "250+"]++;
        }
      }
      previous = time;
      if (kind === "edge") {
        if (!row || !row.isConnected) row = findRow(plan.rowTitle);
        if (row) {
          const left = original.gbcr.call(row).left;
          if (left < plan.parkedBelow) edge.hiddenSeen = true;
          if (edge.armed && left >= plan.shownFrom) {
            state.reveals.push(Math.round((now - edge.arrive) * 10) / 10);
            edge.armed = false;
          } else if (edge.armed && now - edge.arrive > plan.deadlineMs) {
            state.misses++;
            edge.armed = false;
          }
        }
      } else if (kind === "hover" && hover && !hover.done) {
        if (cardShowing(hover.title)) {
          state.hovers.push({ ms: Math.round((now - hover.arrive) * 10) / 10, warm: hover.warm });
          hover.done = true;
        } else if (now - hover.arrive > 3000) {
          state.misses++;
          hover.done = true;
        }
      }
      original.raf(tick);
    };
    original.raf(tick);
    frames = state;
    return { rowsFound: state.rowsFound };
  }

  function stopFrames() {
    if (!frames) return null;
    frames.running = false;
    if (frames.pendingHover?.()) frames.superseded++;
    const { onPointer, running, pendingHover, ...result } = frames;
    frames = null;
    return result;
  }

  function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  }

  window.__benchProbe = {
    mode: full ? "full" : "light",
    reset() {
      counts = zero();
      sends = {};
      events = {};
      loafEntries = [];
      eventEntries = [];
      activations = [];
      keys = [];
      commands = [];
      resetAt = performance.now();
      return true;
    },
    snapshot() {
      const end = performance.now();
      const loafIn = loafEntries.filter(([start, duration]) => start >= resetAt && start + duration <= end);
      const eventsIn = eventEntries.filter(([start]) => start >= resetAt && start <= end);
      const durations = eventsIn.map((e) => e[2]);
      return {
        mode: full ? "full" : "light",
        counts: full ? { ...counts } : null,
        chromeSend: full ? { ...sends } : null,
        hostEvents: full ? { ...events } : null,
        loaf: full ? { count: loafIn.length, blockingMs: loafIn.reduce((s, e) => s + e[2], 0), durationMs: loafIn.reduce((s, e) => s + e[1], 0), maxMs: loafIn.reduce((m, e) => Math.max(m, e[1]), 0), clippedOut: loafEntries.length - loafIn.length } : null,
        events: full ? { count: durations.length, p75: percentile(durations, 75), max: durations.length ? Math.max(...durations) : null } : null,
        activations: [...activations],
        keys: [...keys],
        commands: [...commands],
      };
    },
    lastActive: () => lastActive,
    switcherOpen: () => !!document.querySelector('[data-testid="ardia-tab-switcher"], [data-testid="tab-switcher"]'),
    startFrames,
    stopFrames,
    findRow: (title) => {
      const row = findRow(title);
      if (!row) return null;
      const r = original.gbcr.call(row);
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const hit = original.elementFromPoint.call(document, cx, cy);
      return { left: r.left + screenX, top: r.top + screenY, right: r.right + screenX, bottom: r.bottom + screenY, clientLeft: r.left, clientTop: r.top, clientRight: r.right, clientBottom: r.bottom, hittable: !!hit && row.contains(hit) };
    },
    rowLeft: (title) => {
      const row = findRow(title);
      return row ? original.gbcr.call(row).left : null;
    },
    shown: (selector) => {
      const el = document.querySelector(selector);
      if (!el) return { present: false, visible: false };
      const r = original.gbcr.call(el);
      const onScreen = r.width > 1 && r.height > 1 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      const painted = typeof el.checkVisibility === "function" ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) : original.gcs.call(window, el).visibility !== "hidden";
      return { present: true, visible: onScreen && painted, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    },
    burn(ms) {
      const end = performance.now() + ms;
      let x = 0;
      while (performance.now() < end) x += Math.sqrt(x + 1);
      return x > 0;
    },
  };
  return { state: "installed", mode: full ? "full" : "light" };
}

export const ROW_EDGE = { shownFrom: 0, parkedBelow: -1000, deadlineMs: 1500 };
export const rowShown = (left) => typeof left === "number" && left >= ROW_EDGE.shownFrom;
export const rowParked = (left) => typeof left === "number" && left < ROW_EDGE.parkedBelow;

export const SHELL_PROBE = (mode = "full") => `(${shellProbe.toString()})(${JSON.stringify(mode)})`;

export const PAGE_READ = (t0, t1) => `((t0, t1) => {
  const b = window.__bench;
  if (!b) return null;
  let rv = 0, rh = 0, tv = 0, th = 0;
  if (t0 !== null && b.buckets) {
    for (let k = Math.floor(t0 / 100); k < Math.ceil(t1 / 100); k++) {
      const e = b.buckets[k];
      if (e) { rv += e[0]; rh += e[1]; tv += e[2]; th += e[3]; }
    }
  }
  let visibleMs = 0, hiddenMs = 0, transitions = 0;
  if (t0 !== null) {
    const log = b.vis;
    for (let i = 0; i < log.length; i++) {
      const from = Math.max(t0, log[i][0]);
      const to = Math.min(t1, i + 1 < log.length ? log[i + 1][0] : Date.now());
      if (to > from) { if (log[i][1] === "hidden") hiddenMs += to - from; else visibleMs += to - from; }
      if (i > 0 && log[i][0] > t0 && log[i][0] <= t1) transitions++;
    }
  }
  return { kind: b.kind, n: b.n, raf: b.raf, ticks: b.ticks, visibility: document.visibilityState, shown: b.shown.slice(-200), vis: b.vis.slice(-200), url: location.href, window: { rafVisible: rv, rafHidden: rh, ticksVisible: tv, ticksHidden: th, visibleMs, hiddenMs, transitions } };
})(${JSON.stringify(t0)}, ${JSON.stringify(t1)})`;
