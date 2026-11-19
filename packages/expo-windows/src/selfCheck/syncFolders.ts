import { TurboModuleRegistry } from "react-native";
import { UPSTREAM_SYNC_FOLDER, UPSTREAM_SYNC_REFUSAL } from "@nilla/sync/src/upstreamSyncFolder.ts";
import { requireNativeModule } from "../modules";
import type { AppModule, SystemModule, WindowsSyncModule } from "../nativeModuleTypes";
import { NATIVE_SYNC } from "../sync";
import { expectTrue, type Check } from "./check";

const SYNC_ALIAS_FIXTURES = "sync-aliases";
const MADE_PREFIX = "made-";
const UPSTREAM = UPSTREAM_SYNC_FOLDER;
const UPSTREAM_SHORT_NAME = `${UPSTREAM.replace(/\s/g, "").slice(0, 6).toUpperCase()}~1`;

const sync = () => {
  const module = TurboModuleRegistry.get<WindowsSyncModule>(NATIVE_SYNC);
  expectTrue(module, `${NATIVE_SYNC} is not registered`);
  return module;
};
const system = () => requireNativeModule<SystemModule>("NillaSystem");

const fixtures = async () => {
  const directory = requireNativeModule<AppModule>("NillaApp").launchConfig().dataDirectory;
  expectTrue(typeof directory === "string" && directory.length > 0, "the launch config names no data directory");
  const base = `${directory.replace(/[\\/]+$/, "")}\\${SYNC_ALIAS_FIXTURES}`;
  expectTrue(await system().fileExists(`${base}\\${UPSTREAM}`), `${base}\\${UPSTREAM} is missing: launch-smoke.ps1 makes the sync folder aliases before the self-check`);
  return base;
};

type Answer = { refused: true; message: string } | { refused: false; exists: boolean; resolved: boolean };

const answer = (path: string): Promise<Answer> =>
  sync()
    .folderState(path)
    .then(
      (state): Answer => ({ refused: false, exists: state.exists, resolved: state.resolved }),
      (error: unknown): Answer => ({ refused: true, message: error instanceof Error ? error.message : String(error) }),
    );

async function expectRefused(path: string, what: string) {
  const got = await answer(path);
  expectTrue(got.refused, `${what} (${path}) was probed instead of refused`);
  expectTrue(got.message === UPSTREAM_SYNC_REFUSAL, `${what} was refused with ${JSON.stringify(got.message)}`);
}

async function expectRefusedIfMade(base: string, fixture: string, path: string, what: string) {
  if (!(await system().fileExists(`${base}\\${MADE_PREFIX}${fixture}`))) return console.info(`[nilla windows] self-check note: the launch smoke couldn't make ${what} here, so nothing to refuse`);
  await expectRefused(path, what);
}

export const checks: Check[] = [
  {
    name: "NillaWindowsSync refuses every alias of the upstream Sync folder before it probes",
    async run() {
      const base = await fixtures();
      const own = await answer(`${base}\\Nilla Sync`);
      expectTrue(!own.refused && own.exists && own.resolved, `Nilla's own sync folder answered ${JSON.stringify(own)}`);
      await expectRefused(`${base}\\${UPSTREAM}`, "the upstream Sync folder by its name");
      await expectRefused(`${base}\\${UPSTREAM.toUpperCase()}`, "the upstream Sync folder in other case");
      await expectRefused(`${base}\\${UPSTREAM}.`, "the upstream Sync folder with a trailing dot");
      await expectRefused(`${base}\\${UPSTREAM} \\inner`, "a folder inside the upstream Sync folder with a trailing space");
      await expectRefused(`\\\\?\\${base}\\${UPSTREAM}`, "the upstream Sync folder as an extended path");
      await expectRefused(`${base}\\Nilla Sync\\..\\${UPSTREAM}`, "the upstream Sync folder reached through ..");
      await expectRefused(`${base}\\junction`, "a junction to the upstream Sync folder");
      await expectRefused(`${base}\\junction\\inner`, "a folder inside a junction to the upstream Sync folder");
      await expectRefusedIfMade(base, "symlink", `${base}\\symlink`, "a symbolic link to the upstream Sync folder");
      await expectRefusedIfMade(base, `short-name-${UPSTREAM_SHORT_NAME}`, `${base}\\${UPSTREAM_SHORT_NAME}`, "the 8.3 short name of the upstream Sync folder");
      const dangling = await answer(`${base}\\dangling\\inner`);
      expectTrue(!dangling.refused && !dangling.resolved, `a folder under a dangling link answered ${JSON.stringify(dangling)}, not unresolved`);
    },
  },
];
