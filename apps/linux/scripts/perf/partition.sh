#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
usage:
  partition.sh run [options] -- <command...>
  partition.sh status
  partition.sh restore [--force]

Gives the benchmark CPUs to one command for the length of one run.

run:
  1. Takes the host-wide partition lock (/run/lock/ardiabench-partition.lock) and a shared
     lease on the perflab lock (ARDIA_PERFLAB_LOCK below), so no other benchmark that uses it
     can start until the CPUs are back.
  2. Records the AllowedCPUs, EffectiveCPUs and runtime drop-in of every active top-level
     unit with processes (system.slice, user.slice, init.scope, machine.slice when active,
     and any other), plus the root-cgroup tasks no unit setting reaches, in the state file.
  3. Arms the guard: a root systemd service (Restart=on-failure) that holds the same lease and
     runs 'restore' as soon as this script is gone (SIGKILL included) or the deadline
     (--max-hours + 10 min) passes, retrying every 15 s until the restore verifies.
  4. Confines those units to the rest CPUs with 'systemctl set-property --runtime' and checks
     each one's EffectiveCPUs.
  5. Starts <command> as a transient service in ardiabench.slice (Delegate=yes, your uid and
     gid, the current directory, no $-expansion, ARDIA_BENCH_SCOPE=delegated,
     ARDIA_PARTITION=<rest>|<bench>, ARDIA_PERFLAB_LEASE=<perflab lock>), so bench.mjs puts
     itself in a child cgroup with cpuset <rest> and each chrome in one with cpuset <bench>.
  6. Restores on exit, INT, TERM and HUP.
  When <command> runs bench.mjs, its --cpus must equal --bench and it must start with
  'taskset -c <subset of --rest>'.

run options:
  --rest LIST        CPUs everything else keeps (default 0-9)
  --bench LIST       CPUs left to the benchmark (default 10-15); must not overlap --rest
  --env NAME[=VAL]   pass another variable into the service (repeatable); HOME, PATH, USER,
                     LOGNAME, SHELL, LANG, TERM, DISPLAY, XDG_RUNTIME_DIR, every ARDIA_*,
                     MISE_* and NODE_* variable are passed already
  --max-hours H      the service is stopped after H hours (default 8); the guard restores
                     10 minutes after that even if this script is still alive
  --audit FILE       run cpu-audit.py on the rest CPUs for the whole partition and write FILE
  --force            start even when another process is pinned only to the bench CPUs

restore:
  Takes the partition lock, stops the recorded benchmark service and waits until its cgroup
  is empty (it never reopens the CPUs while the benchmark still runs), puts every recorded
  unit back to its recorded AllowedCPUs and drop-in, runs daemon-reload when a drop-in
  changed, checks AllowedCPUs, EffectiveCPUs and NeedDaemonReload, then deletes the state
  file. On any failure it keeps the state file and the guard, which tries again. Idempotent.
  Without a state file it changes nothing unless --force, which clears AllowedCPUs on every
  top-level unit.

status:
  Each top-level unit's CPUs, the state file, the guard, ardiabench units, top-level cgroups
  and root-cgroup tasks that the partition does not confine.

environment:
  ARDIA_PARTITION_STATE  state file (default ${XDG_STATE_HOME:-~/.local/state}/ardia/linux-bench-partition.state;
                         made absolute; one partition per host, so it is not inside a checkout)
  ARDIA_PERFLAB_LOCK     the perflab lock the run leases (default /tmp/ardia-perflab.lock); bench.mjs --lock must
                         name the same file for the harness to see the lease

Exit status: the command's exit status, or 1 when restoring failed (the state file and the
guard are kept).
EOF
}

