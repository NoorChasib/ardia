#!/usr/bin/env python3
"""usage: cpu-audit.py --out FILE.json [--bench 10-15] [--interval 1] [--until-pid PID] [--seconds S]

Samples every task in /proc once per interval: the CPU it last ran on (psr), its
utime+stime, its cgroup and its allowed CPUs. Each task's CPU time between two samples is
charged to the CPU it was on at the second sample. Tasks are classed as bench-app (in
ardiabench.slice and allowed only bench CPUs), bench-other (in ardiabench.slice, e.g. the
orchestrator), kernel (kthreads) or foreign. Writes per-second foreign CPU on the bench
CPUs, the top foreign tasks there, bench-app tasks seen off the bench CPUs, and /proc/stat
busy time of the bench CPUs. Stops when --until-pid exits or after --seconds.
"""
import argparse
import json
import os
import sys
import time


def cpu_list(text):
    out = set()
    for part in text.strip().split(","):
        if part:
            a, _, b = part.partition("-")
            out.update(range(int(a), int(b or a) + 1))
    return out


def core_busy(cores):
    busy = 0
    with open("/proc/stat") as f:
        for line in f:
            name, *fields = line.split()
            if name.startswith("cpu") and name[3:].isdigit() and int(name[3:]) in cores:
                v = list(map(int, fields))
                busy += v[0] + v[1] + v[2] + v[5] + v[6] + v[7]
    return busy


def task_info(pid, cache):
    entry = cache.get(pid)
    if entry is None or "ardiabench.slice" in entry["cgroup"]:
        try:
            with open(f"/proc/{pid}/cgroup") as f:
                cg = f.read().strip().split("::", 1)[-1]
            with open(f"/proc/{pid}/status") as f:
                fields = dict(line.split(":\t", 1) for line in f.read().splitlines() if ":\t" in line)
            entry = {"cgroup": cg, "ppid": int(fields.get("PPid", "0")), "allowed": fields.get("Cpus_allowed_list", "").strip(), "name": fields.get("Name", "").strip()}
        except OSError:
            entry = {"cgroup": "?", "ppid": -1, "allowed": "", "name": "?"}
        cache[pid] = entry
    return entry


def sample():
    tasks = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            tids = os.listdir(f"/proc/{pid}/task")
        except OSError:
            continue
        for tid in tids:
            try:
                with open(f"/proc/{pid}/task/{tid}/stat") as f:
                    text = f.read()
            except OSError:
                continue
            close = text.rfind(")")
            comm = text[text.find("(") + 1:close]
            fields = text[close + 2:].split()
            tasks[(int(pid), int(tid), int(fields[19]))] = (int(fields[11]) + int(fields[12]), int(fields[36]), comm)
    return tasks


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True)
    parser.add_argument("--bench", default="10-15")
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--until-pid", type=int)
    parser.add_argument("--seconds", type=float)
    args = parser.parse_args()
    bench = cpu_list(args.bench)
    hz = os.sysconf("SC_CLK_TCK")
    cache = {}
    series = []
    foreign_tasks = {}
    off_core_app = {}
    category_ticks = {"bench-app": 0, "bench-other": 0, "kernel": 0, "foreign": 0}
    category_ticks_any = {"bench-app": 0, "bench-other": 0, "kernel": 0, "foreign": 0}
    start = time.time()
    prev = sample()
    prev_busy = core_busy(bench)
    prev_t = time.time()
    while True:
        time.sleep(args.interval)
        now = sample()
        busy = core_busy(bench)
        t = time.time()
        dt = t - prev_t
        per = {"bench-app": 0, "bench-other": 0, "kernel": 0, "foreign": 0}
        for key, (ticks, psr, comm) in now.items():
            before = prev.get(key)
            delta = ticks - before[0] if before else 0
            pid = key[0]
            info = task_info(pid, cache)
            if pid == 2 or info["ppid"] == 2:
                cls = "kernel"
            elif "ardiabench.slice" in info["cgroup"]:
                cls = "bench-app" if info["allowed"] and cpu_list(info["allowed"]) <= bench else "bench-other"
            else:
                cls = "foreign"
            if delta > 0:
                category_ticks_any[cls] += delta
            if psr in bench:
                if delta > 0:
                    per[cls] += delta
                    category_ticks[cls] += delta
                    if cls == "foreign":
                        f = foreign_tasks.setdefault(f"{pid}:{info['name']}:{comm}", {"ticks": 0, "cgroup": info["cgroup"], "allowed": info["allowed"]})
                        f["ticks"] += delta
            elif cls == "bench-app":
                o = off_core_app.setdefault(f"{pid}:{info['name']}:{comm}", {"samples": 0, "psr": set(), "allowed": info["allowed"]})
                o["samples"] += 1
                o["psr"].add(psr)
        series.append({"t": round(t - start, 1), "foreignPct": round(per["foreign"] / hz / dt * 100, 1), "kernelPct": round(per["kernel"] / hz / dt * 100, 1), "benchAppPct": round(per["bench-app"] / hz / dt * 100, 1), "benchOtherPct": round(per["bench-other"] / hz / dt * 100, 1), "coresBusyPct": round((busy - prev_busy) / hz / dt * 100, 1)})
        prev, prev_busy, prev_t = now, busy, t
        if args.until_pid and not os.path.exists(f"/proc/{args.until_pid}"):
            break
        if args.seconds and t - start >= args.seconds:
            break
    seconds = time.time() - start
    def stats(name):
        values = [s[name] for s in series]
        values_sorted = sorted(values)
        return {"mean": round(sum(values) / len(values), 1) if values else None, "p50": values_sorted[len(values) // 2] if values else None, "p95": values_sorted[min(len(values) - 1, int(len(values) * 0.95))] if values else None, "max": max(values) if values else None}
    top = sorted(foreign_tasks.items(), key=lambda kv: -kv[1]["ticks"])[:25]
    report = {
        "bench": args.bench,
        "seconds": round(seconds, 1),
        "samples": len(series),
        "onBenchCpus": {name: stats(name) for name in ("foreignPct", "kernelPct", "benchAppPct", "benchOtherPct", "coresBusyPct")},
        "cpuSecondsOnBenchCpus": {k: round(v / hz, 2) for k, v in category_ticks.items()},
        "cpuSecondsAnywhere": {k: round(v / hz, 2) for k, v in category_ticks_any.items()},
        "topForeignOnBenchCpus": [{"task": k, "cpuS": round(v["ticks"] / hz, 2), "cgroup": v["cgroup"], "allowed": v["allowed"]} for k, v in top],
        "benchAppSeenOffBenchCpus": [{"task": k, "samples": v["samples"], "psr": sorted(v["psr"]), "allowed": v["allowed"]} for k, v in off_core_app.items()],
        "series": series,
    }
    with open(args.out, "w") as f:
        json.dump(report, f, indent=1)
    summary = {k: report[k] for k in ("bench", "seconds", "samples", "onBenchCpus", "cpuSecondsOnBenchCpus", "cpuSecondsAnywhere")}
    summary["topForeignOnBenchCpus"] = report["topForeignOnBenchCpus"][:8]
    summary["benchAppSeenOffBenchCpus"] = report["benchAppSeenOffBenchCpus"][:8]
    json.dump(summary, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
