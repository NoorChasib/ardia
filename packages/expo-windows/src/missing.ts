const seen = new Set<string>();
let firstWindowNoted = false;

export function noteMissing(what: string) {
  if (seen.has(what)) return;
  seen.add(what);
  console.info(`[nilla windows] no Windows version yet: ${what}`);
}

export function noteFirstWindow() {
  if (firstWindowNoted) return;
  firstWindowNoted = true;
  console.info("[nilla windows] first window");
}

export const missingOnWindows = () => [...seen].sort();

Object.assign(globalThis, { nillaWindowsMissing: missingOnWindows });
