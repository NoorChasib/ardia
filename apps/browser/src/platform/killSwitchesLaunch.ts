import { afterFirstWindow } from "../lib/afterFirstWindow";
import { refreshSwitches } from "./killSwitches";
import { appServices } from "./launchConfig";

export function startKillSwitches(fetchFn?: typeof fetch, refreshed?: (result: Awaited<ReturnType<typeof refreshSwitches>>) => void) {
  afterFirstWindow(() => {
    if (appServices().switchesUrl) void refreshSwitches(fetchFn).then(refreshed);
  });
}
