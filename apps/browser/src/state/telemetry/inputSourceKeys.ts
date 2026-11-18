import { takeInputSourceKeys } from "../../platform/focus";
import { consentCrossed, isSharing, useTelemetry } from "./choice";

useTelemetry.subscribe((current, previous) => {
  if (consentCrossed(current, previous)) takeInputSourceKeys();
});

export function takeInputSourceKeyCounts(): { input_source_keys_webkit?: number } {
  const n = takeInputSourceKeys();
  return isSharing() && Number.isSafeInteger(n) && n > 0 ? { input_source_keys_webkit: n } : {};
}
