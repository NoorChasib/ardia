import type { BrowserCommand } from "../../platform/commands";
import type { Settings } from "../settings/settings";
import { parseShortcut, type ShortcutSource } from "./shortcuts";
import { defaultKeys, profileSwitchKey } from "./keyNotation";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { splitViewAvailable } from "../splits/splits";

type Keys = readonly string[];
type Scope = "page" | "window";
type InLittleNilla = "page" | "off";
type Variant = { title?: string; barTitle?: string; symbol?: string; keys?: Keys };
type BooleanSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type ChoiceSetting = { [K in keyof Settings]: Settings[K] extends string ? K : never }[keyof Settings];
export type CommandSpec = Variant & {
  scope?: Scope;
  onInternalPages?: true;
  app?: true;
  littleNilla?: InLittleNilla;
  variants?: Readonly<Record<string, Variant>>;
  toggles?: BooleanSetting;
  chooses?: ChoiceSetting;
};

const inWindow = { scope: "window" } as const;
const appWide = { app: true } as const;
const pageInLittleNilla = { scope: "page", littleNilla: "page" } as const;
const offInLittleNilla = { littleNilla: "off" } as const;
const windowOffInLittleNilla = { scope: "window", littleNilla: "off" } as const;

export const COMMANDS = {
  newTab: { title: "New Tab", symbol: "plus", keys: ["⌘T"] },
  newWindow: { title: "New Window", symbol: "macwindow", keys: ["⌘N"] },
  newIncognitoWindow: { title: "New Incognito Window", symbol: "eyeglasses", keys: ["⇧⌘N"] },
  newLittleNilla: { title: "New Little Nilla Window", keys: ["⌥⌘N"] },
  toggleOpenLinksInLittleNilla: { title: "Open Links from Other Apps in Main Window" },
  reopenClosedTab: { title: "Reopen Closed Tab", symbol: "arrow.uturn.backward", keys: ["⇧⌘T"], littleNilla: "page" },
  reopenClosedWindow: { title: "Reopen Closed Window" },
  restoreClosed: { littleNilla: "page" },
  clearRecentlyClosed: { title: "Clear Recently Closed", symbol: "trash", ...appWide },
  focusCommandBar: { title: "Open Command Bar", keys: ["⌘L", "⌃F5"], ...inWindow },
  closeTab: { title: "Close Tab", symbol: "xmark", keys: ["⌘W"], ...inWindow },
  closeAllTabs: { title: "Close All Tabs", symbol: "xmark.square", keys: ["⇧⌘K"], ...windowOffInLittleNilla },
  print: { title: "Print…", symbol: "printer", keys: ["⌘P"], ...pageInLittleNilla },
  copyUrl: { title: "Copy URL", symbol: "link", keys: ["⇧⌘C"], ...pageInLittleNilla, onInternalPages: true },
  copyUrlAsMarkdown: { title: "Copy URL as Markdown", symbol: "link", keys: ["⌥⇧⌘C"], ...pageInLittleNilla, onInternalPages: true },
  findInPage: { title: "Find…", barTitle: "Find in Page", symbol: "text.magnifyingglass", keys: ["⌘F"], ...pageInLittleNilla },
  findNext: { title: "Find Next", keys: ["⌘G"], ...pageInLittleNilla },
  findPrevious: { title: "Find Previous", keys: ["⇧⌘G"], ...pageInLittleNilla },
  hideElement: { title: "Hide Element…", barTitle: "Hide an Element on This Page", symbol: "eye.slash", keys: ["⇧⌘H"], ...pageInLittleNilla },
  showHiddenElements: { title: "Hidden Elements on This Site…", barTitle: "Show Hidden Elements on This Site", symbol: "eye", keys: ["⇧⌘U"], ...pageInLittleNilla },
  setAppearance: {
    chooses: "appearance",
    variants: {
      auto: { title: "Automatic", barTitle: "Use System Appearance", symbol: "circle.lefthalf.filled" },
      light: { title: "Light", barTitle: "Light Appearance", symbol: "sun.max" },
      dark: { title: "Dark", barTitle: "Dark Appearance", symbol: "moon" },
    },
  },
  reload: { title: "Refresh", barTitle: "Reload Page", symbol: "arrow.clockwise", keys: ["⌘R"], ...pageInLittleNilla },
  forceReload: { title: "Force Refresh the Page", barTitle: "Force Reload Page", symbol: "arrow.clockwise", keys: ["⇧⌘R"], ...pageInLittleNilla },
  toggleTabLayout: { title: "Show Tabs in Sidebar", keys: ["⇧⌘S"], ...windowOffInLittleNilla },
  toggleSidebarSide: { title: "Sidebar on Right", symbol: "sidebar.right", ...offInLittleNilla },
  toggleSidebar: { title: "Auto-Hide Tabs", symbol: "sidebar.left", keys: ["⌘S", "⇧⌘L", "⇧⌘F"], ...windowOffInLittleNilla },
  openSplitPane: { title: "Open Split Pane", keys: ["⌃⇧=", "⌃+"], ...windowOffInLittleNilla },
  useSelectionForFind: { title: "Use Selection for Find", keys: ["⌘E"], ...pageInLittleNilla },
  findAndReplace: { title: "Find and Replace…", keys: ["⌥⌘F"], ...pageInLittleNilla },
  jumpToSelection: { title: "Jump to Selection", keys: ["⌘J"], ...pageInLittleNilla },
  focusNextPane: { title: "Focus Next Split Pane", keys: ["⌃⇧]", "⌃}"], ...offInLittleNilla },
  focusPreviousPane: { title: "Focus Previous Split Pane", keys: ["⌃⇧[", "⌃{"], ...offInLittleNilla },
  toggleFullUrl: { title: "Show Full URL", symbol: "text.alignleft", toggles: "showFullUrl" },
  toggleJavaScriptFromAppleEvents: { title: "Allow JavaScript from Apple Events", toggles: "allowJavaScriptFromAppleEvents" },
  toggleAddressBar: { title: "Show Address Bar in Sidebar", ...offInLittleNilla },
  toggleMinimalism: { title: "Minimalism Mode", barTitle: "Toggle Minimalism Mode", symbol: "rectangle.leftthird.inset.filled", keys: ["⌃⌘M"], toggles: "minimalismMode", ...offInLittleNilla },
  cast: { title: "Cast…", littleNilla: "page" },
  zoomReset: { title: "Zoom to Actual Size", barTitle: "Actual Size", symbol: "1.magnifyingglass", keys: ["⌘0"], ...pageInLittleNilla },
  zoomIn: { title: "Zoom In", symbol: "plus.magnifyingglass", keys: ["⌘+", "⌘="], ...pageInLittleNilla },
  zoomOut: { title: "Zoom Out", symbol: "minus.magnifyingglass", keys: ["⌘-"], ...pageInLittleNilla },
  devTools: { title: "Developer Tools", symbol: "hammer", keys: ["⌥⌘I"], ...pageInLittleNilla },
  toggleDevTools: { title: "Toggle Developer Tools", keys: ["F12"], ...pageInLittleNilla },
  javaScriptConsole: { title: "JavaScript Console", keys: ["⌥⌘J"], ...pageInLittleNilla },
  inspectElements: { title: "Inspect Elements", keys: ["⌥⌘C"], ...pageInLittleNilla },
  viewSource: { title: "View Source", keys: ["⌥⌘U"], ...pageInLittleNilla },
  back: { title: "Go Back", keys: ["⌘[", "⌘←"], scope: "window", littleNilla: "page" },
  forward: { title: "Go Forward", keys: ["⌘]", "⌘→"], scope: "window", littleNilla: "page" },
  nextTab: { title: "Next Tab", keys: ["⇧⌘]", "⌘}", "⌃⇥", "⌃⇟", "⌥⌘↓"], ...windowOffInLittleNilla },
  previousTab: { title: "Previous Tab", keys: ["⇧⌘[", "⌘{", "⌃⇧⇥", "⌃⇞", "⌥⌘↑"], ...windowOffInLittleNilla },
  selectTab: {
    ...windowOffInLittleNilla,
    variants: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), { title: `Select Tab ${n}`, keys: [`⌘${n}`] }])),
  },
  selectLastTab: { title: "Select Last Tab", keys: ["⌘9"], ...windowOffInLittleNilla },
  togglePin: {
    title: "Move to Top Apps",
    symbol: "pin",
    ...windowOffInLittleNilla,
    variants: { tile: { title: "Move Pinned Tab to Top Apps" }, row: {} },
  },
  togglePinnedRow: { title: "Move to Pinned", keys: ["⌥⇧⌘D"], ...windowOffInLittleNilla },
  duplicateTab: { title: "Duplicate", barTitle: "Duplicate Tab", symbol: "plus.square.on.square", ...windowOffInLittleNilla },
  moveTabToProfile: windowOffInLittleNilla,
  moveTabToWindow: windowOffInLittleNilla,
  bookmarkPage: { title: "Add to Bookmarks…", symbol: "bookmark", keys: ["⌘D"], ...pageInLittleNilla, onInternalPages: true },
  addBookmarkToFolder: { ...pageInLittleNilla, onInternalPages: true },
  openBookmark: { scope: "window", littleNilla: "page" },
  addFolderToSidebar: {},
  restoreArcFolders: {},
  toggleMute: { title: "Mute Tab", symbol: "speaker.slash", ...pageInLittleNilla },
  togglePageEngine: { title: "Open Page in WebKit" },
  toggleReader: { title: "Show Reader", barTitle: "Toggle Reading Mode", symbol: "doc.plaintext", keys: ["⌥⌘R"], ...pageInLittleNilla },
  downloads: { title: "Downloads", symbol: "arrow.down.circle", keys: ["⇧⌘J", "⌥⌘L"], scope: "window", littleNilla: "page" },
  mergeAllWindows: { title: "Merge All Windows", symbol: "rectangle.stack", ...windowOffInLittleNilla },
  switchProfile: inWindow,
  nextProfile: { title: "Next Profile", keys: ["⌥⌘→"], ...inWindow },
  previousProfile: { title: "Previous Profile", keys: ["⌥⌘←"], ...inWindow },
  newProfile: { title: "New Profile…", symbol: "person.crop.circle.badge.plus" },
  openSettings: { title: "Settings…", symbol: "gearshape", keys: ["⌘,"] },
  importBrowserData: { title: "Import from Another Browser…", barTitle: "Import Browser Data", symbol: "square.and.arrow.down" },
  showHistory: { title: "Show History…", barTitle: "History", symbol: "clock", keys: ["⌘Y"] },
  clearBrowsingData: { title: "Clear Browsing Data…", symbol: "trash", keys: ["⇧⌘⌫"] },
  manageBookmarks: { title: "Manage Bookmarks", barTitle: "Bookmarks", symbol: "book", keys: ["⌥⌘B"] },
  exportBookmarks: { title: "Export Bookmarks…", symbol: "square.and.arrow.up" },
  bookmarkAllTabs: { title: "Bookmark All Tabs…", keys: ["⇧⌘D"], ...offInLittleNilla },
  setBookmarksBar: { chooses: "bookmarksBar", variants: { always: { title: "Always" }, newTab: { title: "On New Tab Only" }, never: { title: "Never" } } },
  toggleBookmarksBar: { title: "Toggle Bookmarks Bar", symbol: "menubar.rectangle", keys: ["⇧⌘B"] },
  newTabInGroup: { title: "New Tab in Group", keys: ["⌥⌘T", "⌃⌘C"], ...windowOffInLittleNilla },
  newGroupWithTabs: { title: "New Group with Tab", symbol: "folder.badge.plus", keys: ["⌃⌘N", "⌃⌘P"], ...windowOffInLittleNilla },
  cleanUpTabs: { title: "Clean Up Tabs", symbol: "sparkles", keys: ["⌥⌘K"], ...windowOffInLittleNilla },
  tidyPins: { title: "Tidy Pins", symbol: "sparkles" },
  searchTabs: { title: "Search Tabs…", symbol: "magnifyingglass", keys: ["⇧⌘A"], ...windowOffInLittleNilla },
  renameTab: { title: "Rename…", barTitle: "Rename Tab", symbol: "pencil", ...windowOffInLittleNilla },
  changeTabIcon: { title: "Change Icon…", ...windowOffInLittleNilla },
  returnToPinnedUrl: { title: "Back to Pinned URL", keys: ["⌘↩"], ...windowOffInLittleNilla },
  tabSwitcher: {
    ...windowOffInLittleNilla,
    variants: {
      forward: { title: "Tab Switcher (forward)" },
      backward: { title: "Tab Switcher (backward)" },
    },
  },
  share: { title: "Share…", symbol: "square.and.arrow.up", keys: ["⌥⌘S"], ...pageInLittleNilla },
  reportProblem: { title: "Report a Problem…", keys: ["⌥⇧⌘I"], ...appWide },
  keyboardShortcuts: { title: "Keyboard Shortcuts", symbol: "keyboard" },
  copyDiagnostics: { title: "Copy Diagnostics", ...appWide },
  toolTour: { title: "Tool Tour", ...appWide },
  videoTour: { title: "Video Tour", ...appWide },
  releaseNotes: { title: "Release Notes", ...appWide },
  showOnboarding: { title: "Show Onboarding", ...appWide },
  taskManager: { title: "Task Manager", ...appWide },
  openExtension: { littleNilla: "page" },
  addExtension: { title: "Add Extension…", littleNilla: "page" },
  manageExtensions: { title: "Manage Extensions…" },
  pinExtensions: { title: "Pin Extensions…" },
  autofill: {
    littleNilla: "page",
    variants: { contact: { title: "Contact…" }, passwords: { title: "Passwords…" }, creditCard: { title: "Credit Card…" } },
  },
  openFile: { title: "Open File…", keys: ["⌘O"] },
  savePage: { title: "Save Page As…", ...pageInLittleNilla },
  emailPageLocation: { title: "Email Page Location", keys: ["⇧⌘I"], ...pageInLittleNilla },
  printWithSystemDialog: { title: "Print Using System Dialog…", keys: ["⌥⌘P"], ...pageInLittleNilla },
  stop: { title: "Stop", keys: ["⌘."], ...pageInLittleNilla },
  caretBrowsing: { title: "Caret Browsing", keys: ["F7"], ...pageInLittleNilla },
  moveTabDown: { title: "Move Tab Down", keys: ["⌃⇧⇟"], ...windowOffInLittleNilla },
  moveTabUp: { title: "Move Tab Up", keys: ["⌃⇧⇞"], ...windowOffInLittleNilla },
  closeTabGroup: { title: "Close Group", keys: ["⌃⌘W"], ...windowOffInLittleNilla },
  openProfileMenu: { title: "Show Profiles Menu", keys: ["⇧⌘M"], ...inWindow },
} as const satisfies Record<BrowserCommand, CommandSpec>;

