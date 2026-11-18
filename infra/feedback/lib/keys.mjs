export const LOCAL_APP_KEY = "local-app-key";
export const LOCAL_CLI_KEY = "local-cli-key";
export const LOCAL_KEYS = Object.freeze({ app: LOCAL_APP_KEY, cli: LOCAL_CLI_KEY });

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export const isLoopbackHost = (host) => LOOPBACK_HOSTS.has(String(host ?? "").replace(/^\[|\]$/g, ""));

export function acceptedKeys(mode, env) {
  if (mode === "local") return LOCAL_KEYS;
  const app = env.FEEDBACK_APP_KEY ?? "";
  const cli = env.FEEDBACK_CLI_KEY ?? "";
  if (!app || !cli) throw new Error("FEEDBACK_APP_KEY and FEEDBACK_CLI_KEY are required");
  if (Object.values(LOCAL_KEYS).includes(app) || Object.values(LOCAL_KEYS).includes(cli)) throw new Error("the local test keys are refused outside --local");
  if (app === cli) throw new Error("FEEDBACK_APP_KEY and FEEDBACK_CLI_KEY must differ");
  return Object.freeze({ app, cli });
}

export function surfaceByKey(keys) {
  if (!keys?.app || !keys?.cli) throw new Error("the feedback service needs an app key and a CLI key");
  return new Map([
    [keys.app, "app"],
    [keys.cli, "cli"],
  ]);
}
