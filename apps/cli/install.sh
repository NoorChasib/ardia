#!/bin/sh
# Installs the nilla-browser command, which controls a running Nilla from the terminal.
#
#   install.sh [--version V] [--sha256 DIGEST] [--uninstall]
#   install.sh -h | --help
#
# --version V        the version the tarball holds (default: read from the tarball's name).
# --sha256 DIGEST    the tarball's digest (default: read from $ARDIA_CLI_URL.sha256).
# --uninstall        remove the installed CLI and its nilla-browser link.
#
# This development build installs only from a local tarball: ARDIA_CLI_URL must be a file:// URL, and nothing is
# downloaded. It never creates, replaces or removes an ardia link.
#
# Runs on macOS (Apple silicon) and Linux (x86_64). Installs into $ARDIA_CLI_HOME/<version> (default
# ~/Library/Application Support/Nilla/CLI on macOS; on Linux this development build has no default and needs
# ARDIA_CLI_HOME), points its `current` link there and links ${ARDIA_CLI_BIN_DIR:-~/.local/bin}/nilla-browser to
# current/bin/ardia. When the default bin dir isn't on the login shell's PATH, it adds one PATH line to its login
# file, once: on macOS ~/.zprofile
# (~/.bash_profile for bash); on Linux ~/.zprofile for zsh, ~/.bash_profile for bash when it exists, else ~/.profile;
# for fish, on both, ${XDG_CONFIG_HOME:-~/.config}/fish/conf.d/nilla-browser.fish.
# It refuses a CLI home or bin dir that resolves (through links, on macOS in any letter case) into an installed
# Ardia's folders, and a path it can't resolve. It marks the CLI home with a .nilla-cli file and refuses a CLI home
# that holds an install without one, so it never replaces, prunes or removes another install's versions; the mark
# never makes an Ardia folder its own.
# Re-running it upgrades: a version that is already current is left alone; a new one is verified, staged in
# <version>.partial, renamed, and `current` is swapped atomically (a running nilla-browser keeps its old dir). It keeps the
# current and the previous version and prunes the rest, except versions a running nilla-browser uses (it leaves a lease in
# <version>/.leases/<pid>, live while that pid runs and started before the lease was written). Two runs never overlap:
# each holds a flock on $ARDIA_CLI_HOME/.lock (lockf on macOS, flock on Linux), which the kernel drops when
# the run exits.
# The installed version is `basename "$(readlink "$ARDIA_CLI_HOME/current")"`. It runs nothing after the link: no skill
# install or refresh and no cua-driver refresh, since those can download. --uninstall also removes
# $ARDIA_CLI_HOME/cua-driver and the cua-driver link in the bin dir when it is this CLI's, and leaves /Applications/CuaDriver.app.
# ARDIA_CLI_URL names the tarball; without --sha256 its checksum is read from $ARDIA_CLI_URL.sha256.
#
# Prints one line per event: `step resolve|download|verify|install|link`, `version <v>`, `path <rc file>`,
# then `installed <bin path>` (or `uninstalled`), or `error <message>` and exits 1.
set -eu
umask 022

version_pattern='^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-[a-z]{1,16}\.[0-9]{1,4})?$'
if [ "$(uname -s)" = Linux ]; then
  os=linux
  asset_platform=linux-x64
  cli_home=${ARDIA_CLI_HOME:-}
else
  os=macos
  asset_platform=macos-arm64
  cli_home=${ARDIA_CLI_HOME:-$HOME/Library/Application Support/Nilla/CLI}
fi
asset_suffix=-$asset_platform.tar.gz
default_bin_dir=$HOME/.local/bin
bin_dir=${ARDIA_CLI_BIN_DIR:-$default_bin_dir}
version=
pinned_sha=
uninstall=0
work=
reported=0

help() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit 0
}

fail() {
  reported=1
  printf 'error %s\n' "$*"
  exit 1
}

finish() {
  status=$?
  [ -n "$work" ] && rm -rf "$work"
  if [ "$status" -ne 0 ] && [ "$reported" -eq 0 ]; then
    printf 'error install stopped (exit %s)\n' "$status"
  fi
}
trap finish EXIT
trap 'exit 130' INT TERM HUP