const SPECS: Readonly<Record<BrowserCommand, CommandSpec>> = COMMANDS;

type Specs = typeof COMMANDS;
export type AppCommand = { [C in BrowserCommand]: Specs[C] extends { app: true } ? C : never }[BrowserCommand];
export type VariantOf<C extends BrowserCommand> = Specs[C] extends { variants: infer V } ? keyof V & string : never;

export const STANDARD_ITEMS: Readonly<Record<string, { keys?: Keys }>> = {
  "std:quit:": { keys: ["⌘Q"] },
  "std:hide:": { keys: ["⌘H"] },
  "std:hideOtherApplications:": { keys: ["⌥⌘H"] },
  "std:unhideAllApplications:": {},
  "std:closeWindow:": { keys: ["⇧⌘W"] },
  "std:undo:": { keys: ["⌘Z"] },
  "std:redo:": { keys: ["⇧⌘Z"] },
  "std:cut:": { keys: ["⌘X"] },
  "std:copy:": { keys: ["⌘C"] },
  "std:paste:": { keys: ["⌘V"] },
  "std:pasteAndMatchStyle:": { keys: ["⇧⌘V"] },
  "std:delete:": {},
  "std:selectAll:": { keys: ["⌘A"] },
  "std:showGuessPanel:": { keys: ["⌘:"] },
  "std:checkSpelling:": { keys: ["⌘;"] },
  "std:toggleContinuousSpellChecking:": {},
  "std:toggleGrammarChecking:": {},
  "std:toggleAutomaticSpellingCorrection:": {},
  "std:orderFrontSubstitutionsPanel:": {},
  "std:toggleSmartInsertDelete:": {},
  "std:toggleAutomaticQuoteSubstitution:": {},
  "std:toggleAutomaticDashSubstitution:": {},
  "std:toggleAutomaticLinkDetection:": {},
  "std:toggleAutomaticDataDetection:": {},
  "std:toggleAutomaticTextReplacement:": {},
  "std:uppercaseWord:": {},
  "std:lowercaseWord:": {},
  "std:capitalizeWord:": {},
  "std:startSpeaking:": {},
  "std:stopSpeaking:": {},
  "std:toggleFullScreen:": { keys: ["🌐F", "⌃⌘F"] },
  "std:performMiniaturize:": { keys: ["⌘M"] },
  "std:miniaturizeAll:": { keys: ["⌥⌘M"] },
  "std:performZoom:": {},
  "std:arrangeWindowsInFront:": {},
  "std:toggleKeepOnTop:": {},
};

