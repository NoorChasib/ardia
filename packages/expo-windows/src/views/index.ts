import { ActivitySpinner } from "./ActivitySpinner";
import { ClipView } from "./ClipView";
import { ThemeSwatch, WindowBackdrop } from "./backdrop";
import { DockSelection } from "./DockSelection";
import { EdgeFadeMask } from "./EdgeFadeMask";
import { FadeLabel } from "./FadeLabel";
import { FolderIcon } from "./FolderIcon";
import { ContextMenuArea, FileDrop, MagnifyArea, MouseArea, OutsidePressArea, WindowProfile } from "./inputAreas";
import { GlassEffect, GlassGroup, PopoverBubble, VisualEffect } from "./materials";
import { PageCoverGate } from "./PageCoverGate";
import type { ViewByName } from "./shared";
import { Surface } from "./Surface";
import { SwipeArea } from "../pager/SwipeArea";
import { MeadowPage } from "../meadow/MeadowPage";

export { OutsidePressRoot } from "./inputAreas";

export const viewsDrawnInJs = new Map<string, ViewByName>([
  ["NillaSurface", Surface],
  ["NillaClipView", ClipView],
  ["NillaPageCoverGate", PageCoverGate],
  ["NillaFadeLabel", FadeLabel],
  ["NillaEdgeFadeMask", EdgeFadeMask],
  ["NillaActivitySpinner", ActivitySpinner],
  ["NillaVisualEffect", VisualEffect],
  ["NillaGlassEffect", GlassEffect],
  ["NillaGlassGroup", GlassGroup],
  ["NillaPopoverBubble", PopoverBubble],
  ["NillaWindowBackdrop", WindowBackdrop],
  ["NillaContextMenuArea", ContextMenuArea],
  ["NillaOutsidePressArea", OutsidePressArea],
  ["NillaFileDrag", MouseArea],
  ["NillaMagnifyArea", MagnifyArea],
  ["NillaFileDrop", FileDrop],
  ["NillaThemeSwatch", ThemeSwatch],
  ["NillaDockSelection", DockSelection],
  ["NillaFolderIcon", FolderIcon],
  ["NillaWindowProfile", WindowProfile],
  ["NillaSwipe", SwipeArea],
  ["NillaMeadowPage", MeadowPage],
]);
