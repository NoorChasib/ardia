import { isAbsolute, resolve } from "node:path";

export const USAGE = `Ardia Linux native acceptance suite

Usage: bun run acceptance:linux <executable> [uiDir] [options]

Run it from the repository root, from apps/linux, or from a folder with no
package.json of its own. Bun runs a script in the folder of the package.json
that defines it and sets no INIT_CWD, so relative paths resolve against the
repository root, or against apps/linux when run there. Under a runner that sets
INIT_CWD (npm), they resolve against INIT_CWD.

Runs each feature issue's runtime acceptance scenarios headlessly against a packaged
Linux Ardia build with throwaway profiles, and prints per-issue results as JSON.

Options:
  --only F01,F03,#33   Run only these findings or issue numbers
  --results <dir>      Write evidence and results.json here (default: a new temp dir)
  --keep               Keep every scratch profile, not just failing ones
  --list               List the scenarios and exit
  --quiet              No progress lines on stderr
  --help               Show this help

Exit status: 0 when no issue failed, 1 when any failed, 2 on a usage error.
`;

export class UsageError extends Error {}

export function parseArgs(argv, { cwd = process.env.INIT_CWD || process.cwd() } = {}) {
  const options = { executable: null, uiDir: null, only: [], results: null, keep: false, list: false, help: false, quiet: false };
  const positional = [];
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--only" || arg.startsWith("--only=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args.shift();
      const ids = value?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
      if (!ids.length) throw new UsageError("--only needs a list such as F01,F03");
      options.only.push(...ids);
    } else if (arg === "--results" || arg.startsWith("--results=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args.shift();
      if (!value) throw new UsageError("--results needs a directory");
      options.results = isAbsolute(value) ? value : resolve(cwd, value);
    } else if (arg.startsWith("-")) throw new UsageError(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 2) throw new UsageError(`Unexpected argument ${positional[2]}`);
  const [executable, uiDir] = positional.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)));
  options.executable = executable ?? null;
  options.uiDir = uiDir ?? null;
  if (!options.help && !options.list && !options.executable) throw new UsageError("Pass the packaged Linux Ardia executable");
  return options;
}
