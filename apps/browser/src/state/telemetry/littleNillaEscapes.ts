export type EscapePressedIn = "page" | "window" | "blankBar";

const none = (): Record<EscapePressedIn, number> => ({ page: 0, window: 0, blankBar: 0 });

let closes = none();
const noHandoffs = () => ({ appLinkCloses: 0, returnsToApp: 0, globalShortcutOpens: 0, fitsBelowSaved: 0 });

let handoffs = noHandoffs();

const handoffCounter = { appLinkClose: "appLinkCloses", returnToApp: "returnsToApp", globalShortcut: "globalShortcutOpens" } as const;

export function noteLittleNillaAppHandoff(what: keyof typeof handoffCounter) {
  handoffs[handoffCounter[what]]++;
}

export function noteLittleNillaFitBelowSaved() {
  handoffs.fitsBelowSaved++;
}

export function noteLittleNillaEscapeClose(pressedIn: EscapePressedIn) {
  closes[pressedIn]++;
}

export function takeLittleNillaEscapeCloses() {
  const taken = closes;
  const handedOff = handoffs;
  closes = none();
  handoffs = noHandoffs();
  return {
    little_nilla_app_link_closes: handedOff.appLinkCloses,
    little_nilla_returns_to_app: handedOff.returnsToApp,
    little_nilla_global_shortcut_opens: handedOff.globalShortcutOpens,
    little_nilla_fits_below_saved_size: handedOff.fitsBelowSaved,
    little_nilla_escape_closes: taken.page,
    little_nilla_escape_closes_unfocused: taken.window,
    little_nilla_escape_closes_blank: taken.blankBar,
  };
}
