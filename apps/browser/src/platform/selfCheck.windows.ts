import { requireNativeModule } from "expo-modules-core";
import type { SelfCheckNative } from "@nilla/shell";

export const selfChecks = requireNativeModule<SelfCheckNative>("NillaSelfCheck");
