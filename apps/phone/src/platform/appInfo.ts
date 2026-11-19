import Constants from "expo-constants";
import { pages } from "@nilla/phone-native";
import { appVersionLabel } from "../lib/appVersionLabel";

export const appVersion = () => {
  const release = pages.appRelease();
  return release ? appVersionLabel(release, __DEV__) : `Nilla ${Constants.expoConfig?.version ?? "1.0"}`;
};
