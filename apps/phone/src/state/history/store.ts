import { tabDatabase } from "../store/database";
import { useTabs } from "../tabs/store";
import { countUsage } from "../telemetry/telemetry";
import { createHistoryLog, type HistoryLog } from "./historyLog";

let log: HistoryLog | null = null;

const countFullScan = () => {
  if (!useTabs.getState().incognito) countUsage("tray_sources_rebuilt");
};

export const history = (): HistoryLog => (log ??= createHistoryLog(tabDatabase(), countFullScan));
