#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun run check
for project in apps/phone apps/dashboard apps/videos apps/site; do
  [ -x "$project/node_modules/.bin/tsc" ] || { echo "$project is not installed: run bun install --frozen-lockfile --cwd $project" >&2; exit 1; }
  echo "== $project"
  bun run --cwd "$project" check
done
