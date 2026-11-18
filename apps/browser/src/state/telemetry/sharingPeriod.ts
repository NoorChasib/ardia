import { useTelemetry } from "./choice";

let period = 0;

useTelemetry.subscribe((s, prev) => {
  if (prev.sharing !== s.sharing) period++;
});

export function sameSharingPeriod() {
  const started = period;
  return () => started === period;
}
