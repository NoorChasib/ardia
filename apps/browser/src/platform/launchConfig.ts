import { nativeModule, type LaunchConfig } from "@ardia/shell";
import { replaceServices, services, type Services } from "@ardia/core/src/services.ts";

let config: (LaunchConfig & { services?: unknown }) | null = null;

function adoptLaunchServices(snapshot: unknown) {
  if (snapshot === undefined || snapshot === null) return;
  const problems = replaceServices(snapshot as Partial<Services>, "launch");
  if (problems.length) console.warn(`[services] launch snapshot refused: ${problems.map((p) => `${p.field || "(snapshot)"} ${p.problem}`).join(", ")}`);
}

const current = (): LaunchConfig => {
  if (config) return config;
  config = nativeModule("ArdiaApp").launchConfig() as LaunchConfig & { services?: unknown };
  adoptLaunchServices(config.services);
  return config;
};

export const appServices = (): Readonly<Services> => {
  try {
    current();
  } catch {}
  return services();
};

export const configDirectory = (): string => current().configDirectory;

export const isTestInstance = (): boolean => current().testInstance;

export const switchOverride = (name: string): boolean | undefined => current().switches[name];

const testValue = (key: string): string | null => current().test[key] ?? null;

export const introStartDelayMs = (): number => {
  const asked = Number(testValue("introStartDelayMs"));
  return Number.isFinite(asked) && asked > 0 ? asked : 0;
};

export const devTestValue = (key: string): string | null => (typeof __DEV__ !== "undefined" && __DEV__ ? testValue(key) : null);

export const reloadLaunchConfigForTests = () => void (config = null);

export const httpPagesPort = (): string | null => {
  const port = testValue("httpPages");
  return port && /^\d+$/.test(port) ? port : null;
};
