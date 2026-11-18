import assert from "node:assert/strict";
import { test } from "node:test";
import { rowEnds } from "./closeSide.ts";

test("on the right the close button takes the trailing slot and the icon stays", () => {
  assert.deepEqual(rowEnds("right", true, false), { lead: "icon", trail: "close" });
  assert.deepEqual(rowEnds("right", true, true), { lead: "icon", trail: "close" });
});

test("on the left the close button takes the icon's place and the trailing slot keeps its status", () => {
  assert.deepEqual(rowEnds("left", true, false), { lead: "close", trail: "status" });
});

test("on the left a row away from its pinned address moves Back to Pinned URL to the trailing slot", () => {
  assert.deepEqual(rowEnds("left", true, true), { lead: "close", trail: "backToPin" });
});

test("a row that isn't showing its close button keeps its icon and status on both sides", () => {
  for (const side of ["left", "right"]) {
    for (const resettable of [false, true]) assert.deepEqual(rowEnds(side, false, resettable), { lead: "icon", trail: "status" }, `${side} ${resettable}`);
  }
});