STATE="$(realpath -m "${ARDIA_PARTITION_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/ardia/linux-bench-partition.state}")"
SELF="$(readlink -f "$0")"
HERE="$(dirname "$SELF")"
KNOWN_UNITS=(system.slice user.slice init.scope machine.slice)
BENCH_SLICE=ardiabench.slice
CONTROL_DIR=/run/systemd/system.control
LOCK=/run/lock/ardiabench-partition.lock
PERFLAB="$(realpath -m "${ARDIA_PERFLAB_LOCK:-/tmp/ardia-perflab.lock}")"
REST=0-9
BENCH=10-15
SUDO=()
[ "$(id -u)" = 0 ] || SUDO=(sudo -n)

say() { printf '[partition %s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() { say "$*"; exit 1; }

prop() { systemctl show -p "$2" --value "$1" 2>/dev/null || true; }

online_cpus() { cat /sys/devices/system/cpu/online; }

dropin_path() { printf '%s/%s.d/50-AllowedCPUs.conf' "$CONTROL_DIR" "$1"; }

field() { [ -f "$STATE" ] && awk -F'\t' -v k="$1" '$1==k{print $2; exit}' "$STATE" || true; }

cpuset() {
  python3 -I - "$@" <<'PY'
import sys
def parse(text):
    out = set()
    for part in text.strip().split(","):
        if not part:
            continue
        a, _, b = part.partition("-")
        if not a.isdigit() or (b and not b.isdigit()) or int(b or a) < int(a):
            raise SystemExit(f"bad CPU list {text!r}")
        out.update(range(int(a), int(b or a) + 1))
    return out
def fmt(s):
    s = sorted(s)
    runs, i = [], 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and s[j + 1] == s[j] + 1:
            j += 1
        runs.append(str(s[i]) if i == j else f"{s[i]}-{s[j]}")
        i = j + 1
    return ",".join(runs)
op, *lists = sys.argv[1:]
sets = [parse(x) for x in lists]
if op == "norm":
    print(fmt(sets[0]))
elif op == "eq":
    raise SystemExit(0 if sets[0] == sets[1] else 1)
elif op == "subset":
    raise SystemExit(0 if sets[0] <= sets[1] else 1)
elif op == "disjoint":
    raise SystemExit(0 if not (sets[0] & sets[1]) else 1)
elif op == "minus":
    print(fmt(sets[0] - sets[1]))
PY
}

top_level_units() {
  local dir name
  for dir in /sys/fs/cgroup/*/; do
    name="$(basename "$dir")"
    case "$name" in *.slice|*.scope|*.service) ;; *) continue ;; esac
    [ "$name" = "$BENCH_SLICE" ] && continue
    grep -q '^populated 1' "$dir/cgroup.events" 2>/dev/null || continue
    [ "$(prop "$name" LoadState)" = loaded ] && [ "$(prop "$name" ActiveState)" = active ] && printf '%s\n' "$name"
  done
}

unconfined_report() {
  local dir name
  for dir in /sys/fs/cgroup/*/; do
    name="$(basename "$dir")"
    [ "$name" = "$BENCH_SLICE" ] && continue
    grep -q '^populated 1' "$dir/cgroup.events" 2>/dev/null || continue
    case "$name" in
      *.slice|*.scope|*.service)
        if [ -f "$STATE" ] && ! awk -F'\t' -v u="$name" '$1=="unit"&&$2==u{f=1}END{exit !f}' "$STATE"; then
          printf 'top-level unit not recorded: %s (EffectiveCPUs %s)\n' "$name" "$(prop "$name" EffectiveCPUs)"
        fi ;;
      *) printf 'top-level cgroup outside systemd: %s (cpuset %s)\n' "$name" "$(cat "$dir/cpuset.cpus.effective" 2>/dev/null)" ;;
    esac
  done
  [ "${1:-}" = units ] && return 0
  local pid key value name ppid cpus
  while read -r pid; do
    [ "$pid" = 2 ] && continue
    name="" ppid="" cpus=""
    while IFS=$'\t' read -r key value; do
      case "$key" in Name:) name="$value" ;; PPid:) ppid="$value" ;; Cpus_allowed_list:) cpus="$value" ;; esac
    done < "/proc/$pid/status" 2>/dev/null || continue
    case "$ppid" in ""|0|2) continue ;; esac
    printf 'root-cgroup task: %s %s cpus=%s\n' "$pid" "$name" "$cpus"
  done < /sys/fs/cgroup/cgroup.procs
}

