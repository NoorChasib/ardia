#!/usr/bin/env bash
# Puts the licence texts a Mac app ships with in <app>/Contents/Resources/Licenses, or checks they are there.
#
#   scripts/release/licenses.sh copy <Nilla.app>
#   scripts/release/licenses.sh check <Nilla.app>
#
# The files: LICENSE, LICENSE.Apache-2.0 and NOTICE from the repo root, and third_party/bangs/LICENSE as bangs-LICENSE.
# check compares each byte for byte with the repo's and fails on a missing, changed or extra file.
set -euo pipefail

usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0" >&2
  exit 64
}
[ $# -eq 2 ] || usage
mode="$1"
app="$2"
root="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$app/Contents/Resources/Licenses"
names=(LICENSE LICENSE.Apache-2.0 NOTICE bangs-LICENSE)
sources=("$root/LICENSE" "$root/LICENSE.Apache-2.0" "$root/NOTICE" "$root/third_party/bangs/LICENSE")

case "$mode" in
  copy)
    [ -d "$app/Contents" ] || { echo "licenses.sh: $app is not an app bundle" >&2; exit 1; }
    rm -rf "$dir"
    mkdir -p "$dir"
    for i in "${!names[@]}"; do cp "${sources[$i]}" "$dir/${names[$i]}"; done
    ;;
  check)
    for i in "${!names[@]}"; do
      cmp -s "${sources[$i]}" "$dir/${names[$i]}" || { echo "licenses.sh: $dir/${names[$i]} is missing or differs from the repo's" >&2; exit 1; }
    done
    extra="$(cd "$dir" && ls -A | grep -vxF -e LICENSE -e LICENSE.Apache-2.0 -e NOTICE -e bangs-LICENSE || true)"
    [ -z "$extra" ] || { echo "licenses.sh: $dir has files it shouldn't: $extra" >&2; exit 1; }
    ;;
  *) usage ;;
esac
