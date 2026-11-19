#!/usr/bin/env bash
set -euo pipefail
usage='usage: baseline-linux.sh --package TARBALL --run DIR [--idle-seconds N] [--proxy-mode MODE] [--repo DIR]
                          [--python PATH] [--sharing on|off]

The no-upstream exercise for the Linux app (plan 2.6 items 9 and 10), in one
command. Inside nilla-isolate --net --display it extracts TARBALL (a
scripts/linux/package.py tarball) into DIR/pkg and runs exercise-linux.mjs
with launch-dev.sh as the launcher, which starts DIR/pkg/ardia through the
repo'"'"'s scripts/linux/nilla-dev-run with ARDIA_DATA_DIR and ARDIA_CONFIG_HOME
under DIR/dev (a bare bin/ardia launch stops before the engine). The cli
step runs the repo'"'"'s CLI with PATH (default
/home/noor/ardia-work/venv-cli/bin/python), whose virtualenv is bound
read-only. --sharing on (default off) runs the app with a saved choice that
shares usage, for the exercise'"'"'s consent step. Afterwards it writes check-upstream.py'"'"'s report to DIR/check.md
and DIR/check.json. Exits with check-upstream.py'"'"'s status (0 clean, 1
upstream attempts, 2 isolation broken), or the exercise'"'"'s failure status
when the app could not be driven.'

here=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
package="" run="" idle=300 mode=block-upstream repo=/home/noor/Code/ardia python=/home/noor/ardia-work/venv-cli/bin/python sharing=off
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) echo "$usage"; exit 0 ;;
    --package) package=$(readlink -f "$2"); shift 2 ;;
    --run) run=$2; shift 2 ;;
    --idle-seconds) idle=$2; shift 2 ;;
    --proxy-mode) mode=$2; shift 2 ;;
    --repo) repo=$(readlink -f "$2"); shift 2 ;;
    --python) python=$2; shift 2 ;;
    --sharing) sharing=$2; shift 2 ;;
    *) echo "$usage" >&2; exit 64 ;;
  esac
done
[ -n "$package" ] && [ -n "$run" ] && [ -f "$package" ] || { echo "$usage" >&2; exit 64; }

set +e
venv=$(dirname "$(dirname "$python")")
"$here/nilla-isolate" --run "$run" --net --display --proxy-mode "$mode" --bind-ro "$(dirname "$package")" --bind-ro "$repo" --bind-ro "$venv" -- \
  bash -c 'set -e; mkdir -p "$ISOLATE_RUN/pkg"; tar -xJf "$1" -C "$ISOLATE_RUN/pkg"; export NILLA_REPO="$3" NILLA_APP="$ISOLATE_RUN/pkg/ardia"; exec node "$2/exercise-linux.mjs" --repo "$3" --launcher "$2/launch-dev.sh" --results "$ISOLATE_RUN/exercise" --idle-seconds "$4" --python "$5" --sharing "$6"' \
  exercise "$package" "$here" "$repo" "$idle" "$python" "$sharing"
exercise_status=$?
set -e
run=$(readlink -f "$run")
rm -rf "$run/pkg"
set +e
python3 "$here/check-upstream.py" "$run" --json "$run/check.json" > "$run/check.md"
check_status=$?
set -e
cat "$run/check.md"
echo "baseline-linux: exercise exit $exercise_status, check exit $check_status" >&2
if [ "$exercise_status" = 3 ] || [ "$check_status" = 2 ]; then exit 2; fi
[ "$exercise_status" = 0 ] || exit "$exercise_status"
exit "$check_status"
