import assert from "node:assert/strict";
import test from "node:test";
import { sharedWith } from "./structuralSharing.ts";

const view = () => ({
  devices: [{ id: "mac", name: "Mac", lastSeen: 1 }],
  profiles: [
    { syncId: "work", color: "blue", theme: { colors: ["#112233", "#445566"], darkColors: null }, history: [{ url: "https://a.example/", visits: 1 }], bookmarks: [] },
    { syncId: "home", color: null, theme: null, history: [], bookmarks: [{ key: "b", url: "https://b.example/", children: null }] },
  ],
  look: { interfaceStyle: "glass", appearance: "auto" },
  syncedAt: 5,
});

test("an equal tree keeps the previous root, so nothing downstream sees a change", () => {
  const before = view();
  assert.equal(sharedWith(before, view()), before);
});

test("a change keeps every equal subtree's identity and takes the new values where they differ", () => {
  const before = view();
  const next = view();
  next.profiles[1]!.history = [{ url: "https://c.example/", visits: 2 }];
  const after = sharedWith(before, next);
  assert.notEqual(after, before);
  assert.deepEqual(after, next);
  assert.equal(after.devices, before.devices);
  assert.equal(after.look, before.look);
  assert.equal(after.profiles[0], before.profiles[0]);
  assert.notEqual(after.profiles[1], before.profiles[1]);
  assert.equal(after.profiles[1]!.bookmarks, before.profiles[1]!.bookmarks);
  assert.deepEqual(after.profiles[1]!.history, [{ url: "https://c.example/", visits: 2 }]);
});

test("added, removed and renamed keys and items count as changes", () => {
  const before = { a: 1, list: [1, 2] } as Record<string, unknown>;
  assert.deepEqual(sharedWith(before, { a: 1 }), { a: 1 });
  assert.deepEqual(sharedWith(before, { a: 1, list: [1, 2], b: 2 }), { a: 1, list: [1, 2], b: 2 });
  assert.deepEqual(sharedWith(before, { b: 1, list: [1, 2] }), { b: 1, list: [1, 2] });
  assert.deepEqual(sharedWith(before, { a: 1, list: [1] }), { a: 1, list: [1] });
  assert.deepEqual(sharedWith(before, { a: 1, list: [1, 2, 3] }), { a: 1, list: [1, 2, 3] });
  assert.deepEqual(sharedWith({ a: undefined }, { b: undefined }), { b: undefined });
});

test("null, numbers, NaN and type changes compare by value", () => {
  assert.equal(sharedWith(null, null), null);
  assert.equal(sharedWith(NaN, NaN), NaN);
  assert.deepEqual(sharedWith({ x: null }, { x: { y: 1 } }), { x: { y: 1 } });
  assert.deepEqual(sharedWith({ x: [1] }, { x: { 0: 1 } }), { x: { 0: 1 } });
  assert.deepEqual(sharedWith([{ a: 1 }], [[1]]), [[1]]);
});

test("the incoming tree is never mutated", () => {
  const before = view();
  const next = view();
  next.syncedAt = 6;
  const frozen = JSON.stringify(next);
  sharedWith(before, next);
  assert.equal(JSON.stringify(next), frozen);
});
