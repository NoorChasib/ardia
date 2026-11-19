const seen = new Set<string>();

export function noteMissing(what: string) {
  if (seen.has(what)) return;
  seen.add(what);
  console.info(`[nilla linux] unavailable: ${what}`);
}

export const missingOnWeb = () => [...seen].sort();

Object.assign(globalThis, { nillaLinuxMissing: missingOnWeb });
