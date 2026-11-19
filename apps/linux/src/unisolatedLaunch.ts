import type { ArdiaHost } from "./host";
import { hostLaunchConfig } from "./hostLaunchConfig";

export const UNISOLATED_MESSAGE =
  "Nilla stopped: this development build runs only on a profile of its own, and this one wasn't given one. Its engine opens the profile before this page, so close it and start the build with scripts/linux/nilla-dev-run, inside a disposable VM, container or namespace.";

type AlertRoot = { setAttribute(name: string, value: string): void; textContent: string | null };

export function refuseUnisolatedLaunch(host: ArdiaHost, root: AlertRoot | null): boolean {
  if (hostLaunchConfig(host).isolated) return false;
  if (root) {
    root.setAttribute("role", "alert");
    root.textContent = UNISOLATED_MESSAGE;
  }
  return true;
}
