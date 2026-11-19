import { nativeModule, type ScriptCommand, type ScriptState } from "@nilla/shell";

export type { ScriptCommand, ScriptState };

const Scripting = nativeModule("NillaScripting");

export const setScriptState = (state: ScriptState) => Scripting.setScriptState(state);
export const replyToScript = (id: string, result: Record<string, unknown> | null, error: string | null = null) =>
  Scripting.replyToScript(id, result, error);
export const onScriptCommand = (listener: (e: ScriptCommand) => void) => Scripting.addListener("onScriptCommand", listener);
