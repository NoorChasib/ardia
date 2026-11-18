import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { osVersion: "26.1", osBuild: "25B78" });
const { systemDetails } = await import("./details.ts");
const { resource } = await import("../telemetry/client.ts");
const windowsIds = (await import("../../lib/platformTerms.windows.ts")).PLATFORM_IDS;

test("on the Mac the attached system details keep the macos key and telemetry keeps os.type darwin", async () => {
  const details = await systemDetails();
  assert.equal(details.macos, "26.1 (25B78)");
  assert.equal(resource()["os.type"], "darwin");
});

test("the Windows OS key names its OS and takes no other detail's place", async () => {
  const details = await systemDetails();
  assert.ok(!(windowsIds.report in details));
  assert.equal(windowsIds.otel, "windows");
});

test("with no feedback server Report a Problem opens the issue page with a static body and no diagnostics", async () => {
  const { useBrowser } = await import("../browser/store.ts");
  const { openWindow } = await import("../browser/actions.ts");
  const { openReport, issuePageUrl, REPORT_ISSUE_BODY, feedbackEndpoint } = await import("./actions.ts");
  const { currentReport } = await import("./store.ts");
  assert.equal(feedbackEndpoint(), null);
  const windowId = openWindow({ url: "https://private.example/secret?q=1" });
  openReport(windowId);
  const url = issuePageUrl();
  assert.equal(url, `https://github.com/NoorChasib/nilla/issues/new?body=${encodeURIComponent(REPORT_ISSUE_BODY)}`);
  const opened = Object.values(useBrowser.getState().tabs).map((tab) => tab.url ?? tab.navigation?.url ?? "").filter((u) => u.startsWith("https://github.com/NoorChasib/nilla/issues/new"));
  assert.deepEqual(opened, [url]);
  const query = new URL(url).searchParams;
  assert.deepEqual([...query.keys()], ["body"]);
  assert.equal(query.get("body"), REPORT_ISSUE_BODY);
  for (const leak of ["26.1", "25B78", "private.example", "macos", "Windows:", "tabs"]) assert.ok(!url.includes(encodeURIComponent(leak)) && !url.includes(leak), leak);
  assert.equal(currentReport().windowId, null);
});
