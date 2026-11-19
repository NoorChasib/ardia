import { engineCallName } from "./engineModuleNames.ts";
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

export const isGated = (appName: string) => {
  const name = engineCallName(appName);
  return GATED_METHODS.has(name) || GATED_MODULES.some((module) => name.startsWith(`${module}.`));
};

export const ENGINE_DRIVEN_MODULES: readonly string[] = ["ArdiaLive"];

export const isGatedForAnyHost = (name: string) => isGated(name) && !ENGINE_DRIVEN_MODULES.some((module) => engineCallName(name).startsWith(`${module}.`));

export const gatedError = (name: string) => Object.assign(new Error(`${name} is off in this build of Nilla`), { code: "ERR_UNSUPPORTED" });

const ungated = (capabilities: string[] | undefined) => capabilities?.filter((name) => !isGated(name));

const gatedHosts = new WeakSet<object>();

export function gateHost<T extends ArdiaHost | undefined>(host: T): T {
  if (!host || gatedHosts.has(host)) return host;
  const source: ArdiaHost = host;
  let seen: string[] | undefined;
  let filtered: string[] | undefined;
  const bootstrap = new Proxy({} as ArdiaHost["bootstrap"], {
    get(_target, key) {
      if (key !== "capabilities") return Reflect.get(source.bootstrap, key);
      if (source.bootstrap.capabilities !== seen) {
        seen = source.bootstrap.capabilities;
        filtered = ungated(seen);
      }
      return filtered;
    },
    has: (_target, key) => key in source.bootstrap,
    set: (_target, key, value) => Reflect.set(source.bootstrap, key, value),
  });
  const gated = new Proxy({} as ArdiaHost, {
    get(_target, key) {
      if (key === "bootstrap") return bootstrap;
      if (key === "invoke") return (method: string, args: Record<string, unknown>) => (isGated(method) ? Promise.reject(gatedError(method)) : source.invoke(engineCallName(method), args));
      if (key === "call") return (name: string, profile: string, args: string | null) => (isGated(name) ? Promise.reject(gatedError(name)) : source.call(engineCallName(name), profile, args));
      const value = Reflect.get(source, key);
      return typeof value === "function" ? value.bind(source) : value;
    },
    has: (_target, key) => key in source,
    set: (_target, key, value) => Reflect.set(source, key, value),
  });
  gatedHosts.add(gated);
  return gated as T;
}
