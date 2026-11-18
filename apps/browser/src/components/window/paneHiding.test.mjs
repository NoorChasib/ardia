import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const { DETACHED_PANE_STYLE, detachedPaneStyle, hiddenPanesDetached, paneDetached, setHiddenPanesDetached } = await import("../../state/windows/paneHiding.ts");

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../../..");
const tabPane = readFileSync(join(here, "TabPane.tsx"), "utf8");

const everyPane = () => {
  const out = [];
  for (const visible of [false, true]) for (const warm of [false, true]) for (const lingering of [false, true]) for (const prewarmed of [false, true]) out.push({ visible, warm, lingering, prewarmed });
  return out;
};

function detachedFor(on, fn) {
  const before = hiddenPanesDetached();
  setHiddenPanesDetached(on);
  try {
    return fn();
  } finally {
    setHiddenPanesDetached(before);
  }
}

test("hidden panes stay in layout unless a platform opts in, so macOS and Windows render as before", () => {
  assert.equal(hiddenPanesDetached(), false);
  for (const pane of everyPane()) {
    assert.equal(paneDetached(pane), false, JSON.stringify(pane));
    assert.equal(detachedPaneStyle(pane), null, JSON.stringify(pane));
  }
});

test("with the opt-in, only a pane that is not shown, warm, lingering or prewarmed is detached", () => {
  detachedFor(true, () => {
    for (const pane of everyPane()) {
      const expected = !pane.visible && !pane.warm && !pane.lingering && !pane.prewarmed;
      assert.equal(paneDetached(pane), expected, JSON.stringify(pane));
      assert.equal(detachedPaneStyle(pane), expected ? DETACHED_PANE_STYLE : null, JSON.stringify(pane));
    }
  });
});

test("a pane is shown again the moment it becomes visible or warm, and detached again when it leaves", () => {
  detachedFor(true, () => {
    const away = { visible: false, warm: false, lingering: false, prewarmed: false };
    assert.notEqual(detachedPaneStyle(away), null);
    assert.equal(detachedPaneStyle({ ...away, visible: true }), null);
    assert.equal(detachedPaneStyle({ ...away, warm: true }), null);
    assert.notEqual(detachedPaneStyle(away), null);
  });
});

test("a detached pane leaves layout and hit testing entirely, and changes nothing else about the pane", () => {
  assert.deepEqual(DETACHED_PANE_STYLE, { display: "none" });
});

test("TabPane applies the detached style last on its root, from its own visible, warm, lingering and prewarmed state", () => {
  const start = tabPane.indexOf("return (\n    <View");
  const root = tabPane.slice(start, tabPane.indexOf("    >\n", start));
  const style = root.slice(root.indexOf("style={{"));
  assert.match(style, /\.\.\.detachedPaneStyle\(\{ visible, warm: !!warm, lingering, prewarmed \}\),\n\s*\}\}\s*$/);
  assert.equal(tabPane.match(/detachedPaneStyle\(/g)?.length, 1);
  assert.match(tabPane, /const visible = !!rect;/);
  assert.ok(tabPane.indexOf("const prewarmed = usePrewarm(") < tabPane.indexOf("detachedPaneStyle({"), "prewarmed is known before the root renders");
});

function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".") || entry.name.startsWith("build")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.(tsx?|mjs|cjs|js)$/.test(entry.name) && !entry.name.endsWith(".test.mjs")) out.push(path);
  }
  return out;
}

test("only the Linux shell turns detaching on", () => {
  const roots = ["apps/browser/src", "apps/linux/src", "packages"].map((p) => join(repo, p));
  const callers = roots
    .flatMap((root) => {
      try {
        return sources(root);
      } catch {
        return [];
      }
    })
    .filter((file) => /setHiddenPanesDetached\(/.test(readFileSync(file, "utf8")))
    .map((file) => relative(repo, file))
    .sort();
  assert.deepEqual(callers, ["apps/browser/src/state/windows/paneHiding.ts", "apps/linux/src/main.tsx"]);
  assert.match(readFileSync(join(repo, "apps/linux/src/main.tsx"), "utf8"), /setHiddenPanesDetached\(true\)/);
});
