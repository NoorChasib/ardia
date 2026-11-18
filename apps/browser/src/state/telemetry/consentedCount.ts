import { sharingAgreed, useTelemetry } from "./choice";

export function consentedCount() {
  let count = 0;
  useTelemetry.subscribe((s, prev) => {
    if (s.sharing !== prev.sharing) count = 0;
  });
  return {
    note: () => void (sharingAgreed() && count++),
    add: (amount: number) => void (sharingAgreed() && (count += amount)),
    take: () => {
      const taken = count;
      count = 0;
      return taken;
    },
  };
}
