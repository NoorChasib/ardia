import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";

globalThis.__DEV__ = false;
const { LeadingClose } = await import("./LeadingClose.tsx");

const Icon = () => null;
const Close = () => null;
const Badges = () => null;

function pathTo(node, type, path = []) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = pathTo(child, type, path);
      if (found) return found;
    }
    return null;
  }
  if (node.type === type) return path;
  return pathTo(node.props?.children, type, [...path, node]);
}

const hides = (node) => [node.props.style].flat().some((style) => style?.opacity === 0);
const order = (tree, type) => {
  const top = [tree.props.children].flat();
  return top.findIndex((child) => child && pathTo(child, type));
};

for (const closing of [true, false]) {
  test(`the tab's capture and Peek badges stay visible ${closing ? "while the left close button covers the favicon" : "with no close button"}`, () => {
    const tree = LeadingClose({ iconBox: 16, close: closing ? React.createElement(Close) : null, badges: React.createElement(Badges), children: React.createElement(Icon) });
    const toBadges = pathTo(tree, Badges);
    const toIcon = pathTo(tree, Icon);
    assert.ok(toBadges, "badges are drawn");
    assert.equal(toBadges.some(hides), false, "no ancestor of the badges is hidden");
    assert.equal(toIcon.some(hides), closing, "the favicon is hidden only while the close button shows");
    assert.equal(toBadges.at(-1).props.pointerEvents, "none", "the badges never take the close button's click");
    if (closing) assert.ok(order(tree, Badges) > order(tree, Close), "the badges draw over the close button, as over the favicon");
  });
}
