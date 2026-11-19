import { afterFirstWindow } from "../lib/afterFirstWindow";
import { refreshSwitches } from "./killSwitches";
import { appServices } from "./launchConfig";

type Refreshed = Exclude<Awaited<ReturnType<typeof refreshSwitches>>, "off">;

export function startKillSwitches(fetchFn?: typeof fetch, refreshed?: (result: Refreshed) => void) {
  afterFirstWindow(() => {
    if (!appServices().switchesUrl) return;
    void refreshSwitches(fetchFn).then((result) => {
      if (result !== "off") refreshed?.(result);
    });
  });
}
