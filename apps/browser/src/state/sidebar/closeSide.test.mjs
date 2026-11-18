import assert from "node:assert/strict";
import { test } from "node:test";
import { rowEnds } from "./closeSide.ts";

test("on the right the close button takes the trailing slot and the icon stays", () => {
  assert.deepEqual(rowEnds("right", true, false), { lead: "icon", trail: "close", trailingBackToPin: "none" });
  assert.deepEqual(rowEnds("right", true, true), { lead: "icon", trail: "close", trailingBackToPin: "none" });
});

test("on the left the close button takes the icon's place and the trailing slot keeps its status", () => {
  assert.deepEqual(rowEnds("left", true, false), { lead: "close", trail: "status", trailingBackToPin: "none" });
});

test("on the left a row away from its pinned address shows Back to Pinned URL after its status, which stays", () => {
  assert.deepEqual(rowEnds("left", true, true), { lead: "close", trail: "status", trailingBackToPin: "shown" });
});

test("on the left a row away from its pinned address keeps Back to Pinned URL's room at rest, so hovering moves nothing", () => {
  assert.deepEqual(rowEnds("left", false, true), { lead: "icon", trail: "status", trailingBackToPin: "reserved" });
});

test("a row that isn't showing its close button keeps its icon and status on both sides", () => {
  for (const side of ["left", "right"]) {
    for (const resettable of [false, true]) {
      const ends = rowEnds(side, false, resettable);
      assert.equal(ends.lead, "icon", `${side} ${resettable}`);
      assert.equal(ends.trail, "status", `${side} ${resettable}`);
    }
  }
  assert.equal(rowEnds("right", false, true).trailingBackToPin, "none");
});
