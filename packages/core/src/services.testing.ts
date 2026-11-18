import { replaceServices, type Services } from "./services.ts";

const runningUnderTests = () => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.NODE_ENV === "test" || !!env?.NODE_TEST_CONTEXT;
};

export function overrideServicesForTests(partial: Partial<Services>) {
  if (!runningUnderTests()) throw new Error("overrideServicesForTests runs only under the test runner");
  const problems = replaceServices(partial, "test");
  if (problems.length) throw new Error(`overrideServicesForTests refused: ${problems.map((p) => `${p.field || "(snapshot)"} ${p.problem}`).join(", ")}`);
}

export const resetServicesForTests = () => overrideServicesForTests({});
