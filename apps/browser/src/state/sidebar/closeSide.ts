import type { Settings } from "../settings/settings";

export type CloseSide = Settings["tabCloseButtonSide"];

export type RowEnds = { lead: "icon" | "close"; trail: "status" | "close" | "backToPin" };

const AT_REST: RowEnds = { lead: "icon", trail: "status" };
const CLOSE_TRAILING: RowEnds = { lead: "icon", trail: "close" };
const CLOSE_LEADING: RowEnds = { lead: "close", trail: "status" };
const CLOSE_LEADING_BACK_TO_PIN: RowEnds = { lead: "close", trail: "backToPin" };

export function rowEnds(side: CloseSide, closing: boolean, resettable: boolean): RowEnds {
  if (!closing) return AT_REST;
  if (side === "right") return CLOSE_TRAILING;
  return resettable ? CLOSE_LEADING_BACK_TO_PIN : CLOSE_LEADING;
}
