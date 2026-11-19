import { TurboModuleRegistry } from "react-native";
import { UPSTREAM_SYNC_REFUSAL } from "@nilla/sync/src/upstreamSyncFolder.ts";
import { requireNativeModule } from "../modules";
import type { AppModule, SystemModule, WindowsSyncModule } from "../nativeModuleTypes";
import { NATIVE_SYNC } from "../sync";
import { expectTrue, type Check } from "./check";

const SYNC_ALIAS_FIXTURES = "sync-aliases";

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
  expectTrue(await system().fileExists(`${base}\\Ardia Sync`), `${base}\\Ardia Sync is missing: launch-smoke.ps1 makes the sync folder aliases before the self-check`);
  return base;
};

type Answer = { refused: true; message: string } | { refused: false; exists: boolean };

const answer = (path: string): Promise<Answer> =>
  sync()
    .folderState(path)
    .then(
      (state): Answer => ({ refused: false, exists: state.exists }),
      (error: unknown): Answer => ({ refused: true, message: error instanceof Error ? error.message : String(error) }),
    );

async function expectRefused(path: string, what: string) {
  const got = await answer(path);
  expectTrue(got.refused, `${what} (${path}) was probed instead of refused`);
  expectTrue(got.message === UPSTREAM_SYNC_REFUSAL, `${what} was refused with ${JSON.stringify(got.message)}`);
}

async function expectRefusedIfThere(path: string, what: string) {
  const got = await answer(path);
  if (!got.refused && !got.exists) return console.info(`[nilla windows] self-check note: ${what} isn't on this volume, so nothing to refuse`);
  expectTrue(got.refused && got.message === UPSTREAM_SYNC_REFUSAL, `${what} (${path}) was probed instead of refused`);
}

export const checks: Check[] = [
  {
    name: "NillaWindowsSync refuses every alias of Ardia's Sync folder before it probes",
    async run() {
      const base = await fixtures();
      const own = await answer(`${base}\\Nilla Sync`);
      expectTrue(!own.refused && own.exists, `Nilla's own sync folder answered ${JSON.stringify(own)}`);
      await expectRefused(`${base}\\Ardia Sync`, "Ardia's Sync folder by its name");
      await expectRefused(`${base}\\ARDIA SYNC`, "Ardia's Sync folder in other case");
      await expectRefused(`${base}\\Ardia Sync.`, "Ardia's Sync folder with a trailing dot");
      await expectRefused(`${base}\\Ardia Sync \\inner`, "a folder inside Ardia's Sync folder with a trailing space");
      await expectRefused(`\\\\?\\${base}\\Ardia Sync`, "Ardia's Sync folder as an extended path");
      await expectRefused(`${base}\\Nilla Sync\\..\\Ardia Sync`, "Ardia's Sync folder reached through ..");
      await expectRefused(`${base}\\junction`, "a junction to Ardia's Sync folder");
      await expectRefused(`${base}\\junction\\inner`, "a folder inside a junction to Ardia's Sync folder");
      await expectRefusedIfThere(`${base}\\symlink`, "a symbolic link to Ardia's Sync folder");
      await expectRefusedIfThere(`${base}\\ARDIAS~1`, "the 8.3 short name of Ardia's Sync folder");
    },
  },
];
