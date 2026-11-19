import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { turboModules } from "../../test-native/reactNative.ts";

const { NATIVE_SYNC, windowsSync } = await import("../../../../../packages/expo-windows/src/sync/index.ts");
const { UPSTREAM_SYNC_FOLDER, UPSTREAM_SYNC_REFUSAL, UpstreamSyncFolderError } = await import("../../../../../packages/sync/src/upstreamSyncFolder.ts");

const native = (name) => readFileSync(new URL(`../../../windows/Ardia/${name}`, import.meta.url), "utf8");
const LINKED = "C:\\Users\\me\\Documents\\Nilla Sync";

function fakeWindows(pickedFolder) {
  const probed = [];
  const seeded = [];
  turboModules[NATIVE_SYNC] = {
    getConstants: () => ({ oneDriveFolder: "", documentsFolder: "C:\\Users\\me\\Documents", computerName: "PC" }),
    folderState: (path) => {
      probed.push(path);
      return path === LINKED ? Promise.reject(new Error(UPSTREAM_SYNC_REFUSAL)) : Promise.resolve({ exists: true, writable: true, hasSyncData: false });
    },
  };
  turboModules.NillaDialogs = {
    pickFolder: (current) => {
      seeded.push(current);
      return Promise.resolve(pickedFolder);
    },
  };
  return { probed, seeded };
}

test("the folder picker never starts in a folder the native side says leads to the upstream Sync folder", async () => {
  const { probed, seeded } = fakeWindows("D:\\Elsewhere\\Mine");
  assert.equal(await windowsSync().chooseFolder(LINKED), "D:\\Elsewhere\\Mine");
  assert.deepEqual(seeded, [null]);
  assert.deepEqual(probed, [LINKED, "D:\\Elsewhere\\Mine"]);
});

test("a picked folder the native side says leads to the upstream Sync folder is refused", async () => {
  const { seeded } = fakeWindows(LINKED);
  await assert.rejects(windowsSync().chooseFolder("D:\\Elsewhere\\Mine"), UpstreamSyncFolderError);
  assert.deepEqual(seeded, ["D:\\Elsewhere\\Mine"]);
});

test("the Windows sync module resolves a folder through handles before it probes, reads or writes it", () => {
  const handles = native("SyncHandles.h");
  const refusal = handles.match(/constexpr char UpstreamRefusal\[\] = "([^"]+)";/);
  assert.ok(refusal);
  assert.equal(refusal[1], UPSTREAM_SYNC_REFUSAL);
  assert.equal(handles.match(/constexpr std::wstring_view UpstreamFolderName = L"([^"]+)";/)?.[1], UPSTREAM_SYNC_FOLDER);
  assert.match(handles, /std::optional<std::wstring> resolved = Paths::Resolved\(std::filesystem::path\{folder\}, VOLUME_NAME_DOS\);\n  if \(!resolved\) return Owner::Unresolved;/);
  assert.match(handles, /std::optional<std::wstring> final = Paths::FinalPathOf\(folder, VOLUME_NAME_DOS\);/);
  assert.match(handles, /while \(!part\.empty\(\) && \(part\.back\(\) == L' ' \|\| part\.back\(\) == L'\.'\)\) part\.remove_suffix\(1\);/);

  const vault = native("SyncVault.h");
  assert.match(vault, /if \(!SyncFiles::IsUsableFolder\(wide\)\) throw Failure\("not a sync folder path"\);\n  RefuseUnlessOwn\(SyncHandles::OwnerOf\(wide\)\);\n  return wide;/);
  assert.match(vault, /if \(root\.state == SyncHandles::Folder::Directory\) RefuseUnlessOwn\(SyncHandles::OwnerOfOpened\(root\.handle\.get\(\)\)\);/);
  assert.equal(vault.split("SyncHandles::OpenRoot(").length - 1, 1, "every root opens through OpenOwnRoot");
  assert.match(vault, /inline SyncHandles::Handle RootOf\(std::string const &folder\) \{\n  SyncHandles::OpenedFolder root = OpenOwnRoot\(folder\);/);
  assert.match(vault, /inline std::string ChainStatus\(std::string const &folder, Keys const &keys\) \{\n  SyncHandles::OpenedFolder root = OpenOwnRoot\(folder\);/);
  assert.match(vault, /inline std::wstring ChainPath\(std::string const &folder, Keys const &keys\) \{ return Folder\(folder\) \+ /);
  assert.match(vault, /std::wstring root = Folder\(folder\);\n  SyncFiles::Probe chain = SyncFiles::ProbePath\(ChainPath\(folder, \*keys\)\);/);

  const module = native("SyncModule.h");
  const probe = module.slice(module.indexOf("REACT_METHOD(folderState)"), module.indexOf("REACT_METHOD(readPasswords)"));
  assert.ok(probe.indexOf("SyncHandles::OwnerOf(folder)") > 0 && probe.indexOf("SyncHandles::OwnerOf(folder)") < probe.indexOf("SyncFiles::IsDirectory(folder)"), "folderState resolves before it probes");
  assert.match(probe, /if \(owner == SyncHandles::Owner::Upstream\) return promise\.Reject\(SyncHandles::UpstreamRefusal\);/);
});

test("the self-check asks the native side about every alias of the upstream Sync folder the launch smoke makes", () => {
  const check = readFileSync(new URL("../../../../../packages/expo-windows/src/selfCheck/syncFolders.ts", import.meta.url), "utf8");
  const smoke = readFileSync(new URL("../../../../../scripts/windows/launch-smoke.ps1", import.meta.url), "utf8");
  for (const alias of ["junction", "symlink"]) {
    assert.ok(check.includes(`\${base}\\\\${alias}`), alias);
    assert.ok(smoke.includes(`(Join-Path $syncAliases "${alias}")`), alias);
  }
  assert.match(smoke, /New-Item -ItemType Junction -Path \(Join-Path \$syncAliases "junction"\) -Target \$upstreamSync/);
  assert.match(check, /\$\{UPSTREAM_SHORT_NAME\}/);
  assert.match(readFileSync(new URL("../../../../../packages/expo-windows/src/selfCheck/index.ts", import.meta.url), "utf8"), /syncChecks, syncFolderChecks,/);
});
