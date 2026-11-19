import type { ExternalAppCountsNative } from "@nilla/shell";

export const externalAppCounts: ExternalAppCountsNative = { takeLaunches: () => ({ opened: 0, refused: 0, automatic: 0 }) };
