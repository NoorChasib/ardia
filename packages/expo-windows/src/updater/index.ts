import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { AppNative, ConfirmOptions, DialogsNative, DocumentsNative, UpdateChannel, UpdaterNative, UpdaterState } from "@nilla/shell";
import type { AppWindowsModule, WindowsUpdateConstants, WindowsUpdateModule } from "../nativeModuleTypes";
import { failureText, feedNotPublished, megabytes, offered, readBuild, readManifest, type BuildIdentity } from "./manifest";

const PREFERENCES = "windows-updates.json";
const FIRST_CHECK_AFTER_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

type Preferences = Pick<Extract<UpdaterState, { available: true }>, "automaticChecks" | "automaticDownloads" | "lastCheck">;

const native = () => TurboModuleRegistry.get<WindowsUpdateModule>("NillaWindowsUpdate");
const constants = (): WindowsUpdateConstants & { feed?: unknown; publishedUnder?: unknown } => native()?.getConstants?.() ?? {};
const dialogs = () => TurboModuleRegistry.get<TurboModule & Pick<DialogsNative, "confirm">>("NillaDialogs");
const documents = () => TurboModuleRegistry.get<TurboModule & Pick<DocumentsNative, "readDocument" | "writeDocument">>("NillaDocuments");
const launch = () => TurboModuleRegistry.get<TurboModule & Pick<AppNative, "launchConfig">>("NillaApp")?.launchConfig?.();

let identityRead: BuildIdentity | null | undefined;
let preferencesRead: Preferences | undefined;
let checking = false;
let declinedBuild = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let firstCheck: ReturnType<typeof setTimeout> | undefined;

function identity(): BuildIdentity | null {
  if (identityRead === undefined) identityRead = typeof constants().buildFile === "string" ? readBuild(constants().buildFile as string) : null;
  return identityRead;
}

