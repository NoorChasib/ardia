import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const LAYER_FOLDERS = [
  ["components/ui/", "ui"],
  ["components/", "components"],
  ["state/", "state"],
  ["platform/", "platform"],
  ["lib/", "lib"],
];
const ENTRY_FILES = ["App", "main"];
const MAY_IMPORT = {
  app: ["app", "components", "ui", "state", "platform", "lib"],
  components: ["components", "ui", "state", "lib"],
  ui: ["ui", "lib"],
  state: ["state", "platform", "lib"],
  platform: ["platform", "lib"],
  lib: ["lib"],
};
const MAY_CALL_NATIVE = ["platform", "ui"];
const HANDS_PLATFORM_TO_SCRIPTS = new Set(["components/dev/devHarness.ts"]);

const RULES = ["layout", "imports", "native-calls", "tokens", "scale", "get-state", "set-state", "store-reads", "store-shape", "size", "env", "naming", "comments", "file-names"];
const SIZE_CAP = { js: 400, native: 600 };
const SCOPES = ["apps/browser/src", "packages", "engine/ardiacore/src", "engine/chromium/src"];
const GENERATED = new Set(["packages/core/src/bangList.ts", "packages/demo/src/shims/web/symbols/data.ts", "apps/browser/src/lib/emojiData.ts", "packages/phone/ios/NillaKit/Sources/NillaShared/Scripts/nilla-core.js", "packages/phone/ios/NillaKit/Sources/NillaShared/Scripts/nilla-sync.js"]);
const ONE_INJECTED_SCRIPT = new Set(["packages/ardiacore/ios/page_script.js"]);
const FROZEN_SPECS = new Set(["packages/core/src/suggest.reference.ts"]);
const LAUNCH_CONFIG = [/^packages\/ardiacore\/ios\/ArdiaLaunchConfig\.\w+$/, /^apps\/browser\/src\/platform\/launchConfig\.ts$/];
const TOKEN_FILE = /(?:^|\/)(?:tokens|motion)\.ts$/;
const ENGINE_ENV_READS = {
  "engine/ardiacore/src/ardia/core/ac_main_delegate.cc": [
    "std::string EnvironmentThatOpensTheProfile(base::Environment& env) {",
    "std::unique_ptr<base::Environment> env = base::Environment::Create();",
  ],
  "engine/chromium/src/chrome/browser/ardia/ac_scripts_policy.cc": ['if (const char* home = getenv("HOME")) {'],
};

const APP_SRC = "apps/browser/src/";
const BASELINE_PATH = `${APP_SRC}conventions-baseline.json`;
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const SOURCE_FILE = /\.(?:tsx?|mjs|js|swift|h|m|mm|cc|mojom)$/;
const SCOPE_FILE = /^(?:apps\/browser\/src\/|packages\/[^/]+\/(?:src|ios)\/|engine\/(?:ardiacore|chromium)\/src\/)/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$|(?:^|\/)(?:test-native|fixtures|tests|Tests)\/|(?:^|\/)test-(?:loader|hooks|preload)\.mjs$/;

