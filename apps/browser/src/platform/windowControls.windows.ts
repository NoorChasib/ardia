import { requireNativeModule } from "expo-modules-core";
import type { WindowControlsNative } from "@nilla/shell";
import type { WindowControls } from "./windowControls";

const Windows = requireNativeModule<WindowControlsNative>("NillaAppWindows");

export const windowControls: WindowControls = {
  minimize: (windowId) => void Windows.minimizeWindow(windowId),
  toggleMaximize: (windowId) => void Windows.toggleMaximizeWindow(windowId),
  setCaptionRegions: (windowId, regions) => void Windows.setCaptionRegions(windowId, regions),
};
