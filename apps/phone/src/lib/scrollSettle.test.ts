import assert from "node:assert/strict";
import test from "node:test";
import { scrollAtRest, scrollMovedSinceSave, scrollSaveDecision, type ScrollWatch } from "./scrollSettle.ts";

const run = (start: ScrollWatch, ys: number[]) => {
  let watch = start;
  const saves: number[] = [];
  for (const y of ys) {
    const step = scrollSaveDecision(watch, y);
    if (step.save) saves.push(y);
    watch = step.next;
  }
  return saves;
};

test("a scroll is saved once it has settled, and only when it moved since the last save", () => {
  assert.deepEqual(run({ lastSeen: null, lastSaved: 0 }, [0, 0, 0]), []);
  assert.deepEqual(run({ lastSeen: 0, lastSaved: 0 }, [300, 900, 900, 900]), [900]);
  assert.deepEqual(run({ lastSeen: 0, lastSaved: 0 }, [300, 300, 1200, 1200]), [300, 1200]);
  assert.deepEqual(run({ lastSeen: 500, lastSaved: 500 }, [501, 500]), []);
});

test("a page counts as scrolled since its save when it has no save yet or moved past the threshold", () => {
  assert.equal(scrollMovedSinceSave(undefined, 0), true);
  assert.equal(scrollMovedSinceSave(40, 41), false);
  assert.equal(scrollMovedSinceSave(40, 400), true);
});

test("a page is at rest only when it is where it was last seen and last saved", () => {
  assert.equal(scrollAtRest({ lastSeen: 300, lastSaved: 300 }, 301), true);
  assert.equal(scrollAtRest({ lastSeen: 300, lastSaved: 0 }, 300), false);
  assert.equal(scrollAtRest({ lastSeen: 0, lastSaved: 0 }, 300), false);
  assert.equal(scrollAtRest({ lastSeen: null, lastSaved: null }, 0), false);
});
