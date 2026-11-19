#!/usr/bin/env bash
set -euo pipefail
usage='usage: launch-dev.sh [ENGINE ARG]...

The launcher exercise-linux.mjs starts inside nilla-isolate. It runs the
extracted package NILLA_APP (default $ISOLATE_RUN/pkg/ardia) through
NILLA_REPO/scripts/linux/nilla-dev-run (NILLA_REPO defaults to
/home/noor/Code/ardia), with ARDIA_DATA_DIR=$ISOLATE_RUN/dev/data and
ARDIA_CONFIG_HOME=$ISOLATE_RUN/dev/config, and passes every argument on to
the engine. It refuses to run outside nilla-isolate (no ISOLATE_RUN).'

case "${1:-}" in -h|--help) echo "$usage"; exit 0 ;; esac
[ -n "${ISOLATE_RUN:-}" ] || { echo "launch-dev.sh: ISOLATE_RUN is unset; run it inside nilla-isolate" >&2; exit 64; }
repo=${NILLA_REPO:-/home/noor/Code/ardia}
app=${NILLA_APP:-$ISOLATE_RUN/pkg/ardia}
export ARDIA_DATA_DIR="$ISOLATE_RUN/dev/data" ARDIA_CONFIG_HOME="$ISOLATE_RUN/dev/config"
exec bash "$repo/scripts/linux/nilla-dev-run" "$app" "$@"
