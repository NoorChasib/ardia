import type { SqlDatabase } from "../../lib/sqlDatabase.ts";

export type WindowEdge = { visitedAt: number; id: number };

export type EdgeVisit = WindowEdge & { url: string; title: string };

const FROM_EDGE = "visitedAt >= ? AND (visitedAt > ? OR id >= ?)";

const edgeValues = (edge: WindowEdge) => [edge.visitedAt, edge.visitedAt, edge.id];

export const oldestTwo = (db: SqlDatabase, edge: WindowEdge | null) =>
  edge
    ? db.all<EdgeVisit>(`SELECT id, url, title, visitedAt FROM visits WHERE ${FROM_EDGE} ORDER BY visitedAt ASC, id ASC LIMIT 2`, edgeValues(edge))
    : db.all<EdgeVisit>("SELECT id, url, title, visitedAt FROM visits ORDER BY visitedAt ASC, id ASC LIMIT 2");

const withinEdge = (edge: WindowEdge | null) => (edge ? ` AND ${FROM_EDGE}` : "");

const urlValues = (url: string, edge: WindowEdge | null) => (edge ? [url, ...edgeValues(edge)] : [url]);

export const windowTitleOf = (db: SqlDatabase, url: string, edge: WindowEdge | null) =>
  db.first<{ title: string }>(`SELECT title FROM visits WHERE url = ? AND title <> ''${withinEdge(edge)} ORDER BY visitedAt DESC, id DESC LIMIT 1`, urlValues(url, edge))?.title ?? "";

export const windowVisitsOf = (db: SqlDatabase, url: string, edge: WindowEdge | null) => ({
  visits: db.first<{ n: number }>(`SELECT count(*) AS n FROM visits WHERE url = ?${withinEdge(edge)}`, urlValues(url, edge))?.n ?? 0,
  title: windowTitleOf(db, url, edge),
});

export const storedVisit = (db: SqlDatabase, id: number) => db.first<EdgeVisit>("SELECT id, url, title, visitedAt FROM visits WHERE id = ?", [id]);

export const isInWindow = (visit: WindowEdge, edge: WindowEdge | null) => !edge || visit.visitedAt > edge.visitedAt || (visit.visitedAt === edge.visitedAt && visit.id >= edge.id);
