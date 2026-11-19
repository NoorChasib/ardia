import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url);

function locate(file) {
  for (const dir of ["../../packages/core/src/", "core/"]) {
    const url = new URL(dir + file, root);
    if (existsSync(url)) return url.href;
  }
  throw new Error(`feedback: ${file} is in neither packages/core/src nor infra/feedback/core (copy it from packages/core/src)`);
}

export const { anonymousIdentity } = await import(locate("anonymousIdentity.ts"));
export const { INGEST_KEY_HEADER } = await import(locate("ingestKeys.ts"));
