export type IngestKeys = { app: string; cli: string; site: string };

export type Services = {
  telemetryUrl: string | null;
  feedbackUrl: string | null;
  switchesUrl: string | null;
  ingestKeys: IngestKeys | null;
  macFeedUrl: string | null;
  windowsFeedUrl: string | null;
  windowsTrustedPrefix: string | null;
  linuxReleasesUrl: string | null;
  releaseNotesUrl: string | null;
  siteUrl: string | null;
  sourceRepo: string;
  issueUrl: string;
};

export const SOURCE_REPO = "NoorChasib/nilla";

export const DEFAULT_SERVICES: Readonly<Services> = Object.freeze({
  telemetryUrl: null,
  feedbackUrl: null,
  switchesUrl: null,
  ingestKeys: null,
  macFeedUrl: null,
  windowsFeedUrl: null,
  windowsTrustedPrefix: null,
  linuxReleasesUrl: null,
  releaseNotesUrl: null,
  siteUrl: null,
  sourceRepo: SOURCE_REPO,
  issueUrl: `https://github.com/${SOURCE_REPO}/issues/new`,
});

export const SERVICE_URL_FIELDS = [
  "telemetryUrl",
  "feedbackUrl",
  "switchesUrl",
  "macFeedUrl",
  "windowsFeedUrl",
  "windowsTrustedPrefix",
  "linuxReleasesUrl",
  "releaseNotesUrl",
  "siteUrl",
  "issueUrl",
] as const satisfies readonly (keyof Services)[];

export const SERVICE_FIELDS = [...SERVICE_URL_FIELDS, "ingestKeys", "sourceRepo"] as const satisfies readonly (keyof Services)[];

const INGEST_KEY_FIELDS = ["app", "cli", "site"] as const;

const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || !value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export const isFolderPrefix = (value: unknown): value is string => {
  if (!isHttpsUrl(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith("/") && value === `${url.origin}${url.pathname}`;
};

const isIngestKeys = (value: unknown): value is IngestKeys =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((k) => (INGEST_KEY_FIELDS as readonly string[]).includes(k)) &&
  INGEST_KEY_FIELDS.every((k) => typeof (value as Record<string, unknown>)[k] === "string" && !!(value as Record<string, string>)[k]);

export type ServicesProblem = { field: string; problem: "unknown field" | "not an https URL" | "not a folder URL" | "wrong type" | "read already" };

export function servicesProblems(partial: unknown): ServicesProblem[] {
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) return [{ field: "", problem: "wrong type" }];
  const problems: ServicesProblem[] = [];
  for (const [field, value] of Object.entries(partial)) {
    if (!(SERVICE_FIELDS as readonly string[]).includes(field)) problems.push({ field, problem: "unknown field" });
    else if (field === "ingestKeys") {
      if (value !== null && !isIngestKeys(value)) problems.push({ field, problem: "wrong type" });
    } else if (field === "sourceRepo") {
      if (typeof value !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(value)) problems.push({ field, problem: "wrong type" });
    } else if (field === "windowsTrustedPrefix") {
      if (value !== null && !isFolderPrefix(value)) problems.push({ field, problem: typeof value === "string" ? "not a folder URL" : "wrong type" });
    } else if (field === "issueUrl") {
      if (!isHttpsUrl(value)) problems.push({ field, problem: "not an https URL" });
    } else if (value !== null && !isHttpsUrl(value)) problems.push({ field, problem: typeof value === "string" ? "not an https URL" : "wrong type" });
  }
  return problems;
}

let current: Readonly<Services> = DEFAULT_SERVICES;
let read = false;

export function services(): Readonly<Services> {
  read = true;
  return current;
}

export function replaceServices(partial: Partial<Services>, source: "launch" | "test"): ServicesProblem[] {
  const problems = servicesProblems(partial);
  if (problems.length) return problems;
  if (source === "launch" && read) return [{ field: "", problem: "read already" }];
  const ingestKeys = partial.ingestKeys ? Object.freeze({ ...partial.ingestKeys }) : null;
  current = Object.freeze({ ...DEFAULT_SERVICES, ...partial, ingestKeys });
  if (source === "test") read = false;
  return [];
}
