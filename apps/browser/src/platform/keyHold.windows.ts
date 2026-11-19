import type { KeyHoldCounts, KeyHoldNative } from "@nilla/shell";
import { requireNativeModule } from "expo-modules-core";
import { onAppEvent } from "./app";

export const takeKeyHoldCounts = (): KeyHoldCounts => requireNativeModule<KeyHoldNative>("NillaFocus").keyHoldCounts();

export function onKeyHoldReplay(listener: (tag: number, count: number) => void): () => void {
  const subscription = onAppEvent((e) => {
    if (e.type === "keyHoldReplay") listener(e.tag, e.count);
  });
  return () => subscription.remove();
}