const ALL_COMMANDS = Object.keys(COMMANDS) as BrowserCommand[];
const commandsWhere = (test: (spec: CommandSpec) => boolean) => ALL_COMMANDS.filter((command) => test(SPECS[command]));

export const PAGE_COMMANDS = commandsWhere((c) => c.scope === "page");
export const PAGE_COMMANDS_OFF_INTERNAL_PAGES = commandsWhere((c) => c.scope === "page" && !c.onInternalPages);
export const WINDOW_COMMANDS = commandsWhere((c) => c.scope !== undefined);
export const LITTLE_NILLA_DISABLED_COMMANDS = commandsWhere((c) => c.littleNilla === "off");
export const SPLIT_VIEW_COMMANDS: readonly BrowserCommand[] = ["openSplitPane", "focusNextPane", "focusPreviousPane"];
export const EXPORT_COMMANDS: readonly BrowserCommand[] = ["exportBookmarks"];
export const WEBKIT_COMMANDS: readonly BrowserCommand[] = ["togglePageEngine"];
export const HIDING_COMMANDS: readonly BrowserCommand[] = ["hideElement", "showHiddenElements"];
export const UNAVAILABLE_COMMANDS: ReadonlySet<string> = new Set([
  ...(splitViewAvailable ? [] : SPLIT_VIEW_COMMANDS),
  ...(PLATFORM_FEATURES.exportsBookmarksAndPasswords ? [] : EXPORT_COMMANDS),
  ...(PLATFORM_FEATURES.webKit ? [] : WEBKIT_COMMANDS),
  ...(PLATFORM_FEATURES.contentBlocker ? [] : HIDING_COMMANDS),
]);
export const LITTLE_NILLA_PAGE_COMMANDS: ReadonlySet<string> = new Set(commandsWhere((c) => c.littleNilla === "page"));

