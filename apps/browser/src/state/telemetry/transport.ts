import { systemInfo, type SystemInfo } from "../../platform/app";
import { devTestValue } from "../../platform/launchConfig";
import { PLATFORM_IDS, PLATFORM_TERMS } from "../../lib/platformTerms";
import { INGEST_KEY_HEADER } from "@nilla/core";
import { appServices } from "../../platform/launchConfig";
import { DEV_SEND_TEST_KEY } from "./config";
import { logRequest, type RequestLogEntry } from "./requestLog";

let app: SystemInfo | null = null;
export const appInfo = () => (app ??= systemInfo());

const devSendAllowed = () => devTestValue(DEV_SEND_TEST_KEY) === "1";

export const NOT_SENT = -1;

export const telemetryEndpoint = (): { url: string; key: string } | null => {
  const { telemetryUrl, ingestKeys } = appServices();
  return telemetryUrl && ingestKeys ? { url: telemetryUrl, key: ingestKeys.app } : null;
};

export const telemetryOffered = () => !!appServices().telemetryUrl;

export const mayPost = () => telemetryEndpoint() !== null && (!__DEV__ || devSendAllowed());

export type TelemetrySend = (body: string, signal?: AbortSignal) => Promise<number>;
export type TelemetryHost = { os: string; osType: string; send: TelemetrySend | null };

const PLATFORM_HOST: TelemetryHost = { os: PLATFORM_TERMS.os, osType: PLATFORM_IDS.otel, send: null };
let host = PLATFORM_HOST;

export const telemetryHost = (): Readonly<TelemetryHost> => host;
export const setTelemetryHost = (next: TelemetryHost) => void (host = next);

const posted = { bytes: 0, failed: 0, requests: 0 };

export function takePostStats() {
  const taken = { ...posted };
  Object.assign(posted, { bytes: 0, failed: 0, requests: 0 });
  return taken;
}

export const postHeaders = (key: string): Readonly<Record<string, string>> => ({ "Content-Type": "application/json", [INGEST_KEY_HEADER]: key });

export async function post(kind: RequestLogEntry["kind"], body: string, count: number, signal?: AbortSignal): Promise<number> {
  const endpoint = telemetryEndpoint();
  const entry: RequestLogEntry = { at: new Date().toISOString(), kind, url: endpoint?.url ?? null, count, bytes: body.length, status: null };
  if (!endpoint || !mayPost()) {
    logRequest({ ...entry, status: NOT_SENT, dryRun: true }, body);
    return NOT_SENT;
  }
  try {
    entry.status = host.send ? await host.send(body, signal) : (await fetch(endpoint.url, { method: "POST", headers: postHeaders(endpoint.key), body, signal })).status;
  } catch {
    entry.status = 0;
  }
  posted.requests++;
  if (entry.status >= 200 && entry.status < 300) posted.bytes += body.length;
  else posted.failed++;
  logRequest(entry, body);
  return entry.status;
}

export const percentile = (sorted: readonly number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