is_version() {
  printf '%s\n' "$1" | grep -Eq "$version_pattern"
}

while [ $# -gt 0 ]; do
  case $1 in
    --version) [ $# -ge 2 ] || fail "--version needs a value"; version=${2#v}; shift 2 ;;
    --version=*) version=${1#--version=}; version=${version#v}; shift ;;
    --sha256) [ $# -ge 2 ] || fail "--sha256 needs a value"; pinned_sha=$2; shift 2 ;;
    --sha256=*) pinned_sha=${1#--sha256=}; shift ;;
    --uninstall) uninstall=1; shift ;;
    -h|--help) help ;;
    *) fail "unknown option: $1" ;;
  esac
done

if [ -n "$version" ] && ! is_version "$version"; then
  fail "bad version: $version"
fi
if [ -n "$pinned_sha" ] && ! printf '%s\n' "$pinned_sha" | grep -Eq '^[0-9a-f]{64}$'; then
  fail "bad --sha256 digest: $pinned_sha"
fi
if [ -z "$cli_home" ]; then
  fail "set ARDIA_CLI_HOME to a folder of Nilla's own: on Linux this development build never guesses, so it never installs into an installed Ardia's ~/.local/share/ardia/cli"
fi

xdg_or() {
  case $1 in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$2" ;;
  esac
}

upstream_folders() {
  printf '%s/ardia\n' "$(xdg_or "${XDG_CONFIG_HOME:-}" "$HOME/.config")" "$HOME/.config" \
    "$(xdg_or "${XDG_DATA_HOME:-}" "$HOME/.local/share")" "$HOME/.local/share" \
    "$(xdg_or "${XDG_STATE_HOME:-}" "$HOME/.local/state")" "$HOME/.local/state" \
    "$(xdg_or "${XDG_CACHE_HOME:-}" "$HOME/.cache")" "$HOME/.cache"
  printf '%s\n' "$HOME/Library/Application Support/Ardia" "$HOME/Library/Application Support/com.ardia.browser" \
    "$HOME/Library/Logs/Ardia"
}

