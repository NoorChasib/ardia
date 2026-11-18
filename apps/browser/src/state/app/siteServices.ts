import { appServices } from "../../platform/launchConfig";

export const setupCodesOffered = () => !!appServices().siteUrl;