show_units() {
  local u units=()
  mapfile -t units < <( { printf '%s\n' "${KNOWN_UNITS[@]}"; top_level_units; [ -f "$STATE" ] && awk -F'\t' '$1=="unit"{print $2}' "$STATE"; } | awk '!seen[$0]++')
  for u in "${units[@]}" "$BENCH_SLICE"; do
    printf '  %-16s %s\n' "$u" "$(systemctl show -p AllowedCPUs,EffectiveCPUs,ActiveState,NeedDaemonReload "$u" 2>/dev/null | tr '\n' ' ')"
  done
}

status() {
  echo "online CPUs: $(online_cpus)"
  show_units
  if [ -f "$STATE" ]; then
    echo "partition ON: state file $STATE"
    sed 's/^/  /' "$STATE"
    local guard
    guard="$(field guard)"
    [ -n "$guard" ] && echo "  guard $guard: $(systemctl show -p ActiveState,SubState,NRestarts "$guard" 2>/dev/null | tr '\n' ' ')"
  else
    echo "partition off: no state file at $STATE"
  fi
  systemctl list-units --all --no-legend --plain 'ardiabench*' 2>/dev/null | sed 's/^/  unit: /' || true
  unconfined_report | sed 's/^/  unconfined: /' || true
}

pinned_to_bench() {
  python3 -I - "$BENCH" "$REST" <<'PY'
import os, sys
def cpus(text):
    out = set()
    for part in text.strip().split(","):
        if not part:
            continue
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return out
bench, rest = cpus(sys.argv[1]), cpus(sys.argv[2])
for pid in filter(str.isdigit, os.listdir("/proc")):
    try:
        status = open(f"/proc/{pid}/status").read()
        cg = open(f"/proc/{pid}/cgroup").read()
    except OSError:
        continue
    fields = dict(line.split(":\t", 1) for line in status.splitlines() if ":\t" in line)
    if fields.get("PPid", "").strip() in ("0", "2") or "ardiabench.slice" in cg:
        continue
    allowed = cpus(fields.get("Cpus_allowed_list", ""))
    if allowed and not (allowed & rest):
        print(f"{pid} {fields.get('Name', '').strip()} cpus={fields['Cpus_allowed_list'].strip()} {cg.strip()}")
PY
}

start_time() { sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | awk '{print $20}'; }

open_lock() {
  if ! { true >&9; } 2>/dev/null; then
    [ -e "$LOCK" ] || "${SUDO[@]}" install -m 0644 /dev/null "$LOCK" || die "cannot create $LOCK"
    exec 9<"$LOCK"
  fi
}

take_lock() {
  open_lock
  flock -w "${1:-300}" 9 || die "the partition lock $LOCK is busy (another run, restore or guard)"
}

check_sudo() {
  [ "${#SUDO[@]}" = 0 ] && return 0
  local c path
  for c in systemctl systemd-run tee rm rmdir truncate test base64 install; do
    path="$(type -P "$c")" || die "$c not found"
    "${SUDO[@]}" -l "$path" >/dev/null 2>&1 || die "passwordless sudo does not allow $path"
  done
}

