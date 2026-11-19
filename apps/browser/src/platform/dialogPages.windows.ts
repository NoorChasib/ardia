import { requireNativeModule } from "expo-modules-core";
import type { DialogPagesNative } from "@nilla/shell";

export const dialogPages = requireNativeModule<DialogPagesNative>("NillaDialogPages");
