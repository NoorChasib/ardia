import { Linking } from "react-native";

export { canUseSpeech, speech, type SpeechAccess, type SpeechEvent, type SpeechProblem } from "@nilla/phone-native";

export const openAppSettings = () => Linking.openSettings();
