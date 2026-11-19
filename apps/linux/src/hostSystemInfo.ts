import type { SystemInfo } from "../../../packages/shell/src/app";
import type { ArdiaHost } from "./host";

export const APP_NAME = "Nilla";

export function reportedSystemInfo(host: ArdiaHost | undefined): SystemInfo | undefined {
  const reported = host?.bootstrap.nativeModules?.ArdiaApp?.systemInfo as SystemInfo | undefined;
  return reported && { ...reported, appName: APP_NAME };
}
