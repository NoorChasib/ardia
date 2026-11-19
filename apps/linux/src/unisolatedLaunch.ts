import type { ArdiaHost } from "./host";
import { hostLaunchConfig } from "./hostLaunchConfig";

export const UNISOLATED_MESSAGE =
  "This development build of Nilla runs only on a profile of its own, so this window has read and saved nothing. Start it with scripts/linux/nilla-dev-run, inside a disposable VM, container or namespace.";

type AlertRoot = { setAttribute(name: string, value: string): void; textContent: string | null };

export function refuseUnisolatedLaunch(host: ArdiaHost, root: AlertRoot | null): boolean {
  if (hostLaunchConfig(host).isolated) return false;
  if (root) {
    root.setAttribute("role", "alert");
    root.textContent = UNISOLATED_MESSAGE;
  }
  return true;
}