write_state() {
  local tmp u allowed effective file existed content dir_existed control_existed
  tmp="$(mktemp "${STATE}.XXXXXX")"
  control_existed=0
  "${SUDO[@]}" test -d "$CONTROL_DIR" && control_existed=1
  {
    printf 'control_dir_existed\t%s\n' "$control_existed"
    printf 'rest\t%s\nbench\t%s\nonline\t%s\nstarted\t%s\n' "$REST" "$BENCH" "$(online_cpus)" "$(date -Is)"
    printf 'owner\t%s\nowner_start\t%s\ndeadline\t%s\n' "$$" "$(start_time $$)" "$deadline"
    printf 'service\t%s\nguard\t%s\n' "$unit.service" "$guard.service"
    while read -r u; do
      allowed="$(prop "$u" AllowedCPUs)"
      effective="$(prop "$u" EffectiveCPUs)"
      file="$(dropin_path "$u")"
      existed=0
      content=-
      dir_existed=0
      "${SUDO[@]}" test -d "$(dirname "$file")" && dir_existed=1
      if "${SUDO[@]}" test -f "$file"; then
        existed=1
        content="$("${SUDO[@]}" base64 -w0 "$file")"
        [ -n "$content" ] || content=EMPTY
      fi
      printf 'unit\t%s\t%s\t%s\t%s\t%s\t%s\n' "$u" "${allowed:--}" "${effective:--}" "$existed" "$dir_existed" "$content"
    done < <(top_level_units)
    unconfined_report | sed 's/^/unconfined\t/'
  } > "$tmp"
  if ! (set -o noclobber; cat "$tmp" > "$STATE") 2>/dev/null; then
    rm -f "$tmp"
    die "a state file already exists at $STATE: a partition is on or was not restored; run '$SELF restore' first"
  fi
  rm -f "$tmp"
}

service_gone() {
  local svc="$1" active cg
  active="$(prop "$svc" ActiveState)"
  case "$active" in ""|inactive|failed) ;; *) return 1 ;; esac
  cg="/sys/fs/cgroup/$BENCH_SLICE/$svc"
  [ ! -e "$cg/cgroup.events" ] || grep -q '^populated 0' "$cg/cgroup.events"
}

stop_service() {
  local svc="$1" i
  service_gone "$svc" && return 0
  say "stopping $svc and waiting for its cgroup to empty"
  "${SUDO[@]}" systemctl stop "$svc" || true
  for i in $(seq 1 60); do service_gone "$svc" && return 0; sleep 1; done
  "${SUDO[@]}" systemctl kill --signal=SIGKILL "$svc" || true
  for i in $(seq 1 20); do service_gone "$svc" && return 0; sleep 1; done
  say "$svc still has processes"
  return 1
}

