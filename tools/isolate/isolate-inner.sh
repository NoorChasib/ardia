#!/usr/bin/env bash
set -euo pipefail
die() { echo "isolate-inner: $*" >&2; exit 2; }
run=$ISOLATE_RUN
logs=$run/logs

mount --make-rprivate /
mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs /tmp
keep=/tmp/.isolate-keep
mkdir -p "$keep"

declare -a paths=() modes=()
while IFS= read -r path; do [ -n "$path" ] && paths+=("$path") && modes+=(ro); done <<<"$ISOLATE_RO"
while IFS= read -r path; do [ -n "$path" ] && paths+=("$path") && modes+=(rw); done <<<"$ISOLATE_RW"
order=$(for index in "${!paths[@]}"; do printf '%d %d\n' "${#paths[$index]}" "$index"; done | sort -n | awk '{print $2}')

for index in $order; do
  [ -e "${paths[$index]}" ] || die "bind source ${paths[$index]} doesn't exist"
  mkdir -p "$keep/$index"
  mount --rbind "${paths[$index]}" "$keep/$index"
done

mount -t tmpfs -o mode=0755,nosuid,nodev tmpfs "$ISOLATE_REAL_HOME"
for index in $order; do
  target=${paths[$index]}
  mkdir -p "$target"
  mount --move "$keep/$index" "$target"
  if [ "${modes[$index]}" = ro ]; then
    mount -o remount,bind,ro "$target" 2>/dev/null || mount -o remount,bind,ro,nosuid,nodev "$target"
  fi
done
rmdir "$keep"/* "$keep" 2>/dev/null || true
mount -o remount,bind,ro "$ISOLATE_REAL_HOME"

resolv_target=$(readlink -f /etc/resolv.conf 2>/dev/null || true)
mount -t tmpfs -o mode=0755,nosuid,nodev tmpfs /run
case "$resolv_target" in
  /run/*) mkdir -p "$(dirname "$resolv_target")"; printf 'nameserver 127.0.0.53\noptions edns0\n' > "$resolv_target" ;;
  *) [ "$ISOLATE_NET" = 0 ] || grep -q '^nameserver 127.0.0.53' /etc/resolv.conf || die "/etc/resolv.conf doesn't point at 127.0.0.53 or into /run; can't steer DNS to the logging stub" ;;
esac
mkdir -p "/run/user/$ISOLATE_UID"
chmod 700 "/run/user/$ISOLATE_UID"
mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs /dev/shm
mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs /var/tmp

helpers=()
tcpdump_pid=""
finish() {
  local status=$?
  if [ -n "$tcpdump_pid" ]; then
    kill -INT "$tcpdump_pid" 2>/dev/null || true
    for _ in $(seq 50); do kill -0 "$tcpdump_pid" 2>/dev/null || break; sleep 0.1; done
  fi
  if [ "$ISOLATE_NET" = 1 ]; then
    nft list ruleset > "$logs/nft-final.txt" 2>&1 || true
  fi
  for pid in "${helpers[@]}"; do kill "$pid" 2>/dev/null || true; done
  exit "$status"
}
trap finish EXIT

if [ "$ISOLATE_NET" = 1 ]; then
  ip link set lo up
  ip link add isolate0 type dummy
  ip link set isolate0 addrgenmode none 2>/dev/null || true
  ip addr add 10.200.0.2/16 dev isolate0
  ip -6 addr add fd00:200::2/64 dev isolate0 nodad
  ip link set isolate0 up
  ip route add default via 10.200.0.1 dev isolate0 onlink
  ip -6 route add default via fd00:200::1 dev isolate0 onlink
  nft -f - <<'NFT'
table inet isolate {
  chain output {
    type filter hook output priority filter; policy drop;
    oif "lo" accept
    counter log group 1 drop
  }
}
NFT
  nft list ruleset > "$logs/nft-initial.txt"
  tcpdump -Z root -U -n -i nflog:1 -w "$logs/egress.pcap" > "$logs/tcpdump.log" 2>&1 &
  tcpdump_pid=$!
  python3 "$ISOLATE_HERE/dnslog.py" --listen 127.0.0.53:53 --log "$logs/dns.jsonl" --ready "$run/sock/dns.ready" > "$logs/dnslog.log" 2>&1 &
  helpers+=("$!")
  python3 "$ISOLATE_HERE/unixbridge.py" tcp-to-unix "127.0.0.1:$ISOLATE_PROXY_PORT" "$run/sock/proxy.sock" --ready "$run/sock/inner-bridge.ready" > "$logs/inner-bridge.log" 2>&1 &
  helpers+=("$!")
  for _ in $(seq 100); do
    grep -q 'listening on nflog' "$logs/tcpdump.log" 2>/dev/null && [ -e "$run/sock/dns.ready" ] && [ -e "$run/sock/inner-bridge.ready" ] && break
    sleep 0.1
  done
  grep -q 'listening on nflog' "$logs/tcpdump.log" || die "tcpdump didn't start on nflog:1: $(cat "$logs/tcpdump.log")"
  [ -e "$run/sock/dns.ready" ] || die "the DNS stub didn't start: $(cat "$logs/dnslog.log")"
  [ -e "$run/sock/inner-bridge.ready" ] || die "the proxy bridge didn't start: $(cat "$logs/inner-bridge.log")"
fi

{
  echo "uid_map: $(tr -s ' ' < /proc/self/uid_map)"
  echo "real home now: $(ls -A "$ISOLATE_REAL_HOME" | tr '\n' ' ')"
  echo "mounts:"
  findmnt -rn -o TARGET,FSTYPE,OPTIONS | awk -v home="$ISOLATE_REAL_HOME" 'index($1, home) == 1 || $1 ~ /^\/(tmp|run|dev\/shm|var\/tmp)$/'
  if [ "$ISOLATE_NET" = 1 ]; then echo "links:"; ip -br addr; echo "routes:"; ip route; fi
} > "$logs/namespace.txt" 2>&1

set +e
unshare --user --map-user="$ISOLATE_UID" --map-group="$ISOLATE_GID" -- bash "$ISOLATE_HERE/isolate-session.sh" "$@"
status=$?
set -e
exit "$status"
