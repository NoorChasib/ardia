import { restartBrowser, startBrowser } from "../lib/flows.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, pause, until } from "../lib/util.mjs";

const page = (title) => `data:text/html,<title>${title}</title><body>${title}</body>`;
const HOME = "Acceptance page 28";
const TITLES = ["Close Plain", "Close Active", "Close Pinned", HOME, "Close Home", "Close Text", "Close Member", "Close Other", "Close Left Pane", "Close Right Pane", "Close Spare"];
const CLOSE_LABELS = ["Close Tab", "Unload Tab", "Remove Pinned Tab", "Back to Pinned URL"];
const ANY_CLOSE = ["Close Tab", "Unload Tab", "Remove Pinned Tab"];
const ELSEWHERE = "Acceptance page 29";
const ROW_INSET = 6;
const TOLERANCE = 0.5;

const PROBE = `(want) => {
  const shown = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth; };
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
  const buttons = [...row.querySelectorAll("[aria-label]")].filter((n) => ${js(CLOSE_LABELS)}.some((l) => n.getAttribute("aria-label").startsWith(l)) && shown(n)).map((n) => ({ label: n.getAttribute("aria-label"), ...box(n.getBoundingClientRect()) }));
  return { row: box(row.getBoundingClientRect()), title: box(best.r), icon, buttons };
}`;

function rows(shell) {
  const probe = (title) => shell.eval(`(${PROBE})(${js(title)})`);
  const move = (x, y) => shell.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  const away = async () => {
    await move(5, 790);
    await pause(250);
  };
  const hover = async (title, at = 0.7) => {
    await away();
    const rest = await until(() => probe(title), { timeout: 8000, label: `the ${title} row` });
    await move(rest.row.left + rest.row.width * at, rest.row.cy - 6);
    await move(rest.row.left + rest.row.width * at, rest.row.cy);
    await pause(350);
    const now = await probe(title);
    if (!now) throw new Error(`${title} vanished on hover`);
    return { rest, now };
  };
  const click = async (x, y) => {
    await move(x, y);
    await pause(300);
    await shell.mouse(x, y);
  };
  return { probe, move, away, hover, click };
}

function closeButton(now, label) {
  const labels = [label].flat();
  const button = now.buttons.find((b) => labels.some((l) => b.label.startsWith(l)));
  if (!button) throw new Error(`no ${label} button: ${js(now.buttons.map((b) => b.label))}`);
  if (Math.abs(button.width - 22) > TOLERANCE) throw new Error(`the button is ${button.width} wide`);
  return button;
}

const near = (a, b) => Math.abs(a - b) <= TOLERANCE;

async function onRight(ui, title, label, inset = ROW_INSET) {
  const { rest, now } = await ui.hover(title);
  const button = closeButton(now, label);
  if (!near(button.right, now.row.right - inset)) throw new Error(`${title}: the button ends ${(now.row.right - button.right).toFixed(2)} from the row's end, not ${inset}`);
  if (!near(now.title.left, rest.title.left)) throw new Error(`${title}: the title moved ${now.title.left - rest.title.left}`);
  return { inset: +(now.row.right - button.right).toFixed(2) };
}

async function onLeft(ui, title, label) {
  const { rest, now } = await ui.hover(title);
  const button = closeButton(now, label);
  if (!rest.icon) throw new Error(`${title}: no icon at rest`);
  if (!near(button.cx, rest.icon.cx) || !near(button.cy, rest.icon.cy)) throw new Error(`${title}: the button centre ${button.cx},${button.cy} is not the icon's ${rest.icon.cx},${rest.icon.cy}`);
  if (!near(now.title.left, rest.title.left)) throw new Error(`${title}: the title moved ${now.title.left - rest.title.left}`);
  if (now.buttons.some((b) => b !== button && b.label.startsWith("Close Tab"))) throw new Error(`${title}: a second close button is shown`);
  return { inset: +(button.left - now.row.left).toFixed(2), iconCentre: +rest.icon.cx.toFixed(2) };
}

const SETUP = `
  const id = (title) => Object.keys(s.tabs).find((k) => s.tabs[k].title === title);
  s.pinTabs([id("Close Pinned"), id(${js(HOME)}), id("Close Text")], true, true);
  s.updateTab(id("Close Text"), { customIcon: "symbol:ardia:no-icon", customTitle: "Close Text Pin" });
  s.groupTabs([id("Close Member"), id("Close Other")], { name: "Close Group" });
  s.createSplit([id("Close Left Pane"), id("Close Right Pane")]);
  s.activate(id("Close Active"));
  return true;
`;

