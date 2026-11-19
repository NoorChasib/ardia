import type { SelfCheck, SelfCheckNative } from "@nilla/shell";

const registered: SelfCheck[] = [];

export const windowsSelfChecks: SelfCheckNative = {
  register(check) {
    registered.push(check);
  },
};

export const registeredChecks = (): readonly SelfCheck[] => registered;
