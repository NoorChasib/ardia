import { system, type SystemLink } from "@nilla/phone-native";

export type { SystemLink };

export const initialLink = () => system.initialLink();

export const setHidesFromRecents = (hidden: boolean) => system.setHidesFromRecents(hidden);

export const addLinkListener = (listener: (link: SystemLink) => void) => system.addLinkListener(listener);
