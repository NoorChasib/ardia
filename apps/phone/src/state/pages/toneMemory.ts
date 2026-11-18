import { parseRememberedTones, rememberedTonesText } from "../../lib/toneMemory";
import { readPreference, writePreference } from "../store/browserDatabase";
import { tabDatabase } from "../store/database";
import { usePages } from "./store";

const TONES_KEY = "pageTones";
const WRITE_DELAY_MS = 1500;

let stopRemembering: (() => void) | null = null;
let lastWritten: string | null = null;

export function restorePageTones(keep: ReadonlySet<string>) {
  let remembered = {};
  try {
    const stored = readPreference(tabDatabase(), TONES_KEY);
    remembered = parseRememberedTones(stored, keep);
    lastWritten = stored;
  } catch {
    return;
  }
  usePages.setState((s) => ({ lastTones: { ...remembered, ...s.lastTones } }));
}

export function rememberPageTones(keep: () => ReadonlySet<string>): () => void {
  stopRemembering?.();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    timer = null;
    try {
      const text = rememberedTonesText(usePages.getState().lastTones, keep());
      if (text === lastWritten) return;
      writePreference(tabDatabase(), TONES_KEY, text);
      lastWritten = text;
    } catch {
      return;
    }
  };
  const unsubscribe = usePages.subscribe((state, previous) => {
    if (state.lastTones === previous.lastTones || timer) return;
    timer = setTimeout(write, WRITE_DELAY_MS);
  });
  const stop = () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    if (stopRemembering === stop) stopRemembering = null;
  };
  stopRemembering = stop;
  return stop;
}
