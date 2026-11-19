import texts from "./licenseTexts.json";

export type LicenseText = { id: "apache" | "notice" | "bangs"; title: string; text: string };

export const LICENSE_TEXTS: readonly LicenseText[] = [
  { id: "apache", title: "Apache License 2.0", text: texts["LICENSE.Apache-2.0"] },
  { id: "notice", title: "Notices", text: texts.NOTICE },
  { id: "bangs", title: "!Bang List, MIT License", text: texts["third_party/bangs/LICENSE"] },
];
