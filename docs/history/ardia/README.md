# Ardia's history

Nilla is a fork of [Ardia](https://github.com/ardia-browser/ardia) (originally
[mantrakp04/ardia](https://github.com/mantrakp04/ardia)), by Mantra Patel and its contributors, forked on 2026-11-18.
This folder keeps Ardia's records from before the fork. They describe Ardia's releases, builds and work, not Nilla's:
nothing here is a Nilla release, a Nilla measurement or a claim about Nilla. Issue and pull request numbers in these
files are Ardia's (`ardia-browser/ardia#<n>`), and the "Thanks, @…" credits in the release notes stay as Ardia wrote
them.

| Path | What it is |
| --- | --- |
| `release-notes/` | Ardia's release notes, 0.1.0 to 0.2.47-nightly.5 (122 files), with their contributor credits |
| `releasing.md` | Ardia's release flow: signing, Sparkle, the nightly channel, the site and the engine releases |
| `ardiacore-spike.md`, `ardiacore-parity.md` | The move from CEF to ArdiaCore, and the parity record kept during it |
| `perf/field-journeys.md`, `perf/sprint.md` | Ardia's field data and perf sprint reports |
| `windows/` | Screenshots of Ardia's Windows app |

Every archived Markdown file starts (after its frontmatter, for the release notes) with one line naming the upstream
repository. Nothing else in them was changed, so their relative links still point where they did in Ardia's layout,
and some no longer resolve from here. To follow one, read the tree as it was before the move:
`git show 1fad6ed2a^:docs/<path>` (for example `git show 1fad6ed2a^:docs/linux-ci.md`), or browse that commit. Link
checks on Nilla's own docs leave this folder out.

Kept in place, also as records of Ardia's tree:

- `docs/audit/` holds the performance and architecture audit made on Ardia's tree on 2026-11-18, just before the
  rename. It is kept byte for byte; the paths, names and numbers in it are Ardia's as they were then.
- `docs/perf/0.2.*` compares Ardia releases with each other. Those numbers measure Ardia's builds, not Nilla's.

Nilla's own release notes start in `docs/release-notes/` with its first release, and `docs/releasing.md` says what a
Nilla release still needs.