restore_locked() {
  local force="${1:-}"
  if [ ! -f "$STATE" ]; then
    if [ "$force" = --force ]; then
      local u
      say "no state file; --force clears AllowedCPUs on every top-level unit"
      while read -r u; do "${SUDO[@]}" systemctl set-property --runtime "$u" AllowedCPUs= || say "set-property on $u failed"; done < <( { printf '%s\n' "${KNOWN_UNITS[@]}"; top_level_units; } | awk '!seen[$0]++' | while read -r u; do [ "$(prop "$u" ActiveState)" = active ] && echo "$u"; done)
      show_units >&2
      return 0
    fi
    say "nothing to restore (no state file at $STATE)"
    return 0
  fi
  local svc
  svc="$(field service)"
  if [ -n "$svc" ] && [ "$$" != "$(field owner)" ] && [ "$(start_time "$(field owner)")" = "$(field owner_start)" ] && ! service_gone "$svc"; then
    printf 'cancelled by pid %s at %s\n' "$$" "$(date -Is)" > "$STATE.cancelled"
  fi
  if [ -n "$svc" ] && ! stop_service "$svc"; then
    say "RESTORE DEFERRED: $svc is still running; the CPUs stay partitioned"
    return 1
  fi
  local failed=0 reload=0 control_existed online kind u allowed effective existed dir_existed content file
  control_existed="$(field control_dir_existed)"
  online="$(field online)"
  while IFS=$'\t' read -r kind u allowed effective existed dir_existed content; do
    [ "$kind" = unit ] || continue
    [ "$allowed" = - ] && allowed=
    "${SUDO[@]}" systemctl set-property --runtime "$u" "AllowedCPUs=$allowed" || { say "set-property on $u failed"; failed=1; }
    file="$(dropin_path "$u")"
    if [ "$existed" = 1 ]; then
      if [ "$content" = EMPTY ]; then
        "${SUDO[@]}" truncate -s0 "$file" || failed=1
      else
        printf '%s' "$content" | base64 -d | "${SUDO[@]}" tee "$file" > /dev/null || failed=1
      fi
      reload=1
    elif "${SUDO[@]}" test -e "$file"; then
      "${SUDO[@]}" rm -f "$file" || failed=1
      reload=1
      [ "$dir_existed" = 1 ] || "${SUDO[@]}" rmdir "$(dirname "$file")" 2>/dev/null || true
    fi
  done < "$STATE"
  [ "$control_existed" = 1 ] || "${SUDO[@]}" rmdir "$CONTROL_DIR" 2>/dev/null || true
  if [ "$reload" = 1 ]; then "${SUDO[@]}" systemctl daemon-reload || failed=1; fi
  while IFS=$'\t' read -r kind u allowed effective existed dir_existed content; do
    [ "$kind" = unit ] || continue
    [ "$allowed" = - ] && allowed=
    local now_allowed now_effective need dropin_ok=1
    now_allowed="$(prop "$u" AllowedCPUs)"
    now_effective="$(prop "$u" EffectiveCPUs)"
    need="$(prop "$u" NeedDaemonReload)"
    file="$(dropin_path "$u")"
    if [ "$existed" = 1 ]; then "${SUDO[@]}" test -f "$file" || dropin_ok=0; else ! "${SUDO[@]}" test -e "$file" || dropin_ok=0; fi
    if [ "$now_allowed" != "$allowed" ] || [ "$now_effective" != "$effective" ] || [ "$need" != no ] || [ "$dropin_ok" != 1 ]; then
      say "$u: AllowedCPUs '$now_allowed' (want '$allowed'), EffectiveCPUs '$now_effective' (want '$effective'), NeedDaemonReload $need, drop-in ok $dropin_ok"
      failed=1
    else
      say "$u restored: AllowedCPUs '${now_allowed}', EffectiveCPUs ${now_effective}"
    fi
  done < "$STATE"
  if [ "$failed" != 0 ]; then
    say "RESTORE INCOMPLETE: state and guard kept at $STATE; the guard retries, or run '$SELF restore'"
    return 1
  fi
  local guard
  guard="$(field guard)"
  rm -f "$STATE" "$STATE.guard"
  if [ "$(prop "$BENCH_SLICE" ActiveState)" = active ] && [ -z "$(systemctl list-units --no-legend --plain "ardiabench-run-*" 2>/dev/null | awk '$3=="active"')" ]; then
    "${SUDO[@]}" systemctl stop "$BENCH_SLICE" 2>/dev/null || true
  fi
  if [ -n "$guard" ] && [ "${PARTITION_GUARD:-}" != 1 ]; then "${SUDO[@]}" systemctl stop "$guard" 2>/dev/null || true; fi
  say "restored; online CPUs $online"
  return 0
}

restore() {
  take_lock 600
  local rc=0
  restore_locked "$@" || rc=$?
  flock -u 9
  return "$rc"
}

guard() {
  [ "$(id -u)" = 0 ] || die "guard runs as root under systemd"
  [ -f "$STATE" ] || exit 0
  exec 8<"$PERFLAB"
  flock -s -w 30 8 || die "guard: could not share the perflab lease"
  echo "$$" > "$STATE.guard"
  say "guard armed for $STATE"
  local owner owner_start deadline reason seen="" next_audit=0
  owner="$(field owner)"
  owner_start="$(field owner_start)"
  deadline="$(field deadline)"
  while [ -f "$STATE" ]; do
    reason=""
    if [ "$(start_time "$owner")" != "$owner_start" ]; then reason="partition.sh (pid $owner) is gone"
    elif [ "$(date +%s)" -ge "$deadline" ]; then reason="deadline passed"
    fi
    if [ -n "$reason" ]; then
      say "guard: $reason; restoring"
      if restore; then exit 0; fi
      say "guard: restore failed; retrying in 15 s"
      sleep 15
      continue
    fi
    if [ "$(date +%s)" -ge "$next_audit" ]; then
      next_audit=$(( $(date +%s) + 30 ))
      local line
      while read -r line; do
        case "$seen" in *"|$line|"*) continue ;; esac
        seen="$seen|$line|"
        say "guard: unconfined: $line"
      done < <(unconfined_report units || true)
    fi
    sleep 3
  done
  exit 0
}

