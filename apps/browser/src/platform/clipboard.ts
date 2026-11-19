import { nativeModule } from "@nilla/shell";

const Shell = nativeModule("NillaShell");

export const copyText = (text: string) => Shell.copyText(text);
export const readText = () => Shell.readText();
