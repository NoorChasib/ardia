import type { LaunchConfig } from "../../../packages/shell/src/app";
import type { HydrateData } from "../../browser/src/state/browser/store";
import type { BrowserWindow, Tab } from "../../browser/src/state/browser/types";
import type { UnclaimedTab } from "./unclaimedTabs.ts";
import { engineCallName } from "./engineModuleNames.ts";
import { gatedError, gateHost, isGatedForAnyHost } from "./layer1Gate.ts";

export type HostListener = (module: string, event: string, payload: unknown) => void;
export type ArdiaHost = {
  bootstrap: {
    windowId: string;
    profileId: string;
    startup?: boolean;
    utility?: { pane: string; profileId: string | null; detail: string | null; importSource?: string };
    session?: HydrateData | null;
    documents?: Record<string, string>;
    nativeModules?: Record<string, Record<string, unknown>>;
    capabilities?: string[];
    launchConfig?: LaunchConfig;
    pageProfile?: string;
    privateWindow?: { window: BrowserWindow; tabs: Record<string, Tab> };
    windowKind?: string;
    smallWindow?: unknown;
    typeaheadDeadline?: number;
    adoptTabs?: UnclaimedTab[];
    chromeMade?: boolean;
    glassPanels?: boolean;
    sandboxDecision?: string;
  };
  call(name: string, profile: string, args: string | null): Promise<string>;
  invoke(method: string, args: Record<string, unknown>): Promise<unknown>;
  onEvent(listener: HostListener): () => void;
  onBeforeClose?(listener: () => void): () => void;
};

declare global {
  interface Window {
    __ardiaHost?: ArdiaHost;
  }
}

export const nillaHost = typeof window === "undefined" ? undefined : gateHost(window.__ardiaHost);

export function hostProfile(profile: string | undefined, host: ArdiaHost = nillaHost!) {
  return profile || host.bootstrap.profileId;
}

export function invokeHost<T = unknown>(appMethod: string, args: Record<string, unknown>, host: ArdiaHost = nillaHost!): Promise<T> {
  const method = engineCallName(appMethod);
  if (!host) return Promise.reject(new Error(`Nilla host unavailable: ${method}`));
  if (isGatedForAnyHost(method)) return Promise.reject(gatedError(method));
  return Promise.resolve().then(() => host.invoke(method, args)) as Promise<T>;
}

export function hostSupports(appMethod: string, host: ArdiaHost = nillaHost!) {
  const method = engineCallName(appMethod);
  return !isGatedForAnyHost(method) && !!host?.bootstrap.capabilities?.includes(method);
}

export type HostRect = { x: number; y: number; width: number; height: number };
export type HostInputRegions = { pages: HostRect[]; overlays: HostRect[] };
export const INPUT_REGIONS_METHOD = "shell.inputRegions";

export function hostModuleMethod(module: string, method: string, host: ArdiaHost = nillaHost!) {
  const name = engineCallName(`${module}.${method}`);
  return (...args: unknown[]) => (isGatedForAnyHost(name) ? Promise.reject(gatedError(name)) : invokeHost(name, { args }, host));
}

export function callHost(appName: string, profile: string, args: string | null, host: ArdiaHost = nillaHost!) {
  const name = engineCallName(appName);
  if (!host) return Promise.reject(new Error(`Nilla host unavailable: ${name}`));
  if (isGatedForAnyHost(name)) return Promise.reject(gatedError(name));
  if (typeof profile !== "string") return Promise.reject(Object.assign(new Error("Profile must be a string"), { code: "ERR_ENGINE" }));
  return Promise.resolve().then(() => host.call(name, hostProfile(profile, host), args)).then((reply) => {
    if (typeof reply !== "string") throw Object.assign(new Error("The engine reply is not JSON text"), { code: "ERR_BAD_REPLY" });
    let parsed: unknown;
    try { parsed = JSON.parse(reply); } catch { throw Object.assign(new Error("The engine reply is not JSON"), { code: "ERR_BAD_REPLY" }); }
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      throw Object.assign(new Error(String(parsed.error)), { code: "ERR_ENGINE" });
    }
    return reply;
  });
}

export function reportHostError(error: unknown) {
  console.error("[nilla host]", error);
}
