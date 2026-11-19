import assert from "node:assert/strict";
import { test } from "node:test";
import { cliProblems, reportDraftProblems, reportTemplate, UNSET_REFUSAL } from "./exercise-checks.mjs";

const repo = process.env.NILLA_REPO ?? "/home/noor/Code/ardia";
const template = await reportTemplate(repo);
const draft = (query) => `https://github.com/NoorChasib/nilla/issues/new${query}`;
const good = draft(`?body=${encodeURIComponent(template)}`);

test("the app's own draft passes", () => {
  assert.deepEqual(reportDraftProblems(good, template), []);
});

test("no draft page fails", () => {
  assert.match(reportDraftProblems(null, template).join("\n"), /opened no draft page/);
});

test("a draft body with an install ID fails", () => {
  const body = `${template}install id: 0f3c2a`;
  assert.match(reportDraftProblems(draft(`?body=${encodeURIComponent(body)}`), template).join("\n"), /not the report template/);
});

test("a path that only starts with the issue path fails", () => {
  assert.match(reportDraftProblems(good.replace("/issues/new", "/issues/new-wrong"), template).join("\n"), /path is \/NoorChasib\/nilla\/issues\/new-wrong/);
});

test("another host, an extra field, a fragment or credentials fail", () => {
  for (const [url, pattern] of [
    [good.replace("https://github.com", "https://github.com.example.org"), /origin/],
    [`${good}&labels=bug`, /query fields are \[body, labels\]/],
    [`${good}#install`, /fragment/],
    [good.replace("https://", "https://user:pw@"), /credentials/],
  ]) assert.match(reportDraftProblems(url, template).join("\n"), pattern, url);
});

const ok = { status: 0, stdout: "", stderr: "" };
const page = "https://example.com/";
const refused = { status: 2, stdout: "", stderr: `${UNSET_REFUSAL}: on Linux this development build never guesses\n` };
const runs = (overrides) => ({ windows: ok, tabs: ok, select: ok, browse: { ...ok, stdout: `${page}\n` }, unset: refused, ...overrides });

test("windows, tabs, a browse read of the page and the refusal pass", () => {
  assert.deepEqual(cliProblems(runs({}), page), []);
});

test("a browse call that cannot connect fails", () => {
  const browse = { status: 2, stdout: "", stderr: "Nilla isn't running" };
  assert.match(cliProblems(runs({ browse }), page).join("\n"), /browse get url exited 2/);
});

test("a browse session that could not take the page's tab fails", () => {
  assert.match(cliProblems(runs({ select: { status: 1, stdout: "", stderr: "Tab not found" } }), page).join("\n"), /browse tab <page target> exited 1/);
});

test("a browse read of another page fails", () => {
  assert.match(cliProblems(runs({ browse: { ...ok, stdout: "about:blank\n" } }), page).join("\n"), /read "about:blank"/);
});

test("the unset probe exiting 0 fails", () => {
  assert.match(cliProblems(runs({ unset: { ...ok, stdout: "window main" } }), page).join("\n"), /neither variable set exited 0, not 2/);
});

test("the unset probe failing for another reason fails", () => {
  const unset = { status: 2, stdout: "", stderr: "nilla-browser: Nilla isn't running\n" };
  assert.match(cliProblems(runs({ unset }), page).join("\n"), /did not refuse with the data-folder message/);
});
