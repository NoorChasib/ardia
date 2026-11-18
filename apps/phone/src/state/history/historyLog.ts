import type { SqlDatabase } from "../../lib/sqlDatabase.ts";
import { isSyncableUrl } from "../tabs/tabModels.ts";
import {
  deleteVisitsBefore,
  deleteVisitsFor,
  deleteVisitsSince,
  insertVisit,
  maxVisitId,
  newestVisits,
  searchVisits,
  updateVisit,
  type Visit,
  type VisitTransition,
} from "../store/browserDatabase.ts";
import { summarizeVisits, SUMMARY_LIMIT, SUMMARY_SCAN, type HistoryRow } from "./historySummary.ts";
import { isInWindow, oldestTwo, windowTitleOf, windowVisitsOf, type EdgeVisit, type WindowEdge } from "./historyWindow.ts";

export type HistoryLog = {
  revision(): number;
  record(url: string, title: string, transition: VisitTransition, profileSyncId: string | null, at: number): Visit | null;
  amend(visit: Visit, patch: { url?: string; title?: string }): Visit;
  summary(limit?: number, scan?: number): HistoryRow[];
  search(text: string, limit?: number): Visit[];
  pruneBefore(cutoff: number): void;
  clear(since: number | null): void;
  removeVisits(urls: readonly string[], profileSyncId: string | null): void;
};

type Summary = { limit: number; scan: number; rows: HistoryRow[]; scanned: number; edge: WindowEdge | null };

export function createHistoryLog(db: SqlDatabase, onFullScan: () => void = () => undefined): HistoryLog {
  let nextId = maxVisitId(db);
  let revision = 0;
  let summary: Summary | null = null;
  const bump = () => {
    revision += 1;
  };
  const forget = () => {
    summary = null;
  };

  function slideWindow(shown: Summary, visit: Visit): EdgeVisit | null | false {
    if (shown.scanned < shown.scan) {
      shown.scanned += 1;
      return null;
    }
    const [oldest, next] = oldestTwo(db, shown.edge);
    if (!oldest || !next || oldest.id === visit.id || (shown.edge && oldest.id !== shown.edge.id)) return false;
    shown.edge = { visitedAt: next.visitedAt, id: next.id };
    return oldest;
  }

  function noteVisit(visit: Visit) {
    const shown = summary;
    if (!shown) return;
    const newest = shown.rows[0];
    if (!newest || visit.visitedAt <= newest.lastVisit) return forget();
    const evicted = slideWindow(shown, visit);
    if (evicted === false) return forget();
    const rows = shown.rows;
    const at = rows.findIndex((row) => row.url === visit.url);
    let next: HistoryRow[];
    let dropped: HistoryRow | null = null;
    let countedAfresh = false;
    if (at >= 0) {
      const row = rows[at]!;
      next = [{ url: row.url, title: visit.title || row.title, favicon: row.favicon, visits: row.visits + 1, lastVisit: visit.visitedAt }, ...rows.slice(0, at), ...rows.slice(at + 1)];
    } else {
      countedAfresh = rows.length >= shown.limit;
      const seen = countedAfresh ? windowVisitsOf(db, visit.url, shown.edge) : { visits: 1, title: visit.title };
      next = [{ url: visit.url, title: seen.title, favicon: null, visits: seen.visits, lastVisit: visit.visitedAt }, ...rows];
      if (next.length > shown.limit) dropped = next.pop()!;
    }
    if (evicted && !(countedAfresh && evicted.url === visit.url)) {
      const index = next.findIndex((row) => row.url === evicted.url);
      const row = next[index];
      if (row && row.visits > 1) {
        const title = evicted.title && evicted.title === row.title ? windowTitleOf(db, row.url, shown.edge) : row.title;
        next[index] = { url: row.url, title, favicon: row.favicon, visits: row.visits - 1, lastVisit: row.lastVisit };
      } else if (row) {
        next.splice(index, 1);
        if (dropped) next.push(dropped);
        else if (rows.length >= shown.limit) return forget();
      }
    }
    shown.rows = next;
  }

  function noteTitle(before: Visit, after: Visit) {
    const shown = summary;
    if (!shown) return;
    if (after.url !== before.url) return forget();
    if (!isInWindow(before, shown.edge)) return;
    const at = shown.rows.findIndex((row) => row.url === after.url);
    const row = shown.rows[at];
    if (!row) return;
    const title = windowTitleOf(db, row.url, shown.edge);
    if (title === row.title) return;
    const next = shown.rows.slice();
    next[at] = { url: row.url, title, favicon: row.favicon, visits: row.visits, lastVisit: row.lastVisit };
    shown.rows = next;
  }

  return {
    revision: () => revision,
    record(url, title, transition, profileSyncId, at) {
      if (!isSyncableUrl(url)) return null;
      nextId += 1;
      const visit: Visit = { id: nextId, url, title, visitedAt: at, profileSyncId, transition };
      insertVisit(db, visit);
      bump();
      noteVisit(visit);
      return visit;
    },
    amend(visit, patch) {
      const amended: Visit = {
        ...visit,
        url: patch.url && isSyncableUrl(patch.url) ? patch.url : visit.url,
        title: patch.title ? patch.title : visit.title,
      };
      updateVisit(db, amended);
      bump();
      noteTitle(visit, amended);
      return amended;
    },
    summary(limit = SUMMARY_LIMIT, scan = SUMMARY_SCAN) {
      if (summary && summary.limit === limit && summary.scan === scan) return summary.rows;
      const visits = newestVisits(db, scan);
      const rows = summarizeVisits(visits, limit);
      const last = visits[visits.length - 1];
      summary = { limit, scan, rows, scanned: visits.length, edge: visits.length === scan && last ? { visitedAt: last.visitedAt, id: last.id } : null };
      onFullScan();
      return rows;
    },
    search(text, limit = 200) {
      const query = text.trim();
      return query ? searchVisits(db, query, limit) : newestVisits(db, limit);
    },
    pruneBefore(cutoff) {
      deleteVisitsBefore(db, cutoff);
      bump();
      forget();
    },
    clear(since) {
      deleteVisitsSince(db, since);
      bump();
      forget();
    },
    removeVisits(urls, profileSyncId) {
      if (!urls.length) return;
      deleteVisitsFor(db, urls, profileSyncId);
      bump();
      forget();
    },
  };
}