const TOOL_DIRECTIVE =
  /^(?:\/\/+|\/\*+)\s*(?:@ts-(?:expect-error|ignore|nocheck)|eslint-(?:disable|enable)|swiftlint:|swift-format-ignore|swift-tools-version:|prettier-ignore|clang-format (?:on|off)|NOLINT|nogncheck|IWYU pragma|[#@]__PURE__|# sourceURL=|# sourceMappingURL=)/;
const LICENSE_HEADER = /copyright|licen[cs]e|spdx/i;
const REGEX_AFTER_WORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);

function scanSource(src, lang, embedded = false) {
  const n = src.length;
  const comments = [];
  const strings = [];
  let i = 0;
  let regexOk = true;

  const lineComment = () => {
    const start = i;
    while (i < n && src[i] !== "\n") i++;
    comments.push([start, i]);
  };
  const blockComment = () => {
    const start = i;
    if (lang === "swift") {
      let depth = 0;
      while (i < n) {
        if (src.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (src.startsWith("*/", i)) {
          depth--;
          i += 2;
          if (!depth) break;
        } else i++;
      }
    } else {
      const end = src.indexOf("*/", i + 2);
      if (end < 0 && embedded) return false;
      i = end < 0 ? n : end + 2;
    }
    comments.push([start, i]);
    return true;
  };
  const quoted = (quote) => {
    const start = ++i;
    while (i < n && src[i] !== quote && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
    strings.push({ start, end: Math.min(i, n), embedded: false, holes: [] });
    i++;
  };
  const rawCString = () => {
    const open = src.indexOf("(", i);
    const delimiter = src.slice(i + 1, open);
    const close = `)${delimiter}"`;
    const start = open + 1;
    const end = src.indexOf(close, start);
    const stop = end < 0 ? n : end;
    strings.push({ start, end: stop, embedded: true, holes: [] });
    i = stop + close.length;
  };
  const template = () => {
    const start = ++i;
    const holes = [];
    while (i < n && src[i] !== "`") {
      if (src[i] === "\\") {
        i += 2;
      } else if (src[i] === "$" && src[i + 1] === "{") {
        const hole = i;
        i += 2;
        code("}");
        i++;
        holes.push([hole, i]);
      } else i++;
    }
    strings.push({ start, end: Math.min(i, n), embedded: true, holes });
    i++;
  };
  const swiftString = () => {
    let hashes = 0;
    while (src[i] === "#") {
      hashes++;
      i++;
    }
    const multiline = src.startsWith('"""', i);
    i += multiline ? 3 : 1;
    const start = i;
    const close = (multiline ? '"""' : '"') + "#".repeat(hashes);
    const escape = "\\" + "#".repeat(hashes);
    const holes = [];
    while (i < n) {
      if (src.startsWith(escape, i)) {
        const after = i + escape.length;
        if (src[after] === "(") {
          const hole = i;
          i = after + 1;
          code(")");
          i++;
          holes.push([hole, i]);
        } else i = after + 1;
        continue;
      }
      if (src.startsWith(close, i) || (!multiline && src[i] === "\n")) break;
      i++;
    }
    strings.push({ start, end: Math.min(i, n), embedded: multiline, holes });
    i += src.startsWith(close, i) ? close.length : 1;
  };
  const regex = () => {
    i++;
    let inClass = false;
    while (i < n && src[i] !== "\n") {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      i++;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
    }
    while (i < n && /[a-z]/.test(src[i])) i++;
  };
  const code = (closer) => {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const next = src[i + 1];
      if (c === "/" && next === "/" && (embedded ? /^$|[\s;{}(),]/.test(src[i - 1] ?? "") : src[i - 1] !== ":")) {
        lineComment();
        continue;
      }
      if (c === "/" && next === "*" && blockComment()) continue;
      if (lang === "swift") {
        if (c === '"' || (c === "#" && /^#+"/.test(src.slice(i, i + 8)))) {
          swiftString();
          continue;
        }
      } else if (c === '"' || c === "'") {
        if (lang === "c" && c === '"' && /(?:^|[^\w])(?:u8|u|U|L)?R$/.test(src.slice(Math.max(0, i - 4), i))) rawCString();
        else quoted(c);
        regexOk = false;
        continue;
      } else if (lang === "js" && c === "`") {
        template();
        regexOk = false;
        continue;
      } else if (lang === "js" && c === "/") {
        if (regexOk && !closesJsxTag(src, i)) {
          regex();
          regexOk = false;
        } else {
          i++;
          regexOk = true;
        }
        continue;
      }
      if (/[\w$]/.test(c)) {
        const start = i;
        while (i < n && /[\w$]/.test(src[i])) i++;
        regexOk = REGEX_AFTER_WORDS.has(src.slice(start, i));
        continue;
      }
      if (closer && depth === 0 && c === closer) return;
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      if (!/\s/.test(c)) regexOk = !(c === ")" || c === "]" || c === "}" || (c === ">" && src[i - 1] !== "="));
      i++;
    }
  };

  code(null);
  const codeAndStrings = blank(src, comments);
  const firstCode = codeAndStrings.search(/\S/);
  const header = comments.filter(([, end]) => firstCode < 0 || end <= firstCode);
  const licensed = header.some(([start, end]) => LICENSE_HEADER.test(src.slice(start, end)));
  const stray = comments.filter(
    (range) => !(licensed && header.includes(range)) && !TOOL_DIRECTIVE.test(src.slice(range[0], range[1])),
  );
  for (const s of strings) {
    if (!s.embedded) continue;
    const text = withoutHoles(src, s).replace(/\\([\s\S])/g, (_, ch) => (ch === "\\" ? "  " : ` ${ch}`));
    for (const [start, end] of scanSource(text, "js", true).stray) stray.push([s.start + start, s.start + end]);
  }
  return { comments, strings, stray, codeAndStrings };
}

function closesJsxTag(src, slash) {
  let before = slash - 1;
  while (before >= 0 && /\s/.test(src[before])) before--;
  return src[before] === "<";
}

function withoutHoles(src, { start, end, holes }) {
  let text = "";
  let at = start;
  for (const [holeStart, holeEnd] of holes) {
    text += src.slice(at, holeStart) + src.slice(holeStart, holeEnd).replace(/[^\n]/g, "0");
    at = holeEnd;
  }
  return text + src.slice(at, end);
}

const HEX_STRING = /^(["'`])([0-9a-f]{3,8})\1$/i;
const HEX_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*(["'`])([0-9a-f]{3,8})\2/gi;

function hexBindings(code) {
  return new Map([...code.matchAll(HEX_BINDING)].map((match) => [match[1], match[3]]));
}

function withHexHoles(src, { start, end, holes }, bindings) {
  let text = "";
  let at = start;
  for (const [holeStart, holeEnd] of holes) {
    const inner = src.slice(holeStart + 2, holeEnd - 1).trim();
    const hex = inner.match(HEX_STRING)?.[2] ?? bindings.get(inner);
    text += src.slice(at, holeStart) + (hex ?? src.slice(holeStart, holeEnd).replace(/[^\n]/g, "_"));
    at = holeEnd;
  }
  return text + src.slice(at, end);
}

function blank(src, ranges) {
  const sorted = ranges.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [start, end] of sorted) {
    if (end <= at) continue;
    const from = Math.max(start, at);
    out += src.slice(at, from) + src.slice(from, end).replace(/[^\n]/g, " ");
    at = end;
  }
  return out + src.slice(at);
}

function stringContentRanges({ start, end, holes }) {
  const ranges = [];
  let at = start;
  for (const [holeStart, holeEnd] of holes) {
    ranges.push([at, holeStart]);
    at = holeEnd;
  }
  ranges.push([at, end]);
  return ranges;
}

function languageOf(path) {
  if (/\.(?:tsx?|mjs|js)$/.test(path)) return "js";
  if (path.endsWith(".swift")) return "swift";
  return "c";
}

function layerOf(rel) {
  for (const [prefix, layer] of LAYER_FOLDERS) if (rel.startsWith(prefix) || rel === prefix.slice(0, -1)) return layer;
  if (ENTRY_FILES.includes(rel.replace(/\.(?:tsx?|mjs|js)$/, ""))) return "app";
  return null;
}

const count = (text, pattern) => (text.match(pattern) || []).length;

const COLOR_LITERAL = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\s*\(/gi;
const NAMED_CLEAR = /^\s*transparent\s*$/i;
const MOTION_LITERAL = /\bEasing\s*\.\s*\w|\bduration\s*:\s*-?\.?\d|\bAnimated\s*\.\s*delay\s*\(\s*\d/g;
const SCALE_PROPERTY =
  /(?<![\w$.])(?:fontSize|letterSpacing|radius|[a-z]\w*Radius|padding(?:Horizontal|Vertical|Top|Bottom|Left|Right|Start|End)?|margin(?:Horizontal|Vertical|Top|Bottom|Left|Right|Start|End)?|gap|rowGap|columnGap|damping|stiffness|friction|tension|bounciness)\s*(?::|=\s*\{|=(?![=>]))/g;
const NUMBER = String.raw`-?\s*(?:\d+(?:\.\d+)?|\.\d+)(?![\w.$])`;
const LEADING_NUMBER = new RegExp(String.raw`^\(?\s*(${NUMBER})`);
const NUMERIC_BRANCH = new RegExp(String.raw`[?:]\s*(${NUMBER})\s*(?=:|\)|$)`, "g");
const ENV_READ =
  /\b(?:secure_)?getenv\s*\(|processInfo(?:\]\s*|\s*\.\s*)environment\b|ProcessInfo\s*\(\s*\)\s*\.\s*environment\b|\bprocess\s*\.\s*env\b|\bbase::Environment\b/g;
const CEF_NAME = /(?<![A-Za-z])(?:[Cc]ef|CEF)(?![a-z])|(?<=[a-z0-9_])(?:Cef|CEF)(?![a-z])/g;
const APP_SIDE_OBJC_FILE = /^(?:AC[A-Z]|ArdiaCore[A-Z])\w*\.(?:h|m|mm|swift)$/;
const APP_SIDE_OBJC_CLASS =
  /@(?:interface|implementation|protocol)\s+(?:AC[A-Z]|ArdiaCore[A-Z])\w*\b(?!\s*[(;])|(?<!@)\b(?:class|struct|enum|protocol|actor|typealias)\s+(?:AC[A-Z]|ArdiaCore[A-Z])\w*|@objc\(\s*(?:AC[A-Z]|ArdiaCore[A-Z])\w*\s*\)/g;
const IMPORT_SPEC =
  /\b(?:import|export)\b[^;"'`]*?\bfrom\s*(["'])([^"'\n]+)\1|\bimport\s*(?:\(\s*)?(["'])([^"'\n]+)\3|\brequire\s*\(\s*(["'])([^"'\n]+)\5/g;
const NATIVE_PACKAGE = /^(?:@ardia\/ardiacore(?:\/.*)?|@nilla\/(?:shell|shaders|import|sync)(?:\/.*)?|expo-modules-core)$/;
const NATIVE_GLOBAL = /\bNativeModules\b(?!\s*[,}])|\brequireNative(?:Module|Component|ViewManager)\s*\(/g;
const COMPONENT_FILE = /^[A-Z][A-Za-z0-9]*(?:\.(?:web|native|macos|ios|windows|linux))?\.tsx$/;
const MODULE_FILE = /^[a-z][A-Za-z0-9]*(?:\.(?:web|native|macos|ios|windows|linux))?\.(?:ts|mjs)$/;
const TEST_NAME = /^[A-Za-z][A-Za-z0-9]*\.test\.mjs$/;

function valueAt(code, at) {
  let depth = 0;
  let end = at;
  for (; end < code.length; end++) {
    const c = code[end];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (c === "," || c === ";" || c === "\n")) break;
  }
  return code.slice(at, end).trim();
}

const nonZero = (literal) => Number(literal.replace(/\s+/g, "")) !== 0;

function scaleLiterals(code) {
  let found = 0;
  for (const match of code.matchAll(SCALE_PROPERTY)) {
    const value = valueAt(code, match.index + match[0].length);
    const leading = value.match(LEADING_NUMBER);
    const branches = [...value.matchAll(NUMERIC_BRANCH)].map((branch) => branch[1]);
    if ((leading && nonZero(leading[1])) || branches.some(nonZero)) found++;
  }
  return found;
}

function unshapedStores(code) {
  let found = 0;
  for (const match of code.matchAll(/(?<![.\w$])create\s*(<|\()/g)) {
    let at = match.index + match[0].length;
    if (match[1] === "<") {
      for (let depth = 1; at < code.length && depth; at++) depth += code[at] === "<" ? 1 : code[at] === ">" ? -1 : 0;
      if (!code.startsWith("()(", at)) found++;
      else if (/^\(\)\(\s*\(\s*set\b/.test(code.slice(at, at + 40))) found++;
    } else found++;
  }
  return found;
}

function envReads(path, src, code) {
  const exempt = ENGINE_ENV_READS[path] ?? [];
  let found = 0;
  for (const match of code.matchAll(ENV_READ)) {
    const lineStart = src.lastIndexOf("\n", match.index) + 1;
    const lineEnd = src.indexOf("\n", match.index);
    if (!exempt.includes(src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim())) found++;
  }
  return found;
}

function checkFile(path, src, add) {
  const lang = languageOf(path);
  const isTest = TEST_FILE.test(path);
  const isDeclaration = path.endsWith(".d.ts");
  const inApp = path.startsWith(APP_SRC);
  const rel = inApp ? path.slice(APP_SRC.length) : path;
  const base = posix.basename(path);
  const { strings, stray, codeAndStrings } = scanSource(src, lang);
  const code = blank(codeAndStrings, strings.flatMap(stringContentRanges));
  add("comments", path, stray.length);

  if (isTest || isDeclaration) {
    if (inApp && isTest && base.endsWith(".test.mjs") && !TEST_NAME.test(base)) add("file-names", path, 1);
    return;
  }

  const lines = src.length ? src.split("\n").length - (src.endsWith("\n") ? 1 : 0) : 0;
  const isJs = /\.tsx?$/.test(path) && (inApp || /^packages\/[^/]+\/src\//.test(path)) && !FROZEN_SPECS.has(path);
  const isNative = /\.(?:swift|h|m|mm|cc|mojom|js)$/.test(path) && !ONE_INJECTED_SCRIPT.has(path);
  if ((isJs && lines > SIZE_CAP.js) || (isNative && lines > SIZE_CAP.native)) add("size", path, 1);

  if (!LAUNCH_CONFIG.some((allowed) => allowed.test(path))) add("env", path, envReads(path, src, code));

  let naming = count(codeAndStrings, CEF_NAME);
  if (/^packages\/[^/]+\/ios\//.test(path)) naming += (APP_SIDE_OBJC_FILE.test(base) ? 1 : 0) + count(code, APP_SIDE_OBJC_CLASS);
  add("naming", path, naming);

  if (!inApp || !/\.(?:tsx?|mjs)$/.test(path)) return;

  if (!(COMPONENT_FILE.test(base) || MODULE_FILE.test(base) || rel === "main.tsx")) add("file-names", path, 1);

  if (!TOKEN_FILE.test(path)) {
    const bindings = hexBindings(codeAndStrings);
    const colors = strings.reduce((sum, s) => sum + count(withHexHoles(src, s, bindings), COLOR_LITERAL) + (NAMED_CLEAR.test(src.slice(s.start, s.end)) ? 1 : 0), 0);
    add("tokens", path, colors + count(code, MOTION_LITERAL));
    if (rel.startsWith("components/") || rel === "App.tsx") add("scale", path, scaleLiterals(code));
  }

  if (rel.startsWith("components/")) {
    add("get-state", path, count(code, /\bgetState\s*\(/g));
    add("set-state", path, count(code, /\.setState\s*\(/g));
    add("store-reads", path, count(code, /\buseBrowser\s*\(/g));
  }
  if (/\bimport\s*\{[^}]*\bcreate\b[^}]*\}\s*from\s*["']zustand["']/.test(codeAndStrings)) add("store-shape", path, unshapedStores(code));

  const layer = layerOf(rel);
  let nativeCalls = count(code, NATIVE_GLOBAL);
  let badImports = 0;
  for (const match of codeAndStrings.matchAll(IMPORT_SPEC)) {
    const spec = match[2] ?? match[4] ?? match[6];
    if (NATIVE_PACKAGE.test(spec)) {
      nativeCalls++;
      continue;
    }
    if (!layer || !spec.startsWith(".")) continue;
    const target = posix.normalize(posix.join(posix.dirname(rel), spec));
    if (target.startsWith("..")) continue;
    const targetLayer = layerOf(target);
    const handsPlatformToScripts = targetLayer === "platform" && HANDS_PLATFORM_TO_SCRIPTS.has(rel);
    if (!targetLayer || !(MAY_IMPORT[layer].includes(targetLayer) || handsPlatformToScripts)) badImports++;
  }
  if (!MAY_CALL_NATIVE.includes(layer)) add("native-calls", path, nativeCalls);
  if (!layer) add("layout", path, 1);
  else add("imports", path, badImports);
}

function git(args, input) {
  const result = spawnSync("git", args, { cwd: ROOT, input, maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

const inScope = (path) => SCOPE_FILE.test(path) && SOURCE_FILE.test(path) && !GENERATED.has(path) && path !== posix.join(APP_SRC, "conventions.test.mjs");

function workingTreeFiles() {
  const paths = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...SCOPES]).toString().split("\0");
  return [...new Set(paths)]
    .filter((path) => inScope(path) && existsSync(ROOT + path))
    .map((path) => [path, readFileSync(ROOT + path, "utf8")]);
}

function committedFiles(fromHead) {
  const listing = fromHead ? ["ls-tree", "-r", "-z", "HEAD", "--", ...SCOPES] : ["ls-files", "-s", "-z", "--", ...SCOPES];
  const entries = git(listing)
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      return [path, meta.split(" ")[fromHead ? 2 : 1]];
    })
    .filter(([path]) => inScope(path));
  const batch = git(["cat-file", "--batch"], entries.map(([, sha]) => sha).join("\n") + "\n");
  const files = [];
  let at = 0;
  for (const [path] of entries) {
    const headerEnd = batch.indexOf(10, at);
    const size = Number(batch.toString("utf8", at, headerEnd).split(" ")[2]);
    files.push([path, batch.toString("utf8", headerEnd + 1, headerEnd + 1 + size)]);
    at = headerEnd + 1 + size + 1;
  }
  return files;
}

function findViolations(files) {
  const found = Object.fromEntries(RULES.map((rule) => [rule, {}]));
  const add = (rule, path, n) => {
    if (n > 0) found[rule][path] = (found[rule][path] ?? 0) + n;
  };
  for (const [path, src] of files) checkFile(path, src, add);
  return found;
}

const NAMING_ALLOWLIST_PATH = `${APP_SRC}naming-allowlist.json`;
const RESIDUAL_NAME = /ardia|netnyahoo/gi;
const RESIDUAL_GATE_FILE = `${APP_SRC}conventions.test.mjs`;
const KEPT_PATH_GROUPS = ["frozen", "keep", "lead", "generated", "skipTree"];
const KEPT_PATHS = ["docs/audit/*", RESIDUAL_GATE_FILE];

const globRegex = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
const regexText = (text) => text.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

function protectedPattern(entry) {
  if ("regex" in entry) {
    const caseless = entry.regex.startsWith("(?i)");
    const source = caseless ? entry.regex.slice(4) : entry.regex;
    assert.ok(!source.includes("(?i)"), `${entry.id}: a (?i) flag only at the start`);
    return new RegExp(source, caseless ? "gmi" : "gm");
  }
  const text = regexText(entry.text);
  if (entry.quoted) return new RegExp(`(?<=["'\`])${text}(?=["'\`])`, "g");
  if ((entry.boundary ?? "word") !== "word") return new RegExp(text, "g");
  const before = /\w/.test(entry.text[0]) ? "(?<![A-Za-z0-9_])" : "";
  const after = /\w/.test(entry.text.at(-1)) ? "(?![A-Za-z0-9_])" : "";
  return new RegExp(`${before}${text}${after}`, "g");
}

function namingAllowlist(document) {
  const unmoved = [
    ...document.moves.componentMaps
      .filter((map) => map.replace)
      .map((map) => [new RegExp(`(^|/)${regexText(map.replace)}(?=/|$)`, "g"), `$1${map.match.replace(/^\^|^\(\^\|\/\)|\$$/g, "").split("/").at(-1)}`]),
    ...document.moves.componentCase.map(([before, after]) => [new RegExp(after, "g"), before]),
  ];
  const beforeRename = (path) => unmoved.reduce((moved, [pattern, before]) => moved.replace(pattern, before), path);
  const matches = (globs, path) => (globs ?? []).some((glob) => globRegex(glob).test(path) || globRegex(glob).test(beforeRename(path)));
  const keptPaths = [...KEPT_PATH_GROUPS.flatMap((group) => document.paths[group]), ...KEPT_PATHS];
  const entries = document.protect.map((entry) => ({ entry, pattern: protectedPattern(entry) }));
  return {
    kept: (path) => matches(keptPaths, path),
    spans(path, text) {
      const spans = [];
      for (const { entry, pattern } of entries) {
        if (entry.scope && !matches(entry.scope, path)) continue;
        if (entry.except && matches(entry.except, path)) continue;
        for (const match of text.matchAll(pattern)) if (match[0]) spans.push([match.index, match.index + match[0].length]);
      }
      const lines = new Set(document.lines.filter((line) => line.path === path || line.path === beforeRename(path)).map((line) => line.text));
      if (lines.size) {
        let start = 0;
        for (const line of text.split("\n")) {
          if (lines.has(line)) spans.push([start, start + line.length]);
          start += line.length + 1;
        }
      }
      return spans;
    },
  };
}

function residualNames(allowlist, files) {
  const uncovered = [];
  for (const [path, text] of files) {
    if (allowlist.kept(path)) continue;
    const spans = allowlist.spans(path, text);
    for (const match of text.matchAll(RESIDUAL_NAME)) {
      const end = match.index + match[0].length;
      if (spans.some(([from, to]) => from <= match.index && end <= to)) continue;
      const line = text.slice(0, match.index).split("\n").length;
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const lineEnd = text.indexOf("\n", match.index);
      uncovered.push(`${path}:${line}: ${text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).trim().slice(0, 160)}`);
    }
  }
  return uncovered;
}

function filesNamingTheUpstream() {
  const listed = spawnSync("git", ["grep", "--untracked", "-I", "-l", "-z", "-i", "-E", RESIDUAL_NAME.source], { cwd: ROOT, maxBuffer: 1 << 30 });
  if (listed.status > 1) throw new Error(`git grep: ${listed.stderr}`);
  return listed.stdout.toString().split("\0").filter((path) => path && existsSync(ROOT + path)).map((path) => [path, readFileSync(ROOT + path, "utf8")]);
}

function staleLines(document) {
  return document.lines
    .filter((line) => !existsSync(ROOT + line.path) || !readFileSync(ROOT + line.path, "utf8").split("\n").includes(line.text))
    .map((line) => `${line.id} (${line.path}): ${line.text.trim().slice(0, 120)}`);
}

const ENGINE_CONTRACT = [
  {
    name: "the instance switch prefix ardia-",
    engine: ["engine/ardiacore/src/ardia/core/ac_launch_switches.cc", /const std::string name = "ardia-" \+ std::string\(key\);/],
    app: [
      ["packages/ardiacore/ios/ArdiaHost+Launch.mm", /!\[sw hasPrefix:@"ardia-"\]/],
      ["packages/ardiacore/ios/ArdiaHost+Launch.mm", /!strncmp\(arg, "--ardia-", 8\)/],
      ["packages/ardiacore/ios/ArdiaLaunchConfig.mm", /@"--ardia-%@=%@"/],
      ["scripts/lib/launchEnv.mjs", /"--ardia-apply-profile-gate"/],
    ],
  },
  {
    name: "the CLI control socket ArdiaControl.sock",
    engine: ["engine/ardiacore-linux/src/ardia/linux/ac_linux_control_core.h", /kSocketName\[\] = "ArdiaControl\.sock";/],
    app: [
      ["apps/cli/nilla_browser_cli/control.py", /^SOCKET_FILE = "ArdiaControl\.sock"$/m],
      ["packages/shell/ios/ControlSocket.swift", /static let socketName = "ArdiaControl\.sock"/],
    ],
  },
  {
    name: "the CLI control file ArdiaControl.json",
    engine: ["engine/chromium/src/chrome/browser/ardia/ac_cli_control.cc", /kControlFileName\[\] = "ArdiaControl\.json";/],
    app: [["apps/cli/nilla_browser_cli/endpoint.py", /^CONTROL_FILE = "ArdiaControl\.json"$/m]],
  },
  {
    name: "the Little window identifier ardia.window.small",
    engine: ["engine/ardiacore/src/ardia/core/ac_video_upscaling.mm", /kLittleArdiaWindow = @"ardia\.window\.small";/],
    app: [["packages/ardiacore/ios/ArdiaEarlyWindow.mm", /little\.window\.identifier = @"ardia\.window\.small";/]],
  },
  {
    name: "the Windows app library ArdiaApp.dll",
    engine: ["scripts/windows/engine/src/ardia/win/main.cc", /path\.append\(L"ArdiaApp\.dll"\);/],
    app: [
      ["apps/browser/windows/NillaLauncher/Launcher.cpp", /directory \+ L"ArdiaApp\.dll";/],
      ["scripts/windows/assemble.ps1", /^\$library = "ArdiaApp\.dll"$/m],
    ],
  },
  ...["ArdiaAppStart", "ArdiaAppPreTranslateMessage", "ArdiaAppStop", "ArdiaAppStartFailure"].map((symbol) => ({
    name: `the Windows app export ${symbol}`,
    engine: ["scripts/windows/engine/src/ardia/win/main.cc", new RegExp(`GetProcAddress\\((?:app\\.)?module, "${symbol}"\\)`)],
    app: [["apps/browser/windows/Ardia/Nilla.cpp", new RegExp(`__declspec\\(dllexport\\) [^\\n(]*\\b${symbol}\\(`)]],
  })),
  {
    name: "the Windows test-build marker Ardia.test-build",
    engine: ["scripts/windows/engine/src/ardia/win/test_gate.h", /kTestBuildMarker\[\] = L"Ardia\.test-build";/],
    app: [
      ["apps/browser/windows/Ardia/TestGate.h", /TestBuildMarker\[\] = L"Ardia\.test-build";/],
      ["scripts/windows/assemble.ps1", /-ieq "Ardia\.test-build"/],
    ],
  },
  {
    name: 'the Windows profile folder prefix "Ardia "',
    engine: ["scripts/windows/engine/src/ardia/win/profiles.cc", /kDirectoryPrefix\[\] = "Ardia ";/],
    app: [
      ["apps/browser/windows/Ardia/EngineHostModule.h", /ProfileFolderPrefix = "Ardia ";/],
      ["packages/expo-windows/src/engine/domains/profiles.ts", /const FOLDER_PREFIX = "Ardia ";/],
    ],
  },
  {
    name: "the ingest key header X-Ardia-Key",
    engine: ["engine/ardiacore-linux/src/ardia/linux/ac_linux_telemetry.cc", /SetHeader\("X-Ardia-Key", ingest_key\)/],
    app: [
      ["packages/core/src/ingestKeys.ts", /^export const INGEST_KEY_HEADER = "X-Ardia-Key";$/m],
      ["apps/cli/nilla_browser_cli/telemetry.py", /^INGEST_KEY_HEADER = "X-Ardia-Key"$/m],
    ],
  },
  {
    name: "the video upscaler trace events ArdiaVSR.*",
    engine: ["engine/ardiacore/src/ardia/core/ac_video_upscaler.mm", /TRACE_EVENT_INSTANT0\("gpu", "ArdiaVSR\.GateOpen"/],
    app: [
      ["apps/browser/scripts/video-upscaling-test.mjs", /String\(e\.name\)\.startsWith\("ArdiaVSR"\)/],
      ["apps/browser/scripts/video-upscaling-test.mjs", /e\.name === `ArdiaVSR\.\$\{n\}`/],
    ],
  },
  {
    name: "the product name Ardia on chrome://version",
    engine: ["engine/patches/build/ardia_namesub.py", /\(r'\(\?<!\[\/\._0-9\]\)Helium\(\?!\[A-Z0-9_\]\)', 'Ardia'\)/],
    app: [
      ["packages/ardiacore/scripts/acceptance.mjs", /!\/\^Ardia\\t\/\.test\(product/],
      ["scripts/release/smoke.mjs", /includes\(`Ardia\\t\$\{chromiumVersion\} \(Official Build\)`\)/],
    ],
  },
  {
    name: "the engine source list ardia_sources",
    engine: ["engine/chromium/src/chrome/browser/ardia/BUILD.gn", /^ardia_sources = \[/m],
    app: [["scripts/linux/syntax_check_156.py", (script, read) => gnSearchesMatch(script, read(LINUX_SYNTAX_GN))]],
  },
  {
    name: "the engine folders the Linux syntax check reads",
    engine: ["engine/ardiacore-linux/src/ardia/linux/BUILD.gn", /^mojom\("page_mojom"\) \{\n  sources = \[ "mojom\/page\.mojom" \]/m],
    app: [["scripts/linux/syntax_check_156.py", syntaxCheckFoldersExist]],
  },
  {
    name: "the upstream engine repo the fetch defaults name",
    engine: ["scripts/linux/fetch-engine.sh", /^repo=\$\{ARDIACORE_PREBUILT_REPO:-ardia-browser\/ardia\}$/m],
    app: [["scripts/lib/releases.sh", /^ENGINE_REPO="ardia-browser\/ardia"$/m]],
  },
];

const LINUX_SYNTAX_GN = "engine/chromium/src/chrome/browser/ardia/BUILD.gn";

function gnSearchesMatch(script, gn) {
  const searches = [...script.matchAll(/re\.search\(r"((?:[^"\\]|\\.)+)", gn, re\.S\)/g)].map((match) => new RegExp(match[1], "s"));
  return gn !== undefined && searches.length >= 2 && searches.every((search) => search.test(gn));
}

function syntaxCheckFoldersExist(script) {
  const bases = { ROOT: "" };
  for (const [, name, base, path] of script.matchAll(/^(\w+) = (ROOT|ENGINE|LINUX) \/ "([^"]+)"$/gm)) if (base in bases) bases[name] = `${bases[base]}${path}/`;
  const read = [...script.matchAll(/\b(ROOT|ENGINE|LINUX|NILLA) \/ "([^"]+)"/g)].map(([, base, path]) => (base in bases ? bases[base] + path : undefined));
  const mojom = /\(LINUX \/ "([^"]+)\/mojom"\)\.glob\("\*\.mojom"\)/.exec(script)?.[1];
  return (
    ["LINUX", "ENGINE", "NILLA"].every((name) => name in bases) &&
    read.length >= 8 &&
    read.every((path) => path !== undefined && existsSync(ROOT + path)) &&
    mojom !== undefined &&
    script.includes(`mojo / "src/${mojom}/mojom" / mojom.name`) &&
    script.includes(`f"src/${mojom}/mojom/{m.name}\\n"`) &&
    script.includes(`(mojo / "gen/${mojom.split("/")[0]}").rglob("*.h")`)
  );
}

function engineContractProblems(read) {
  const problems = [];
  const holds = (pattern, path) => (typeof pattern === "function" ? pattern(read(path) ?? "", read) : pattern.test(read(path) ?? ""));
  for (const { name, engine, app } of ENGINE_CONTRACT) {
    const [enginePath, enginePattern] = engine;
    if (!holds(enginePattern, enginePath)) problems.push(`${name}: ${enginePath} no longer holds it; update the app side with the engine`);
    for (const [path, pattern] of app) if (!holds(pattern, path)) problems.push(`${name}: ${path} must hold the engine's spelling`);
  }
  return problems;
}

const CREDITS = [
  ["NOTICE", /^Ardia\nCopyright 2026 Mantra Patel$/m, "keeps Ardia's NOTICE block"],
  ["README.md", /^## Acknowledgements\n(?:(?!\n#)[\s\S])*\[Ardia\]\(https:\/\/github\.com\/ardia-browser\/ardia\)(?:(?!\n#)[\s\S])*by Mantra Patel and its contributors/m, "thanks Ardia, Mantra Patel and its contributors"],
  ["apps/browser/src/state/app/legalNotice.ts", /"Based on Ardia, © 2026 Mantra Patel\."/, "says About is based on Ardia"],
  ["packages/shell/ios/AppUpdater.swift", /Based on Ardia, © 2026 Mantra Patel\./, "says the Mac About panel is based on Ardia"],
  ["apps/phone/src/components/settings/DataPages.tsx", /\{ name: "Ardia", use: "[^"]+", license: "Apache License 2\.0", url: "https:\/\/github\.com\/ardia-browser\/ardia" \}/, "lists Ardia in the phone's open source licences"],
  ["extras/raycast-nilla/package.json", /"contributors": \[\s*"mantrakp04",\s*"ridemountainpig"/, "keeps the Raycast extension's contributors"],
];

const sorted = (found) =>
  Object.fromEntries(RULES.map((rule) => [rule, Object.fromEntries(Object.entries(found[rule] ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)))]));
const total = (entries = {}) => Object.values(entries).reduce((sum, n) => sum + n, 0);

function compare(baseline, found) {
  const problems = [];
  for (const rule of RULES) {
    const lines = [];
    const paths = new Set([...Object.keys(baseline[rule] ?? {}), ...Object.keys(found[rule])]);
    for (const path of [...paths].sort()) {
      const was = baseline[rule]?.[path] ?? 0;
      const now = found[rule][path] ?? 0;
      if (now > was) lines.push(`  new    ${path}: ${now}${was ? ` (baseline ${was})` : ""}`);
      else if (now < was) lines.push(`  fixed  ${path}: ${now} (baseline ${was}), lower or remove its baseline entry`);
    }
    if (lines.length) problems.push(`${rule} (${lines.length})`, ...lines);
  }
  return problems;
}

function scoreboard(found) {
  return RULES.map((rule) => `${rule} ${Object.keys(found[rule]).length} files / ${total(found[rule])}`).join(", ");
}

function report(found) {
  for (const rule of RULES) {
    console.log(`${rule}: ${Object.keys(found[rule]).length} files, ${total(found[rule])} violations`);
    for (const [path, n] of Object.entries(found[rule])) console.log(`  ${path}: ${n}`);
  }
}

function writeBaseline(fromHead, force) {
  const found = sorted(findViolations(committedFiles(fromHead)));
  let previous = null;
  try {
    previous = JSON.parse(git(["show", `HEAD:${BASELINE_PATH}`]).toString());
  } catch {}
  if (previous) {
    const grown = RULES.filter((rule) => rule in previous && total(found[rule]) > total(previous[rule]));
    const movedOutOfOldLayout = total(found.layout) < total(previous.layout);
    const refused = grown.filter((rule) => !(rule === "imports" && movedOutOfOldLayout));
    for (const rule of RULES) {
      const added = Object.keys(found[rule]).filter((path) => !(path in (previous[rule] ?? {})));
      console.log(`${rule}: ${total(previous[rule])} -> ${total(found[rule])}${added.length ? `, new entries: ${added.join(", ")}` : ""}`);
    }
    if (refused.length && !force) {
      console.error(`Refusing to write: ${refused.join(", ")} grew. Fix the new violations, or pass --force with the owner's OK.`);
      process.exit(1);
    }
  } else report(found);
  writeFileSync(ROOT + BASELINE_PATH, JSON.stringify(found, null, 2) + "\n");
  console.log(`Wrote ${BASELINE_PATH} from ${fromHead ? "HEAD" : "the git index"}: ${scoreboard(found)}`);
}

const fromHead = process.argv.includes("--from-head");
if (process.argv.includes("--write-baseline")) {
  writeBaseline(fromHead, process.argv.includes("--force"));
} else if (process.argv.includes("--report")) {
  const found = sorted(findViolations(fromHead ? committedFiles(true) : workingTreeFiles()));
  report(found);
  const problems = compare(JSON.parse(readFileSync(ROOT + BASELINE_PATH, "utf8")), found);
  console.log(problems.length ? `\nAgainst the baseline:\n${problems.join("\n")}` : "\nMatches the baseline.");
  process.exitCode = problems.length ? 1 : 0;
} else {
  const violationsOf = (path, src) => {
    const found = {};
    checkFile(path, src, (rule, _, n) => {
      if (n > 0) found[rule] = (found[rule] ?? 0) + n;
    });
    return found;
  };
  test("a Swift package manifest's tools version line is a compiler directive", () => {
    assert.deepEqual(violationsOf("packages/phone/ios/PhoneSync/Package.swift", "// swift-tools-version:6.2\nimport PackageDescription\n"), {});
    assert.deepEqual(violationsOf("packages/phone/ios/PhoneSync/Package.swift", "// swift-tools-version:6.2\n// a note\nimport PackageDescription\n"), { comments: 1 });
  });

  test("a closing JSX tag doesn't hide a comment after it", () => {
    assert.deepEqual(violationsOf("apps/browser/src/components/hello/Hello.tsx", "<Text>Hello</Text>; // comment\n"), { comments: 1 });
  });
  test("a closing JSX tag doesn't hide a colour after it", () => {
    assert.deepEqual(violationsOf("apps/browser/src/components/hello/Hello.tsx", '<Text>Hello</Text>; const color = "#ff0000";\n'), { tokens: 1 });
  });
  test("a transparent colour name counts as a colour literal, the word in copy doesn't", () => {
    assert.deepEqual(violationsOf("apps/browser/src/components/hello/Hello.tsx", 'const fill = selected ? theme.card : "transparent";\n'), { tokens: 1 });
    assert.deepEqual(violationsOf("apps/browser/src/components/hello/Hello.tsx", 'const copy = "A transparent toolbar";\n'), {});
  });
  test("scale literals count outside token files, layout geometry and computed values don't", () => {
    const scale = (path, body) => violationsOf(path, `${body}\n`).scale ?? 0;
    const component = "apps/browser/src/components/hello/Hello.tsx";
    assert.equal(scale(component, "<View style={{ padding: 9, gap: space.m, borderRadius: 0 }} />"), 1);
    assert.equal(scale(component, "<View style={{ width: 30, height: 30, top: 4, left: -2, flex: 1 }} />"), 0);
    assert.equal(scale(component, "<Text style={{ fontSize: 12.5, letterSpacing: 0.4, lineHeight: 17 }} />"), 2);
    assert.equal(scale(component, "<Surface cornerRadius={12} shadowRadius={size / 2} />"), 1);
    assert.equal(scale(component, "<View style={{ borderRadius: 10 * g.s, marginTop: -3.5, paddingHorizontal: PAD * 2 }} />"), 2);
    assert.equal(scale(component, "<View style={{ marginTop: active ? 4 : 0, gap: wide ? space.l : space.m }} />"), 1);
    assert.equal(scale(component, "function Plate({ radius = 7, box = 30 }: { radius?: number; box?: number }) {}"), 1);
    assert.equal(scale(component, "const LIFT = spring({ response: 0.2, damping: 0.5 });"), 1);
    assert.equal(scale(component, "Animated.spring(v, { toValue: 1, friction: 9, tension: 60 });"), 2);
    assert.equal(scale(component, "if (gap === 0 || radius !== 4) return;"), 0);
    assert.equal(scale("apps/browser/src/components/hello/tokens.ts", "export const HELLO = { padding: 9, radius: 7 };"), 0);
    assert.equal(scale("apps/browser/src/App.tsx", "<View style={{ paddingTop: 6 }} />"), 1);
    assert.equal(scale("apps/browser/src/lib/hello.ts", "export const ROW = { radius: 7 };"), 0);
  });
  test("an import of a layer's own folder maps to that layer", () => {
    assert.deepEqual(violationsOf("apps/browser/src/components/ui/Button.tsx", 'import { Box } from ".";\n'), {});
    assert.deepEqual(violationsOf("apps/browser/src/platform/launchConfig.ts", 'import { keys } from "../lib";\n'), {});
  });
  test("a store is created curried, with no set/get creator", () => {
    const store = (body) => violationsOf("apps/browser/src/state/hello/store.ts", `import { create } from "zustand";\n${body}\n`);
    assert.deepEqual(store("export const useA = create<{ a: number }>()(() => ({ a: 1 }));"), {});
    assert.deepEqual(store("export const useA = create<Record<string, number>>()(() => ({}));"), {});
    assert.deepEqual(store("export const useA = create<{ a: number }>(() => ({ a: 1 }));"), { "store-shape": 1 });
    assert.deepEqual(store("export const useA = create<{ a: number }>()((set) => ({ a: 1 }));"), { "store-shape": 1 });
    assert.deepEqual(store("export const useA = create((set) => ({ a: 1 }));"), { "store-shape": 1 });
  });
  test("an interpolation after # in a string isn't a colour", () => {
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/ids.ts", "export const id = (repo: string, n: number) => `${repo}#${n}`;\n"), {});
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/ids.ts", 'export const plum = "#C07A98";\n'), { tokens: 1 });
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/ids.ts", "export const anchor = (id: string) => `#${id}`;\n"), {});
  });
  test("a hex string interpolated after # is still a colour", () => {
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/colors.ts", 'export const white = `#${"fff"}`;\n'), { tokens: 1 });
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/colors.ts", 'const hex = "fff";\nexport const color = `#${hex}`;\n'), { tokens: 1 });
  });
  test("a forward declaration of the engine's ArdiaCore classes isn't an app-side class", () => {
    assert.deepEqual(violationsOf("packages/hello/ios/HelloWindow.h", "@class ArdiaCoreTab;\n"), {});
    assert.deepEqual(violationsOf("packages/hello/ios/HelloWindow.h", "@interface ArdiaCoreHello : NSObject\n@end\n"), { naming: 1 });
  });
  test("a component importing a native package is reported, the engine package and subpaths included", () => {
    const imports = (spec) => violationsOf("apps/browser/src/components/hello/Hello.tsx", `import { thing } from "${spec}";\n`);
    for (const spec of ["@ardia/ardiacore", "@ardia/ardiacore/sub", "@nilla/shell", "@nilla/shell/sub", "@nilla/sync", "@nilla/shaders", "@nilla/import", "expo-modules-core"]) {
      assert.deepEqual(imports(spec), { "native-calls": 1 }, spec);
    }
    for (const spec of ["@nilla/core", "@nilla/ardiacore", "@ardia/shell"]) assert.deepEqual(imports(spec), {}, spec);
    assert.deepEqual(violationsOf("apps/browser/src/platform/hello.ts", 'import { thing } from "@nilla/shell/sub";\n'), {});
  });
  test("components neither write a store nor subscribe to the workspace store directly", () => {
    const component = (body) => violationsOf("apps/browser/src/components/hello/Hello.tsx", `${body}\n`);
    assert.deepEqual(component("useSidebarUi.setState({ hover: null });"), { "set-state": 1 });
    assert.deepEqual(component("const tab = useBrowser((s) => s.tabs[id]);"), { "store-reads": 1 });
    assert.deepEqual(component("const tab = useTab(id, (t) => t?.title);"), {});
  });
  test("components reach platform/ only through state, except the dev harness", () => {
    const imports = (path, spec) => violationsOf(path, `import { webviews } from "${spec}";\n`);
    assert.deepEqual(imports("apps/browser/src/components/find/FindBar.tsx", "../../platform/webviews"), { imports: 1 });
    assert.deepEqual(imports("apps/browser/src/components/settings/panes/Passwords.tsx", "../../../platform/importModule"), { imports: 1 });
    assert.deepEqual(imports("apps/browser/src/components/find/FindBar.tsx", "../../state/tabs/webviewHandles"), {});
    assert.deepEqual(imports("apps/browser/src/components/dev/devHarness.ts", "../../platform/webviews"), {});
    assert.deepEqual(imports("apps/browser/src/components/dev/DevPanel.tsx", "../../platform/webviews"), { imports: 1 });
    assert.deepEqual(imports("apps/browser/src/state/tabs/webviewHandles.ts", "../../platform/webviews"), {});
  });
  test("only the engine's named environment reads are exempt", () => {
    const delegate = "engine/ardiacore/src/ardia/core/ac_main_delegate.cc";
    const policy = "engine/chromium/src/chrome/browser/ardia/ac_scripts_policy.cc";
    const create = "  std::unique_ptr<base::Environment> env = base::Environment::Create();\n";
    assert.deepEqual(violationsOf(delegate, create), {});
    assert.deepEqual(violationsOf(delegate, `${create}  const char* port = getenv("PORT");\n`), { env: 1 });
    assert.deepEqual(violationsOf(policy, '    if (const char* home = getenv("HOME")) {\n'), {});
    assert.deepEqual(violationsOf(policy, '    const char* user = getenv("USER");\n'), { env: 1 });
    assert.deepEqual(violationsOf("engine/chromium/src/chrome/browser/ardia/ac_other.cc", '    if (const char* home = getenv("HOME")) {\n'), { env: 1 });
  });
  test("the residual-name gate covers a name only with an allowlist entry, a kept path or a protected token", () => {
    const allowlist = namingAllowlist({
      paths: { frozen: ["engine/*"], keep: [], lead: [], generated: [], finalByD: ["README.md"], skipTree: [], skipHand: { "scripts/linux/package.py": "C-linux" } },
      moves: { componentMaps: [{ match: "^apps/cli/ardia_cli$", replace: "nilla_browser_cli" }], componentCase: [["Ardia", "Nilla"], ["ardia", "nilla"]] },
      protect: [
        { id: "env", regex: "ARDIA_[A-Z_]*" },
        { id: "core", regex: "(?i)[a-z]*ardiacore[a-z]*" },
        { id: "word", text: "ArdiaShell", scope: ["apps/linux/*"] },
        { id: "cli", regex: "(?i)ardia", scope: ["apps/cli/ardia_cli/upstream.py"] },
      ],
      lines: [{ path: "apps/browser/src/state/report/actions.ts", text: 'const URL = "https://ardia.dev";' }],
    });
    const files = [
      ["engine/x.cc", "ardia"],
      ["scripts/linux/package.py", "ardia"],
      ["README.md", "Ardia"],
      ["apps/browser/src/a.ts", "ARDIA_DATA_DIR ArdiaCoreTab NillaShell"],
      ["apps/linux/src/b.ts", '"ArdiaShell.quit"'],
      ["apps/cli/nilla_browser_cli/upstream.py", "an installed Ardia"],
      ["apps/browser/src/state/report/actions.ts", 'const URL = "https://ardia.dev";\nconst other = "https://ardia.dev";'],
      ["apps/browser/src/c.ts", 'const a = "ArdiaShell";\nconst b = "Netnyahoo";'],
    ];
    assert.deepEqual(residualNames(allowlist, files), [
      "scripts/linux/package.py:1: ardia",
      "README.md:1: Ardia",
      'apps/browser/src/state/report/actions.ts:2: const other = "https://ardia.dev";',
      'apps/browser/src/c.ts:1: const a = "ArdiaShell";',
      'apps/browser/src/c.ts:2: const b = "Netnyahoo";',
    ]);
  });
  test("every Ardia or Netnyahoo name left is one the naming allowlist keeps", () => {
    const allowlist = namingAllowlist(JSON.parse(readFileSync(ROOT + NAMING_ALLOWLIST_PATH, "utf8")));
    const uncovered = residualNames(allowlist, filesNamingTheUpstream());
    assert.equal(uncovered.length, 0, `Names outside ${NAMING_ALLOWLIST_PATH} (docs/conventions.md › Names):\n${uncovered.join("\n")}`);
  });
  test("every naming allowlist line is still in its file", () => {
    const stale = staleLines(JSON.parse(readFileSync(ROOT + NAMING_ALLOWLIST_PATH, "utf8")));
    assert.equal(stale.length, 0, `Lines entries in ${NAMING_ALLOWLIST_PATH} that no longer match a line (regenerate the allowlist):\n${stale.join("\n")}`);
  });
  test("the app keeps every name today's engines read, spelled as the engines spell it", () => {
    const read = (path) => (existsSync(ROOT + path) ? readFileSync(ROOT + path, "utf8") : undefined);
    const problems = engineContractProblems(read);
    assert.equal(problems.length, 0, `Engine contract (docs/conventions.md › Names):\n${problems.join("\n")}`);
    const renamed = (path) => read(path)?.replace(/Ardia/g, "Nilla").replace(/ardia/g, "nilla");
    const broken = engineContractProblems((path) => (path.startsWith("engine/") || path.startsWith("scripts/windows/engine/") || path === "scripts/linux/fetch-engine.sh" ? read(path) : renamed(path)));
    assert.equal(broken.length, ENGINE_CONTRACT.reduce((sum, { app }) => sum + app.length, 0), `a renamed app side fails every row:\n${broken.join("\n")}`);
  });
  test("Nilla keeps its credit to Ardia", () => {
    for (const [path, credit, what] of CREDITS) assert.match(readFileSync(ROOT + path, "utf8"), credit, `${path} ${what}`);
    const [readmePath, readmeCredit] = CREDITS.find(([path]) => path === "README.md");
    const creditMovedOut = readFileSync(ROOT + readmePath, "utf8").replace("## Acknowledgements\n", "## Acknowledgements\n\nNo credits here.\n\n## Engine source\n");
    assert.doesNotMatch(creditMovedOut, readmeCredit, "the README credit counts only inside its Acknowledgements section");
  });
  test("conventions hold, except what the baseline lists", (t) => {
    const baseline = JSON.parse(readFileSync(ROOT + BASELINE_PATH, "utf8"));
    const found = findViolations(workingTreeFiles());
    t.diagnostic(scoreboard(found));
    const problems = compare(baseline, found);
    assert.equal(
      problems.length,
      0,
      `Conventions check (docs/conventions.md). New violations fail; fixed ones must leave the baseline (node apps/browser/src/conventions.test.mjs --write-baseline):\n${problems.join("\n")}`,
    );
  });
}
