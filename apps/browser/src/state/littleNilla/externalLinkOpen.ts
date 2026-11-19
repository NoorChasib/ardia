import { isWebPageUrl } from "../../lib/url";

export type ExternalLinkOpen = "tab" | "littleNilla" | "window";

export function externalLinkOpen(littleNillaOn: boolean, urls: readonly string[], ruled: ExternalLinkOpen | null = null): ExternalLinkOpen {
  if (ruled) return ruled;
  const [url] = urls;
  return littleNillaOn && urls.length === 1 && !!url && isWebPageUrl(url) ? "littleNilla" : "tab";
}
