# nilla-isolate: the isolation and no-upstream harness

This harness covers plan-v2 §2.6 items 9 (the Linux app runs only inside disposable isolation) and 10 (the
no-upstream check). It sits outside the repo and needs no root.

| File | What it does |
| --- | --- |
| `nilla-isolate` | The runner. It starts a command in user, mount and PID namespaces with a scratch `$HOME`. With `--net` it adds a network namespace with deny-by-default egress and a logging proxy. `--setup` creates `.venv` with mitmproxy |
| `isolate-inner.sh` | Runs as root inside the new user namespace. It sets up the mounts, the network, nftables and the log helpers, then drops to your uid in a nested user namespace |
| `isolate-session.sh` | Runs unprivileged and holds no capabilities. It starts a private D-Bus with a Secret Service monitor, adds the throwaway CA to an NSS db, starts Xvfb, then runs the command |
| `proxy_addon.py` | mitmproxy addon. It logs every CONNECT and request (host, path, method, user agent) to `logs/proxy.jsonl`, and refuses fixed-list destinations with 451 in the default mode |
| `dnslog.py` | DNS stub on 127.0.0.53 inside the namespace. It logs every lookup and answers with a different sinkhole address for each name |
| `unixbridge.py` | Carries the namespace's proxy port to the host's mitmproxy through a Unix socket in the run directory |
| `upstream_rules.py` | The fixed list from §2.6 item 10 and its allowed exceptions. The addon and the checker both use it |
| `check-upstream.py` | Reads a run's logs and prints a Markdown report. It exits 0 when the run is clean, 1 when there was an upstream attempt, and 2 when the isolation broke |
| `exercise-linux.mjs` | Drives the packaged Linux app over CDP: the launch, Settings › General › Updates (it fails if Check Now or any update control is offered), Report a Problem (it fails unless a draft opens at exactly `https://github.com/NoorChasib/nilla/issues/new` with only the app's `REPORT_ISSUE_BODY` as `body`), a page load, the timers step (every shell's virtual clock moves past the 6 h update interval), the consent step (with `--sharing on` the profile starts with sharing on; either way the app's saved choice must match, it may not post, and every telemetry request it logged is a dry run with no endpoint), the CLI against the instance, a timed idle, then quit |
| `exercise-checks.mjs` | The report-draft and CLI checks the exercise applies, as plain functions; `node --test exercise-checks.test.mjs` runs their cases without an app |
| `launch-dev.sh` | The exercise's launcher: it starts the extracted package through the repo's `scripts/linux/nilla-dev-run`, with `ARDIA_DATA_DIR` and `ARDIA_CONFIG_HOME` under `DIR/dev`. A bare `bin/ardia` launch stops at the isolation page before the engine starts |
| `baseline-linux.sh` | All of the above in one command, for a `scripts/linux/package.py` tarball |

## Usage

```sh
tools/isolate/nilla-isolate --setup

cd /home/noor/Code/ardia
scripts/linux/fetch-engine.sh --nearest
bun run --cwd apps/linux build
scripts/linux/fetch-ubo.sh
python3 scripts/linux/package.py --out <engine dir> --ui apps/linux/dist \
  --content-blocker packages/ardiacore/vendor/ubo/ext --no-ubo-seed \
  --version 0.2.47-nightly.5 --destination <scratch>/ardia.tar.xz

tools/isolate/baseline-linux.sh --package <scratch>/ardia.tar.xz --run <new run dir> --idle-seconds 420

tools/isolate/nilla-isolate --run <dir> --net --display --bind-ro <pkg dir> -- <command>
tools/isolate/check-upstream.py <dir> [--since EPOCH --until EPOCH] [--json out.json]
```

Run all build steps on the host, before the exercise. Only fetching the engine and uBO reaches the network, and that is
the build-time exception. Pass `--no-ubo-seed` to `package.py`: when it has a content blocker and no such flag, it
launches the staged `chrome` to seed uBO, and that launch would run outside the namespace.

A run directory holds everything a run writes:

- `home/`: the scratch `$HOME`.
- `dev/`: the instance's `ARDIA_DATA_DIR` (`dev/data`) and `ARDIA_CONFIG_HOME` (`dev/config`, the engine's
  `ardia` user data dir under it).
