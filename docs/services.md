# Services

Nilla talks to no server of its own. Every endpoint the app, the command and the phone could send to lives in one
frozen constant, `packages/core/src/services.ts`, and every one of them ships as `null`. Only two values are set:
`sourceRepo` (`NoorChasib/nilla`) and `issueUrl` (`https://github.com/NoorChasib/nilla/issues/new`). With an endpoint
`null`, the code that would use it does nothing: no request, no retry, no queue drain.

The only outside traffic a Layer 1 build makes is Helium's bang list (`services.helium.imput.net`, credited) and, at
build time only, the prebuilt engine from `ardia-browser/ardia` releases. Chromium's own component updater and uBlock
Origin's filter lists are the engine's and the extension's, not Nilla's.

## The fields

| Field | What it turns on | When `null` | Native mirrors |
| --- | --- | --- | --- |
| `telemetryUrl` | Posting opted-in events and logs (OTLP logs) | Nothing is posted. Events still land in the 7-day local copy; a send is logged as "not sent" and the queue is kept. Settings › Privacy, onboarding and the New Tab ask say "Nilla sends no usage data." | CLI `telemetry.LOGS_URL`; phone `platform/telemetry.ts` reads `services.ts`; Android `LabNetworkLog.TELEMETRY_HOST` |
| `ingestKeys` | The `X-Ardia-Key` value each surface sends (`{ app, cli, site }`) | No key header is sent | CLI `telemetry.CLI_INGEST_KEY` |
| `feedbackUrl` | Report a Problem uploads to the feedback service | Report a Problem opens `issueUrl` with a static body and offers the details to copy separately; the command keeps the report locally and prints `issueUrl` | Mac `ServicesConfig.feedbackURL` (`ReportUploader` refuses to upload without it); CLI `feedback.FEEDBACK_URL` |
| `switchesUrl` | Fetching the kill-switch file once a launch | No fetch, and cached remote values are ignored (`docs/kill-switches.md`) | – |
| `macFeedUrl` | Sparkle's appcast on the Mac | Sparkle stays off: `Info.plist` has an empty `SUFeedURL` and `SUPublicEDKey` | Mac `ServicesConfig.macFeedURL` |
| `windowsFeedUrl`, `windowsTrustedPrefix` | The Windows update manifest and the address prefix its installers must start with | The updater isn't set up: it needs both. An empty prefix is refused everywhere, since every address starts with "" | Windows `AppServices` in `UpdateModule.h` |
| `linuxReleasesUrl` | Reserved for a Nilla release list on Linux | Linux updates stay behind the Layer 1 gate regardless | – |
| `releaseNotesUrl` | The release-notes page after an update and in Help | Nothing opens and the menu item hides | Mac `ServicesConfig.releaseNotesURL`, `NLReleaseNotesURL` in `Info.plist` |
| `siteUrl` | The setup-code link in onboarding and the Settings row | Both are hidden | – |
| `sourceRepo` | About, Settings › Updates, the phone's About and Licenses, the web demo | – | Mac `ServicesConfig.sourceRepo`; CLI `star.REPO`; `apps/cli/tests/test_feedback.py` checks the CLI against `services.ts` |
| `issueUrl` | Report a Problem without a feedback service | – | Mac `NLFeedbackURL` in `Info.plist`; CLI `feedback.ISSUE_URL` |

The `X-Ardia-Key` header name stays in `packages/core/src/ingestKeys.ts`; the Linux engine's tests assert it. The
`FEEDBACK_URL` line in `apps/browser/src/state/report/actions.ts` is the Linux engine's compiled endpoint, kept for the
same reason and never used.

## Linux

Today's Linux engine compiles its telemetry, update, kill-switch and report destinations in, so any setting here would
turn upstream back on. `apps/linux/src/layer1Gate.ts` therefore refuses those calls at the host boundary whatever
`services.ts` says: `ArdiaTelemetry.post`, `ArdiaUpdates.releases`, `ArdiaShell.fetchKillSwitches`, `ArdiaReport.upload`,
`ArdiaReport.post`, the `report.send` capability, every `ArdiaSync.*` and `ArdiaLive.*` call,
`ArdiaSystem.setAsDefaultBrowser`, `ArdiaSystem.setLaunchAtLogin` and `ArdiaCli.install`. The app's host is wrapped once
in `host.ts`, which drops those names from the advertised capabilities (so the UI hides their entry points) and rejects
them with `ERR_UNSUPPORTED` before native dispatch; `invokeHost`, `callHost`, `hostSupports` and `hostModuleMethod` check
the same list for any host they're given, except `ArdiaLive.*`, which the engine's live contract suite drives through
its own host. The gate goes when Nilla's own Linux engine lands (Layer 2).

## Tests

- Node and Bun tests: `overrideServicesForTests(partial)` from `packages/core/src/services.testing.ts` replaces the
  snapshot and throws outside a test runner. Only test files may import it; `services.testing.test.mjs` scans the tree.
- A Mac or Windows test instance: put a JSON file of fields in `ARDIA_TEST="services=<path>"`. The launch config honours
  `ARDIA_TEST` only in an authorized test instance. The Mac reads it once in `ServicesConfig.swift`, Windows in
  `UpdateModule.h`; both refuse the whole file for an unknown field, a non-https URL or a wrong type, log why, and hand
  the snapshot to JS through `launchConfig().services`, which `platform/launchConfig.ts` adopts before any consumer
  reads the services. A non-test instance ignores the key.
- Linux tests only the `null` defaults; the gate wins anyway.

## Turning one on

Change the field in `services.ts` (and its mirror, where the table names one), then:

- Telemetry: an ingest key per surface, and a collector that accepts OTLP logs with that key.
- Feedback: run `infra/feedback` with `FEEDBACK_APP_KEY`, `FEEDBACK_CLI_KEY`, `GITHUB_REPO`, `DASHBOARD_URL` and
  `PUBLIC_URL` (`docs/feedback.md`).
- Mac updates: a Sparkle EdDSA key pair. The public key goes in `SUPublicEDKey`; the feed alone isn't enough.
- Windows updates: the feed and the trusted prefix together, and installers published under that prefix.
- Kill switches: host a `{ "version": 1, "switches": {} }` file (`apps/browser/src/platform/fixtures/switches.json`).
- Linux: nothing until Layer 2 removes the gate.
