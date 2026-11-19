import type { KeyHoldCounts } from "@nilla/shell";

export const takeKeyHoldCounts = (): KeyHoldCounts => ({ holds: 0, replayed: 0, drops: {} });

export const onKeyHoldReplay = (_listener: (tag: number, count: number) => void): (() => void) => () => {};