const APP_COMMANDS: ReadonlySet<string> = new Set(commandsWhere((c) => !!c.app));
export const isAppCommand = (command: BrowserCommand): command is AppCommand => APP_COMMANDS.has(command);

export function variantArg<C extends BrowserCommand>(command: C, arg: string | null | undefined): VariantOf<C> | undefined {
  const variants = SPECS[command].variants;
  return arg && variants && Object.hasOwn(variants, arg) ? (arg as VariantOf<C>) : undefined;
}

export function settingChange(command: BrowserCommand, arg: string | null | undefined, settings: Settings): Partial<Settings> | undefined {
  const { toggles, chooses } = SPECS[command];
  if (toggles) return { [toggles]: !settings[toggles] };
  const choice = variantArg(command, arg);
  return chooses && choice ? { [chooses]: choice } : undefined;
}

export function settingChecks(settings: Settings): string[] {
  return ALL_COMMANDS.flatMap((command) => {
    const { toggles, chooses } = SPECS[command];
    if (toggles) return settings[toggles] ? [command] : [];
    return chooses ? [`${command}:${settings[chooses]}`] : [];
  });
}

const variantOf = (command: BrowserCommand, arg: string | undefined): Variant => {
  const spec = SPECS[command];
  return (arg && spec.variants?.[arg]) || spec;
};

