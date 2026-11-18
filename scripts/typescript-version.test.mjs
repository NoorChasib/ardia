import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const typescriptSevenProjects = [".", "apps/phone", "apps/dashboard", "apps/videos"];

function majorOf(range) {
  return Number(range.replace(/^[~^]/, "").split(".")[0]);
}

test("the root's tsc, the one bun check runs, is TypeScript 7 and not the TypeScript 6 that @typescript/typescript6 also links as tsc", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(majorOf(manifest.devDependencies.typescript), 7);
  const version = execFileSync(join(root, "node_modules/.bin/tsc"), ["--version"], { encoding: "utf8" }).trim();
  assert.match(version, /^Version 7\./);
});

test("every installed project that checks with TypeScript 7 gets TypeScript 7 from its tsc", () => {
  for (const project of typescriptSevenProjects) {
    const tsc = join(root, project, "node_modules/.bin/tsc");
    if (!existsSync(tsc)) continue;
    const version = execFileSync(tsc, ["--version"], { encoding: "utf8" }).trim();
    assert.match(version, /^Version 7\./, `${project}: ${version}`);
  }
});
