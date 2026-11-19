import type { AppEvent, CommandEvent, ConfirmOptions, DialogsNative, InlineWrite, PromptOptions, SystemInfo, WindowEvent } from "@nilla-real/shell";
export * from "@nilla-real/shell";
import { unstable_batchedUpdates } from "react-dom";
import { emitNativeEvent, provideNativeModule, provideNativeModuleProvider } from "./expo-modules-core";
import { NATIVE_CHANGE } from "./react-native";
import { nillaHost, hostModuleMethod, reportHostError } from "../host";
import { hostLaunchConfig } from "../hostLaunchConfig";
import { APP_NAME, reportedSystemInfo } from "../hostSystemInfo";
import { createFolderPicker } from "../hostFolders";
import { linuxHostDialogs } from "../hostDialogs";
import { createHostDocuments } from "../hostDocuments";
import { createAppearance, type AppearanceMode } from "../hostAppearance";
import { createHostWindowOpener, dropRefusedWindow } from "../hostWindowProfiles";
import { createLinuxWindowIds } from "../windowSweep";
import { useBrowser } from "../../../browser/src/state/browser/store";

export { Symbol } from "./web/Symbol";
export { FolderIcon } from "./web/FolderIcon";
export { ActivitySpinner } from "./web/motion/ActivitySpinner";
export {
  ContextMenuArea,
  DockSelection,
  GlassEffect,
  OutsidePressArea,
  Surface,
  VisualEffect,
  WindowDragRegion,
} from "./web/chrome";
export { FadeLabel } from "./web/FadeLabel";
export { EdgeFadeMask } from "./web/EdgeFadeMask";
export { MouseArea } from "./web/MouseArea";
export { FileDropArea } from "./web/FileDropArea";
export { PopoverBubble } from "./web/PopoverBubble";
export { showMenu } from "../menus";
import { setTrafficLightsCenter } from "./web/windowChrome";
export { setTrafficLightsCenter };
export { fetchBangList } from "../shellMethods";

const SYSTEM_INFO: SystemInfo = {
  appName: APP_NAME,
  appVersion: "linux-dev",
  appBuild: "host",
  bundleId: "dev.ardia.linux",
  configuration: "Release",
  osVersion: "Linux",
  osBuild: "Linux",
  arch: "unknown",
  model: "Linux",
  memoryGB: 8,
  locale: typeof navigator === "undefined" ? "en-US" : navigator.language,
};

provideNativeModule("ArdiaApp", { launchConfig: () => hostLaunchConfig(), systemInfo: () => SYSTEM_INFO });
provideNativeModule("ArdiaCalendar", { authorizationStatus: () => "notDetermined" });

const documents = new Map<string, string>();
const hostDocuments = nillaHost ? createHostDocuments(nillaHost) : undefined;
export const readDocument = (name: string) => hostDocuments ? hostDocuments.read(name) : documents.get(name) ?? null;
export const writeDocument = (name: string, contents: string) => hostDocuments ? void hostDocuments.write(name, contents).catch(reportHostError) : void documents.set(name, contents);
export const saveDocument = async (name: string, contents: string) => hostDocuments ? hostDocuments.write(name, contents) : void documents.set(name, contents);
export const documentSaved = async (name: string) => hostDocuments ? hostDocuments.saved(name) : undefined;
export const removeDocument = (name: string) => hostDocuments ? void hostDocuments.remove(name).catch(reportHostError) : void documents.delete(name);
export const refreshDocument = async (name: string) => hostDocuments ? hostDocuments.refresh(name) : documents.has(name);
export const deleteDocument = async (name: string) => hostDocuments ? hostDocuments.remove(name) : void documents.delete(name);

export function copyText(text: string) {
  if (nillaHost) return void hostModuleMethod("ArdiaShell", "copyText")(text).catch(reportHostError);
  void navigator.clipboard?.writeText(text).catch(() => {});
}

export const confirm: DialogsNative["confirm"] = async (options: ConfirmOptions) => nillaHost ? hostModuleMethod("ArdiaShell", "confirm")(options) as ReturnType<DialogsNative["confirm"]> : ({
  confirmed: window.confirm([options.title, options.message].filter(Boolean).join("\n\n")),
  suppressed: false,
});

