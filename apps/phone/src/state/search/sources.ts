import type { HistoryRow } from "../history/historySummary.ts";
import { searchQuery } from "../page/pageMenu.ts";
import type { BrowserTab } from "../tabs/tabModels.ts";

export type SourceTab = { id: string; url: string; title: string; favicon: string | null };

export type SourceBookmark = { url: string; title: string; favicon: string | null };

export type Sources = { tabs: readonly SourceTab[]; history: readonly HistoryRow[]; bookmarks: readonly SourceBookmark[] };

export const NO_SOURCE_BOOKMARKS: readonly SourceBookmark[] = [];

export const sourceTabs = (openTabs: readonly BrowserTab[]): SourceTab[] =>
  openTabs.filter((tab) => !tab.isPrivate).map((tab) => ({ id: tab.id, url: tab.url, title: tab.title, favicon: tab.faviconUrl }));

export const buildSources = (openTabs: readonly BrowserTab[], history: readonly HistoryRow[], bookmarks: readonly SourceBookmark[] = NO_SOURCE_BOOKMARKS): Sources => ({
  tabs: sourceTabs(openTabs),
  history,
  bookmarks,
});

export const RECENT_SEARCH_LIMIT = 3;

const isNewestFirst = (rows: readonly HistoryRow[]) => {
  for (let i = 1; i < rows.length; i++) if (rows[i - 1]!.lastVisit < rows[i]!.lastVisit) return false;
  return true;
};

const recentByRows = new WeakMap<readonly HistoryRow[], { limit: number; queries: string[] }>();

export function recentSearches(rows: readonly HistoryRow[], limit = RECENT_SEARCH_LIMIT): string[] {
  const known = recentByRows.get(rows);
  if (known && known.limit === limit) return known.queries;
  const queries = searchesIn(isNewestFirst(rows) ? rows : [...rows].sort((a, b) => b.lastVisit - a.lastVisit), limit);
  recentByRows.set(rows, { limit, queries });
  return queries;
}

function searchesIn(newestFirst: readonly HistoryRow[], limit: number): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const row of newestFirst) {
    if (queries.length >= limit) break;
    const query = searchQuery(row.url);
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    queries.push(query);
  }
  return queries;
}

