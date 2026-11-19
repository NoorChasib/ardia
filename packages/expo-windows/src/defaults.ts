import { noteMissing } from "./missing";

const ENGINE_ONLY: Record<string, string[]> = {
  NillaHistory: ["query", "add", "import", "deleteUrls", "watch"],
  NillaBookmarks: ["tree", "apply", "watch"],
  NillaFavicons: ["get", "set"],
  NillaTabs: ["lastTabPolicy"],
  NillaEngine: ["batterySaver", "trimMemory", "openTaskManager", "cliControlStatus", "setCliControl", "setCliActiveTab", "cliTabTargets", "cliOwnsTab", "cliMoveOffscreen", "cliCloseOffscreenTabs"],
  NillaExtensions: ["watchActions", "syncState", "syncApply"],
  NillaDownloads: ["settings", "setSettings"],
};

const ENGINE_ANSWERS: Record<string, Record<string, unknown>> = {
  NillaTabs: { strips: { rev: 0, cmd: null, strips: [] }, routeLinkTabs: {} },
  NillaExtensions: { list: { extensions: [] } },
  NillaSearch: { engines: { list: { engines: [] } } },
  NillaWindows: { list: [] },
};

const engineDomains = Object.fromEntries(
  [...new Set([...Object.keys(ENGINE_ONLY), ...Object.keys(ENGINE_ANSWERS)])].map((module) => [
    module,
    {
      call: async (name: string) => {
        if (ENGINE_ONLY[module]?.includes(name)) throw Object.assign(new Error(`${name} needs the engine, which Windows doesn't have yet`), { code: "ERR_ENGINE" });
        const answer = ENGINE_ANSWERS[module]?.[name];
        if (answer === undefined) noteMissing(`${module}.call ${name}`);
        return JSON.stringify(answer ?? null);
      },
    },
  ]),
);

export const moduleDefaults: Record<string, Record<string, unknown>> = {
  ...engineDomains,
  NillaApp: { launchEnvironment: () => null, windowsApiVersion: 0, interfaceScale: () => 1, interfaceScaleRange: () => [1, 1], setInterfaceScale: async () => 1 },
  NillaCalendar: { authorizationStatus: () => "notDetermined" },
  NillaCli: {
    installedVersion: () => null,
    canInstallUnattended: () => false,
    install: async () => ({ ok: false, appVersion: "", error: "The nilla-browser command isn't offered on Windows yet.", lines: [] }),
  },
  NillaGlassEffect: { isLiquidGlass: () => false },
  NillaTranslate: { available: false, userLanguages: () => ["en"], languageName: (id: string) => id },
  NillaUserScripts: { watch: () => {}, read: async () => ({ state: "empty" }), readStatus: async () => null },
};
