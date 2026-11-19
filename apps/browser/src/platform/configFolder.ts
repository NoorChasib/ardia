import { nativeModule, type ConfigFileRead } from "@nilla/shell";

export type { ConfigFileRead };

const Config = nativeModule("NillaConfig");

export const readConfigFile = (name: string): ConfigFileRead => Config.readFile(name);
export const watchConfigFiles = (names: string[]) => Config.watch(names);
export const writeConfigSchemas = (files: Record<string, string>) => Config.writeSchemas(files);
export const onConfigChange = (listener: () => void) => Config.addListener("onChange", listener);
