#!/usr/bin/env bash
set -uo pipefail
root=$1
logs=$2
mkdir -p "$logs"
export PYTHONDONTWRITEBYTECODE=1
cd "$root/engine/ardiacore-linux/tests"
ls test_*.py | sed 's/\.py$//' | grep -vx test_live | taskset -c 0-13 xargs -P 12 -I{} sh -c \
  'timeout 560 python3 -m unittest {} >"$1/ardiacore-linux-{}.log" 2>&1; echo "$? ardiacore-linux-{}"' sh "$logs" >"$logs/results.txt"
cd "$root"
for suite in engine/patches/build/tests engine/chromium/src/chrome/browser/ardia/tests; do
  name=$(echo "$suite" | tr '/' '-')
  timeout 560 taskset -c 0-13 python3 -m unittest discover -s "$suite" >"$logs/$name.log" 2>&1
  echo "$? $name" >>"$logs/results.txt"
done
sort -k2 "$logs/results.txt" -o "$logs/results.txt"
awk '{ print ($1 == 0 ? "ok" : "FAIL"), $2 }' "$logs/results.txt" | sort | uniq -c -w4 | head
