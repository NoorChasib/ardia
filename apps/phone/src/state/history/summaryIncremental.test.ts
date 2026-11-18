import assert from "node:assert/strict";
import test from "node:test";
import { nodeDatabase } from "../../../test/nodeDatabase.ts";
import type { SqlDatabase } from "../../lib/sqlDatabase.ts";
import { newestVisits, type Visit, type VisitTransition } from "../store/browserDatabase.ts";
import { migrate } from "../store/schema.ts";
import { createHistoryLog } from "./historyLog.ts";
import { summarizeVisits } from "./historySummary.ts";

function countingDatabase() {
  const db = nodeDatabase();
  migrate(db);
  const counts = { visitRowsRead: 0 };
  const counted: SqlDatabase = {
    ...db,
    all: <T,>(sql: string, values?: Parameters<SqlDatabase["all"]>[1]) => {
      const rows = db.all<T>(sql, values);
      if (/FROM visits/.test(sql) && !/max\(id\)/.test(sql)) counts.visitRowsRead += rows.length;
      return rows;
    },
    first: <T,>(sql: string, values?: Parameters<SqlDatabase["first"]>[1]) => {
      const row = db.first<T>(sql, values);
      if (row && /FROM visits/.test(sql) && !/max\(id\)/.test(sql)) counts.visitRowsRead += 1;
      return row;
    },
  };
  return { db: counted, raw: db, counts };
}

function seeded(urls: number, startAt = 1_000) {
  const { db, raw, counts } = countingDatabase();
  const log = createHistoryLog(db);
  for (let i = 0; i < urls; i++) log.record(`https://site${i}.example/page`, `Site ${i}`, "link", null, startAt + i);
  return { db, raw, log, counts };
}

test("a visit recorded after the summary was read patches one row and reads no visits back", () => {
  const { log, counts } = seeded(5000);
  const before = log.summary();
  assert.equal(before.length, 5000);
  counts.visitRowsRead = 0;
  const visit = log.record("https://site42.example/page", "", "link", null, 100_000)!;
  log.amend(visit, { title: "Site 42 again" });
  const after = log.summary();
  assert.ok(counts.visitRowsRead <= 2, `visit rows read after one visit: ${counts.visitRowsRead}`);
  const kept = after.filter((row) => before.includes(row)).length;
  assert.equal(kept, 4999, `rows kept by identity: ${kept}`);
  assert.deepEqual(after[0], { url: "https://site42.example/page", title: "Site 42 again", favicon: null, visits: 2, lastVisit: 100_000 });
  assert.notEqual(after, before);
});

test("a visit to a new address while the scan is full reads a few rows, not the whole window", () => {
  const { log, counts } = seeded(300);
  log.summary(50, 200);
  counts.visitRowsRead = 0;
  log.record("https://fresh.example/", "Fresh", "link", null, 100_000);
  const rows = log.summary(50, 200);
  assert.ok(counts.visitRowsRead <= 6, `visit rows read: ${counts.visitRowsRead}`);
  assert.equal(rows[0]!.url, "https://fresh.example/");
});

test("a title amend that changes nothing in the summary keeps the same rows", () => {
  const { log } = seeded(50);
  const first = log.record("https://a.example/", "A", "link", null, 10_000)!;
  log.record("https://a.example/", "A newer", "link", null, 10_001);
  const before = log.summary();
  log.amend(first, { title: "A older" });
  assert.equal(log.summary(), before);
});

function mulberry(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("after any mix of visits, amends, prunes and removals the summary equals a fresh scan", () => {
  const transitions: VisitTransition[] = ["link", "typed"];
  for (let seed = 1; seed <= 60; seed++) {
    const random = mulberry(seed);
    const { db, log } = seeded(0);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
    const urls = Array.from({ length: 3 + Math.floor(random() * 8) }, (_, i) => `https://u${i}.example/`);
    const titles = ["", "", "One", "Two", "Three"];
    const limit = 1 + Math.floor(random() * 6);
    const scan = 1 + Math.floor(random() * 14);
    const visits: Visit[] = [];
    let at = 1_000;
    for (let step = 0; step < 160; step++) {
      const roll = random();
      if (roll < 0.55) {
        at += random() < 0.15 ? 0 : random() < 0.1 ? -3 : 1 + Math.floor(random() * 3);
        const visit = log.record(pick(urls), pick(titles), pick(transitions), random() < 0.3 ? "work" : null, at);
        if (visit) visits.push(visit);
      } else if (roll < 0.85 && visits.length) {
        const index = Math.floor(random() * visits.length);
        const patch = random() < 0.1 ? { url: pick(urls) } : { title: pick(titles) };
        visits[index] = log.amend(visits[index]!, patch);
      } else if (roll < 0.9) {
        log.pruneBefore(at - 5 - Math.floor(random() * 20));
      } else if (roll < 0.95) {
        log.removeVisits([pick(urls)], random() < 0.5 ? "work" : null);
      } else if (roll < 0.97) {
        log.clear(random() < 0.5 ? null : at - 3);
      }
      const expected = summarizeVisits(newestVisits(db, scan), limit);
      assert.deepEqual(log.summary(limit, scan), expected, `seed ${seed} step ${step}`);
    }
  }
});

test("an amend through an older handle patches the stored row, so the summary and SQLite agree", () => {
  const { db, log } = seeded(0);
  const original = log.record("https://before.example/", "Before", "link", null, 1)!;
  log.amend(original, { url: "https://redirected.example/" });
  log.summary();
  const late = log.amend(original, { title: "Late title" });
  assert.deepEqual({ url: late.url, title: late.title }, { url: "https://redirected.example/", title: "Late title" });
  assert.deepEqual(log.search("").map(({ url, title }) => ({ url, title })), [{ url: "https://redirected.example/", title: "Late title" }]);
  assert.deepEqual(log.summary(), summarizeVisits(newestVisits(db, 1000), 1000));
});

test("after amends through any handle, old or removed, the summary equals a fresh scan", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const random = mulberry(seed + 1000);
    const { db, log } = seeded(0);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
    const urls = Array.from({ length: 3 + Math.floor(random() * 6) }, (_, i) => `https://h${i}.example/`);
    const titles = ["", "One", "Two", "Three"];
    const limit = 1 + Math.floor(random() * 6);
    const scan = 1 + Math.floor(random() * 14);
    const handles: Visit[] = [];
    let at = 1_000;
    for (let step = 0; step < 160; step++) {
      const roll = random();
      if (roll < 0.45) {
        at += 1 + Math.floor(random() * 3);
        const visit = log.record(pick(urls), pick(titles), "link", null, at);
        if (visit) handles.push(visit);
      } else if (roll < 0.95 && handles.length) {
        const patch = random() < 0.3 ? { url: pick(urls) } : { title: pick(titles) };
        handles.push(log.amend(pick(handles), patch));
      } else {
        log.removeVisits([pick(urls)], null);
      }
      const expected = summarizeVisits(newestVisits(db, scan), limit);
      assert.deepEqual(log.summary(limit, scan), expected, `seed ${seed} step ${step}`);
    }
  }
});
