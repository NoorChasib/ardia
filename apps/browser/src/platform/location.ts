import { nativeModule, type LocationPermission } from "@nilla/shell";

export type { LocationPermission };

const Location = nativeModule("NillaLocation");

export const locationPermission = () => Location.locationPermission();
export const requestLocationPermission = () => Location.requestLocationPermission();
export const openLocationSettings = () => Location.openLocationSettings();
