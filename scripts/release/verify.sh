#!/usr/bin/env bash
set -euo pipefail

usage="usage: scripts/release/verify.sh <exported Nilla.app> <archive> <version> <build number>
       scripts/release/verify.sh --dev <Nilla.app>"
if [ "${1:-}" = --dev ]; then
  app="${2:?$usage}"
  . "$(dirname "$0")/lib.sh"
  . "$(dirname "$0")/../lib/identity.sh"
  echo "==> Verify (development build)"
  [ -f "$app/Contents/Info.plist" ] || die "$app has no Contents/Info.plist"
  python3 - "$app/Contents/Info.plist" "$NILLA_BUNDLE_ID" <<'PY' || exit 1
import plistlib, sys
info = plistlib.load(open(sys.argv[1], "rb"))
problems = []
def expect(key, want):
    if info.get(key) != want:
        problems.append(f"{key} is {info.get(key)!r}, not {want!r}")
expect("CFBundleIdentifier", sys.argv[2])
expect("CFBundleExecutable", "Nilla")
expect("CFBundleName", "Nilla")
expect("CFBundleDisplayName", "Nilla")
for key in ("SUFeedURL", "SUPublicEDKey", "NLReportServerURL", "NLReleaseNotesURL"):
    if info.get(key, "") != "":
        problems.append(f"{key} is {info[key]!r}; a development build has no update, report or release-notes server")
schemes = sorted({s for t in info.get("CFBundleURLTypes", []) for s in t.get("CFBundleURLSchemes", [])})
if schemes != ["file", "http", "https"]:
    problems.append(f"the app registers the URL schemes {schemes}, not only file, http and https")
for problem in problems:
    print(f"error: {problem}", file=sys.stderr)
sys.exit(1 if problems else 0)
PY
  [ -x "$app/Contents/MacOS/Nilla" ] || die "no executable Contents/MacOS/Nilla"
  "$root/scripts/release/licenses.sh" check "$app" || die "the app's Contents/Resources/Licenses doesn't match the repo"
  echo "ok: $app"
  exit 0
fi
app="${1:?$usage}"
archive="${2:?$usage}"
version="${3:?$usage}"
release_build="${4:?$usage}"
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/../lib/identity.sh"
[ -n "$NILLA_TEAM_ID" ] || die "NILLA_TEAM_ID is empty: a Developer ID build needs the owner's team id"
channel="$(channel_of "$version")"
fwv="$(cd "$app/Contents/Frameworks/Chromium Framework.framework/Versions/Current" && pwd -P)"

echo "==> Verify"
codesign --verify --deep --strict "$app"
[ -d "$archive/dSYMs/Nilla.app.dSYM" ] || die "the archive has no Nilla.app.dSYM"
entitlements() { codesign -d --entitlements - --xml "$1" 2>/dev/null; }
info() { plutil -extract "$1" raw "$app/Contents/Info.plist" 2>/dev/null; }
[ "$(info CFBundleIdentifier)" = "$NILLA_BUNDLE_ID" ] || die "bundle id is $(info CFBundleIdentifier)"
[ "$(info CFBundleExecutable)" = Nilla ] || die "executable is $(info CFBundleExecutable)"
[ "$(info CFBundleShortVersionString)" = "$version" ] || die "CFBundleShortVersionString is $(info CFBundleShortVersionString)"
[ "$(info CFBundleVersion)" = "$release_build" ] || die "CFBundleVersion is $(info CFBundleVersion), not $release_build"
[ "$(info ACUpdateChannel)" = "$channel" ] || die "ACUpdateChannel is '$(info ACUpdateChannel)', not $channel"
for key in SUFeedURL SUPublicEDKey NSDockTilePlugIn NSCameraUsageDescription NSMicrophoneUsageDescription \
  NSBluetoothAlwaysUsageDescription NSLocationUsageDescription NSLocalNetworkUsageDescription; do
  [ -n "$(info "$key")" ] || die "Info.plist has no $key"
done
[ -d "$app/Contents/Frameworks/Sparkle.framework" ] || die "no Sparkle.framework"
[ -d "$app/Contents/PlugIns/NillaDockTile.plugin" ] || die "no dock tile plug-in"
[ ! -e "$app/Contents/Helpers/NillaFairPlay.app" ] || die "the removed FairPlay helper is still in the app"
[ -f "$app/Contents/embedded.provisionprofile" ] || die "no Developer ID provisioning profile (keychain groups need it)"
[ -f "$app/Contents/Resources/Extensions/ublock/manifest.json" ] || die "no uBlock Origin in the app"
[ -f "$app/Contents/Resources/ContentRules/rulesets.json" ] || die "no WebKit content rules in the app"
"$root/scripts/release/licenses.sh" check "$app" || die "the app's Contents/Resources/Licenses doesn't match the repo"
designated="$(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p')"
[[ "$designated" == *"identifier \"$NILLA_BUNDLE_ID\""* && "$designated" == *"subject.OU] = $NILLA_TEAM_ID"* ]] \
  || die "designated requirement: $designated"
app_ents="$(entitlements "$app")"
for group in webauthn unexportable-keys secure-payment-confirmation; do
  [[ "$app_ents" == *"$NILLA_TEAM_ID.$NILLA_BUNDLE_ID.$group"* ]] || die "the app lacks the keychain group …$group"
done
if grants_browser_passkeys "$app/Contents/embedded.provisionprofile"; then
  [[ "$app_ents" == *web-browser.public-key-credential* ]] || die "the profile grants browser passkeys but the app isn't signed with them"
else
  [[ "$app_ents" != *web-browser.public-key-credential* ]] || die "the app is signed with com.apple.developer.web-browser.public-key-credential, which its profile doesn't grant"
fi
for helper in "$fwv"/Helpers/*"Renderer).app" "$fwv"/Helpers/*"GPU).app"; do
  [[ "$(entitlements "$helper")" == *cs.allow-jit* ]] || die "$(basename "$helper") lost allow-jit"
done
while IFS= read -r -d '' code; do
  details="$(codesign -dvv "$code" 2>&1)"
  [[ "$details" == *"TeamIdentifier=$NILLA_TEAM_ID"* && "$details" == *"Authority=Developer ID Application"* \
    && "$details" == *"Timestamp="* ]] || die "$code isn't Developer ID-signed with a timestamp"
  [[ "$(entitlements "$code")" != *get-task-allow* ]] || die "$code has get-task-allow"
done < <(find "$app" \( -name "*.app" -o -name "*.framework" -o -name "*.dylib" -o -name "*.xpc" -o -name "*.plugin" \
  -o -path "*/Helpers/*" -type f -perm -u+x -o -path "*/MacOS/*" -type f \) -print0)
