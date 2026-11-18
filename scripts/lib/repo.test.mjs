import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { REPO } from "./repo.mjs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("every place that names the GitHub repo names the same one", () => {
  assert.equal(/^REPO="([^"]+)"$/m.exec(read("scripts/lib/releases.sh"))?.[1], REPO);
});
