import { consentCrossed, useTelemetry } from "./choice";

let period = 0;

useTelemetry.subscribe((s, prev) => {
  if (consentCrossed(s, prev)) period++;
});

export function sameSharingPeriod() {
  const started = period;
  return () => started === period;
}
