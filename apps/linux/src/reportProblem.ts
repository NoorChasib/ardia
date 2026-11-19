import { useBrowser } from "../../browser/src/state/browser/store";
import { feedbackEndpoint, openIssuePage, openReport as openReportSheet, REPORT_ISSUE_BODY } from "../../browser/src/state/report/actions";
import { setReportPlatform } from "../../browser/src/platform/report";
import { nillaHost, type ArdiaHost } from "./host.ts";
import { hostReportPost, servesReportSheet } from "./hostReport.ts";

export const LINUX_REPORT_TEMPLATE = REPORT_ISSUE_BODY;

type ReportSource = "menu" | "check_in";

export const sendsFromSheet = (host: ArdiaHost | undefined = nillaHost) => servesReportSheet(host) && feedbackEndpoint() !== null;

export function adoptHostReports(host: ArdiaHost | undefined = nillaHost) {
  const post = hostReportPost(host);
  setReportPlatform(post ? { recording: false, post } : { recording: false });
}

adoptHostReports();

export function openReport(windowId: string | null, source: ReportSource = "menu", host: ArdiaHost | undefined = nillaHost): Promise<void> {
  const target = windowId && useBrowser.getState().windows[windowId]?.kind !== "small" ? windowId : null;
  if (!target) return Promise.resolve();
  if (sendsFromSheet(host)) openReportSheet(target, source);
  else openIssuePage(target, source);
  return Promise.resolve();
}
