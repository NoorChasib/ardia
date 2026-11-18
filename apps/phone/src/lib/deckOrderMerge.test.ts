import assert from "node:assert/strict";
import test from "node:test";
import { mergeDeckOrder } from "./deckGeometry.ts";

function quadraticMergeDeckOrder(shown: readonly string[], live: readonly string[]): string[] {
  const alive = new Set(live);
  const next = shown.filter((id) => alive.has(id));
  const known = new Set(next);
  for (let i = 0; i < live.length; i++) {
    const id = live[i]!;
    if (known.has(id)) continue;
    let at = next.length;
    for (let j = i + 1; j < live.length; j++) {
      const after = next.indexOf(live[j]!);
      if (after >= 0) {
        at = after;
        break;
      }
    }
    next.splice(at, 0, id);
    known.add(id);
  }
  return next;
}

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const ids = (count: number, prefix = "t") => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

function countingIndexOf(work: () => void): { calls: number; visited: number } {
  const original = Array.prototype.indexOf;
  const tally = { calls: 0, visited: 0 };
  Array.prototype.indexOf = function (this: unknown[], ...args: Parameters<typeof original>) {
    tally.calls += 1;
    tally.visited += this.length;
    return original.apply(this, args);
  };
  try {
    work();
  } finally {
    Array.prototype.indexOf = original;
  }
  return tally;
}

test("merging the deck's order matches the old insert-before-the-next-kept-tab merge on thousands of random orders, subsets, removals and arrivals", () => {
  const random = seeded(20261118);
  for (let round = 0; round < 4000; round++) {
    const universe = ids(1 + Math.floor(random() * 40));
    const live = shuffled(universe, random).filter(() => random() < 0.75);
    const pool = [...universe, ...ids(Math.floor(random() * 5), "gone")];
    const shown = shuffled(pool, random).filter(() => random() < (round % 3 === 0 ? 0.2 : 0.7));
    assert.deepEqual(mergeDeckOrder(shown, live), quadraticMergeDeckOrder(shown, live), JSON.stringify({ shown, live }));
  }
});

test("clearing Search Tabs merges every tab back around the one match without an indexOf scan, at either end of a thousand tabs and in the middle", () => {
  const all = ids(1000);
  for (const kept of [["t999"], ["t0"], ["t500"], ["t3", "t998"]]) {
    let merged: string[] = [];
    const tally = countingIndexOf(() => {
      merged = mergeDeckOrder(kept, all);
    });
    assert.deepEqual(merged, quadraticMergeDeckOrder(kept, all));
    assert.equal(tally.calls, 0, `${kept.join(",")}: ${tally.calls} indexOf calls visiting ${tally.visited} elements`);
  }
});

test("merging keeps the shown order of the tabs it keeps and puts each new tab before the next kept tab that follows it live", () => {
  assert.deepEqual(mergeDeckOrder(["c", "a"], ["a", "x", "b", "c", "y"]), ["x", "b", "c", "a", "y"]);
  assert.deepEqual(mergeDeckOrder(["b", "a"], ["n1", "a", "n2", "b", "n3"]), ["n2", "b", "n1", "a", "n3"]);
  assert.deepEqual(mergeDeckOrder([], ["a", "b"]), ["a", "b"]);
  assert.deepEqual(mergeDeckOrder(["a", "b"], []), []);
});
