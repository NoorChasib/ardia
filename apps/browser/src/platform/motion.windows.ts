import { requireNativeModule } from "expo-modules-core";
import type { MotionNative } from "@nilla/shell";

export const animationBursts = requireNativeModule<MotionNative>("NillaMotion");
