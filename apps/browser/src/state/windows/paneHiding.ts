export type PaneShown = { visible: boolean; warm: boolean; lingering: boolean; prewarmed: boolean };

export const DETACHED_PANE_STYLE = { display: "none" } as const;

let detached = false;

export const hiddenPanesDetached = () => detached;

export function setHiddenPanesDetached(on: boolean) {
  detached = on;
}

export const paneDetached = (pane: PaneShown) => detached && !pane.visible && !pane.warm && !pane.lingering && !pane.prewarmed;

export const detachedPaneStyle = (pane: PaneShown) => (paneDetached(pane) ? DETACHED_PANE_STYLE : null);
