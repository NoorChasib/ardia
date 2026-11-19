import type { BrowserSourceId } from "../../state/onboarding/onboarding";
import type { PlatformFeatures } from "../../lib/platformFeatures";

export type SourceCandidate = { id: Exclude<BrowserSourceId, "fresh">; name: string; app: string; importId?: string; onlyWhenFound?: boolean; listedOnly?: boolean };

export const SOURCE_CANDIDATES: SourceCandidate[][] = [
  [{ id: "arc", name: "Arc", app: "/Applications/Arc.app" }],
  [{ id: "dia", name: "Dia", app: "/Applications/Dia.app" }],
  [{ id: "chrome", name: "Chrome", app: "/Applications/Google Chrome.app" }],
  [
    { id: "safari", name: "Safari", app: "/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app" },
    { id: "safari", name: "Safari", app: "/Applications/Safari.app" },
  ],
  [{ id: "firefox", name: "Firefox", app: "/Applications/Firefox.app" }],
  [
    { id: "zen", name: "Zen", app: "/Applications/Zen.app" },
    { id: "zen", name: "Zen", app: "/Applications/Zen Browser.app" },
    { id: "zen", name: "Zen Twilight", app: "/Applications/Zen Twilight.app" },
  ],
  [
    { id: "brave", name: "Brave", app: "/Applications/Brave Browser.app" },
    { id: "brave", name: "Brave Beta", app: "/Applications/Brave Browser Beta.app", importId: "braveBeta" },
    { id: "brave", name: "Brave Nightly", app: "/Applications/Brave Browser Nightly.app", importId: "braveNightly" },
    { id: "edge", name: "Edge", app: "/Applications/Microsoft Edge.app" },
    { id: "edge", name: "Edge Beta", app: "/Applications/Microsoft Edge Beta.app", importId: "edgeBeta" },
  ],
  [{ id: "helium", name: "Helium", app: "/Applications/Helium.app", onlyWhenFound: true }],
  [{ id: "ardia", name: "Ardia", app: "/Applications/Ardia.app", onlyWhenFound: true }],
  [{ id: "chromium", name: "Chromium", app: "", onlyWhenFound: true, listedOnly: true }],
  [{ id: "vivaldi", name: "Vivaldi", app: "", onlyWhenFound: true, listedOnly: true }],
  [{ id: "opera", name: "Opera", app: "", onlyWhenFound: true, listedOnly: true }],
];

export type SourceTile = { id: BrowserSourceId; name: string; found: boolean; app: string | null; icon: string | null; importId?: string };

type Finding = Pick<PlatformFeatures, "findsBrowsersBy" | "hiddenBrowserSources">;

const offeredGroups = (platform: Finding) =>
  SOURCE_CANDIDATES.filter((group) => !platform.hiddenBrowserSources.includes(group[0]!.id) && !(platform.findsBrowsersBy === "appBundle" && group[0]!.listedOnly));

export const candidateImportIds = (platform: Finding) => [...new Set(offeredGroups(platform).flat().map((c) => c.importId ?? c.id))];

export async function listedSourceTiles(listBrowsers: (only: readonly string[]) => Promise<{ id: string }[]>, platform: Finding): Promise<SourceTile[]> {
  const listed = new Set((await listBrowsers(candidateImportIds(platform))).map((source) => source.id));
  return sourceTiles((c) => listed.has(c.importId ?? c.id), platform);
}

export function sourceTiles(isFound: (c: SourceCandidate) => boolean, platform: Finding): SourceTile[] {
  const keepsAppPaths = platform.findsBrowsersBy === "appBundle";
  return offeredGroups(platform).flatMap((group): SourceTile[] => {
    const found = group.find(isFound);
    if (found) return [{ id: found.id, name: found.name, found: true, app: keepsAppPaths ? found.app : null, icon: null, importId: found.importId }];
    if (group.every((c) => c.onlyWhenFound)) return [];
    const names = [...new Set(group.filter((c) => !c.importId).map((c) => c.name))];
    const families = names.filter((name) => !names.some((other) => other !== name && name.startsWith(`${other} `)));
    return [{ id: group[0]!.id, name: families.join(" or "), found: false, app: null, icon: null }];
  });
}
