export const UPSTREAM_SYNC_FOLDER = "Ardia Sync";

export const UPSTREAM_SYNC_REFUSAL = "That folder is Ardia's Sync folder. Nilla keeps its sync data apart from Ardia's, so choose another folder.";

export class UpstreamSyncFolderError extends Error {
  constructor() {
    super(UPSTREAM_SYNC_REFUSAL);
    this.name = "UpstreamSyncFolderError";
  }
}

export const UPSTREAM_SYNC_FOLDER_CODE = "ERR_UPSTREAM_SYNC_FOLDER";

const folded = (part: string) => part.normalize("NFC").trim().replace(/[. ]+$/, "").toLowerCase();

export const isUpstreamSyncFolder = (path: string) =>
  path.split(/[\\/]+/).some((part) => folded(part) === UPSTREAM_SYNC_FOLDER.toLowerCase());

const nativeRefused = (error: unknown) =>
  !!error && typeof error === "object" && (error as { code?: unknown }).code === UPSTREAM_SYNC_FOLDER_CODE ? new UpstreamSyncFolderError() : error;

const FOLDER_ARGUMENT: Record<string, number> = {
  folderInfo: 0,
  enterPhrase: 2,
  chainStatus: 0,
  createChain: 0,
  write: 0,
  read: 0,
  remove: 0,
  deleteChain: 0,
  revealFolder: 0,
};

const refuseUpstream = (value: unknown) => {
  if (typeof value === "string" && isUpstreamSyncFolder(value)) throw new UpstreamSyncFolderError();
};

export function ownSyncFoldersOnly<T extends object>(native: T | null): T | null {
  if (!native) return null;
  return new Proxy(native, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function" || typeof key !== "string") return value;
      if (key === "chooseFolder") {
        return async (current: unknown, ...rest: unknown[]) => {
          const seed = typeof current === "string" && isUpstreamSyncFolder(current) ? null : current;
          let picked: unknown;
          try {
            picked = await value.call(target, seed, ...rest);
          } catch (error) {
            throw nativeRefused(error);
          }
          refuseUpstream(picked);
          return picked;
        };
      }
      const index = FOLDER_ARGUMENT[key];
      if (index === undefined) return value.bind(target);
      return (...args: unknown[]) => {
        try {
          refuseUpstream(args[index]);
          return Promise.resolve(value.apply(target, args)).catch((error: unknown) => Promise.reject(nativeRefused(error)));
        } catch (error) {
          return Promise.reject(nativeRefused(error));
        }
      };
    },
  });
}

export const UPSTREAM_SHARED_FOLDER = "Ardia Shared";

export const UPSTREAM_SHARED_REFUSAL = "That folder is in Ardia's Shared folder. Nilla keeps its shared folders apart from Ardia's, so choose another folder.";

export const UPSTREAM_SHARED_FOLDER_CODE = "ERR_UPSTREAM_SHARED_FOLDER";

export class UpstreamSharedFolderError extends Error {
  constructor() {
    super(UPSTREAM_SHARED_REFUSAL);
    this.name = "UpstreamSharedFolderError";
  }
}

export const isUpstreamSharedFolder = (path: string) =>
  isUpstreamSyncFolder(path) || path.split(/[\\/]+/).some((part) => folded(part) === UPSTREAM_SHARED_FOLDER.toLowerCase());

const sharedRefused = (error: unknown) =>
  !!error && typeof error === "object" && (error as { code?: unknown }).code === UPSTREAM_SHARED_FOLDER_CODE ? new UpstreamSharedFolderError() : error;

const SHARED_FOLDER_CALLS = new Set(["read", "apply", "create"]);

export function ownSharedFoldersOnly<T extends object>(native: T | null): T | null {
  if (!native) return null;
  return new Proxy(native, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function" || typeof key !== "string") return value;
      if (key === "watch") {
        return (paths: unknown, ...rest: unknown[]) =>
          value.call(target, Array.isArray(paths) ? paths.filter((path) => typeof path !== "string" || !isUpstreamSharedFolder(path)) : paths, ...rest);
      }
      if (!SHARED_FOLDER_CALLS.has(key)) return value.bind(target);
      return (path: unknown, ...rest: unknown[]) => {
        if (typeof path === "string" && isUpstreamSharedFolder(path)) {
          return key === "read" ? Promise.resolve({ exists: false, error: UPSTREAM_SHARED_REFUSAL }) : Promise.reject(new UpstreamSharedFolderError());
        }
        try {
          return Promise.resolve(value.call(target, path, ...rest)).catch((error: unknown) => Promise.reject(sharedRefused(error)));
        } catch (error) {
          return Promise.reject(sharedRefused(error));
        }
      };
    },
  });
}
