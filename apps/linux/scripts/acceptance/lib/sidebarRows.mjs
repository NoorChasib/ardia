import { js, pause, until } from "./util.mjs";

export const CLOSE_LABELS = ["Close Tab", "Unload Tab", "Remove Pinned Tab", "Hide Until Refresh"];
export const ANY_CLOSE = ["Close Tab", "Unload Tab", "Remove Pinned Tab"];
const BUTTON_LABELS = [...CLOSE_LABELS, "Back to Pinned URL"];
const CARD_LABELS = ["Pin", "Unpin", "Bookmark", "Split"];
export const TOLERANCE = 0.5;
export const near = (a, b) => Math.abs(a - b) <= TOLERANCE;

const PROBE = `(want) => {
  const shown = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; };
  const seen = (n) => { let o = 1; for (let a = n; a && a.nodeType === 1; a = a.parentElement) o *= Number(getComputedStyle(a).opacity); return o; };
  let best = null;
  for (const n of document.querySelectorAll("div")) {
    if ((n.innerText ?? "").trim() !== want || !shown(n)) continue;
    const r = n.getBoundingClientRect();
    if (!best || r.width * r.height < best.r.width * best.r.height) best = { n, r };
  }
  if (!best) return null;
  let row = best.n;
  while (row && !(row.getBoundingClientRect().height >= best.r.height + 3 && row.getBoundingClientRect().width > 50)) row = row.parentElement;
  if (!row) return null;
  const box = (r) => ({ left: r.left, right: r.right, top: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  let icon = null;
  for (const n of row.querySelectorAll("div,img")) {
    const r = n.getBoundingClientRect();
    if (Math.abs(r.width - r.height) > 0.5 || r.width < 12 || r.width > 20 || r.left > best.r.left || n.closest("[aria-label]")) continue;
    if (!icon || r.left < icon.left) icon = box(r);
  }
  const buttons = [...row.querySelectorAll("[aria-label]")].filter((n) => ${js(BUTTON_LABELS)}.some((l) => n.getAttribute("aria-label").startsWith(l)) && shown(n) && seen(n) > 0.05).map((n) => ({ label: n.getAttribute("aria-label"), ...box(n.getBoundingClientRect()) }));
  const marks = [];
  for (const n of row.querySelectorAll("svg,[title]")) {
    const r = n.getBoundingClientRect();
    const tip = n.getAttribute("title") ?? "";
    if (r.left < best.r.right - 0.5 || r.width < 6 || r.width > 24 || r.height < 6 || n.closest("[aria-label]") || n.parentElement?.closest("svg") || ${js(BUTTON_LABELS)}.some((l) => tip.startsWith(l))) continue;
    marks.push({ kind: n.tagName.toLowerCase() === "svg" ? "spinner" : n.getAttribute("title"), left: +r.left.toFixed(2), width: +r.width.toFixed(2), opacity: +seen(n).toFixed(2) });
  }
  return { row: box(row.getBoundingClientRect()), title: box(best.r), icon, buttons, marks };
}`;

const HOVER_SHOWN = `(() => {
  const seen = (n) => { const r = n.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; let o = 1; for (let a = n; a && a.nodeType === 1; a = a.parentElement) o *= Number(getComputedStyle(a).opacity); return o > 0.05; };
  const labelled = (match) => [...document.querySelectorAll("[aria-label]")].filter((n) => match(n.getAttribute("aria-label")) && seen(n));
  return { close: labelled((l) => ${js(CLOSE_LABELS)}.some((c) => l.startsWith(c))).map((n) => n.getAttribute("aria-label")), card: labelled((l) => ${js(CARD_LABELS)}.includes(l)).length > 0 };
})()`;

export function sidebarRows(shell) {
  const probe = (title) => shell.eval(`(${PROBE})(${js(title)})`);
  const shownNow = () => shell.eval(HOVER_SHOWN);
  const move = (x, y) => shell.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  const neutral = async () => {
    const { side, sidebar } = await shell.state("return { side: s.settings.sidebarSide, sidebar: s.settings.sidebarWidth };");
    const width = await shell.eval("innerWidth");
    const page = side === "right" ? [0, width - sidebar] : [sidebar, width];
    return { x: Math.round(page[0] + (page[1] - page[0]) * (side === "right" ? 0.3 : 0.6)), y: 30 };
  };
  const away = async () => {
    const at = await neutral();
    await move(at.x, at.y + 4);
    await move(at.x, at.y);
    let still = null;
    try {
      await until(async () => {
        still = await shownNow();
        return !still.close.length && !still.card;
      }, { timeout: 6000, interval: 80, label: "every row's hover to clear" });
    } catch (error) {
      throw new Error(`the pointer at ${at.x},${at.y} left ${js(still)} shown (${error.message})`);
    }
  };
  const reaches = (labels) => (state) => !labels.length || state.buttons.some((b) => labels.some((l) => b.label.startsWith(l)));
  const hover = async (title, { at = 0.7, expect = ANY_CLOSE } = {}) => {
    const wanted = reaches([expect].flat());
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      await away();
      const rest = await until(() => probe(title), { timeout: 8000, label: `the ${title} row` });
      const x = rest.row.left + rest.row.width * at;
      await move(x, rest.row.cy - 6);
      await move(x, rest.row.cy);
      try {
        const now = await until(async () => {
          const state = await probe(title);
          last = state;
          return state && wanted(state) ? state : null;
        }, { timeout: 4000, interval: 80, label: `${title} to show ${[expect].flat().join(" or ")}` });
        await pause(120);
        return { rest, now: (await probe(title)) ?? now };
      } catch (error) {
        if (attempt) throw new Error(`${title}: pointed at ${x.toFixed(1)},${rest.row.cy.toFixed(1)} but the row shows ${js(last?.buttons.map((b) => b.label) ?? null)}; hover elsewhere ${js(await shownNow())} (${error.message})`);
      }
    }
    throw new Error(`${title}: unreachable`);
  };
  const click = async (x, y, { modifiers = 0 } = {}) => {
    await move(x, y);
    await pause(150);
    await shell.session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1, modifiers });
    await shell.session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0, modifiers });
  };
  return { probe, move, away, hover, click, shownNow };
}

export function closeButton(now, label) {
  const labels = [label].flat();
  const button = now.buttons.find((b) => labels.some((l) => b.label.startsWith(l)));
  if (!button) throw new Error(`no ${labels.join(" or ")} button: ${js(now.buttons.map((b) => b.label))}`);
  if (Math.abs(button.width - 22) > TOLERANCE) throw new Error(`the ${button.label} button is ${button.width} wide`);
  return button;
}
