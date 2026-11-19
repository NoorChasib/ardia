import assert from "node:assert/strict";
import { test } from "node:test";
import { isUpstreamSyncFolder, ownSyncFoldersOnly, UPSTREAM_SYNC_FOLDER, UPSTREAM_SYNC_FOLDER_CODE, UpstreamSyncFolderError } from "./upstreamSyncFolder.ts";

type Native = {
  chooseFolder(current: string | null): Promise<string | null>;
  folderInfo(path: string | null): Promise<{ path: string }>;
  read(folder: string, scope: string, known: string[]): Promise<unknown>;
  deviceName(): string;
};

const refusedByNative = () => Object.assign(new Error("native refusal"), { code: UPSTREAM_SYNC_FOLDER_CODE });

function fake(picked: string | null, refuse = false) {
  const seeds: (string | null)[] = [];
  const calls: string[] = [];
  const native: Native = {
    async chooseFolder(current) {
      seeds.push(current);
      if (refuse) throw refusedByNative();
      return picked;
    },
    async folderInfo(path) {
      calls.push(`folderInfo ${path}`);
      if (refuse) throw refusedByNative();
      return { path: path ?? "" };
    },
    async read(folder) {
      calls.push(`read ${folder}`);
      if (refuse) throw refusedByNative();
      return { files: [] };
    },
    deviceName: () => "Mac",
  };
  return { sync: ownSyncFoldersOnly(native)!, seeds, calls };
}

test("Windows and Unicode spellings of the upstream folder are refused, and look-alikes are not", () => {
  const nfd = UPSTREAM_SYNC_FOLDER.normalize("NFD");
  for (const path of [
    `C:\\Users\\me\\OneDrive\\${UPSTREAM_SYNC_FOLDER}.`,
    `C:\\Users\\me\\OneDrive\\${UPSTREAM_SYNC_FOLDER} . .`,
    `\\\\?\\C:\\Users\\me\\${UPSTREAM_SYNC_FOLDER}\\chain`,
    `\\\\.\\C:\\Users\\me\\${UPSTREAM_SYNC_FOLDER.toUpperCase()}`,
    `/Users/me/${nfd}/x`,
  ]) {
    assert.equal(isUpstreamSyncFolder(path), true, path);
  }
  for (const path of [`/Users/me/${UPSTREAM_SYNC_FOLDER}s`, `/Users/me/${UPSTREAM_SYNC_FOLDER}.bak`, "/Users/me/Nilla Sync"]) {
    assert.equal(isUpstreamSyncFolder(path), false, path);
  }
});

test("the picker is never seeded with the upstream folder", async () => {
  const { sync, seeds } = fake("/Users/me/Nilla Sync");
  assert.equal(await sync.chooseFolder(`/Users/me/${UPSTREAM_SYNC_FOLDER}`), "/Users/me/Nilla Sync");
  assert.equal(await sync.chooseFolder("/Users/me/Dropbox"), "/Users/me/Nilla Sync");
  assert.deepEqual(seeds, [null, "/Users/me/Dropbox"]);
});

test("a native refusal (a link, a relative path or a short name that leads into the upstream folder) reaches the UI as UpstreamSyncFolderError", async () => {
  const { sync, calls } = fake("/Users/me/Nilla Sync", true);
  await assert.rejects(sync.chooseFolder(null), UpstreamSyncFolderError);
  await assert.rejects(sync.folderInfo("/Users/me/Nilla Sync"), UpstreamSyncFolderError);
  await assert.rejects(sync.read("/Users/me/Nilla Sync", "app", []), UpstreamSyncFolderError);
  assert.deepEqual(calls, ["folderInfo /Users/me/Nilla Sync", "read /Users/me/Nilla Sync"]);
});

test("other native errors pass through unchanged", async () => {
  const failing = ownSyncFoldersOnly({ read: async (_folder: string) => Promise.reject(Object.assign(new Error("offline"), { code: "ERR_SYNC_FOLDER_UNREADABLE" })) })!;
  await assert.rejects(failing.read("/Users/me/Nilla Sync"), (error: Error & { code?: string }) => error.code === "ERR_SYNC_FOLDER_UNREADABLE" && !(error instanceof UpstreamSyncFolderError));
});
