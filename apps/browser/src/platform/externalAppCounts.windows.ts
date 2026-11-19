import { requireNativeModule } from "expo-modules-core";
import type { ExternalAppCountsNative } from "@nilla/shell";

export const externalAppCounts = requireNativeModule<ExternalAppCountsNative>("NillaExternalAppCounts");
