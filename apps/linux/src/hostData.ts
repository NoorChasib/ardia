import { startBookmarks } from "../../browser/src/state/bookmarks/engineSync";
import { reloadHistory, startHistory } from "../../browser/src/state/history/engineSync";
import { startFavicons } from "../../browser/src/state/favicons/favicons";
import { startProfileDataCleanup } from "../../browser/src/state/profiles/profileData";
import { startProfileLoading } from "../../browser/src/state/profiles/profileLoading";
import { nillaHost } from "./host";
import { watchHistoryImports } from "./hostHistoryImports";

export function startHostData() {
  const stops = [startProfileLoading(), startFavicons(), startHistory(), startBookmarks(), startProfileDataCleanup()];
  if (nillaHost) stops.push(watchHistoryImports(nillaHost, reloadHistory));
  return () => { for (const stop of stops) stop(); };
}
