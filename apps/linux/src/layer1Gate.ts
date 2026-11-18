import type { ArdiaHost } from "./host.ts";

export const GATED_METHODS: ReadonlySet<string> = new Set([
  "ArdiaTelemetry.post",
  "ArdiaUpdates.releases",
  "ArdiaShell.fetchKillSwitches",
  "ArdiaReport.upload",
  "ArdiaReport.post",
  "report.send",
  "ArdiaSystem.setAsDefaultBrowser",
  "ArdiaSystem.setLaunchAtLogin",
  "ArdiaCli.install",
]);

export const GATED_MODULES: readonly string[] = ["ArdiaSync", "ArdiaLive"];

export const isGated = (name: string) => GATED_METHODS.has(name) || GATED_MODULES.some((module) => name.startsWith(`${module}.`));

export const ENGINE_DRIVEN_MODULES: readonly string[] = ["ArdiaLive"];

export const isGatedForAnyHost = (name: string) => isGated(name) && !ENGINE_DRIVEN_MODULES.some((module) => name.startsWith(`${module}.`));

export const gatedError = (name: string) => Object.assign(new Error(`${name} is off in this build of Nilla`), { code: "ERR_UNSUPPORTED" });

const ungated = (capabilities: string[] | undefined) => capabilities?.filter((name) => !isGated(name));

const gatedHosts = new WeakSet<object>();

export function gateHost<T extends ArdiaHost | undefined>(host: T): T {
  if (!host || gatedHosts.has(host)) return host;
  let source: string[] | undefined;
  let filtered: string[] | undefined;
  const bootstrap = new Proxy(host.bootstrap, {
    get(target, key, receiver) {
      if (key !== "capabilities") return Reflect.get(target, key, receiver);
      if (target.capabilities !== source) {
        source = target.capabilities;
        filtered = ungated(source);
      }
      return filtered;
    },
  });
  const gated = new Proxy(host, {
    get(target, key, receiver) {
      if (key === "bootstrap") return bootstrap;
      if (key === "invoke") return (method: string, args: Record<string, unknown>) => (isGated(method) ? Promise.reject(gatedError(method)) : target.invoke(method, args));
      if (key === "call") return (name: string, profile: string, args: string | null) => (isGated(name) ? Promise.reject(gatedError(name)) : target.call(name, profile, args));
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  gatedHosts.add(gated);
  return gated as T;
}
