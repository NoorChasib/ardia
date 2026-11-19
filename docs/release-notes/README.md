# Release notes

One Markdown file per version: `docs/release-notes/<version>.md`, where `<version>` is the app's
`MARKETING_VERSION` exactly (`0.1.0.md`). Nilla has no releases yet, so this folder holds only this guide; Ardia's
notes from before the fork are in `docs/history/ardia/release-notes/` and are never published as Nilla's.

Write the file before running `scripts/release.sh`, which refuses to build without it. Once releases are set up
(`docs/releasing.md`), the same file goes to two places:

- **The GitHub release** on `NoorChasib/nilla`: `release.sh` writes `dist/<version>/release-notes.md` (the body, then
  the standard Install section and a Source section linking this version's tag and its engine source) for
  `gh release create --notes-file`. Don't write a Source line in the notes file: `release.sh` adds it to every release
  (`docs/releasing.md` › Source and licenses).
- **The update dialog**: `release.sh` embeds the headline and body in the appcast item, so Sparkle's "A new version is
  available" window shows them (it renders the Markdown).

## The file

```markdown
---
date: 2026-12-01
headline: Tabs stay where you left them.
---

## Fixed

- **⌘-scroll no longer zooms with a trackpad.** Resting a thumb on ⌘ while scrolling with two fingers
  zoomed the page. It scrolls now; pinch to zoom instead. With a wheel mouse, ⌘-scroll still zooms.
```

Frontmatter, one `key: value` per line (`scripts/lib/release-note.mjs` reads it for `release.sh` and refuses anything
else; quote a headline that holds `: `):

- `date`: the day the release is published, `YYYY-MM-DD`.
- `headline`: one line, the deadpan part (below).

Check that it reads before you commit it: `node scripts/lib/release-note.mjs docs/release-notes/<version>.md headline`.

Body:

- An intro paragraph before the first section is optional. Use it only for a big release (the first one, a redesign)
  and keep it to two or three plain sentences.
- Sections are `##` headings, only the ones the release needs, in this order: `## New`, `## Faster`, `## Fixed`,
  `## Smaller`, `## Not yet`. When a release is mostly a fix for something broken, put `## Fixed` first.
  - **New**: things people can do now that they couldn't before.
  - **Faster**: the measured old-against-new table (below), plus a bullet for any speed-up worth a sentence.
  - **Fixed**: things that were broken and now work.
  - **Smaller**: polish and minor fixes, one line each, no bold lead.
  - **Not yet**: known gaps worth saying out loud (a big release only).
- Each item is one bullet: a **bold lead sentence** that states the change from the user's side, then at most three
  plain sentences: what people saw before, what happens now, where to find it or who it affects. Items in Smaller are
  a single sentence without bold.
- `## Faster` carries one table, only when the release is measurably faster than the previous Nilla release: the rows
  that moved in the release's perf gate (columns old version, new version, change; plain-language row names), then
  one sentence on what moved most. Never compare against Ardia's numbers.
- Nothing else: no images, no other tables, no nested lists, no links unless the item is about a page.
- Say which platforms an item affects when it isn't all three, and name Mac things (⌘, the menu bar) with their Linux
  and Windows wording where it differs.

## Nightlies

If Nilla ever ships nightlies, a nightly's file is `docs/release-notes/<next stable>-nightly.<n>.md`
(`0.1.1-nightly.1.md`) with the same frontmatter. Keep it short: the headline and the one to three bullets for what
the nightly fixed, in `## Fixed` or `## New`, written exactly like a stable item, and no `## Faster`. The next stable's
notes cover everything since the previous stable, nightlies included, written fresh for people who never ran one.

## Voice

The notes are plain and useful. The wit goes in the headline only.

**Headline.** One sentence, 30 to 60 characters, ending with a full stop. It's about the release's most noticeable
change, said flatly, as if nothing much had happened. Dry and calm: deadpan, never a pun on the change, never an
exclamation mark. The fact under it must be true. No politics, no jokes at the user's expense, and no food or flavour
jokes about the name.

- "Tabs stay where you left them." (session restore fixed)
- "The menu bar can be used without consequences." (menu commands crashed the app)
- "Nothing you can see has changed, on purpose." (tidied source, the same app)

**Items.**

- Lead with what the user sees, not with what the code does: "Menu commands no longer crash the app", not
  "Fix selector in MenuTarget".
- Name the symptom people hit, so they recognise it: "every command in the menu bar crashed Nilla", "sites like Google
  waited forever at 'Complete sign-in using your passkey'".
- One short "why" is welcome when it explains the fix in user terms ("The menu items pointed at the wrong method.").
  No file names, class names, commit hashes or internal flags.
- Name menus by their path (Nilla › Check for Updates…, System Settings › Privacy & Security), shortcuts with symbols
  (⌘T, ⇧⌘T), settings by their label in quotes.
- Say which versions a regression affected when it matters ("In 0.1.0 and 0.1.1, …").
- "Like Dia" / "as in Dia" is fine where the feature copies Dia's behaviour.
- Don't write: "exciting", "we're thrilled", "various", "improvements", "bug fixes and performance improvements",
  "under the hood", emoji, exclamation marks.
- Straight quotes and apostrophes in the file are fine.

## From `git log` to a notes file

1. `git log --format='%h %s%n%b' v<previous>..HEAD`. The commit bodies explain the user-visible effect. For the first
   release there is no previous Nilla tag; write a short intro instead of listing everything since the fork.
2. Keep commits that change what someone using the app sees or can do: `apps/browser`, `apps/linux`, `apps/phone`,
   `packages/*`, `engine/`, `Info.plist`. Drop docs, tests, refactors and version bumps.
3. Merge commits that are one change for the user into one item. Split a commit that fixes two visible things into
   two items.
4. Sort each section by how many people it affects; crashes and data loss first.
5. Credit outside contributors. When a change came from someone's pull request, or a commit has a `Co-authored-by:`
   who isn't the owner or a coding agent, end its item with `Thanks, [@handle](<PR url>).` (their GitHub handle,
   linking the pull request). One credit per item, even when several commits fed it.
6. Pick the headline from the top item.
