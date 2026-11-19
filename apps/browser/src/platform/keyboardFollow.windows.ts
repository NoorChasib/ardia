import type { KeptFollows, KeptFollowsNative } from "@nilla/shell";
import { requireNativeModule } from "expo-modules-core";
import type { FollowKeyboard } from "./keyboardFollow";

export type { FollowKeyboard } from "./keyboardFollow";

export const followKeyboard: FollowKeyboard | null = (tabId, windowId) => requireNativeModule<{ followKeyboard: FollowKeyboard }>("NillaTabs").followKeyboard(tabId, windowId);

export const takeKeptFollows = (): KeptFollows => requireNativeModule<KeptFollowsNative>("NillaTabs").takeKeptFollows();
