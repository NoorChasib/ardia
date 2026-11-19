import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isUpstreamSharedFolder,
  isUpstreamSyncFolder,
  ownSharedFoldersOnly,
  ownSyncFoldersOnly,
  UPSTREAM_SHARED_FOLDER,
  UPSTREAM_SHARED_FOLDER_CODE,
  UPSTREAM_SHARED_REFUSAL,
  UPSTREAM_SYNC_FOLDER,
  UPSTREAM_SYNC_FOLDER_CODE,
  UpstreamSharedFolderError,
  UpstreamSyncFolderError,
} from "./upstreamSyncFolder.ts";

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

test("shared folders never read, write, create in or watch Ardia's shared or sync folders", async () => {
  const calls: string[] = [];
  const watched: string[][] = [];
  const native = {
    async read(path: string) {
      calls.push(`read ${path}`);
      return { exists: true };
    },
    async apply(path: string, _ops: string) {
      calls.push(`apply ${path}`);
      if (path.endsWith("Alias")) throw Object.assign(new Error("native refusal"), { code: UPSTREAM_SHARED_FOLDER_CODE });
      return { conflicts: [] };
    },
    async create(parent: string, name: string) {
      calls.push(`create ${parent}`);
      return `${parent}/${name}`;
    },
    watch(paths: string[]) {
      watched.push(paths);
    },
  };
  const shared = ownSharedFoldersOnly(native)!;
  const upstream = `/Users/me/iCloud/${UPSTREAM_SHARED_FOLDER.toLowerCase()} /Team`;
  assert.equal(isUpstreamSharedFolder(upstream), true);
  assert.equal(isUpstreamSharedFolder(`/Users/me/${UPSTREAM_SYNC_FOLDER}/x`), true);
  assert.equal(isUpstreamSharedFolder("/Users/me/iCloud/Nilla Shared/Team"), false);
  assert.deepEqual(await shared.read(upstream), { exists: false, error: UPSTREAM_SHARED_REFUSAL });
  await assert.rejects(shared.apply(upstream, "[]"), UpstreamSharedFolderError);
  await assert.rejects(shared.create(`/Users/me/iCloud/${UPSTREAM_SHARED_FOLDER}`, "Team"), UpstreamSharedFolderError);
  await assert.rejects(shared.apply("/Users/me/Team Alias", "[]"), UpstreamSharedFolderError);
  shared.watch([upstream, "/Users/me/iCloud/Nilla Shared/Team"]);
  assert.deepEqual(await shared.read("/Users/me/iCloud/Nilla Shared/Team"), { exists: true });
  assert.deepEqual(watched, [["/Users/me/iCloud/Nilla Shared/Team"]]);
  assert.deepEqual(calls, ["apply /Users/me/Team Alias", "read /Users/me/iCloud/Nilla Shared/Team"]);
});