real_path() {
  path=$1
  while [ "$path" != / ] && [ "${path%/}" != "$path" ]; do
    path=${path%/}
  done
  case $path in
    /*) ;;
    *) return 1 ;;
  esac
  case $path/ in
    */./*|*/../*|*//*) [ "$path" = / ] || return 1 ;;
  esac
  rest=
  while ! [ -d "$path" ]; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      return 1
    fi
    rest=/${path##*/}$rest
    path=${path%/*}
    [ -n "$path" ] || path=/
  done
  base=$(cd -P -- "$path" 2>/dev/null && pwd -P) || return 1
  [ "$base" = / ] && base=
  real=$base$rest
  if [ "$os" = macos ]; then
    real=$(printf '%s' "$real" | tr '[:upper:]' '[:lower:]')
  fi
  printf '%s\n' "${real:-/}"
}

refuse_upstream() {
  target=$(real_path "$2") || fail "$1 $2 can't be resolved to a real folder (use an absolute path with no . or .. parts and no dangling links)"
  while IFS= read -r folder; do
    [ -n "$folder" ] || continue
    root=$(real_path "$folder") || root=$folder
    case $target/ in
      "$root"/*) fail "$1 $2 is inside $folder, an installed Ardia's folder; nilla-browser never installs into Ardia's folders" ;;
    esac
  done <<EOF
$(upstream_folders)
EOF
}

refuse_upstream "the CLI home" "$cli_home"
refuse_upstream "the bin dir" "$bin_dir"

local_file() {
  path=${1#file://}
  path=${path#localhost}
  case $path in
    /*) printf '%s' "$path" ;;
    *) return 1 ;;
  esac
}

if [ "$os" = linux ]; then
  lock_fd9() { flock -w 120 9; }
  sha256_of() { sha256sum "$1" | awk '{ print $1 }'; }
  link_into() { ln -sfn "$1" "$2"; }
  replace_link() { mv -fT "$1" "$2"; }
  started_epoch() { LC_ALL=C date -d "$1" +%s 2>/dev/null; }
  modified_epoch() { stat -c %Y "$1" 2>/dev/null; }
  account_shell() { getent passwd "$(id -un)" 2>/dev/null | awk -F: '{ print $7; exit }'; }
  default_shell=/bin/sh
else
  lock_fd9() { /usr/bin/lockf -s -t 120 9; }
  sha256_of() { shasum -a 256 "$1" | awk '{ print $1 }'; }
  link_into() { ln -sfh "$1" "$2"; }
  replace_link() { mv -fh "$1" "$2"; }
  started_epoch() { LC_ALL=C date -j -f "%a %b %e %T %Y" "$1" +%s 2>/dev/null; }
  modified_epoch() { stat -f %m "$1" 2>/dev/null; }
  account_shell() { dscl . -read "/Users/$(id -un)" UserShell 2>/dev/null | awk '{ print $2 }'; }
  default_shell=/bin/zsh
fi

take_lock() {
  exec 9>>"$cli_home/.lock" || fail "couldn't open $cli_home/.lock"
  lock_fd9 || fail "another install is still running"
}

points_into_cli_home() {
  [ -L "$1" ] || return 1
  case $(readlink "$1") in
    "$cli_home"/*) return 0 ;;
  esac
  return 1
}

command_link=$bin_dir/nilla-browser

check_bin_free() {
  if { [ -e "$command_link" ] || [ -L "$command_link" ]; } && ! points_into_cli_home "$command_link"; then
    fail "$command_link already exists and isn't this CLI's link; move it away and run this again"
  fi
}

link_bin() {
  target=$cli_home/current/bin/ardia
  [ -L "$command_link" ] && [ "$(readlink "$command_link")" = "$target" ] && return 0
  printf 'step link\n'
  mkdir -p "$bin_dir" || fail "couldn't create $bin_dir"
  check_bin_free
  link_into "$target" "$bin_dir/.nilla-browser.$$" || fail "couldn't create the nilla-browser link"
  replace_link "$bin_dir/.nilla-browser.$$" "$command_link" || { rm -f "$bin_dir/.nilla-browser.$$"; fail "couldn't link $command_link"; }
}

lease_live() {
  holder=${1##*/}
  case $holder in
    ''|*[!0-9]*) return 1 ;;
  esac
  started=$(LC_ALL=C ps -o lstart= -p "$holder" 2>/dev/null) || return 1
  [ -n "$started" ] || return 1
  started=$(started_epoch "$started") || return 0
  leased=$(modified_epoch "$1") || return 1
  [ "$started" -le $((leased + 1)) ]
}

in_use() {
  for lease in "$1"/.leases/*; do
    [ -f "$lease" ] || continue
    lease_live "$lease" && return 0
    rm -f "$lease"
  done
  return 1
}

is_cli_entry() {
  name=${1##*/}
  case $name in
    current) [ -L "$1" ] ;;
    *.partial) is_version "${name%.partial}" ;;
    *) is_version "$name" && [ -d "$1" ] ;;
  esac
}

check_archive() {
  tar -tzf "$1" >"$work/names" 2>/dev/null || fail "couldn't read the tarball"
  if grep -q -e '\\' -e ' -> ' -e '[[:cntrl:]]' "$work/names"; then
    fail "the tarball has entry names with control characters, backslashes or arrows"
  fi
  if grep -Ev "^ardia-cli-$version(/|$)" "$work/names" | grep -q .; then
    fail "the tarball has entries outside ardia-cli-$version/"
  fi
  if grep -Eq '(^|/)\.\.(/|$)' "$work/names"; then
    fail "the tarball has .. entries"
  fi
  tar -tvzf "$1" >"$work/listing" 2>/dev/null || fail "couldn't read the tarball"
  if grep -Eq '^h| link to ' "$work/listing"; then
    fail "the tarball has hard links"
  fi
  grep -E '^l' "$work/listing" | awk '{ i = index($0, " -> "); print (i ? substr($0, i + 4) : "/") }' >"$work/targets"
  if grep -Eq '^/|(^|/)\.\.(/|$)|\\' "$work/targets"; then
    fail "the tarball has links that point outside it"
  fi
}

