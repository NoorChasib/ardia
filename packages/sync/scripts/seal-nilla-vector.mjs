#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { cryptoDouble } from "../../../apps/browser/src/state/sync/fixtures/windowsSyncDouble.mjs";

const VECTOR = new URL("../tests/fixtures/sealed-nilla-0.1.b64", import.meta.url);
const TEXT = "from nilla 0.1";
const keys = cryptoDouble(Buffer.alloc(32));
const scopeTag = keys.scopeTag("app");

if (process.argv.includes("--help")) {
  console.log("usage: node packages/sync/scripts/seal-nilla-vector.mjs [--check]\n\nSeals \"from nilla 0.1\" with the zero key, scope app and file f1 into packages/sync/tests/fixtures/sealed-nilla-0.1.b64,\nor with --check opens the saved vector and fails unless it holds that text. Prints the zero key's chain and app scope tags.");
  process.exit(0);
}
if (process.argv.includes("--check")) {
  const opened = keys.opened(scopeTag, "f1", Buffer.from(readFileSync(VECTOR, "utf8").trim(), "base64"));
  if (opened.state !== "data" || opened.payload !== TEXT) {
    console.error(`seal-nilla-vector: ${VECTOR.pathname} doesn't open to "${TEXT}": ${JSON.stringify(opened)}`);
    process.exit(1);
  }
} else {
  writeFileSync(VECTOR, `${keys.sealFile(scopeTag, "f1", TEXT).toString("base64")}\n`);
}
console.log(`chainTag ${keys.chainTag()}\nscopeTag(app) ${scopeTag}`);
