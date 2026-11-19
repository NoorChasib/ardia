import { systemInfo } from "../../platform/app";
import { appServices } from "../../platform/launchConfig";
import { openUrls } from "../browser/actions";

function releaseNotesUrl(version = systemInfo().appVersion): string | null {
  const page = appServices().releaseNotesUrl;
  if (!page) return null;
  return version ? `${page}#${version}` : page;
}

export function openReleaseNotesPage(windowId?: string | null) {
  const url = releaseNotesUrl();
  if (url) openUrls([url], windowId);
}

export function openReleaseNotesAfterUpdate() {
  const info = systemInfo();
  if (!info.forceReleaseNotes && (__DEV__ || info.isolatedInstance !== false)) return;
  openReleaseNotesPage();
}
