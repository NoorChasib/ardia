import type { DialogPagesNative } from "@nilla/shell";

export const dialogPages: DialogPagesNative = { takeDialogPages: () => ({ asked: 0, stalled: 0 }) };
