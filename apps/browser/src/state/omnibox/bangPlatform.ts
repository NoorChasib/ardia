export const refreshesBangs = true;

export const loadBundledBangs = (): Promise<typeof import("@nilla/core/src/bangList.ts")> =>
  Promise.resolve().then(() => require("@nilla/core/src/bangList.ts"));
