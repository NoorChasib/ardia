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
