# Feedback and telemetry

How Nilla (app and CLI) would know who hit a problem, what they saw, and whether the fix held. Nilla ships with no
telemetry or feedback server (`docs/services.md`): every endpoint is `null`, so nothing here leaves the device until the
owner sets one. This is the contract the app, the CLI and the dormant feedback service build against. Change it here
first.

## Identity

- **Install id** (`installId` in `telemetry.json`): a random UUIDv4 from the native secure source, made at
  the first opt-in or first report and then kept for life. Updates, downgrades, sharing toggles and newer
  file formats never change it. Only Settings › Privacy › "Reset my anonymous ID" replaces it. Nothing is
  sent with it while sharing is off, except a report the user sends and the 14-day watch they opt into.
- **Session id**: a UUIDv7 made at each app launch, sent as `$session_id` on every app event and saved as
  `sessionId` in `telemetry.json` while the app runs. CLI events carry the app's `sessionId` when the app
  session is open, else a UUIDv7 per CLI process.
- **Name and avatar**: `packages/core/src/anonymousIdentity.ts` turns an id into `{ name, avatar }`.
  Name: adjective + animal ("Brave Otter"). Avatar: three colours and an angle for a gradient blob. Pure and
  deterministic; never stored, never sent. The app and the feedback service both use it.
- **No ping without consent.** There is no daily or launch count sent with sharing off; the old `daily_active` sender
  is gone.

## Events

- Every app event: `$session_id`, plus the existing common properties. CLI: the same.
- Sending needs `services.telemetryUrl` and `services.ingestKeys`. Without them a send is logged as "not sent"
  (`RequestLogEntry.status` `-1`, `dryRun: true`), the queue is kept (capped at 1,000 events and 200 log lines) and no
  retry is scheduled; nothing counts it as delivered.
- Ingest key: every POST sends `X-Ardia-Key` with the surface's key from `services.ingestKeys` (`app`, `cli`, `site`).
  The header name is in `packages/core/src/ingestKeys.ts`. With no keys set, no header is sent.

## Local copy (7 days)

- Everything the app builds as an event or log line, sent or not (sharing off included), is appended to
  `<data dir>/Telemetry/local/<UTC day>.jsonl`, one record per line with `sent` true or false (whether sharing let it
  into the queue).
- Kept 7 days, capped at 8 MB in total (oldest lines go first), pruned at launch and hourly. Writes are
  batched (every 10 s, at quit, and at once for a crash) and never block the UI thread.
- The CLI keeps its own copy in the same folder as `cli-<UTC day>.jsonl`, 7 days, 4 MB.
- It leaves the device only when sharing is on and an endpoint is set, or when the user attaches it to a report sent
  to a configured feedback service.
- It measures itself: an hourly `telemetry_local_store` event with bytes, lines, files, write time p95,
  prune time, lines dropped for the cap, queue bytes, bytes posted, failed posts.

## 14-day watch

- A report from someone with sharing off can opt in to "Help confirm the fix: share crash reports and usage
  for 14 days". That turns sharing on with `sharingUntil` (14 days) and `watchReport` (`FB-…`) in
  `telemetry.json`. Every event during it carries `watch_report`. At `sharingUntil` sharing turns itself off
  and the app says so once. Settings shows the end date and lets them stop early.
- Reports from people who already share are watched for 14 days without asking.
- It needs a feedback service to hand out the `FB-…` reference, so it never starts in a build without one.

## Report a Problem (app)

Help › Report a Problem… (⌥⇧⌘I) and the New Tab check-in banner open it.

