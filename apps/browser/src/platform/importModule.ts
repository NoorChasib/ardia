import type * as ImportApi from "@nilla/import";

export type {
  ArcArchive,
  ArcArchivedTab,
  ArcLinkDestination,
  ArcLinkRule,
  ArcRouting,
  BookmarkNode,
  BrowserProfile,
  BrowserSource,
  Credential,
  DiaTabsProfile,
  DiaTabsResult,
  ImportedExtension,
  ImportedExtensionSkip,
  ImportedFavicon,
  ImportedTab,
  ImportKind,
  ImportResult,
  SafariExport,
  SpaceSuggestion,
  SpaceSummary,
} from "@nilla/import";

let api: typeof ImportApi | undefined;

export const importModule = (): typeof ImportApi => (api ??= require("@nilla/import") as typeof ImportApi);
