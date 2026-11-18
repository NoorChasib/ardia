import { INGEST_KEY_HEADER } from "@ardia/core/src/ingestKeys.ts";
import { services } from "@ardia/core/src/services.ts";
import Constants from "expo-constants";
import { requireOptionalNativeModule, uuid } from "expo-modules-core";
import { Platform } from "react-native";
import { appVersionOf, osVersionOf, type DeviceFacts } from "../lib/telemetrySchema";
import { system } from "@ardia/phone-native";

export const JS_STARTED_AT = Date.now();

const isLab = process.env.EXPO_PUBLIC_ARDIA_LAB === "true";

export const newTelemetryId = () => uuid.v4().toLowerCase();

const telemetryEndpoint = (): { url: string; key: string } | null => {
  const { telemetryUrl, ingestKeys } = services();
  return telemetryUrl && ingestKeys ? { url: telemetryUrl, key: ingestKeys.app } : null;
};

export const canPostTelemetry = () => !__DEV__ && telemetryEndpoint() !== null;

export function deviceFacts(): DeviceFacts {
  return {
    platform: Platform.OS === "ios" ? "ios" : "android",
    appVersion: appVersionOf(Constants.expoConfig?.version),
    osVersion: osVersionOf(Platform.Version),
    environment: __DEV__ ? "dev" : isLab ? "test" : "production",
  };
}

type ProcessClock = { processStartedAt?: () => number | Promise<number> };

const processClock = requireOptionalNativeModule<ProcessClock>("ArdiaPhoneSystem");

export async function processStartedAt(): Promise<number | null> {
  try {
    const at = await processClock?.processStartedAt?.();
    return typeof at === "number" && Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export function launchBackdropShownAt(): number | null {
  try {
    const at = system.launchBackdropShownAt();
    return typeof at === "number" && Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export async function postTelemetry(body: string, signal: AbortSignal): Promise<number> {
  const endpoint = telemetryEndpoint();
  if (!endpoint) return 0;
  const response = await fetch(endpoint.url, { method: "POST", headers: { "Content-Type": "application/json", [INGEST_KEY_HEADER]: endpoint.key }, body, signal });
  return response.status;
}

export const takePendingCounts = (): Record<string, unknown> => system.takePendingCounts();

export const setUsageConsent = (sharing: boolean) => system.setUsageConsent(sharing);
