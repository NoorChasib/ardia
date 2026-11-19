import { network } from "@nilla/phone-native";

export const addOnlineAgainListener = (listener: () => void) => network.addOnlineAgainListener(listener);
