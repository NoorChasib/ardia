#!/usr/bin/env bash
set -uo pipefail
root=$1
cd "$root"
check() {
  local name=$1 pattern=$2
  shift 2
  local hits
  hits=$(git grep -n -I -P -e "$pattern" HEAD -- "$@" ':!engine' ':!scripts/windows/engine' 2>/dev/null | sed 's/^HEAD://')
  local before
  before=$(git grep -c -I -P -e "$pattern" HEAD~1 -- "$@" ':!engine' ':!scripts/windows/engine' 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
  local n
  n=$(printf '%s' "$hits" | grep -c . )
  printf '%-34s %5s (base %s)\n' "$name" "$n" "$before"
  if [ "$n" -gt 0 ]; then printf '%s\n' "$hits" | head -6 | cut -c1-200 | sed 's/^/      /'; fi
}
check "S env NILLA_" '(?<![A-Za-z0-9_])NILLA_[A-Z0-9_]'
check "S switch --nilla-" '--nilla-[a-z]'
check "S bare switch names" '(?<![A-Za-z0-9_-])nilla-(?:ui-dir|data-dir|downloads-dir|content-blocker-dir|switches|trace|test-instance|test-cast-sink|background|sandbox-decision|keyboard-diagnostics|hyprland)'
check "R nillacore" '(?i)nillacore'
check "R g_nilla_" 'g_nilla_'
check "R engine paths" '(?:chrome/browser|chrome/app/theme)/nilla|(?<![@\w.-])nilla/(?:core|linux|win)/'
check "R @nilla/nillacore" '@nilla\\?/(?:ardia|nilla)core'
check "C globals" '__nilla|nillaRequest|nillaOffscreen|nilla\.elementPicker'
check "D DOM hooks" 'nilla-(?:reveal|hide-element|pip-|ver\b|symbols|blocking-off)|data-nilla-bridge'
check "I uBO key" 'nillaReloadPending'
check "A rendezvous" 'NillaControl|/nilla/active'
check "B profile files" 'Nilla Tab History'
check "E window ids" 'nilla\.window\.small|NillaHostedPage|NillaProbe|NillaHTM'
check "F scheme" 'nilla://|nilla:\\/\\/|chrome://nilla|/nilla-oauth|nilla-linux-bridge'
check "G little links / webstore" 'setLittleNillaOpensNewTabLinks|(?:Add to|Remove from) Nilla'
check "H Linux module names" '(?<![A-Za-z0-9_$])Nilla(?!Error\b)[A-Z]\w*' apps/linux scripts/linux 'docs/linux-*.md'
check "H Linux Nilla[ prefix" '/\^Nilla\[|"Default", "Nilla"' apps/linux scripts/linux
check "J plist" 'NillaPictureInPicture\.plist'
check "M asserted lines" 'FEEDBACK_URL = "https://nilla|INGEST_KEY_HEADER = "X-Nilla|const (?:APP|SHELL)_PARTS = \["Nilla'
check "N Linux layout" '(?:usr/)?(?:lib|share|apparmor\.d|opt)/nilla\b|nilla\.desktop|Package: nilla|nilla-launch|nilla\.apparmor|dev\.nilla\.linux' apps/linux scripts/linux 'docs/linux-*.md' apps/cli docs/cli.md
check "N CLI artifacts" 'nilla-cli-|nilla-cli\.sha256|/nilla/cli\b|\.config/nilla|\.local/share/nilla'
check "O frozen tokens" 'NillaApp(?:Run|Start|Stop|PreTranslate)|NillaEngineApi|nillaPageColor|(?i)nillapagecolor'
check "P windows" 'Nilla\.test-build|NillaApp\.dll|windows/Nilla/|Nilla\.ico|IDR_NILLA'
check "Q engine strings" 'allowed for the nilla command|on a tab the nilla command|Nilla Safe Storage|Nilla Test Sink|Nilla Scripts|ms for a previous Nilla'
check "T header" '(?i)x[-_]nilla[-_]key'
check "U hosts" '(?i)nilla\.dev\b|nilla\.app\b'
check "K brand folder" 'brand/nilla'
check "K basenames (ardiacore files)" 'packages/ardiacore/ios/Nilla|NillaLaunchConfig\\\.'
check "V false positives" '(?i)gunillan|lombnilla|cnillac|ancnilla'
check "V credit row" 'name: "Nilla", use: copy'
check "V engine-fetch lines" "vars\\.(?:ARDIACORE_PREBUILT_REPO|WINDOWS_ENGINE_REPO) \\|\\| 'NoorChasib"