check_tree() {
  if [ -n "$(find "$1" -name '*[[:cntrl:]]*' -print -quit)" ]; then
    fail "the tarball has names with control characters"
  fi
  if [ -n "$(find "$1" -type f -links +1 -print -quit)" ]; then
    fail "the tarball has hard links"
  fi
  find "$1" -type l -exec sh -c '
    for link do
      case $(readlink "$link") in
        /*|..|../*|*/../*|*/..|*[[:cntrl:]]*) exit 1 ;;
      esac
    done' sh {} + || fail "the tarball has a link that points outside it"
}

installed_elsewhere() {
  [ -d "$cli_home" ] || return 1
  [ -e "$cli_home/.nilla-cli" ] && return 1
  if [ -e "$cli_home/current" ] || [ -L "$cli_home/current" ]; then
    return 0
  fi
  for entry in "$cli_home"/[0-9]*; do
    [ -d "$entry" ] && return 0
  done
  return 1
}

refuse_cli_home_of_another_install() {
  if installed_elsewhere; then
    fail "$cli_home holds a CLI this installer didn't install for nilla-browser (it has no .nilla-cli); set ARDIA_CLI_HOME to a folder of Nilla's own"
  fi
}

refuse_cli_home_of_another_install

if [ "$uninstall" -eq 1 ]; then
  printf 'step uninstall\n'
  if points_into_cli_home "$command_link"; then
    rm -f "$command_link" || fail "couldn't remove $command_link"
  fi
  if points_into_cli_home "$bin_dir/cua-driver"; then
    rm -f "$bin_dir/cua-driver" || fail "couldn't remove $bin_dir/cua-driver"
  fi
  if [ -d "$cli_home" ]; then
    take_lock
    for entry in "$cli_home"/* "$cli_home"/.install.*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      case ${entry##*/} in
        .install.*|cua-driver) ;;
        *) is_cli_entry "$entry" || continue ;;
      esac
      rm -rf "$entry" || fail "couldn't remove $entry"
    done
    rmdir "$cli_home" 2>/dev/null || true
  fi
  reported=1
  printf 'uninstalled\n'
  exit 0
fi

case $(uname -s) in
  Darwin) [ "$(uname -m)" = arm64 ] || fail "the nilla-browser CLI runs on Apple silicon only, not $(uname -m)" ;;
  Linux) [ "$(uname -m)" = x86_64 ] || fail "the nilla-browser CLI runs on x86_64 Linux only, not $(uname -m)" ;;
  *) fail "the nilla-browser CLI runs on macOS and Linux only" ;;
esac

printf 'step resolve\n'
url=${ARDIA_CLI_URL:-}
case $url in
  file://*) ;;
  *) fail "this development build of Nilla installs the CLI only from a local tarball: set ARDIA_CLI_URL to a file:// URL" ;;
