import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SERVICES, replaceServices, services, servicesProblems } from "./services.ts";
import { overrideServicesForTests, resetServicesForTests } from "./services.testing.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /(?:^|\/)(?:test|tests|__tests__|test-native)\/|\.test\.[cm]?[jt]sx?$|(?:^|\/)test-[\w-]+\.[cm]?[jt]s$/;
const IMPORTS_TESTING = /(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["'][^"']*services\.testing(?:\.ts)?["']/;

test("only test files import services.testing", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter((f) => SOURCE.test(f));
  const offenders = files.filter((file) => {
    if (TEST_FILE.test(file) || file.endsWith("/services.testing.ts")) return false;
    try {
      return IMPORTS_TESTING.test(readFileSync(join(root, file), "utf8"));
    } catch {
      return false;
    }
  });
  expect(offenders).toEqual([]);
});

test("every endpoint ships off, and only the repo and issue page are set", () => {
  const nonNull = Object.entries(DEFAULT_SERVICES).filter(([, value]) => value !== null).map(([key]) => key).sort();
  expect(nonNull).toEqual(["issueUrl", "sourceRepo"]);
  expect(DEFAULT_SERVICES.sourceRepo).toBe("NoorChasib/nilla");
  expect(DEFAULT_SERVICES.issueUrl).toBe("https://github.com/NoorChasib/nilla/issues/new");
  expect(Object.isFrozen(DEFAULT_SERVICES)).toBe(true);
});

test("a snapshot with an unknown field, a non-https URL or a wrong type is refused", () => {
  expect(servicesProblems({ telemetryURL: "https://x.test" })).toEqual([{ field: "telemetryURL", problem: "unknown field" }]);
  expect(servicesProblems({ telemetryUrl: "http://x.test/logs" })).toEqual([{ field: "telemetryUrl", problem: "not an https URL" }]);
  expect(servicesProblems({ switchesUrl: 3 })).toEqual([{ field: "switchesUrl", problem: "wrong type" }]);
  expect(servicesProblems({ ingestKeys: { app: "a" } })).toEqual([{ field: "ingestKeys", problem: "wrong type" }]);
  expect(servicesProblems({ issueUrl: null })).toEqual([{ field: "issueUrl", problem: "not an https URL" }]);
  expect(servicesProblems([])).toEqual([{ field: "", problem: "wrong type" }]);
  expect(servicesProblems({ telemetryUrl: "https://logs.example.test/v1/logs", ingestKeys: { app: "a", cli: "c", site: "s" } })).toEqual([]);
});

test("the test override applies a partial snapshot over the defaults, and resets", () => {
  overrideServicesForTests({ telemetryUrl: "https://logs.example.test/v1/logs" });
  expect(services().telemetryUrl).toBe("https://logs.example.test/v1/logs");
  expect(services().switchesUrl).toBeNull();
  expect(Object.isFrozen(services())).toBe(true);
  expect(() => overrideServicesForTests({ telemetryUrl: "ftp://x" })).toThrow(/telemetryUrl not an https URL/);
  resetServicesForTests();
  expect(services()).toEqual(DEFAULT_SERVICES);
});

test("a launch snapshot is refused once a consumer has read the services", () => {
  resetServicesForTests();
  services();
  expect(replaceServices({ switchesUrl: "https://switches.example.test/s.json" }, "launch")).toEqual([{ field: "", problem: "read already" }]);
  expect(services().switchesUrl).toBeNull();
  resetServicesForTests();
  expect(replaceServices({ switchesUrl: "https://switches.example.test/s.json" }, "launch")).toEqual([]);
  expect(services().switchesUrl).toBe("https://switches.example.test/s.json");
  resetServicesForTests();
});

test("outside a test runner the override throws", () => {
  const env = process.env;
  const saved = { NODE_ENV: env.NODE_ENV, NODE_TEST_CONTEXT: env.NODE_TEST_CONTEXT };
  try {
    delete env.NODE_ENV;
    delete env.NODE_TEST_CONTEXT;
    expect(() => overrideServicesForTests({})).toThrow(/only under the test runner/);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete env[key];
    else env[key] = value;
  }
});