- **No feedback service (the default):** it opens `services.issueUrl` with a static body ("What happened? / What did you
  expect?") and nothing else in the address, then offers the system details in a dialog with Copy Details, so the user
  chooses what to paste. It counts `report_sheet_opened` with `form: "issue_page"`. A test checks the address carries
  only the `body` field. The Mac's `ReportUploader` refuses to upload without a configured feedback URL.
- **With a feedback service:** the sheet opens. Kind · Title (live counter, 67 max) · What happened? (required) · Record
  the problem (with "Include web pages", unticked, chosen before recording) · Slow adds a 30-second capped trace ·
  Attached (one summary row, expands in place with checkboxes and a preview) · the 14-day watch (sharing off only) ·
  Contact (optional). Send needs a title and a description; pressing it with either missing outlines the field in red
  and counts `report_send_blocked` (`reason`, `problems`, `kind`). Recording: the app's windows only, 60 s max, web page
  areas blacked out in every frame unless included, watched before sending. Sent screen: the reference, the GitHub
  issue link, "You appear to us as <name>", and the watch end date.
- Linux never uploads in Layer 1: the engine's report endpoint is compiled in, so `report.send`, `NillaReport.upload` and
  `NillaReport.post` stay behind the Layer 1 gate and Linux always opens the issue page.

## CLI

`nilla-browser feedback --title "…" [--kind bug|slow|idea|other] [--attach FILE]… "description"` (or stdin). With no
feedback service (`feedback.FEEDBACK_URL` is `None`, mirroring `services.ts`) it keeps the report in
`<CLI home>/Usage/feedback.jsonl` and prints the issue page to open instead. With one, it sends to the same endpoint
with the same rules and prints the reference, the issue link and the name; "Sent" only after a 2xx. Scrubbing uses
exact secret patterns, never a cut at a keyword. A loopback `ARDIA_FEEDBACK_URL` points it at a local service for
tests, with the local CLI key.

## Feedback service (`infra/feedback`, dormant)

A self-contained template, not deployed. `lib/validate.mjs` and `lib/ids.mjs` stay byte for byte: the Linux engine's
report tests read them.

1. `POST /api/feedback` with `X-Ardia-Key`, JSON:
   `kind` (`bug` | `slow` | `idea` | `other`), `title` (1–67 characters, trimmed), `description`
   (1–4000), `source` (`app` | `cli`), `install_id` (when sharing is on or a watch is chosen; otherwise a
   one-time UUID), `session_id`, `app_version`, `app_build`, `channel`, `os_version`, `arch`,
   `cli_version`, `contact` (≤200, optional), `page_address` (≤2048, optional), `watch_days` (0 or 14),
   `diagnostics` (object, ≤64 KB), `attachments` (list of `{ name, bytes, type }`).
   Answers `201 { id: "FB-XXXX", name, upload_token, upload_urls, expires_at }`.
2. `PUT /api/feedback/<id>/files/<name>` with `Authorization: Bearer <upload_token>` for each attachment. Caps:
   recording 100 MB, trace 50 MB, other files 10 MB. Names: `recording.mp4`, `trace.json.gz`,
   `local-events.jsonl.gz`, `crash-<n>.ips`, `attachment-<n>.<ext>`.
3. `POST /api/feedback/<id>/complete` (Bearer): writes a `feedback_submitted` event through the collector, with
   `distinct_id` the install id or the one-time id, and opens a GitHub issue. Answers `{ id, name, issue_url }`.

- The GitHub issue is public: title, description (scrubbed of emails, keys, URL queries and home paths), kind, version,
  OS, the reference and a link to the triage page. Attachments, contact, page address and diagnostics never go to
  GitHub. The form says so. Labels: `feedback` on every report, plus `bug` for bug and slow, `enhancement` for idea.
- Keys: `lib/keys.mjs`. In production the accepted keys come from `FEEDBACK_APP_KEY` and `FEEDBACK_CLI_KEY` (both
  required, different from each other and from the local test keys). `--local` accepts only `local-app-key` and
  `local-cli-key`, and listens on loopback only.
- Production also requires `FEEDBACK_UPLOAD_SECRET` (32+ characters), `OBJECTS_HOST`, `COLLECTOR_HOST`,
  `GITHUB_REPO`, `DASHBOARD_URL` and `PUBLIC_URL`; `GITHUB_ISSUES_TOKEN` is optional (without it no issue is opened and
  the report is still stored). `node infra/feedback/server.mjs --help` lists them.
- `lib/core.mjs` loads `anonymousIdentity.ts` and `ingestKeys.ts` from `packages/core/src`, or from a `core/` folder
  beside it when packaged (the `Dockerfile` expects one).

### Local mode

```
node infra/feedback/server.mjs --local ~/nilla-scratch/feedback   # http://127.0.0.1:4319
ARDIA_FEEDBACK_URL=http://127.0.0.1:4319                          # in the CLI's env
```

- `bun run --cwd infra/feedback local` does the same into `infra/feedback/.local`.
- `ARDIA_FEEDBACK_URL` is an origin, without a path: clients POST to `$ARDIA_FEEDBACK_URL/api/feedback`. Local mode
  serves the same paths as production.
- Options: `--port <n>` (default `$PORT`, else 4319), `--host <addr>` (default 127.0.0.1; anything but loopback is
  refused), `--rate-limits` (off in local mode). `FEEDBACK_UPLOAD_SECRET` is optional there; without it a secret is
  made once and kept in `<dir>/.upload-secret`, so tokens survive a restart.
- It checks everything production checks, `X-Ardia-Key` included (`local-app-key` with `source: app`,
  `local-cli-key` with `source: cli`).
- `upload_urls` is an object, attachment name → absolute URL to PUT. Every PUT must send exactly the declared
  `bytes` (else 400 or 413). The token lasts 24 hours and only works for its own report.
- Errors are `{ error, message }`: 400 `invalid` (the message names the field), 401 `token_*`, 403 `bad_key`,
  404, 409 `completed` (a PUT after complete), 413, 415 (not JSON), 429 `rate_limited`, 502 `upstream:<backend>`
  (`upstream:storage`, `upstream:collector` or `upstream:issues`, with `backend`, `retryable: true` and
  `Retry-After: 60`), 500 `internal`. Every 5xx is logged as
  `[feedback] <method> <path> failed (<backend or internal>): <stack>`. Complete is idempotent.
- Only storage is required. Complete answers success when GitHub fails (the report keeps `issue_error`) and when the
  collector fails: `complete.json` keeps `event_sent: false` and the service retries the event in the background
  (30 s, 2 min, 10 min, 30 min, then hourly, 8 tries).
- What lands in `<dir>`: `feedback/<id>/report.json`, the uploaded files, `issue.md` (the would-be public issue,
  already scrubbed), `event.json` (the exact OTLP request the collector would get) and `complete.json`, plus every
  event appended to `events.jsonl`. `issue_url` is a `file://` link to `issue.md`.
- Tests: `bun run --cwd infra/feedback test`; the CLI's end-to-end test starts it in local mode.
