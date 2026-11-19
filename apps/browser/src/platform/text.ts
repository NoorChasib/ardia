import { nativeModule } from "@nilla/shell";

export { completeInline, copyFieldAs, translation } from "@nilla/shell";

export const startDictation = () => nativeModule("NillaShell").startDictation();
export const dictationAvailable = () => nativeModule("NillaShell").dictationAvailable?.() !== false;
