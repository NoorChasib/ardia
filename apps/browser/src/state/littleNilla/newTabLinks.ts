import { setLittleArdiaOpensNewTabLinks } from "../../platform/pageOptions";

let started = false;

export function startLittleNillaNewTabLinks() {
  if (started) return;
  started = true;
  void setLittleArdiaOpensNewTabLinks(true);
}