export function stampedSystemInfo(info: unknown): unknown {
  const stamped = identity();
  if (!stamped || typeof info !== "object" || info === null) return info;
  return { ...info, appVersion: stamped.version, appBuild: String(stamped.build) };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const feedOverride = () => text(constants().feedOverride);
const feed = () => text(constants().feed);
const publishedUnder = () => text(constants().publishedUnder);
const configured = () => !!native() && constants().installed === true && identity() !== null && feed() !== "" && publishedUnder() !== "";
const named = (version: string, build: number) => `${version}, Windows alpha ${build}`;

function preferences(): Preferences {
  if (preferencesRead) return preferencesRead;
  const fresh: Preferences = { automaticChecks: true, automaticDownloads: true, lastCheck: null };
  try {
    const stored: unknown = JSON.parse(documents()?.readDocument(PREFERENCES) ?? "null");
    if (typeof stored === "object" && stored !== null) {
      const { automaticChecks, automaticDownloads, lastCheck } = stored as Record<string, unknown>;
      if (typeof automaticChecks === "boolean") fresh.automaticChecks = automaticChecks;
      if (typeof automaticDownloads === "boolean") fresh.automaticDownloads = automaticDownloads;
      if (typeof lastCheck === "number" && Number.isFinite(lastCheck)) fresh.lastCheck = lastCheck;
    }
  } catch {}
  preferencesRead = fresh;
  return fresh;
}

function remember(patch: Partial<Preferences>) {
  preferencesRead = { ...preferences(), ...patch };
  try {
    documents()?.writeDocument(PREFERENCES, JSON.stringify(preferencesRead));
  } catch {}
}

function checksByItself() {
  if (!configured() || !preferences().automaticChecks) return false;
  const config = launch();
  return !config?.background && !(config?.isolated && !feedOverride());
}

const ask = async (options: ConfirmOptions) => (await dialogs()?.confirm(options))?.confirmed === true;
const tell = (title: string, message: string) => ask({ title, message, confirmTitle: "OK", cancelTitle: "" });
const reason = (error: unknown) => failureText(error);

async function check(asked: boolean) {
  const current = identity();
  const update = native();
  if (checking || !update || !current || !configured()) return;
  if (!asked && !checksByItself()) return;
  checking = true;
  try {
    let feedText: string;
    try {
      feedText = await update.fetchText(feed());
    } catch (error) {
      if (!feedNotPublished(error) || feedOverride()) throw error;
      console.info(`[nilla windows] update check failed: ${reason(error)}`);
      const keepsChecking = checksByItself() ? " Nilla keeps checking by itself." : "";
      if (asked) await tell("No Windows update published yet", `No Windows build of Nilla has been published for updates yet. You have ${named(current.version, current.build)}.${keepsChecking}`);
      return;
    }
    const manifest = readManifest(feedText, publishedUnder());
    if (!manifest) throw new Error("the update feed could not be read");
    remember({ lastCheck: Date.now() });
    const installer = offered(manifest, String(constants().cpu), current.build);
    if (!installer) {
      if (asked) await tell("Nilla is up to date", `You have ${named(current.version, current.build)}.`);
      return;
    }
    if (!asked && declinedBuild === manifest.build) return;
    const newer = named(manifest.version, manifest.build);
    if (asked || !preferences().automaticDownloads) {
      const download = await ask({
        title: "A newer Nilla is available",
        message: `${newer} is available. You have ${named(current.version, current.build)}. Download it now (${megabytes(installer.bytes)} MB)?`,
        confirmTitle: "Download",
        cancelTitle: "Later",
      });
      if (!download) {
        declinedBuild = manifest.build;
        return;
      }
    }
    const path = await update.download(installer.url, installer.sha256, installer.bytes);
    console.info(`[nilla windows] update ${manifest.build} downloaded`);
    const install = await ask({
      title: "The update is ready to install",
      message: `Nilla closes, installs ${newer} and opens again.`,
      confirmTitle: "Install and Restart",
      cancelTitle: "Later",
    });
    if (!install) {
      declinedBuild = manifest.build;
      return;
    }
    if (await update.install(path, installer.sha256)) {
      console.info(`[nilla windows] update ${manifest.build} is installing`);
      await TurboModuleRegistry.get<TurboModule & Pick<AppWindowsModule, "quit">>("NillaAppWindows")?.quit();
    }
  } catch (error) {
    console.info(`[nilla windows] update check failed: ${reason(error)}`);
    if (asked) await tell("Nilla couldn't check for updates", reason(error));
  } finally {
    checking = false;
  }
}

function schedule() {
  if (timer !== undefined) clearInterval(timer);
  if (firstCheck !== undefined) clearTimeout(firstCheck);
  timer = undefined;
  firstCheck = undefined;
  if (checksByItself()) timer = setInterval(() => void check(false), CHECK_EVERY_MS);
}

export function startUpdateChecks() {
  schedule();
  if (timer !== undefined) firstCheck = setTimeout(() => void check(false), FIRST_CHECK_AFTER_MS);
}

export const windowsUpdater: UpdaterNative = {
  async updaterState(): Promise<UpdaterState> {
    if (!native()) return { available: false };
    const current = identity();
    const ready = configured();
    return {
      available: true,
      configured: ready,
      automaticChecks: preferences().automaticChecks,
      automaticDownloads: preferences().automaticDownloads,
      canCheck: ready,
      sessionInProgress: checking,
      feedURL: ready ? feed() : null,
      lastCheck: preferences().lastCheck,
      version: current?.version ?? "0.0.0",
      ...(current ? { displayVersion: named(current.version, current.build) } : {}),
    };
  },
  checkForUpdates: () => check(true),
  async setAutomaticUpdateChecks(on: boolean) {
    remember({ automaticChecks: on });
    schedule();
  },
  async setAutomaticUpdateDownloads(on: boolean) {
    remember({ automaticDownloads: on });
  },
  async setUpdateChannel(_channel: UpdateChannel) {},
};
