import { restartBrowser, startBrowser } from "../lib/flows.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { ANY_CLOSE, closeButton, near, sidebarRows } from "../lib/sidebarRows.mjs";
import { js, pause, until } from "../lib/util.mjs";

const page = (title) => `data:text/html,<title>${title}</title><body>${title}</body>`;
const HOME = "Acceptance page 28";
const ELSEWHERE = "Acceptance page 29";
const PANES = { right: ["Pane Right A", "Pane Right B"], left: ["Close Left Pane", "Close Right Pane"], altRight: ["Pane Alt Right A", "Pane Alt Right B"], altLeft: ["Pane Alt Left A", "Pane Alt Left B"] };
const TITLES = ["Close Plain", "Close Plain Right", "Close Active", "Close Pinned", "Close Pinned Right", HOME, "Close Home", "Close Text", "Close Member", "Close Other", ...Object.values(PANES).flat(), "Close Spare"];
const LIVE = { docLeft: "Live Doc Left", docRight: "Live Doc Right", prLeft: "Live PR Left", prRight: "Live PR Right", away: "Live Away PR" };
const ROW_INSET = 6;

async function onRight(ui, title, label, inset = ROW_INSET) {
  const { rest, now } = await ui.hover(title, { expect: label });
  const button = closeButton(now, label);
  if (!near(button.right, now.row.right - inset)) throw new Error(`${title}: the button ends ${(now.row.right - button.right).toFixed(2)} from the row's end, not ${inset}`);
  if (!near(now.title.left, rest.title.left)) throw new Error(`${title}: the title moved ${now.title.left - rest.title.left}`);
  return { inset: +(now.row.right - button.right).toFixed(2) };
}

async function onLeft(ui, title, label) {
  const { rest, now } = await ui.hover(title, { expect: label });
  const button = closeButton(now, label);
  if (!rest.icon) throw new Error(`${title}: no icon at rest`);
  if (!near(button.cx, rest.icon.cx) || !near(button.cy, rest.icon.cy)) throw new Error(`${title}: the button centre ${button.cx},${button.cy} is not the icon's ${rest.icon.cx},${rest.icon.cy}`);
  if (!near(now.title.left, rest.title.left) || !near(now.title.width, rest.title.width)) throw new Error(`${title}: the title went from ${rest.title.left}+${rest.title.width} to ${now.title.left}+${now.title.width}`);
  if (now.buttons.some((b) => b !== button && ANY_CLOSE.some((l) => b.label.startsWith(l)))) throw new Error(`${title}: a second close button is shown`);
  return { inset: +(button.left - now.row.left).toFixed(2), iconCentre: +rest.icon.cx.toFixed(2) };
}

function marksKept(title, rest, now) {
  const kept = rest.marks.filter((m) => m.opacity > 0.9);
  if (!kept.length) throw new Error(`${title}: nothing trailing at rest to keep`);
  for (const m of kept) {
    if (!now.marks.some((n) => near(n.left, m.left) && near(n.width, m.width) && n.opacity > 0.9)) throw new Error(`${title}: the trailing mark at ${m.left} went from ${js(rest.marks)} to ${js(now.marks)}`);
  }
  return kept.length;
}

const tabId = (title) => `Object.keys(s.tabs).find((k) => (s.tabs[k].customTitle || s.tabs[k].title) === ${js(title)})`;
const exists = (title) => `Object.values(s.tabs).some((tab) => (tab.customTitle || tab.title) === ${js(title)})`;

const SETUP = `
  const id = (title) => Object.keys(s.tabs).find((k) => s.tabs[k].title === title);
  s.pinTabs([id("Close Pinned"), id("Close Pinned Right"), id(${js(HOME)}), id("Close Text")], true, true);
  s.updateTab(id("Close Text"), { customIcon: "symbol:ardia:no-icon", customTitle: "Close Text Pin" });
  s.groupTabs([id("Close Member"), id("Close Other")], { name: "Close Group" });
  for (const pair of ${js(Object.values(PANES))}) s.createSplit(pair.map(id));
  s.activate(id("Close Active"));
  return true;
`;

