import { tabDatabase } from "../store/database";
import { countUsage } from "../telemetry/telemetry";
import { createHistoryLog, type HistoryLog } from "./historyLog";

let log: HistoryLog | null = null;

const countFullScan = () => countUsage("tray_sources_rebuilt");

export const history = (): HistoryLog => (log ??= createHistoryLog(tabDatabase(), countFullScan));
