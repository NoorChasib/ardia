import { requireNativeModule } from "expo-modules-core";
import type { LaunchLinksNative } from "@nilla/shell";

export const launchLinks = requireNativeModule<LaunchLinksNative>("NillaLaunchLinks");