const LIVE_FOLDERS = `
  const profileId = s.windows[windowId].profileId;
  return { docs: ardiaLinux.live.newFolder(profileId, "documents"), prs: ardiaLinux.live.newFolder(profileId, "pullRequests") };
`;

const LIVE_ITEMS = (folders) => `
  const folders = ${js(folders)};
  const page = (title) => "data:text/html,<title>" + title + "</title><body>" + title + "</body>";
  const now = Date.now();
  const doc = (title) => ({ id: title, source: "notion", url: page(title), title, subtitle: "", icon: null, updatedAt: now, doc: { kind: "page", editedBy: null, place: null } });
  const pr = (title, mergeable) => ({ id: title, source: "github", url: page(title), title, subtitle: "", icon: null, updatedAt: now, section: "authored", pr: { number: 7, repo: "a/b", author: "x", authorAvatar: null, draft: false, headRef: title, baseRef: "main", review: null, mergeable, checks: [], comments: 0, unresolvedThreads: 0, additions: 1, deletions: 1, changedFiles: 1 } });
  const docs = [doc(${js(LIVE.docLeft)}), doc(${js(LIVE.docRight)})];
  const prs = [pr(${js(LIVE.prLeft)}, "mergeable"), pr(${js(LIVE.prRight)}, "mergeable"), pr(${js(LIVE.away)}, "conflicting")];
  ardiaLinux.live.store.setState((l) => ({ items: { ...l.items, [folders.docs]: docs, [folders.prs]: prs } }));
  const tabs = {};
  for (const [folderId, item] of [[folders.docs, docs[0]], [folders.docs, docs[1]], [folders.prs, prs[2]]]) {
    const tab = s.newTab(windowId, { url: item.url, background: true });
    s.updateTab(tab, { liveItem: { folderId, itemId: item.id }, pinnedUrl: item.url });
    tabs[item.title] = tab;
  }
  return { folders, tabs };
`;

async function pressClose(ui, title, label, options) {
  const { now } = await ui.hover(title, { expect: label });
  const button = closeButton(now, label);
  await ui.click(button.cx, button.cy, options);
}

async function withEvidence(t, shell, name, body) {
  try {
    return await body();
  } catch (error) {
    await t.screenshot(shell, name).catch(() => {});
    throw error;
  }
}

async function actions(t, shell, ui, side, live) {
  const own = side === "left" ? { plain: "Close Plain", pinned: "Close Pinned", panes: PANES.left, alt: PANES.altLeft, doc: LIVE.docLeft, pr: LIVE.prLeft } : { plain: "Close Plain Right", pinned: "Close Pinned Right", panes: PANES.right, alt: PANES.altRight, doc: LIVE.docRight, pr: LIVE.prRight };
  await pressClose(ui, own.plain, "Close Tab");
  await shell.waitState(`return !${exists(own.plain)};`, { timeout: 5000, label: `${own.plain} to close` });
  await pressClose(ui, own.pinned, "Unload Tab");
  await shell.waitState(`const tab = s.tabs[${tabId(own.pinned)}]; return !!tab && tab.page?.kind !== "loaded";`, { timeout: 5000, label: `${own.pinned} to unload` });
  await pressClose(ui, own.panes[0], "Close Tab");
  await shell.waitState(`return !${exists(own.panes[0])} && ${exists(own.panes[1])};`, { timeout: 5000, label: `${own.panes[0]} to close and keep ${own.panes[1]}` });
  await pressClose(ui, own.alt[0], "Close Tab", { modifiers: 1 });
  await pause(800);
  if (!(await shell.state(`return ${exists(own.alt[0])} && ${exists(own.alt[1])};`))) throw new Error(`⌥ on ${own.alt[0]}'s close button closed a tab`);
  await pressClose(ui, own.doc, "Close Tab");
  await shell.waitState(`return !s.tabs[${js(live.tabs[own.doc])}];`, { timeout: 5000, label: `${own.doc}'s tab to close` });
  await until(() => ui.probe(own.doc), { timeout: 3000, label: `${own.doc} to stay in its folder` });
  await pressClose(ui, own.pr, "Hide Until Refresh");
  await until(async () => !(await ui.probe(own.pr)), { timeout: 5000, label: `${own.pr} to hide` });
  await t.screenshot(shell, `${side}-after-actions`);
  return true;
}

