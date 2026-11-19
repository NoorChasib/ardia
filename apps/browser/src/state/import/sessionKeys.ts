import type { BrowserSource } from "./apply";
import { importNow, importSignal, patchImport } from "./flow";
import { importModule } from "./importApi";

let checking = false;

export const checkingSessionKeys = () => checking;

export async function withSessionKeyNeeds(source: BrowserSource, profileIds: string[]): Promise<BrowserSource | null> {
  const { step } = importNow();
  const signal = importSignal();
  checking = true;
  const needing = await importModule()
    .profilesNeedingKey(source.id, profileIds)
    .catch(() => [] as string[])
    .finally(() => (checking = false));
  if (signal.aborted || importNow().source !== source || importNow().step !== step) return null;
  if (!needing.length) return source;
  const marked = { ...source, profiles: source.profiles.map((p) => (needing.includes(p.id) ? { ...p, tabsNeedKey: true } : p)) };
  patchImport({ source: marked });
  return marked;
}
