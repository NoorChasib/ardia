#!/usr/bin/env bash
set -euo pipefail
die() { echo "isolate-session: $*" >&2; exit 2; }
run=$ISOLATE_RUN
logs=$run/logs

export HOME=$run/home
export XDG_CONFIG_HOME=$HOME/.config XDG_CACHE_HOME=$HOME/.cache XDG_DATA_HOME=$HOME/.local/share XDG_STATE_HOME=$HOME/.local/state
export XDG_RUNTIME_DIR=/run/user/$ISOLATE_UID
export USER=${USER:-isolate} LOGNAME=${LOGNAME:-isolate} SHELL=/bin/bash
mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"
echo "session: uid=$(id -u) caps=$(grep CapEff /proc/self/status | awk '{print $2}') home=$HOME" >> "$logs/namespace.txt"

pids=()
finish() {
  local status=$?
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do
    for _ in $(seq 30); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  done
  exit "$status"
}
trap finish EXIT

bus=$XDG_RUNTIME_DIR/bus
cat > "$XDG_RUNTIME_DIR/session.conf" <<CONF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path=$bus</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
CONF
dbus-daemon --config-file="$XDG_RUNTIME_DIR/session.conf" --nofork --nopidfile > "$logs/dbus-daemon.log" 2>&1 &
pids+=("$!")
for _ in $(seq 50); do [ -S "$bus" ] && break; sleep 0.1; done
[ -S "$bus" ] || die "the private session bus didn't start: $(cat "$logs/dbus-daemon.log")"
export DBUS_SESSION_BUS_ADDRESS=unix:path=$bus
dbus-monitor --address "$DBUS_SESSION_BUS_ADDRESS" \
  "destination='org.freedesktop.secrets'" "interface='org.freedesktop.Secret.Service'" \
  "interface='org.freedesktop.Secret.Collection'" "interface='org.freedesktop.Secret.Item'" \
  "destination='org.kde.kwalletd5'" "destination='org.kde.kwalletd6'" "destination='org.gnome.keyring'" \
  > "$logs/dbus-secrets.log" 2>&1 &
pids+=("$!")

if [ "$ISOLATE_NET" = 1 ]; then
  nssdb=$HOME/.pki/nssdb
  mkdir -p "$nssdb"
  certutil -d "sql:$nssdb" -N --empty-password
  certutil -d "sql:$nssdb" -A -n "nilla-isolate throwaway CA" -t "C,," -i "$run/ca/mitmproxy-ca-cert.pem"
  proxy=http://127.0.0.1:$ISOLATE_PROXY_PORT
  export ISOLATE_PROXY=$proxy http_proxy=$proxy https_proxy=$proxy HTTP_PROXY=$proxy HTTPS_PROXY=$proxy
  export no_proxy=localhost,127.0.0.1,::1 NO_PROXY=localhost,127.0.0.1,::1
  export SSL_CERT_FILE=$run/ca/bundle.pem REQUESTS_CA_BUNDLE=$run/ca/bundle.pem CURL_CA_BUNDLE=$run/ca/bundle.pem NODE_EXTRA_CA_CERTS=$run/ca/mitmproxy-ca-cert.pem
fi

if [ "$ISOLATE_DISPLAY" = 1 ]; then
  Xvfb :42 -nolisten tcp -screen 0 1920x1080x24 > "$logs/xvfb.log" 2>&1 &
  pids+=("$!")
  for _ in $(seq 100); do [ -S /tmp/.X11-unix/X42 ] && break; sleep 0.1; done
  [ -S /tmp/.X11-unix/X42 ] || die "Xvfb didn't start: $(cat "$logs/xvfb.log")"
  export DISPLAY=:42
fi

export ISOLATE_ORIG_CWD=$(pwd)
mkdir -p "$run/cwd"
case "$1" in
  /*) ;;
  */*) set -- "$ISOLATE_ORIG_CWD/$1" "${@:2}" ;;
esac
cd "$run/cwd" || die "can't enter $run/cwd"

set +e
"$@"
status=$?
set -e
exit "$status"
