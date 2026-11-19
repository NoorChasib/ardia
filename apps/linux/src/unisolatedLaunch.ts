import type { ArdiaHost } from "./host";
import { hostLaunchConfig } from "./hostLaunchConfig";

export const UNISOLATED_TITLE = "Nilla stopped";
export const UNISOLATED_COMMAND = "scripts/linux/nilla-dev-run";
export const UNISOLATED_MESSAGE =
  `This development build runs only on a profile of its own, and this one wasn't given one. Its engine opens the profile before this page, so close it and start the build with ${UNISOLATED_COMMAND}, inside a disposable VM, container or namespace.`;

export const UNISOLATED_STYLES = {
  page: "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:32px 16px;color-scheme:light dark;background:Canvas;color:CanvasText;font:15px/1.55 system-ui,-apple-system,'Segoe UI',Ubuntu,Cantarell,'Noto Sans',sans-serif;user-select:text;-webkit-user-select:text;cursor:default",
  panel: "max-width:34em",
  title: "margin:0 0 10px;font-size:22px;line-height:1.25;font-weight:650;letter-spacing:-0.01em",
  body: "margin:0;color:color-mix(in srgb,CanvasText 72%,Canvas)",
  command: "font-family:ui-monospace,'DejaVu Sans Mono','Liberation Mono',monospace;font-size:0.9em;padding:1px 5px;border-radius:5px;background:color-mix(in srgb,CanvasText 9%,Canvas);white-space:nowrap",
} as const;

type AlertRoot = Pick<HTMLElement, "setAttribute" | "style" | "replaceChildren" | "ownerDocument">;

function styled(root: AlertRoot, tag: string, cssText: string, ...children: (Node | string)[]) {
  const element = root.ownerDocument.createElement(tag);
  element.style.cssText = cssText;
  element.append(...children);
  return element;
}

function showRefusal(root: AlertRoot) {
  const [before = "", after = ""] = UNISOLATED_MESSAGE.split(UNISOLATED_COMMAND);
  const title = styled(root, "h1", UNISOLATED_STYLES.title, UNISOLATED_TITLE);
  const body = styled(root, "p", UNISOLATED_STYLES.body, before, styled(root, "code", UNISOLATED_STYLES.command, UNISOLATED_COMMAND), after);
  root.setAttribute("role", "alert");
  root.style.cssText = UNISOLATED_STYLES.page;
  root.replaceChildren(styled(root, "div", UNISOLATED_STYLES.panel, title, body));
}

export function refuseUnisolatedLaunch(host: ArdiaHost, root: AlertRoot | null): boolean {
  if (hostLaunchConfig(host).isolated) return false;
  if (root) showRefusal(root);
  return true;
}
