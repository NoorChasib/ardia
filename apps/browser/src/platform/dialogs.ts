import { nativeModule, type ConfirmOptions, type PromptOptions } from "@nilla/shell";

const Dialogs = nativeModule("NillaDialogs");

export const confirm = (options: ConfirmOptions) => Dialogs.confirm(options);
export const prompt = (options: PromptOptions) => Dialogs.prompt(options);
export const pickFiles = () => Dialogs.pickFiles();
export const pickFolder = (current: string | null, prompt: string | null = null) => Dialogs.pickFolder(current, prompt);