- `ca/`: the throwaway mitmproxy CA and the CA bundle.
- `logs/`: these files.
  - `proxy.jsonl`, `dns.jsonl` and `egress.pcap` (nftables drops, read with `tcpdump -n -tttt -r`).
  - `dbus-secrets.log`, `nft-initial.txt` and `nft-final.txt` (with counters).
  - `namespace.txt`, which records the mounts, links, routes and the session's uid and CapEff.
  - `realhome-before.txt`, `realhome-after.txt` and `realhome.diff`.
- `exercise/`: `exercise.json` with step times, `app.log` and screenshots.
- `check.md` and `check.json`.

Proxy modes (`--proxy-mode`):

- `block-upstream` (default): refuses fixed-list destinations inside the proxy, so nothing reaches upstream, and
  forwards everything else so pages load.
- `forward`: forwards everything.
- `offline`: answers every request with 503.

## Design, and why this one

The host allows unprivileged user namespaces:

- `kernel.unprivileged_userns_clone=1`
- `kernel.apparmor_restrict_unprivileged_userns=0`
- `user.max_user_namespaces=248697`

Inside a user namespace we own, we have `CAP_NET_ADMIN` and `CAP_SYS_ADMIN` over the namespaces we create, so mounts,
a dummy interface, nftables and NFLOG all work without root. `sudo -n true` also works on this host, but nothing here
uses it.

The least-privileged design that still logs every attempt:

- **Filesystem.** The real home is covered by an empty tmpfs, which is remounted read-only. Only the needed paths come
  back:
  - read-only: the repo, this tool, the directories holding the `node` and `bun` binaries, and the package's directory;
  - read-write: the run directory.

  A program that ignores `$HOME` and writes to `/home/noor/...` gets EROFS, instead of a silent write somewhere.
  `/tmp`, `/run`, `/dev/shm` and `/var/tmp` are fresh tmpfs mounts. Hiding `/run` removes the host's session and
  system D-Bus sockets, systemd-resolved's varlink socket (a DNS path around the stub), docker.sock and any keyring
  sockets. Abstract Unix sockets are scoped to the network namespace, so the host's abstract sockets are out of reach.
  The command runs as your uid in a nested user namespace with `CapEff=0`, so it can't unmount anything.
- **Network.** The only interfaces are `lo` and a dummy `isolate0` that carries the default routes, for IPv4 and IPv6.
  Without that route, a connect to an outside address would fail with ENETUNREACH before netfilter saw it, and nothing
  would be logged. nftables (`table inet isolate`, output hook, `policy drop`) accepts loopback and runs
  `counter log group 1 drop` on everything else. NFLOG is the only log target that works here:
  `net.netfilter.nf_log_all_netns=0` keeps namespace packets out of the kernel log, and `dmesg` is restricted.
  tcpdump on `nflog:1` writes the dropped packets to `egress.pcap`.
- **DNS.** `/etc/resolv.conf` points into `/run`, so a fresh `stub-resolv.conf` sends lookups to `dnslog.py`. The
  stub gives each name its own sinkhole address in 10.201.0.0/16. A process that bypasses the proxy then connects to
  that address, nftables drops and logs the packet, and the checker maps it back to the name.
- **Proxy.** No network device leads out of the namespace. The proxy port 127.0.0.1:3128 is a relay to a Unix socket
  in the run directory, and the host's `mitmdump` listens on the other end, on host loopback. The CA it generates is
  trusted only inside the namespace:
  - an NSS db at `home/.pki/nssdb`, used by Chromium;
  - a bundle passed as `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` and `CURL_CA_BUNDLE`, for Python and curl;
  - `NODE_EXTRA_CA_CERTS`, for node.

  `connection_strategy=lazy` lets the addon refuse a request before mitmproxy opens any upstream connection.