export const prompt = async (options: PromptOptions) =>
  nillaHost ? hostModuleMethod("ArdiaShell", "prompt")(options) as Promise<string | null> : window.prompt(options.message ? `${options.title}\n\n${options.message}` : options.title, options.value ?? "");

const darkQuery = typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");
const appearance = createAppearance(nillaHost, darkQuery, (dark) => emitAppEvent({ type: "appearance", dark }));
export const isDarkAppearance = appearance.isDarkAppearance;
export const setAppearance = (mode: AppearanceMode) => appearance.setAppearance(mode).catch(reportHostError);

export const windowIds = nillaHost ? createLinuxWindowIds(nillaHost, () => useBrowser.getState()) : async () => [] as string[];
export const windowFrame = async (id: string): Promise<[number, number, number, number] | null> => nillaHost ? hostModuleMethod("ArdiaShell", "windowFrame")(id) as Promise<[number, number, number, number] | null> : null;
export const systemInfo = (): SystemInfo => nillaHost ? reportedSystemInfo(nillaHost) ?? { ...SYSTEM_INFO, appVersion: "linux-dev", appBuild: "host", bundleId: "dev.ardia.linux", osVersion: "Linux", osBuild: "Linux", arch: "unknown", model: "Linux" } : SYSTEM_INFO;
export const launchConfig = () => hostLaunchConfig(nillaHost);

const claimHostFocus = async (generation: number, tag: number) => {
  const node = tag as unknown;
  if (node instanceof HTMLElement) node.focus();
  else await hostModuleMethod("ArdiaShell", "claimFocus")(generation, tag);
};
const openHostWindow = nillaHost ? createHostWindowOpener(nillaHost, () => useBrowser.getState(), (event) => emitWindowEvent(event), (id) => dropRefusedWindow(useBrowser, id)) : undefined;
const pickHostFolder = nillaHost ? createFolderPicker(nillaHost, (options) => linuxHostDialogs().confirm(options).then((answer) => answer.confirmed)) : undefined;
const hostShellLocals: Record<string, unknown> = { readDocument, writeDocument, saveDocument, documentSaved, removeDocument, claimFocus: claimHostFocus, openWindow: openHostWindow, pickFolder: pickHostFolder };
const hostAppLocals: Record<string, unknown> = { systemInfo, launchConfig };
provideNativeModuleProvider((module, method) => nillaHost ? (module === "ArdiaShell" ? hostShellLocals[method] : module === "ArdiaApp" ? hostAppLocals[method] : undefined) : undefined);
const shellLocals: Record<string, unknown> = {
  setAppearance,
  isDarkAppearance,
  windowIds,
  setTrafficLightsCenter: async (id: string, center: [number, number] | null, trailing = false) => setTrafficLightsCenter(id, center, trailing),
};
provideNativeModuleProvider((module, method) => module === "ArdiaShell" && Object.hasOwn(shellLocals, method) ? shellLocals[method] : undefined);

const valueSetter = typeof window === "undefined" ? undefined : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

export async function completeInline(tag: number, typed: string, completion: string): Promise<InlineWrite> {
  const field = tag as unknown as (HTMLInputElement & { [NATIVE_CHANGE]?: (text: string, selection: { start: number; end: number }) => void }) | null;
  if (!(field instanceof HTMLInputElement) || !valueSetter) return 0;
  if (field.value !== typed || document.activeElement !== field) return 2;
  const full = typed + completion;
  valueSetter.call(field, full);
  field.setSelectionRange(typed.length, full.length);
  unstable_batchedUpdates(() => field[NATIVE_CHANGE]?.(full, { start: typed.length, end: full.length }));
  return 1;
}

export const emitCommand = (event: CommandEvent) => emitNativeEvent("ArdiaShell", "onCommand", event);
export const emitWindowEvent = (event: WindowEvent) => emitNativeEvent("ArdiaShell", "onWindowEvent", event);
export const emitAppEvent = (event: AppEvent) => emitNativeEvent("ArdiaShell", "onAppEvent", event);