esac
if [ -z "$version" ]; then
  name=${url##*/}
  version=${name#ardia-cli-}
  version=${version%"$asset_suffix"}
fi
is_version "$version" || fail "bad version: $version"
printf 'version %s\n' "$version"
check_bin_free

mkdir -p "$cli_home" || fail "couldn't create $cli_home"
take_lock
refuse_cli_home_of_another_install
: > "$cli_home/.nilla-cli" || fail "couldn't mark $cli_home as nilla-browser's"
work=$(mktemp -d "${TMPDIR:-/tmp}/nilla-cli-install.XXXXXX") || fail "couldn't create a temporary folder"
chmod 700 "$work"

previous=$(readlink "$cli_home/current" 2>/dev/null || true)
if [ "$previous" = "$version" ] && [ -x "$cli_home/$version/bin/ardia" ]; then
  link_bin
  reported=1
  printf 'installed %s\n' "$command_link"
  exit 0
fi
is_version "$previous" || previous=

printf 'step download\n'
source_file=$(local_file "$url") || fail "not a local file URL: $url"
cp "$source_file" "$work/cli.tar.gz" 2>/dev/null || fail "couldn't read $source_file"
if [ -n "$pinned_sha" ]; then
  expected=$pinned_sha
else
  expected=$(awk '{ print $1; exit }' "$source_file.sha256" 2>/dev/null) || fail "couldn't read $source_file.sha256"
fi

printf 'step verify\n'
printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{64}$' || fail "bad checksum file: $url.sha256"
actual=$(sha256_of "$work/cli.tar.gz")
[ "$actual" = "$expected" ] || fail "checksum mismatch: expected $expected, got $actual"
check_archive "$work/cli.tar.gz"

printf 'step install\n'
staged=$cli_home/$version.partial
dest=$cli_home/$version
rm -rf "$staged"
mkdir "$staged" || fail "couldn't create $staged"
tar -xzf "$work/cli.tar.gz" -C "$staged" --strip-components 1 --no-same-owner "ardia-cli-$version" \
  || fail "couldn't extract ardia-cli-$version from the tarball"
check_tree "$staged"
[ -x "$staged/bin/ardia" ] || fail "the tarball has no ardia-cli-$version/bin/ardia"
[ "$os" = linux ] || xattr -dr com.apple.quarantine "$staged" 2>/dev/null || true
"$staged/bin/ardia" --version >"$work/check.out" 2>&1 9>&- || fail "the downloaded nilla-browser doesn't run: $(tail -n 1 "$work/check.out")"
if [ -d "$dest" ] && ! [ -L "$dest" ] && [ -x "$dest/bin/ardia" ] && in_use "$dest"; then
  rm -rf "$staged"
else
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    mv "$dest" "$cli_home/.install.replaced.$$" || fail "couldn't replace $dest"
    rm -rf "$cli_home/.install.replaced.$$"
  fi
  mv "$staged" "$dest" || fail "couldn't move the CLI into $dest"
fi
link_into "$version" "$cli_home/.install.current.$$" || fail "couldn't create the current link"
replace_link "$cli_home/.install.current.$$" "$cli_home/current" || fail "couldn't switch $cli_home/current"
for entry in "$cli_home"/*; do
  case ${entry##*/} in
    current|"$version"|"$previous") continue ;;
  esac
  if is_cli_entry "$entry" && ! in_use "$entry"; then
    rm -rf "$entry"
  fi
done

link_bin

if [ "$bin_dir" = "$default_bin_dir" ]; then
  login_shell=$(account_shell || true)
  [ -x "${login_shell:-}" ] || login_shell=${SHELL:-$default_shell}
  login_path=$(env -i HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" TERM=dumb "$login_shell" -l -c 'printf "%s" "$PATH"' </dev/null 2>/dev/null 9>&- || true)
  case :$login_path: in
    *:"$bin_dir":*|*:"$bin_dir/":*) ;;
    *)
      line='export PATH="$HOME/.local/bin:$PATH"'
      case $os-${login_shell##*/} in
        *-fish)
          case ${XDG_CONFIG_HOME:-} in
            /*) rc=$XDG_CONFIG_HOME/fish/conf.d/nilla-browser.fish ;;
            *) rc=$HOME/.config/fish/conf.d/nilla-browser.fish ;;
          esac
          line='contains -- $HOME/.local/bin $PATH; or set -gx PATH $HOME/.local/bin $PATH'
          mkdir -p "${rc%/*}" || fail "couldn't create ${rc%/*}"
          ;;
        macos-bash) rc=$HOME/.bash_profile ;;
        macos-*) rc=$HOME/.zprofile ;;
        linux-zsh) rc=$HOME/.zprofile ;;
        linux-bash) if [ -f "$HOME/.bash_profile" ]; then rc=$HOME/.bash_profile; else rc=$HOME/.profile; fi ;;
        *) rc=$HOME/.profile ;;
      esac
      if ! [ -f "$rc" ] || ! grep -qxF "$line" "$rc"; then
        if [ -s "$rc" ] && [ -n "$(tail -c 1 "$rc")" ]; then
          printf '\n' >>"$rc" || fail "couldn't write $rc"
        fi
        printf '%s\n' "$line" >>"$rc" || fail "couldn't write $rc"
        printf 'path %s\n' "$rc"
      fi
      ;;
  esac
fi

reported=1
printf 'installed %s\n' "$command_link"
