import type { Settings } from "../settings/settings";

export type CloseSide = Settings["tabCloseButtonSide"];

export type RowEnds = { lead: "icon" | "close"; trail: "status" | "close"; trailingBackToPin: "none" | "reserved" | "shown" };

const AT_REST: RowEnds = { lead: "icon", trail: "status", trailingBackToPin: "none" };
const CLOSE_TRAILING: RowEnds = { lead: "icon", trail: "close", trailingBackToPin: "none" };
const CLOSE_LEADING: RowEnds = { lead: "close", trail: "status", trailingBackToPin: "none" };
const AWAY_AT_REST: RowEnds = { lead: "icon", trail: "status", trailingBackToPin: "reserved" };
const AWAY_CLOSE_LEADING: RowEnds = { lead: "close", trail: "status", trailingBackToPin: "shown" };

export function rowEnds(side: CloseSide, closing: boolean, resettable: boolean): RowEnds {
  if (side === "right") return closing ? CLOSE_TRAILING : AT_REST;
  if (resettable) return closing ? AWAY_CLOSE_LEADING : AWAY_AT_REST;
  return closing ? CLOSE_LEADING : AT_REST;
}
