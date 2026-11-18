import { create } from "zustand";
import type { DragPreviewShape } from "../../platform/windows";
import type { Frame } from "../browser/types";
import type { SplitSide } from "../splits/splits";

export type DropTarget = { tabId: string; side: SplitSide };
type Insert = { windowId: string; beforeId: string | null };
export type TabDragPicture = { chip: () => [number, number, number, number]; grab: [number, number] };
export type TabDragSession = { seq: number; liveFrame: Frame | null; pointer: [number, number]; picture: TabDragPicture | null; sentShape: DragPreviewShape };

export type TabDragging = {
  phase: "tab";
  tabId: string | null;
  tabIds: string[];
  windowId: string;
  x: number;
  y: number;
  lifted: boolean | null;
  onPage: boolean;
  target: DropTarget | null;
  outside: boolean;
  overWindow: string | null;
  overPoint: [number, number] | null;
  insert: Insert | null;
  session: TabDragSession;
};

export type ExternalDragging = {
  phase: "external";
  owner: { windowId: string; token: number };
  overWindow: string;
  overPoint: [number, number];
  insert: Insert | null;
};

export type TabDrag = { phase: "idle" } | TabDragging | ExternalDragging;

export const TAB_DRAG_IDLE: TabDrag = { phase: "idle" };

export const useTabDrag = create<TabDrag>()(() => TAB_DRAG_IDLE);