export function commandBarTitle(command: BrowserCommand, arg?: string): string {
  const { barTitle, title = "" } = variantOf(command, arg);
  return barTitle ?? title.replace(/…$/, "");
}

export const commandSymbol = (command: BrowserCommand, arg?: string): string | undefined => variantOf(command, arg).symbol ?? SPECS[command].symbol;

const PROFILE_SHORTCUT_COUNT = 9;
const OVERRIDABLE_PER_ITEM_COMMANDS: readonly BrowserCommand[] = ["openExtension"];

const source = (id: string, keys: Keys = []): ShortcutSource => ({ id, keys: keys.map(parseShortcut) });

export function staticShortcutSources(): ShortcutSource[] {
  const sources: ShortcutSource[] = [];
  for (const command of ALL_COMMANDS) {
    const spec = SPECS[command];
    sources.push(source(command, defaultKeys(command, spec.keys)));
    for (const [arg, variant] of Object.entries(spec.variants ?? {})) sources.push(source(`${command}:${arg}`, defaultKeys(`${command}:${arg}`, variant.keys)));
  }
  for (const [id, item] of Object.entries(STANDARD_ITEMS)) sources.push(source(id, defaultKeys(id, item.keys)));
  return sources;
}

const STATIC_SOURCES = staticShortcutSources();

export function shortcutSources(profileIds: readonly string[], overriddenIds: readonly string[]): ShortcutSource[] {
  const perItem = overriddenIds.filter((id) => OVERRIDABLE_PER_ITEM_COMMANDS.some((command) => id.startsWith(`${command}:`)));
  return [
    ...STATIC_SOURCES,
    ...profileIds.flatMap((id, i) => [
      source(`switchProfile:${id}`, i < PROFILE_SHORTCUT_COUNT ? [profileSwitchKey(i + 1)] : []),
      source(`newLittleNilla:${id}`),
    ]),
    ...perItem.map((id) => source(id)),
  ];
}