- **Secrets.** A private session bus has no activatable services, so nothing can store a secret. `dbus-monitor` logs
  every call to `org.freedesktop.secrets`, KWallet or `org.gnome.keyring`. A libsecret attempt therefore shows up as a
  logged call followed by ServiceUnknown.
- **Real home check.** Before and after each run, the runner snapshots `~/.config/ardia`, `~/.config/nilla`,
  `~/.local/share/keyrings` and `~/.pki/nssdb`: a recursive listing with sizes and modification times. If the
  snapshot changed, it exits 3.

## Limits

- **Loopback is open.** nftables accepts all loopback traffic, which is how the CDP driver, the DNS stub and the proxy
  relay reach each other. Loopback can't leave the namespace, so this is not egress. It can hide a local service that
  forwards traffic, but in this design anything a local service forwards still has to leave through the proxy or
  through `isolate0`, and both are logged.
- **No process attribution.** The proxy and NFLOG logs don't say which process made a request. The user agent tells
  Chromium apart from curl, Python or node.
- **GitHub owners are matched by path.** The fixed list's GitHub rows are judged by path. A CONNECT whose TLS
  handshake failed, a DNS-only lookup or a dropped packet to a GitHub host has no path, so the report lists it under
  "GitHub without a visible path" and makes no judgement. Release downloads redirect to `objects.githubusercontent.com`
  with no owner in the path. The flagged request there is the `github.com/<owner>/.../releases/download/...` request
  that comes before the redirect.
- **Timers.** The exercise idles for `--idle-seconds`. The Linux base's longest automatic intervals are:
  - update checks: 30 s after launch, then every 6 h (`hostUpdates.ts`, `CHECK_EVERY_MS`);
  - the daily ping: 30 s after launch, then a recheck every hour (`telemetry/daily.ts`);
  - kill switches: once, after the first window (`killSwitchesLaunch.ts`).

  A few minutes catches the first firing of each. A full §2.6 item 10 pass needs `--idle-seconds 21700` or more.
- **Real home snapshot.** The snapshot covers four paths, not the whole home. The namespace makes the real home
  read-only and invisible anyway, so the snapshot shows that nothing leaked out, but it doesn't scan the whole home.
- **Display.** Only Xvfb inside the namespace, with no TCP listener. It has no window manager, so the exercise uses
  CDP input on the shell renderers, not real X input. Acceptance runs that need xdotool can run inside the same
  namespace.
- **Host prerequisites.** Needs unshare, nft, ip, tcpdump, Xvfb, dbus-daemon, dbus-monitor and certutil
  (libnss3-tools), and mitmproxy in `.venv`. If AppArmor starts restricting unprivileged user namespaces
  (`kernel.apparmor_restrict_unprivileged_userns=1`), the runner refuses to start and says why.
- **CLI.** The CLI and its browse daemon run inside the same namespace when they are part of the command: they get
  the proxy and CA environment, and a direct connection hits nftables. The exercise's `cli` step turns CLI control on
  and runs `nilla-browser` with `--python` (default `/home/noor/ardia-work/venv-cli/bin/python`, whose virtualenv
  `baseline-linux.sh` binds read-only), with the same two variables as the instance. `windows` and `tabs` must
  exit 0; `browse --port N tab <the page's CDP target id>` and `browse --port N get url` must exit 0 and read the page
  step's URL; `windows` with neither variable must exit 2 with the data-folder refusal. `pinned`, `feedback`,
  `browse get url` through the control file and `browse --port N tab active` are recorded only: on this Linux build
  no `ArdiaControl.json` is written, so the control-file routes report that Nilla isn't running.

The command starts in `<run>/cwd`, never in the directory nilla-isolate was called from, so relative writes stay inside the run. A relative command path is resolved against the calling directory first, which is exported as `ISOLATE_ORIG_CWD`.
