import type { LivePersistenceBinding } from "../../browser/src/platform/livePersistence";
import { nillaHost } from "./host";
import { createLiveDocumentClient } from "./liveDocumentClient";
import { registerDocumentProducer } from "./documentFlush";
import { documentError } from "./liveDocumentTypes";

export function createLivePersistence(onSave?: (changed: boolean, kind?: "write" | "intent") => void): LivePersistenceBinding {
  if (!nillaHost) throw documentError("ERR_DOCUMENT_AUTH", "Linux Live persistence requires a native shell");
  const client = createLiveDocumentClient(nillaHost);
  registerDocumentProducer(client);
  return {
    load: () => ({}),
    start: client.start,
    changed: (before, after, intent) => {
      const queued = client.changed(before, after, intent);
      if (queued !== undefined) onSave?.(queued, "intent");
    },
    newFolderId: () => `lf-${crypto.randomUUID()}`,
    completionFence: client.completionFence,
    beginRefresh: client.beginRefresh,
    flush: () => { void client.flush(); },
  };
}
