import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { creditInputs, CREDITS_FILE, gradleArtifacts, nativeCredits, packageRoot, repositoryUrl, workspaceLock } from "../../../test/credits.ts";

test("the licenses page was generated from the current lockfile and the module's Gradle libraries", () => {
  const credits = JSON.parse(readFileSync(CREDITS_FILE, "utf8"));
  assert.equal(credits.inputs, creditInputs(), "dependencies changed: bundle once, then run bun run --cwd apps/phone credits <source map>");
  assert.ok(credits.packages.length > 0);
  for (const credit of [...credits.packages, ...credits.native]) {
    assert.ok(credit.name && credit.license && /^https?:\/\//.test(credit.url), JSON.stringify(credit));
  }
});

test("a bundled module path names its package, scoped or not", () => {
  assert.equal(packageRoot("/r/node_modules/expo/node_modules/react-native/Libraries/A.js"), "/r/node_modules/expo/node_modules/react-native");
  assert.equal(packageRoot("/r/node_modules/@babel/runtime/helpers/x.js"), "/r/node_modules/@babel/runtime");
  assert.equal(packageRoot("/r/packages/core/src/mobile.ts"), null);
});

test("a package's link comes from its repository, then its homepage, then npm", () => {
  assert.equal(repositoryUrl({ name: "a", repository: "git+https://github.com/x/a.git" }), "https://github.com/x/a");
  assert.equal(repositoryUrl({ name: "a", repository: { url: "git://github.com/x/a.git" } }), "https://github.com/x/a");
  assert.equal(repositoryUrl({ name: "a", repository: "x/a" }), "https://github.com/x/a");
  assert.equal(repositoryUrl({ name: "a", homepage: "https://a.dev" }), "https://a.dev");
  assert.equal(repositoryUrl({ name: "@s/a" }), "https://www.npmjs.com/package/@s/a");
});

test("every Gradle library the module adds needs a recorded license", () => {
  const gradle = 'dependencies {\n  implementation "androidx.core:core:1.16.0"\n  implementation "com.google.zxing:core:3.5.4"\n  implementation "com.facebook.react:react-android"\n}';
  assert.deepEqual(gradleArtifacts(gradle), ["androidx.core:core", "com.google.zxing:core", "com.facebook.react:react-android"]);
  assert.deepEqual(nativeCredits(gradleArtifacts(gradle)).map((credit) => credit.name), ["Android Jetpack (AndroidX)", "ZXing"]);
  assert.throws(() => nativeCredits(["io.unknown:thing"]), /no license recorded/);
});

test("the lockfile entry for one app holds its ranges and the version each one resolved to", () => {
  const lockfile = '{\n  "lockfileVersion": 2,\n  "workspaces": {\n    "": {\n      "name": "a",\n      "dependencies": {\n        "x": "^1.0.0",\n      },\n      "devDependencies": {\n        "y": "~2.0.0",\n      },\n    },\n    "../b": {\n      "name": "b",\n    },\n  },\n  "packages": {\n    "x": ["x@1.2.0", "", {}, "sha512-x"],\n    "y": ["y@2.0.3", "", {}, "sha512-y"],\n  },\n}\n';
  assert.deepEqual(JSON.parse(workspaceLock(lockfile, "")), { name: "a", dependencies: { x: "^1.0.0" }, devDependencies: { y: "~2.0.0" }, resolved: { x: "x@1.2.0", y: "y@2.0.3" } });
  assert.equal(JSON.parse(workspaceLock(lockfile, "../b")).name, "b");
  assert.throws(() => workspaceLock(lockfile, "apps/c"), /not in the lockfile/);
});
