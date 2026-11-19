import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { DocumentsNative } from "@nilla/shell";
import type { ExternalAppsModule } from "../../nativeModuleTypes";
import { answerExternalAppsWith, externalAppDropped, externalAppStillAsked } from "../pages";
import { readExternalAppAsk, windowsExternalApps, type ExternalApps } from "./externalApps";

export function nativeExternalApps(): ExternalApps {
  const apps = windowsExternalApps(
    () => TurboModuleRegistry.get<TurboModule & ExternalAppsModule>("NillaExternalApps"),
    () => TurboModuleRegistry.get<TurboModule & DocumentsNative>("NillaDocuments"),
    externalAppStillAsked,
    externalAppDropped,
  );
  answerExternalAppsWith({
    ask: (profile, page, data) => {
      const ask = readExternalAppAsk(data);
      return ask ? apps.request(ask, profile, page) : Promise.resolve(null);
    },
    forget: apps.forget,
    forgetPage: apps.forgetPage,
  });
  return apps;
}
