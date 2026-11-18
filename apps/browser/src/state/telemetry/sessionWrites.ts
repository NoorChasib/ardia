import { consentedCount, sharingAgreed } from "./consentedCount";

const writes = consentedCount();
const cosmeticWrites = consentedCount();
const characters = consentedCount();

export function noteSessionWrite(length: number, cosmeticOnly: boolean) {
  if (!sharingAgreed()) return;
  writes.note();
  if (cosmeticOnly) cosmeticWrites.note();
  characters.add(length);
}

export function takeSessionWrites() {
  return { session_writes: writes.take(), session_cosmetic_writes: cosmeticWrites.take(), session_kb_written: Math.round(characters.take() / 1024) };
}