export default {
  id: "F29",
  issue: null,
  title: "The tab close button sits on the side Settings › Tabs › Close button position picks, in every sidebar row that has one",
  deadline: 300000,
  manual: [
    {
      name: "Close button position with a real pointer, in the auto-hide peek and on other screens",
      steps: [
        "Settings › Tabs › Close button position: Left. Point at a tab row: the ✕ appears over the favicon at once and the title doesn't move; Right puts it back at the row's end.",
        "Turn on Auto-hide tabs, point at the window's edge, then at a row in the peek: the ✕ is on the chosen side and clicking it closes the tab without closing the peek.",
        "Repeat with the sidebar on the right, at the narrowest and widest sidebar, with Minimalism on, and on a loading, audible, unread, pinned, split, group and live folder row.",
      ],
      reason: "headless input is synthesized through CDP; the auto-hide peek needs a real pointer at the window edge (checked on Xvfb with xdotool)",
    },
  ],
  async run(t) {
    const session = sessionSeed({ windows: [{ id: "main", urls: TITLES.map((title) => (title === HOME ? t.fixtures.url.page(28) : page(title))), frame: [0, 0, 1280, 800] }] });
    Object.values(session.tabs).forEach((tab, index) => Object.assign(tab, { title: TITLES[index] }));
    const first = await startBrowser(t, { name: "close-side", session });
    let { shell } = first;
    await t.check("the tabs load and the rows are set up", async () => {
      await shell.waitState(`return ${js(TITLES)}.every((title) => Object.values(s.tabs).some((tab) => tab.title === title));`, { timeout: 20000, label: "every tab's title" });
      await shell.state(SETUP);
      for (const title of ["Close Pinned", HOME, "Close Active"]) {
        await shell.state(`s.activate(Object.keys(s.tabs).find((k) => s.tabs[k].title === ${js(title)})); return true;`);
        await shell.waitState(`const tab = Object.values(s.tabs).find((t) => t.title === ${js(title)}); return tab?.page?.kind === "loaded";`, { timeout: 15000, label: `${title} to load` });
      }
      await shell.navigate(await shell.state(`return Object.keys(s.tabs).find((k) => s.tabs[k].title === ${js(HOME)});`), t.fixtures.url.page(29));
      await shell.waitState(`return Object.values(s.tabs).some((tab) => tab.title === ${js(ELSEWHERE)});`, { label: "the pinned row to leave its URL" });
      await pause(800);
      return true;
    }, { critical: true });
    let ui = rows(shell);

    await t.check("the close button starts on the right, 6 points from the row's end", async () => {
      if ((await shell.state("return s.settings.tabCloseButtonSide;")) !== "right") throw new Error("the default isn't right");
      return {
        plain: await onRight(ui, "Close Plain", "Close Tab"),
        active: await onRight(ui, "Close Active", "Close Tab"),
        pinned: await onRight(ui, "Close Pinned", "Unload Tab"),
        member: await onRight(ui, "Close Member", ANY_CLOSE),
        pane: await onRight(ui, "Close Left Pane", "Close Tab", 0),
      };
    });

    await t.check("on the right, pressing a row's favicon activates the tab and keeps it", async () => {
      const { rest } = await ui.hover("Close Spare");
      await ui.click(rest.icon.cx, rest.icon.cy);
      await shell.waitState(`const w = s.windows[windowId]; const id = Object.keys(s.tabs).find((k) => s.tabs[k].title === "Close Spare"); return !!id && w.activeTabIds[w.profileId] === id;`, { timeout: 5000, label: "Close Spare to be active" });
      return true;
    });

    await t.check("Settings › Tabs › Close button position: Left moves it", async () => {
      await shell.command("openSettings");
      const settings = await first.app.shell("settings", { timeout: 20000 });
      await until(async () => (await settings.text()).includes("General"), { timeout: 10000, label: "Settings navigation" });
      await settings.clickText("Tabs", { timeout: 6000 });
      await until(async () => (await settings.text()).includes("Close button position"), { timeout: 8000, label: "the Close button position row" });
      const left = await settings.eval(`(() => {
        const title = [...document.querySelectorAll("div,span")].filter((n) => (n.innerText ?? "").trim() === "Close button position").sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
        const top = title.getBoundingClientRect().top;
        const below = [...document.querySelectorAll("div,span")].find((n) => (n.innerText ?? "").trim() === "Sidebar position" && n.getBoundingClientRect().top < top);
        const options = [...document.querySelectorAll("div,span")].filter((n) => (n.innerText ?? "").trim() === "Left" && Math.abs(n.getBoundingClientRect().top - top) < 40).map((n) => n.getBoundingClientRect()).sort((a, b) => a.width * a.height - b.width * b.height);
        return options[0] && below ? { x: options[0].left + options[0].width / 2, y: options[0].top + options[0].height / 2 } : null;
      })()`);
      if (!left) throw new Error("no Left segment under Sidebar position");
      await settings.mouse(left.x, left.y);
      await shell.waitState(`return s.settings.tabCloseButtonSide === "left";`, { timeout: 5000, label: "tabCloseButtonSide to be left" });
      await t.screenshot(settings, "settings-close-button-left");
      return true;
    }, { critical: true });

    await t.check("on the left the button covers the favicon and nothing else moves", async () => ({
      plain: await onLeft(ui, "Close Plain", "Close Tab"),
      active: await onLeft(ui, "Close Active", "Close Tab"),
      pinned: await onLeft(ui, "Close Pinned", "Unload Tab"),
      member: await onLeft(ui, "Close Member", ANY_CLOSE),
      pane: await onLeft(ui, "Close Left Pane", "Close Tab"),
    }));

    await t.check("on the left a text-only pinned row opens a 22 point slot before its title", async () => {
      const { rest, now } = await ui.hover("Close Text Pin");
      const button = closeButton(now, ANY_CLOSE);
      const shift = now.title.left - rest.title.left;
      if (!near(shift, 22)) throw new Error(`the title moved ${shift}`);
      if (button.left > now.title.left) throw new Error("the button isn't before the title");
      return { shift };
    });

    await t.check("on the left Back to Pinned URL moves to the row's end and still works", async () => {
      const { now } = await ui.hover(ELSEWHERE, 0.4);
      closeButton(now, ANY_CLOSE);
      const back = closeButton(now, "Back to Pinned URL");
      if (!near(back.right, now.row.right - ROW_INSET)) throw new Error(`↩ ends ${now.row.right - back.right} from the row's end`);
      await ui.move(back.cx, back.cy);
      await until(() => shell.eval(`document.body.innerText.includes("Back to Pinned URL")`), { timeout: 3000, label: "the Back to Pinned URL title" });
      await ui.away();
      if (await shell.eval(`document.body.innerText.includes("Back to Pinned URL")`)) throw new Error("the title stayed Back to Pinned URL after the pointer left");
      const again = await ui.hover(ELSEWHERE, 0.4);
      const back2 = closeButton(again.now, "Back to Pinned URL");
      await ui.click(back2.cx, back2.cy);
      await shell.waitState(`return Object.values(s.tabs).some((tab) => tab.pin && tab.url === ${js(t.fixtures.url.page(28))});`, { timeout: 8000, label: "the row to return to its pinned URL" });
      return true;
    });

    await t.check("renaming a row shows no close button", async () => {
      const { now } = await ui.hover("Close Plain", 0.5);
      await shell.mouse(now.title.cx, now.title.cy);
      await shell.mouse(now.title.cx, now.title.cy, { clickCount: 2 });
      await until(() => shell.eval(`document.activeElement?.tagName === "INPUT"`), { timeout: 3000, label: "the rename field" });
      const shown = await shell.eval(`(() => { let n = document.activeElement; while (n && n.getBoundingClientRect().height < 30) n = n.parentElement; return [...n.querySelectorAll("[aria-label]")].filter((b) => /^(Close Tab|Unload Tab)/.test(b.getAttribute("aria-label")) && b.getBoundingClientRect().width > 0).length; })()`);
      await shell.key("Escape", { code: "Escape", keyCode: 27 });
      if (shown) throw new Error(`${shown} close buttons while renaming`);
      return true;
    });

    await t.check("on the left pressing the button over the favicon closes, unloads and closes a pane", async () => {
      const press = async (title, label) => {
        const { now } = await ui.hover(title);
        const button = closeButton(now, label);
        await ui.click(button.cx, button.cy);
      };
      await press("Close Plain", "Close Tab");
      await shell.waitState(`return !Object.values(s.tabs).some((tab) => tab.title === "Close Plain");`, { timeout: 5000, label: "Close Plain to close" });
      await press("Close Pinned", "Unload Tab");
      await shell.waitState(`const tab = Object.values(s.tabs).find((t) => t.title === "Close Pinned"); return !!tab && tab.page?.kind !== "loaded";`, { timeout: 5000, label: "Close Pinned to unload" });
      await press("Close Left Pane", "Close Tab");
      await shell.waitState(`return !Object.values(s.tabs).some((tab) => tab.title === "Close Left Pane") && Object.values(s.tabs).some((tab) => tab.title === "Close Right Pane");`, { timeout: 5000, label: "the left pane to close" });
      return true;
    });

    await t.screenshot(shell, "left-close-button");

    await t.check("at 160 and 400 points and with the sidebar on the right the button stays on the left of each row", async () => {
      const out = {};
      for (const [width, side] of [[160, "left"], [400, "left"], [160, "right"], [400, "right"]]) {
        await shell.state(`s.updateSettings(${js({ sidebarWidth: width, sidebarSide: side })}); return true;`);
        await pause(700);
        out[`${side}-${width}`] = await onLeft(ui, "Close Active", "Close Tab").catch(async (error) => {
          await t.screenshot(shell, `close-side-${side}-${width}`);
          throw new Error(`${side} sidebar at ${width}: ${error.message}`);
        });
      }
      await shell.state(`s.updateSettings({ sidebarWidth: 240, sidebarSide: "left" }); return true;`);
      await pause(500);
      return out;
    });

    await t.check("the choice survives a relaunch", async () => {
      const second = await restartBrowser(t, first, { label: "relaunch" });
      shell = second.shell;
      ui = rows(shell);
      await shell.waitState(`return s.settings.tabCloseButtonSide === "left" && Object.values(s.tabs).some((tab) => tab.title === "Close Active");`, { timeout: 20000, label: "the restored left setting" });
      await pause(1000);
      return { active: await onLeft(ui, "Close Active", "Close Tab") };
    }, { critical: true });
  },
};
