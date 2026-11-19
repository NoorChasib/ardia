import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(import.meta.dirname, "..");
const REPO_DIR = join(APP_DIR, "..", "..");
export const LICENSE_TEXTS_FILE = join(APP_DIR, "src", "state", "settings", "licenseTexts.json");
export const LICENSE_SOURCES = ["LICENSE.Apache-2.0", "NOTICE", "third_party/bangs/LICENSE"] as const;

export const repoText = (source: string) => readFileSync(join(REPO_DIR, source), "utf8");

export const licenseTextsJson = () => `${JSON.stringify(Object.fromEntries(LICENSE_SOURCES.map((source) => [source, repoText(source)])), null, 2)}\n`;

if (process.argv[2] === "--write") {
  writeFileSync(LICENSE_TEXTS_FILE, licenseTextsJson());
  console.log(`license texts: ${LICENSE_SOURCES.join(", ")}`);
}
