import { ardiaCoreNativeModules } from "../../../test-native/ardiacore.ts";
import { shellNativeModules } from "../../../test-native/shell.ts";

export const escapeCapture = [];
const recordEscape = (on) => (escapeCapture.push(on), Promise.resolve());
const withEscape = (module) => module && { ...module, setDragEscapeCapture: recordEscape };

globalThis.acTestNativeModules = {
  ...globalThis.acTestNativeModules,
  NillaWindows: { ...ardiaCoreNativeModules.NillaWindows, ...shellNativeModules.NillaWindows },
  ...(shellNativeModules.NillaFocus ? { NillaFocus: withEscape(shellNativeModules.NillaFocus) } : {}),
  NillaShell: shellNativeModules.NillaShell.setDragEscapeCapture ? withEscape(shellNativeModules.NillaShell) : shellNativeModules.NillaShell,
};
