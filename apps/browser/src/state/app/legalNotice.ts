import { appServices } from "../../platform/launchConfig";

export const LEGAL_NOTICE = "Nilla is free software under the GNU General Public License v3, with ABSOLUTELY NO WARRANTY.";

export const BASED_ON_ARDIA = "Based on Ardia, © 2026 Mantra Patel.";

const SOURCE_REF = "main";

const sourceRepositoryUrl = () => `https://github.com/${appServices().sourceRepo}`;

export function sourceLinks() {
  const repository = sourceRepositoryUrl();
  return { source: `${repository}/tree/${SOURCE_REF}`, license: `${repository}/blob/${SOURCE_REF}/LICENSE`, notice: `${repository}/blob/${SOURCE_REF}/NOTICE` };
}
