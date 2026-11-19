import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const folder = read("../ios/ConfigFolder.swift");
const body = (signature) => {
  const start = folder.indexOf(signature);
  assert.ok(start >= 0, signature);
  return folder.slice(start, folder.indexOf("\n  }\n", start));
};

test("the Mac config folder reads and writes only paths that resolve outside Ardia's folders", () => {
  assert.match(body("static func read(_ name: String)"), /let target = UpstreamAppFolders\.ownPath\(path\(name\)\) else \{ return \["status": "unreadable"\] \}\s*return readRegularFile\(target,/);
  const writeSchemas = body("static func writeSchemas(");
  const schemaGuard = writeSchemas.indexOf('if let schemaDir = UpstreamAppFolders.ownPath(try DocumentStore.url("config-schema").path) {');
  assert.ok(schemaGuard >= 0, "the schema folder resolves outside Ardia's folders");
  assert.ok(writeSchemas.indexOf("createDirectory(atPath: schemaDir") > schemaGuard, "the schema folder is made only after that check");
  assert.equal([...writeSchemas.matchAll(/createDirectory\(/g)].length, 1);
  assert.match(writeSchemas, /if folderExists\(\), let configFolder = UpstreamAppFolders\.ownPath\(directory\) \{ folders\.append\(configFolder\) \}/);
  assert.match(writeSchemas, /guard let target = UpstreamAppFolders\.ownPath\(\(folder as NSString\)\.appendingPathComponent\(name\)\) else \{ continue \}/);
  assert.doesNotMatch(writeSchemas, /folder == schemaDir|\[schemaDir, directory\]/);
  assert.equal([...folder.matchAll(/readRegularFile\(/g)].length, 3, "every read of the config folder goes through read or writeSchemas");
});

test("the guard lists the CLI's upstream folders under the home folder", () => {
  const guard = read("../ios/ConfigCore/UpstreamAppFolders.swift");
  const cli = read("../../../apps/cli/nilla_browser_cli/upstream.py");
  const listed = guard.slice(guard.indexOf("func folders"), guard.indexOf("func ownPath"));
  const swiftFolders = [...listed.matchAll(/^\s+"([^"]+)",$/gm)].map((match) => match[1]);
  const named = cli.slice(cli.indexOf("return [", cli.indexOf("def folders")), cli.indexOf("def resolved"));
  const cliFolders = [...named.matchAll(/^\s+(home|support)((?: \/ "[^"]+")+),$/gm)].map(([, base, parts]) =>
    [...(base === "support" ? ["Library", "Application Support"] : []), ...[...parts.matchAll(/"([^"]+)"/g)].map((part) => part[1])].join("/"));
  assert.ok(cliFolders.length >= 7, cliFolders.join(", "));
  assert.deepEqual(swiftFolders, cliFolders);
});

test("the shell package runs the config folder checks", () => {
  const pkg = JSON.parse(read("../package.json"));
  assert.match(pkg.scripts["test:portable"], /\.\/scripts\/configFolder\.test\.mjs/);
  assert.match(read("../Package.swift"), /\.testTarget\(name: "NillaConfigCoreTests", dependencies: \["NillaConfigCore"\], path: "config-tests"\)/);
});
