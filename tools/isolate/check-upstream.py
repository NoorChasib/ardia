#!/usr/bin/env python3
"""usage: check-upstream.py RUN_DIR [--json FILE] [--since EPOCH] [--until EPOCH]

Reads the logs of a nilla-isolate --net run and reports, in Markdown:

  upstream    every proxy request, DNS lookup or dropped packet whose
              destination is on plan 2.6 item 10's fixed list: ardia.dev,
              *.ardia.dev (lab.ardia.dev included), netnyahoo.com, and
              github.com, api.github.com, objects.githubusercontent.com paths
              under ardia-browser/ or mantrakp04/ (raw.githubusercontent.com,
              codeload.github.com and uploads.github.com are checked the same
              way as an extension of the list)
  allowed     the named exceptions (Helium's bang list,
              services.helium.imput.net)
  bypass      packets nftables dropped because they didn't go through the
              proxy, mapped back to the name looked up through the DNS stub
  github      a GitHub host reached without a visible path (CONNECT only,
              DNS only or a dropped packet): reported, not judged
  secrets     Secret Service and KWallet method calls on the private bus
  isolation   whether the real home changed during the run

Exit status: 0 when nothing upstream was attempted and the real home didn't
change, 1 when an upstream attempt was logged, 2 when the isolation broke or
the logs are missing.
"""
import ipaddress
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upstream_rules import classify

PACKET = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+) (IP6?) (\S+) > (\S+?):? (.*)$")


