import { isSharing, useTelemetry } from "./choice";

export const sharingAgreed = () => isSharing() && useTelemetry.getState().sharing;

export function consentedCount() {
  let count = 0;
  useTelemetry.subscribe((s, prev) => {
    if (s.sharing !== prev.sharing) count = 0;
  });
  return {
    note: () => void (isSharing() && count++),
    add: (amount: number) => void (isSharing() && (count += amount)),
    take: () => {
      const taken = count;
      count = 0;
      return taken;
    },
  };
}
