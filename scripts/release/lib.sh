root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
. "$root/scripts/lib/releases.sh"
macos="$root/apps/browser/macos"
ardiacore="$root/packages/ardiacore"

die() { echo "error: $*" >&2; exit 1; }

notary_setup_hint="set NOTARY_KEY, NOTARY_KEY_ID and NOTARY_ISSUER, or NOTARY_PROFILE, in scripts/.notary.env or the environment"

load_notary_auth() {
  if [ -f "$root/scripts/.notary.env" ]; then . "$root/scripts/.notary.env"; fi
  if [ -n "${NOTARY_KEY:-}" ]; then
    notary_auth=(--key "$NOTARY_KEY" --key-id "${NOTARY_KEY_ID:?NOTARY_KEY needs NOTARY_KEY_ID}" --issuer "${NOTARY_ISSUER:?NOTARY_KEY needs NOTARY_ISSUER}")
  elif [ -n "${NOTARY_PROFILE:-}" ]; then
    notary_auth=(--keychain-profile "$NOTARY_PROFILE")
  else
    notary_auth=()
  fi
}

has_notary_auth() { [ "${#notary_auth[@]}" -gt 0 ]; }

sign_as() {
  local identity="$1" attempt
  shift
  for attempt in 1 2 3 4 5; do
    codesign --force --timestamp --sign "$identity" "$@" && return 0
    echo "    signing failed (attempt $attempt), likely no timestamp from Apple; retrying" >&2
    sleep 5
  done
  die "couldn't sign ${*: -1}"
}

grants_browser_passkeys() {
  security cms -D -i "$1" 2>/dev/null \
    | plutil -extract 'Entitlements.com\.apple\.developer\.web-browser\.public-key-credential' raw -o - - 2>/dev/null | grep -qx true
}
