import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const REPORT_ORIGIN = "https://github.com";
export const REPORT_PATH = "/NoorChasib/nilla/issues/new";
export const REPORT_FIELDS = ["body"];
export const UNSET_REFUSAL = "nilla-browser windows: set ARDIA_DATA_DIR to Nilla's data folder, or ARDIA_CONFIG_HOME to the folder that holds it";

export async function reportTemplate(repo) {
  const source = await readFile(join(repo, "apps/browser/src/state/report/actions.ts"), "utf8");
  const found = source.match(/export const REPORT_ISSUE_BODY = ("(?:[^"\\\n]|\\.)*");/);
  if (!found) throw new Error("REPORT_ISSUE_BODY is not a plain string in apps/browser/src/state/report/actions.ts");
  return JSON.parse(found[1]);
}

export function reportDraftProblems(url, template) {
  if (!url) return ["Report a Problem opened no draft page"];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [`Report a Problem opened ${url}, which is not a URL`];
  }
  const problems = [];
  if (parsed.origin !== REPORT_ORIGIN) problems.push(`the draft's origin is ${parsed.origin}, not ${REPORT_ORIGIN}`);
  if (parsed.pathname !== REPORT_PATH) problems.push(`the draft's path is ${parsed.pathname}, not ${REPORT_PATH}`);
  if (parsed.username || parsed.password) problems.push("the draft URL carries credentials");
  if (parsed.hash) problems.push(`the draft URL has a fragment ${parsed.hash}`);
  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== REPORT_FIELDS.length || keys.some((key, i) => key !== REPORT_FIELDS[i])) {
    problems.push(`the draft's query fields are [${keys.join(", ")}], not [${REPORT_FIELDS.join(", ")}]`);
  }
  const body = parsed.searchParams.get("body");
  if (body !== template) problems.push(`the draft's body is ${JSON.stringify(body)}, not the report template ${JSON.stringify(template)}`);
  return problems;
}

export function sameUrl(a, b) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

export function cliProblems({ windows, tabs, select, browse, unset }, pageUrl) {
  const problems = [];
  for (const [name, run] of [["windows", windows], ["tabs", tabs], ["browse tab <page target>", select]]) {
    if (run?.status !== 0) problems.push(`nilla-browser ${name} exited ${run?.status ?? "without a status"}: ${run?.stderr ?? ""}`.trim());
  }
  const read = (browse?.stdout ?? "").trim();
  if (browse?.status !== 0) problems.push(`nilla-browser browse get url exited ${browse?.status ?? "without a status"}: ${browse?.stderr ?? ""}`.trim());
  else if (!sameUrl(read, pageUrl)) problems.push(`nilla-browser browse get url read ${JSON.stringify(read)}, not the page the exercise opened (${pageUrl})`);
  if (unset?.status !== 2) problems.push(`nilla-browser windows with neither variable set exited ${unset?.status ?? "without a status"}, not 2`);
  else if (!(unset.stderr ?? "").startsWith(UNSET_REFUSAL)) problems.push(`nilla-browser windows with neither variable set did not refuse with the data-folder message: ${JSON.stringify(unset.stderr ?? "")}`);
  else if ((unset.stdout ?? "") !== "") problems.push(`nilla-browser windows with neither variable set printed ${JSON.stringify(unset.stdout)}`);
  return problems;
}
