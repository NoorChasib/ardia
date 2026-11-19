# Lead decisions during the Nilla Layer 1 run

- 2026-11-19 History is not rewritten. Commits that don't build on their own are listed in the Nilla PR: the wave 1
  range 3fdb394ea..6a77ca9d4^ (S's deletions repaired in 6a77ca9d4; 74b4c28b7 carries G's release-script moves) and
  R's move commit eb354d06b (apps/cli/scripts/build.sh still names ardia_cli until 8a54bbb71). Merge commits keep them.
- 2026-11-19 docs/perf keeps every recorded byte except path-only link fixes to files D moved into docs/history/ardia/
  (two links to sprint.md).
- 2026-11-19 Full guard hardening (owner's choice 2): see owner-requirements.md "Guard hardening".
- 2026-11-19 Shared Folders refusing Ardia's shared folder stays (independence).
- 2026-11-19 Onboarding and the importer list Ardia like any other browser; detection reads only what the same code
  reads for Chrome to show a row; Ardia's profile data is read only after the user picks Ardia.