def stamp(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%H:%M:%S")


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return rows


def split_endpoint(text, family):
    if family == "IP6":
        address, _, port = text.rpartition(".")
        return address, port
    parts = text.split(".")
    if len(parts) == 5:
        return ".".join(parts[:4]), parts[4]
    return text, ""


def read_packets(path):
    if not os.path.exists(path) or os.path.getsize(path) <= 24:
        return []
    output = subprocess.run(["tcpdump", "-n", "-tttt", "-r", path], capture_output=True, text=True).stdout
    packets = []
    for line in output.splitlines():
        match = PACKET.match(line)
        if not match:
            continue
        when, family, source, destination, rest = match.groups()
        address, port = split_endpoint(destination, family)
        epoch = datetime.strptime(when, "%Y-%m-%d %H:%M:%S.%f").timestamp()
        protocol = "tcp" if "Flags [" in rest else "udp" if "UDP" in rest or port in ("53", "443", "123") else "other"
        packets.append({"ts": epoch, "address": address, "port": port, "protocol": protocol, "line": line})
    return packets


def main(arguments):
    if not arguments or arguments[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if arguments else 64
    run = os.path.abspath(arguments.pop(0))
    json_path = None
    since, until = 0.0, float("inf")
    while arguments:
        key = arguments.pop(0)
        if key == "--json":
            json_path = arguments.pop(0)
        elif key == "--since":
            since = float(arguments.pop(0))
        elif key == "--until":
            until = float(arguments.pop(0))
        else:
            print(__doc__, file=sys.stderr)
            return 64
    logs = os.path.join(run, "logs")
    if not os.path.exists(os.path.join(logs, "proxy.jsonl")):
        print(f"check-upstream: {logs}/proxy.jsonl is missing; was the run started with --net?", file=sys.stderr)
        return 2
    inside = lambda row: since <= row.get("ts", 0) <= until

    proxy = [row for row in read_jsonl(os.path.join(logs, "proxy.jsonl")) if inside(row)]
    dns = [row for row in read_jsonl(os.path.join(logs, "dns.jsonl")) if inside(row)]
    names_by_address = defaultdict(set)
    for row in read_jsonl(os.path.join(logs, "dns.jsonl")):
        if row.get("answer"):
            names_by_address[row["answer"]].add(row["name"])
    packets = [row for row in read_packets(os.path.join(logs, "egress.pcap")) if inside(row)]

    upstream, allowed, github, bypass = [], [], [], []
    other_hosts = Counter()
    requests = [row for row in proxy if row.get("event") == "request"]
    hosts_with_requests = {row["host"] for row in requests}
    for row in requests:
        verdict, why = classify(row["host"], row["path"])
        entry = {"ts": row["ts"], "source": "proxy", "what": f'{row["method"]} {row["scheme"]}://{row["host"]}{row["path"]}', "why": why, "action": row.get("action", ""), "agent": row.get("user_agent", "")}
        if verdict == "upstream":
            upstream.append(entry)
        elif verdict == "allowed":
            allowed.append(entry)
        else:
            other_hosts[row["host"]] += 1
    for row in proxy:
        if row.get("event") in ("connect", "tls-failed-client") and row.get("host") not in hosts_with_requests:
            verdict, why = classify(row.get("host"), None)
            entry = {"ts": row["ts"], "source": f'proxy {row["event"]}', "what": f'{row.get("host")}:{row.get("port", "")}', "why": why or row.get("error", ""), "action": "no request seen"}
            if verdict == "upstream":
                upstream.append(entry)
            elif verdict == "github-unknown-path":
                github.append(entry)
            elif verdict == "allowed":
                allowed.append(entry)
            else:
                other_hosts[row.get("host")] += 1
    for row in dns:
        verdict, why = classify(row["name"], None)
        entry = {"ts": row["ts"], "source": "dns", "what": f'{row["type"]} {row["name"]}', "why": why or "looked up outside the proxy", "action": "sinkholed" if row.get("answer") else "empty answer"}
        if verdict == "upstream":
            upstream.append(entry)
        elif verdict == "github-unknown-path":
            github.append(entry)
    for packet in packets:
        names = sorted(names_by_address.get(packet["address"], []))
        try:
            ip = ipaddress.ip_address(packet["address"])
            sinkhole = ip in ipaddress.ip_network("10.201.0.0/16")
        except ValueError:
            sinkhole = False
        label = ",".join(names) if names else packet["address"]
        entry = {"ts": packet["ts"], "source": "nftables", "what": f'{packet["protocol"]} {label}:{packet["port"]}', "why": "dropped: didn't go through the proxy" if sinkhole or names else "dropped: raw address, no DNS lookup through the stub", "action": "dropped"}
        verdicts = {classify(name, None)[0] for name in names}
        if "upstream" in verdicts:
            upstream.append(entry)
        elif "github-unknown-path" in verdicts:
            github.append(entry)
        bypass.append(entry)

    secrets_calls = []
    secrets_log = os.path.join(logs, "dbus-secrets.log")
    if os.path.exists(secrets_log):
        with open(secrets_log, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if line.startswith("method call") and ("org.freedesktop.secrets" in line or "Secret." in line or "kwallet" in line or "org.gnome.keyring" in line):
                    secrets_calls.append(line.strip())

    diff_path = os.path.join(logs, "realhome.diff")
    real_home_changed = os.path.exists(diff_path) and os.path.getsize(diff_path) > 0
    after = open(os.path.join(logs, "realhome-after.txt")).read().strip().splitlines() if os.path.exists(os.path.join(logs, "realhome-after.txt")) else []
    scratch_home = os.path.join(run, "home")
    scratch_profiles = [name for name in (".config/ardia", ".config/nilla") if os.path.isdir(os.path.join(scratch_home, name))]
    scratch_keyrings = os.path.join(scratch_home, ".local/share/keyrings")
    scratch_keyring_files = sorted(os.listdir(scratch_keyrings)) if os.path.isdir(scratch_keyrings) else []

    upstream.sort(key=lambda entry: entry["ts"])
    lines = [f"# No-upstream check: {run}", ""]
    lines.append(f"- upstream attempts: **{len(upstream)}**")
    lines.append(f"- allowed exceptions: {len(allowed)}")
    lines.append(f"- proxy requests: {len(requests)} to {len(hosts_with_requests)} hosts; DNS lookups through the stub: {len(dns)}; packets dropped by nftables: {len(packets)}")
    lines.append(f"- GitHub contacts without a visible path: {len(github)}")
    lines.append(f"- Secret Service / KWallet calls on the private bus: {len(secrets_calls)}")
    lines.append(f"- real home changed: **{'yes' if real_home_changed else 'no'}** ({'; '.join(after)})")
    lines.append(f"- profiles created in the scratch home: {', '.join(scratch_profiles) or 'none'}; scratch keyring files: {', '.join(scratch_keyring_files) or 'none'}")
    lines.append("")
    if upstream:
        lines += ["## Upstream attempts", "", "| time (UTC) | source | request | why | proxy action |", "| --- | --- | --- | --- | --- |"]
        lines += [f'| {stamp(e["ts"])} | {e["source"]} | `{e["what"]}` | {e["why"]} | {e["action"]} |' for e in upstream]
        lines.append("")
    if allowed:
        lines += ["## Allowed exceptions", ""]
        lines += [f'- {stamp(e["ts"])} {e["source"]} `{e["what"]}`' for e in allowed]
        lines.append("")
    if github:
        lines += ["## GitHub without a visible path", ""]
        lines += [f'- {stamp(e["ts"])} {e["source"]} `{e["what"]}` ({e["why"]})' for e in github]
        lines.append("")
    if bypass:
        lines += ["## Dropped by nftables (bypassed the proxy)", ""]
        grouped = Counter(e["what"] for e in bypass)
        lines += [f"- `{what}` x{count}" for what, count in grouped.most_common()]
        lines.append("")
    if other_hosts:
        lines += ["## Other destinations through the proxy", ""]
        lines += [f"- {host} x{count}" for host, count in other_hosts.most_common()]
        lines.append("")
    if secrets_calls:
        lines += ["## Secret Service calls", ""]
        lines += [f"- `{call[:200]}`" for call in secrets_calls[:40]]
        lines.append("")
    print("\n".join(lines))
    if json_path:
        with open(json_path, "w") as handle:
            json.dump({"upstream": upstream, "allowed": allowed, "github_unknown_path": github, "bypass": bypass, "other_hosts": other_hosts, "secrets_calls": secrets_calls, "real_home_changed": real_home_changed, "scratch_profiles": scratch_profiles}, handle, indent=2, default=dict)
    if real_home_changed:
        return 2
    return 1 if upstream else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
