import type { ArdiaHost } from "./host";
import { refuseUnisolatedLaunch } from "./unisolatedLaunch";

const rawHost: ArdiaHost | undefined = typeof window === "undefined" ? undefined : window.__ardiaHost;

if (!rawHost || !refuseUnisolatedLaunch(rawHost, document.getElementById("root"))) void import("./main");
