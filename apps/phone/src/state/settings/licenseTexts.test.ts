import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LICENSE_SOURCES, LICENSE_TEXTS_FILE, licenseTextsJson, repoText } from "../../../test/licenseTexts.ts";

test("the licenses page carries the repository's license texts byte for byte", () => {
  assert.equal(readFileSync(LICENSE_TEXTS_FILE, "utf8"), licenseTextsJson(), "a license text changed: run bun run --cwd apps/phone licenses");
  const texts = JSON.parse(readFileSync(LICENSE_TEXTS_FILE, "utf8")) as Record<string, string>;
  assert.deepEqual(Object.keys(texts), [...LICENSE_SOURCES]);
  for (const source of LICENSE_SOURCES) assert.equal(texts[source], repoText(source), source);
});

test("the texts are the ones Nilla's notices require: Apache-2.0, Nilla's NOTICE and the bang list's MIT license", () => {
  const texts = JSON.parse(readFileSync(LICENSE_TEXTS_FILE, "utf8")) as Record<string, string>;
  assert.match(texts["LICENSE.Apache-2.0"]!, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(texts.NOTICE!, /^Nilla, Copyright 2026 Noor Chasib\./);
  assert.match(texts["third_party/bangs/LICENSE"]!, /^MIT License\n\nCopyright \(c\) 2024 Kagi Search, 2026 imput/);
});