check_command() {
  local i is_bench=0 cpus=10-15 args=("$@")
  for ((i = 0; i < ${#args[@]}; i++)); do
    case "${args[$i]}" in
      */bench.mjs|bench.mjs) is_bench=1 ;;
      --cpus) cpus="${args[$((i + 1))]:-}" ;;
    esac
  done
  [ "$is_bench" = 1 ] || return 0
  cpuset eq "$cpus" "$BENCH" || die "the harness --cpus $cpus is not --bench $BENCH"
  [ "${args[0]}" = taskset ] && [ "${args[1]}" = -c ] && cpuset subset "${args[2]}" "$REST" || die "start the harness with 'taskset -c <subset of $REST>' so the orchestrator stays off $BENCH"
}

run() {
  local force=0 max_hours=8 extra_env=() audit=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --rest) REST="$2"; shift 2 ;;
      --bench) BENCH="$2"; shift 2 ;;
      --env) extra_env+=("$2"); shift 2 ;;
      --max-hours) max_hours="$2"; shift 2 ;;
      --audit) audit="$(realpath -m "$2")"; mkdir -p "$(dirname "$audit")"; shift 2 ;;
      --force) force=1; shift ;;
      --) shift; break ;;
      *) say "unknown option $1"; usage >&2; exit 2 ;;
    esac
  done
  [ $# -gt 0 ] || { usage >&2; exit 2; }
  local online
  online="$(online_cpus)"
  REST="$(cpuset norm "$REST")" && BENCH="$(cpuset norm "$BENCH")" || die "bad --rest or --bench"
  [ -n "$REST" ] && [ -n "$BENCH" ] || die "--rest and --bench must not be empty"
  cpuset disjoint "$REST" "$BENCH" || die "--rest $REST and --bench $BENCH overlap"
  cpuset subset "$REST" "$online" && cpuset subset "$BENCH" "$online" || die "--rest and --bench must be online CPUs ($online)"
  local spare
  spare="$(cpuset minus "$online" "$REST,$BENCH")"
  [ -z "$spare" ] || say "CPUs $spare are in neither list; nothing but the benchmark service may use them"
  check_command "$@"
  check_sudo
  local pinned
  pinned="$(pinned_to_bench)"
  if [ -n "$pinned" ]; then
    say "processes outside $BENCH_SLICE pinned only to CPUs $BENCH (the partition would squeeze them onto $REST):"
    printf '%s\n' "$pinned" | sed 's/^/  /' >&2
    [ "$force" = 1 ] || die "refusing without --force"
  fi

  take_lock 60
  mkdir -p "$(dirname "$STATE")"
  [ -e "$PERFLAB" ] || : >> "$PERFLAB"
  exec 8<"$PERFLAB"
  flock -s -n 8 || die "$PERFLAB is held: another benchmark is running"
  [ ! -e "$STATE" ] || die "a state file already exists at $STATE: run '$SELF restore' first"
  rm -f "$STATE.cancelled" "$STATE.guard"

  local stamp max_s
  stamp="$(date +%Y%m%dT%H%M%S)-$$"
  unit="ardiabench-run-$stamp"
  guard="ardiabench-guard-$stamp"
  max_s=$(python3 -I -c "import sys; print(int(float(sys.argv[1]) * 3600))" "$max_hours")
  deadline=$(( $(date +%s) + max_s + 600 ))

  local env_args=() name
  for name in HOME PATH USER LOGNAME SHELL LANG TERM DISPLAY XDG_RUNTIME_DIR $(compgen -e | grep -E '^(ARDIA_|MISE_|NODE_)' || true); do
    [ -n "${!name+x}" ] && env_args+=(-E "$name=${!name}")
  done
  for name in "${extra_env[@]}"; do
    if [[ "$name" == *=* ]]; then env_args+=(-E "$name"); else env_args+=(-E "$name=${!name-}"); fi
  done
  env_args+=(-E ARDIA_BENCH_SCOPE=delegated -E "ARDIA_PARTITION=$REST|$BENCH" -E "ARDIA_PARTITION_STATE=$STATE" -E "ARDIA_PERFLAB_LEASE=$PERFLAB")

  restored=0
  child=""
  audit_pid=""
  finish() {
    local code=$?
    trap - EXIT INT TERM HUP
    if [ "$restored" = 0 ]; then
      restored=1
      restore || code=1
      say "after restore:"
      show_units >&2
    fi
    [ -n "$child" ] && kill "$child" 2>/dev/null || true
    [ -n "$child" ] && wait "$child" 2>/dev/null || true
    exit "$code"
  }
  write_state
  trap finish EXIT
  trap 'say "signal: stopping"; exit 130' INT TERM HUP

  "${SUDO[@]}" systemd-run --quiet --collect --unit="$guard" -p Restart=on-failure -p RestartSec=5 \
    -E "ARDIA_PARTITION_STATE=$STATE" -E "ARDIA_PERFLAB_LOCK=$PERFLAB" -E PARTITION_GUARD=1 -E PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    "$SELF" guard || die "could not start the guard"
  local i
  for i in $(seq 1 50); do [ -f "$STATE.guard" ] && break; sleep 0.2; done
  [ -f "$STATE.guard" ] || die "the guard $guard did not arm"
  say "guard $guard.service armed: restores when this script is gone or at $(date -d "@$deadline" +%H:%M:%S)"

  local u
  while read -r u; do
    "${SUDO[@]}" systemctl set-property --runtime "$u" "AllowedCPUs=$REST" || die "set-property $u failed"
  done < <(awk -F'\t' '$1=="unit"&&NF>=7{print $2}' "$STATE")
  while read -r u; do
    cpuset eq "$(prop "$u" EffectiveCPUs)" "$REST" || die "$u has EffectiveCPUs $(prop "$u" EffectiveCPUs), not $REST"
  done < <(awk -F'\t' '$1=="unit"&&NF>=7{print $2}' "$STATE")
  say "partition on: everything else on CPUs $REST"
  show_units >&2
  awk -F'\t' '$1=="unconfined"{print "  unconfined: " $2}' "$STATE" >&2

  if [ -n "$audit" ]; then
    taskset -c "$REST" python3 -I "$HERE/cpu-audit.py" --out "$audit" --bench "$BENCH" --until-pid $$ > "$audit.log" 2>&1 &
    audit_pid=$!
    say "auditing every task into $audit (pid $audit_pid)"
  fi

  "${SUDO[@]}" systemd-run --quiet --unit="$unit" --slice="$BENCH_SLICE" --expand-environment=no -p Delegate=yes -p "RuntimeMaxSec=$max_s" \
    -p "AllowedCPUs=$online" -p "LimitNOFILE=$(ulimit -Sn):$(ulimit -Hn)" --uid="$(id -u)" --gid="$(id -g)" --same-dir --wait --collect --pipe \
    "${env_args[@]}" -- "$@" &
  child=$!
  for i in $(seq 1 100); do
    [ "$(prop "$unit.service" ActiveState)" = active ] && break
    kill -0 "$child" 2>/dev/null || break
    sleep 0.1
  done
  flock -u 9
  say "running $unit (pid $child): $*"
  local code=0
  wait "$child" || code=$?
  child=""
  say "$unit exited $code"
  if [ -f "$STATE.cancelled" ]; then
    say "$unit was stopped by an outside restore ($(cat "$STATE.cancelled"))"
    rm -f "$STATE.cancelled"
    [ "$code" != 0 ] || code=1
  fi
  exit "$code"
}

case "${1:-}" in
  run) shift; run "$@" ;;
  status) status ;;
  restore) shift; restore "${1:-}" ;;
  guard) guard ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