async function noButtonWhileRenaming(shell, ui, title) {
  await shell.state(`s.activate(${tabId(title)}); return true;`);
  const { now } = await ui.hover(title, { at: 0.5, expect: "Close Tab" });
  await shell.command("renameTab");
  await until(() => shell.eval(`document.activeElement?.tagName === "INPUT"`), { timeout: 3000, label: "the rename field" });
  const shown = await shell.eval(`(() => { let n = document.activeElement; while (n && n.getBoundingClientRect().height < 30) n = n.parentElement; return [...n.querySelectorAll("[aria-label]")].filter((b) => /^(Close Tab|Unload Tab)/.test(b.getAttribute("aria-label")) && b.getBoundingClientRect().width > 0).length; })()`);
  await shell.key("Escape", { code: "Escape", keyCode: 27 });
  await ui.move(now.row.cx, now.row.cy - 4);
  await ui.move(now.row.cx, now.row.cy);
  await pause(200);
  if (shown) throw new Error(`${shown} close buttons while renaming`);
  return true;
}

export default {
  id: "F29",
  issue: null,
  title: "The tab close button sits on the side Settings › Tabs › Close button position picks, in every sidebar row that has one",
  deadline: 420000,
  manual: [
    {
      name: "Close button position with a real pointer, in the auto-hide peek and on other screens",
      steps: [
        "Settings › Tabs › Close button position: Left. Point at a tab row: the ✕ appears over the favicon at once and the title doesn't move; Right puts it back at the row's end.",
        "Turn on Auto-hide tabs, point at the window's edge, then at a row in the peek: the ✕ is on the chosen side and clicking it closes the tab without closing the peek.",
        "Repeat with the sidebar on the right, at the narrowest and widest sidebar, with Minimalism on, and on a loading, audible, unread, pinned, split, group and live folder row.",
        "On each side, ⌥-click a split pane's ✕: the pane leaves the split and both tabs stay.",
      ],
      reason: "headless input is synthesized through CDP; the auto-hide peek needs a real pointer at the window edge (checked on Xvfb with xdotool); react-native-web's Pressable ignores clicks with ⌥ held, so the pane pull-out can't be pressed on Linux",
    },
  ],
  async run(t) {
    const session = sessionSeed({ windows: [{ id: "main", urls: TITLES.map((title) => (title === HOME ? t.fixtures.url.page(28) : page(title))), frame: [0, 0, 1280, 1040] }] });
    Object.values(session.tabs).forEach((tab, index) => Object.assign(tab, { title: TITLES[index] }));
    const first = await startBrowser(t, { name: "close-side", session });
    let { shell } = first;
    let live = null;
    await t.check("the tabs load and the rows are set up", async () => {
      await shell.waitState(`return ${js(TITLES)}.every((title) => Object.values(s.tabs).some((tab) => tab.title === title));`, { timeout: 20000, label: "every tab's title" });
      await shell.state(SETUP);
      for (const title of ["Close Pinned", "Close Pinned Right", HOME, "Close Active"]) {
        await shell.state(`s.activate(Object.keys(s.tabs).find((k) => s.tabs[k].title === ${js(title)})); return true;`);
        await shell.waitState(`const tab = Object.values(s.tabs).find((t) => t.title === ${js(title)}); return tab?.page?.kind === "loaded";`, { timeout: 15000, label: `${title} to load` });
      }
      await shell.navigate(await shell.state(`return ${tabId(HOME)};`), t.fixtures.url.page(29));
      await shell.waitState(`return ${exists(ELSEWHERE)};`, { label: "the pinned row to leave its URL" });
      const folders = await shell.state(LIVE_FOLDERS);
      await pause(1500);
      live = await shell.state(LIVE_ITEMS(folders));
      await shell.navigate(live.tabs[LIVE.away], t.fixtures.url.page(30));
      await shell.waitState(`const tab = s.tabs[${js(live.tabs[LIVE.away])}]; return !!tab && tab.url !== tab.pinnedUrl;`, { label: "the live PR's tab to leave its URL" });
      await until(async () => { const text = await shell.eval(`document.body.innerText`); return Object.values(LIVE).every((title) => text.includes(title)); }, { timeout: 8000, label: "the live folders' rows" });
      await pause(500);
      return true;
    }, { critical: true });
    let ui = sidebarRows(shell);

    await t.check("the close button starts on the right, 6 points from the row's end", async () => {
      if ((await shell.state("return s.settings.tabCloseButtonSide;")) !== "right") throw new Error("the default isn't right");
      return {
        plain: await onRight(ui, "Close Plain", "Close Tab"),
        active: await onRight(ui, "Close Active", "Close Tab"),
        pinned: await onRight(ui, "Close Pinned", "Unload Tab"),
        member: await onRight(ui, "Close Member", ANY_CLOSE),
        pane: await onRight(ui, "Close Left Pane", "Close Tab", 0),
        liveDoc: await onRight(ui, LIVE.docLeft, "Close Tab"),
        livePr: await onRight(ui, LIVE.prLeft, "Hide Until Refresh"),
      };
    });

    await t.check("on the right, pressing a row's favicon activates the tab and keeps it", async () => {
      const { rest } = await ui.hover("Close Spare", { expect: "Close Tab" });
      await ui.click(rest.icon.cx, rest.icon.cy);
      await shell.waitState(`const w = s.windows[windowId]; const id = ${tabId("Close Spare")}; return !!id && w.activeTabIds[w.profileId] === id;`, { timeout: 5000, label: "Close Spare to be active" });
      return true;
    });

    await t.check("on the right renaming a row shows no close button", () => noButtonWhileRenaming(shell, ui, "Close Plain"));

    await t.check("on the right the button closes, unloads, closes a pane, keeps both panes' tabs on ⌥, closes a live tab and hides a pull request", () => withEvidence(t, shell, "right-actions-failed", () => actions(t, shell, ui, "right", live)));

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
      liveDoc: await onLeft(ui, LIVE.docLeft, "Close Tab"),
      livePr: await onLeft(ui, LIVE.prLeft, "Hide Until Refresh"),
    }));

    await t.check("on the left a text-only pinned row opens a 22 point slot before its title", async () => {
      const { rest, now } = await ui.hover("Close Text Pin", { expect: ANY_CLOSE });
      const button = closeButton(now, ANY_CLOSE);
      const shift = now.title.left - rest.title.left;
      if (!near(shift, 22)) throw new Error(`the title moved ${shift}`);
      if (button.left > now.title.left) throw new Error("the button isn't before the title");
      return { shift };
    });

    await t.check("on the left an away row keeps its title and its spinner or badge when Back to Pinned URL appears", async () => {
      const home = await shell.state(`return ${tabId(ELSEWHERE)};`);
      await shell.state(`s.updateLive(${js(home)}, { isLoading: true }); return true;`);
      try {
        const out = {};
        for (const [title, label] of [[ELSEWHERE, ANY_CLOSE], [LIVE.away, "Close Tab"]]) {
          const { rest, now } = await ui.hover(title, { at: 0.4, expect: "Back to Pinned URL" });
          closeButton(now, label);
          const back = closeButton(now, "Back to Pinned URL");
          if (!near(back.right, now.row.right - ROW_INSET)) throw new Error(`${title}: ↩ ends ${now.row.right - back.right} from the row's end`);
          if (!near(now.title.left, rest.title.left) || !near(now.title.width, rest.title.width)) throw new Error(`${title}: the title went from ${rest.title.left}+${rest.title.width} to ${now.title.left}+${now.title.width}`);
          const kept = marksKept(title, rest, now);
          const over = now.marks.filter((m) => m.opacity > 0.9 && m.left + m.width > back.left + 0.5);
          if (over.length) throw new Error(`${title}: ${js(over)} overlap ↩ at ${back.left}`);
          out[title] = { titleWidth: +now.title.width.toFixed(2), kept };
        }
        await t.screenshot(shell, "left-away-loading-hovered");
        return out;
      } finally {
        await shell.state(`s.updateLive(${js(home)}, { isLoading: false }); return true;`);
      }
    });

    await t.check("on the left Back to Pinned URL sits at the row's end and still works", async () => {
      const { now } = await ui.hover(ELSEWHERE, { at: 0.4, expect: "Back to Pinned URL" });
      closeButton(now, ANY_CLOSE);
      const back = closeButton(now, "Back to Pinned URL");
      if (!near(back.right, now.row.right - ROW_INSET)) throw new Error(`↩ ends ${now.row.right - back.right} from the row's end`);
      await ui.move(back.cx, back.cy);
      await until(() => shell.eval(`document.body.innerText.includes("Back to Pinned URL")`), { timeout: 3000, label: "the Back to Pinned URL title" });
      await ui.away();
      if (await shell.eval(`document.body.innerText.includes("Back to Pinned URL")`)) throw new Error("the title stayed Back to Pinned URL after the pointer left");
      const again = await ui.hover(ELSEWHERE, { at: 0.4, expect: "Back to Pinned URL" });
      const back2 = closeButton(again.now, "Back to Pinned URL");
      await ui.click(back2.cx, back2.cy);
      await shell.waitState(`return Object.values(s.tabs).some((tab) => tab.pin && tab.url === ${js(t.fixtures.url.page(28))});`, { timeout: 8000, label: "the row to return to its pinned URL" });
      return true;
    });

    await t.check("on the left renaming a row shows no close button", () => noButtonWhileRenaming(shell, ui, "Close Plain"));

    await t.check("on the left the button over the favicon closes, unloads, closes a pane, keeps both panes' tabs on ⌥, closes a live tab and hides a pull request", () => withEvidence(t, shell, "left-actions-failed", () => actions(t, shell, ui, "left", live)));

    await t.check("at 160 and 400 points and with the sidebar on either side each position holds", async () => {
      const out = {};
      for (const closeSide of ["right", "left"]) {
        for (const [width, side] of [[160, "left"], [400, "left"], [160, "right"], [400, "right"]]) {
          await shell.state(`s.updateSettings(${js({ sidebarWidth: width, sidebarSide: side, tabCloseButtonSide: closeSide })}); return true;`);
          await pause(600);
          const measure = closeSide === "left" ? onLeft(ui, "Close Active", "Close Tab") : onRight(ui, "Close Active", "Close Tab");
          out[`${closeSide}-close-${side}-sidebar-${width}`] = await measure.catch(async (error) => {
            await t.screenshot(shell, `close-${closeSide}-${side}-${width}`);
            throw new Error(`${closeSide} close, ${side} sidebar at ${width}: ${error.message}`);
          });
        }
      }
      await shell.state(`s.updateSettings({ sidebarWidth: 240, sidebarSide: "left", tabCloseButtonSide: "left" }); return true;`);
      await pause(500);
      return out;
    });

    await t.check("the choice survives a relaunch", async () => {
      const second = await restartBrowser(t, first, { label: "relaunch" });
      shell = second.shell;
      ui = sidebarRows(shell);
      await shell.waitState(`return s.settings.tabCloseButtonSide === "left" && ${exists("Close Active")};`, { timeout: 20000, label: "the restored left setting" });
      await pause(1000);
      return { active: await onLeft(ui, "Close Active", "Close Tab") };
    }, { critical: true });
  },
};
