# Nilla conversion: owner requirements (fixed)

The product name is **Nilla** (owner, 2026-11-18). Anything below or in other notes that says "Nila" means Nilla.

Decided by the owner (NoorChasib) on 2026-11-18. Implementation agents must follow these.

## Decisions
1. Rename everything to Nilla, including internal names and engine/. Layer 1: everything outside the engine
   interface (works with today's prebuilt engines). Layer 2: engine/ and the matching app-side interface names,
   on its own branch, to land with the first Nilla engine builds.
2. Nilla is an independent app: its own bundle ids, data folders, keychain items, nilla:// scheme, `nilla-browser` CLI, phone
   ids, Windows/Linux package ids. No migration from Ardia (Nilla can import from Ardia like any browser).
   Reverse-DNS prefix: `com.nilladigital` (owner's domain nilladigital.com), product ids `com.nilladigital.nilla…`.
3. Rename the GitHub repo NoorChasib/ardia -> NoorChasib/nilla (the lead does this after the stacked PRs are open).
4. Upstream services: disable until the owner has their own (telemetry and update checks off/no-op, crash and
   feedback reporting off, kill switches local defaults), each with a config hook for the owner's endpoints.
   Prebuilt engines still come from upstream releases until Nilla engines exist (Layer 1 only).
5. Governance: remove upstream-only governance (vouch, TEAM/VOUCHED, CLA bot and CLA.md, CodeRabbit, Bonzai,
   upstream release/stats/full-send skills); rewrite AGENTS.md, README, CONTRIBUTING and docs for Nilla with the
   owner as owner; keep generic CI.

## Attribution (owner's explicit request: "I'm not trying to hide the fact that it was a fork")
- README.md ends with an "Acknowledgements" section: Nilla is a fork of Ardia
  (https://github.com/ardia-browser/ardia, originally https://github.com/mantrakp04/ardia) by Mantra Patel and
  its contributors, with a sincere thank-you, plus credits to Helium (The Helium Authors), ungoogled-chromium and
  Chromium, and a pointer to NOTICE for the full list.
- NOTICE: add Nilla's own notice at the top ("Nilla, Copyright 2026 Noor Chasib. Nilla is a modified version of
  Ardia, forked on 2026-11-18.") and keep Ardia's notice ("Ardia, Copyright 2026 Mantra Patel") and every
  third-party entry verbatim beneath it; update the Corresponding Source paragraph to Nilla's repo and releases.
- Keep LICENSE (GPL-3.0), LICENSE.Apache-2.0 and third_party licenses unchanged.
- The in-app About/credits screen states that Nilla is based on Ardia (and keeps chrome://credits).
- Never use the Ardia name or logo as Nilla's brand (Apache-2.0 section 6); refer to Ardia only to give credit.
- Apache-2.0 4(b) asks modified files to carry prominent notices of change; the repo's no-comments rule allows
  license headers. Default: a NOTICE statement plus git history; flag per-file notices as an owner/legal decision.

## Resolved branding questions (lead, 2026-11-18, from decisions 1-2 above)
The branding plan (`~/ardia-work/branding/nila/plan.md`) was written before the owner chose an independent app, so
its "tier B defaults hold" section is superseded. Its icons, wordmark, string inventory and work list stay the input.
- Bundle ids, keychain items, data/config folders, `nilla://`, `chrome://nilla/` (Layer 2 if the engine serves it),
  `nilla.desktop`, Windows ProgIDs and data folder, phone ids and the CLI command all become Nilla. No alias, no
  migration code, no self-rename: Nilla installs beside Ardia as a separate app.
- `.app` file name: `Nilla.app`. Release artifacts (DMG, zip, setup exe, tarball) are named Nilla; the Sparkle
  "keep the installed name" constraint does not apply because nothing updates from Ardia to Nilla.
- Stored setting keys inside Nilla's own new profile may stay as code identifiers (e.g. `openLinksInLittleArdia`)
  only if renaming them is Layer 2 work; otherwise rename them with their labels (no users to migrate).
- "Little Ardia" becomes "Little Nilla". "Ardia Sync" becomes "Nilla Sync" (new folder name, no shared folder with Ardia).
- CLI: the command is `nilla-browser` (owner, latest answers); examples and help use `nilla-browser`.
- FAQ: none needed (the site is deleted under D4). The earlier Tamil/Hindi answer described "Nila" and no longer applies.
- New Tab hills: use the branding hand-off's redrawn Nilla set (the current hills are cut from Ardia's logo painting,
  which the "never use the Ardia logo as Nilla's brand" rule forbids). The site's meadow goes with the site (D4); the
  app's shader meadow in packages/shaders is scenery code, not the logo, and stays unless the review says otherwise.
- Domain: none yet. Every ardia.dev URL (appcast, release notes, feedback, switches, otel, site links) goes behind
  one config value that defaults to off/empty, per decision 4.
- NOTICE changes as described in Attribution; CLA.md is removed with the CLA bot.
- The trademark search (`branding/nila/web-check.md`) is the owner's, before anything public.
- Default icon: Highland, with the other 23 palettes as switchable alternates (owner, in the branding thread).

## Branding inputs and extra rules (lead, 2026-11-18, from the branding thread's final hand-off)
- Asset source of truth: `~/ardia-work/branding/nila/manifest.json` (229 entries: replace/add/remove/edit, current
  and proposed repo paths) and `icons/INDEX.md`. The regeneration scripts in `branding/nila/tools/` go into
  `docs/brand/nilla/` (replacing `docs/brand/ardia/`), with the repo's no-comments rule applied.
- Copy source of truth: `branding/nila/strings/inventory.tsv`; rerun `node tools/inventory.mjs <base>` on the real base.
  Its 200 flagged lines get hand-written copy, not a mechanical swap.
- Engine-side assets in the manifest (Chromium product logos, `mac/app.icns`, `mac/Assets.car`) are Layer 2.
  `Assets.car` needs `actool` on a Mac, and the macOS 26 `AppIcon.icon` needs an Icon Composer check on the Mac.
- Testimonials (`apps/site/src/data/voices.ts`) are real people's words about Ardia: remove them, never reword them.
- Performance numbers and benchmark data measured on Ardia builds (`bench*.json`, site claims) are not Nilla's claims:
  drop them from the site, or present them as measurements of the Ardia builds they came from, until Nilla reruns them.
- Links to the `ardia-browser` / `mantrakp04` org and ardia.dev become Nilla's repo (`NoorChasib/nilla`) or the
  single disabled endpoint config; the only remaining upstream links are the credits (README Acknowledgements,
  NOTICE, About) and the prebuilt-engine source (Layer 1 only).
- A new sync encryption salt and magic for Nilla (independent app; nothing ships yet, so no compatibility constraint).

## Plan decisions D1-D8 (lead defaults, 2026-11-18; owner may override)
- D1 reverse-DNS prefix: **`com.nilladigital`** (answered; see Owner answers), kept in as
  few places as the platforms allow so a later change is mechanical.
- D2 Layer 1 builds are development builds only: no release, appcast, store upload or tester hand-out.
- D3 engine for Layer 1: leave `engine/` untouched; build against the nearest published engine (`--nearest`).
- D4 site, dashboard, videos, infra: pending the owner; default is the plan's recommendation (delete apps/site,
  infra/site, apps/dashboard, infra/dashboard, infra/telemetry, infra/hexclave-cli, apps/videos and deploy.yml after
  moving what other code needs; keep infra/feedback dormant and packages/demo). Deletion happens on the Nilla branch
  only, so it stays reversible until the owner merges it.
- D5 keep the phone app, with Nilla ids, not uploaded anywhere.
- D6 Dia parity stays the product goal (docs renamed, rules kept).
- D7 AGENTS.md: keep the working rules; "commit straight to main" becomes branches plus PRs; agents never publish
  releases until the owner grants it; upstream issue numbers go.
- D8 no CLA; inbound = outbound under Apache-2.0 section 5, stated in CONTRIBUTING; optional DCO, not enforced.

## Owner answers (2026-11-18, later)
- Domain: the owner has **nilladigital.com**. Reverse-DNS prefix: `com.nilladigital` (replaces the
  `io.github.noorchasib` default). The product suffix waits on the name confirmation below.
- D4: **delete** the Ardia site, dashboard, release videos and their hosting setup (move what other code needs first;
  infra/feedback stays dormant).
- Apache-2.0 4(b): **NOTICE statement plus git history is enough**; no per-file change notices.
- `phone/hill-climb`: becomes **its own PR** (based on PR 2), after the four stacked PRs.
- **Name: Nilla (double L), confirmed by the owner.** It overrides every "Nila" in earlier notes, the branding hand-off
  and the plan: app `Nilla`, `Nilla.app`, CLI `nilla-browser`, `nilla://`, "Little Nilla", "Nilla Sync", wordmark "nilla",
  GitHub repo `NoorChasib/nilla`, ids under `com.nilladigital.nilla` (e.g. `com.nilladigital.nilla`, `.nilla.ios`,
  `group.com.nilladigital.nilla.ios`, Kotlin/JNI package `com.nilladigital.nilla`, Windows AUMID `NillaDigital.Nilla`).
  Folder names under ~/ardia-work (`branding/nila/`, `nila-cleanup/`) are working paths and keep their spelling.
  "Nilla" is five letters like "Ardia", so fixed-offset name handling (e.g. `nativeModules.ts` name[5]/slice(6)) keeps
  working. Trademark note: "Nilla" is Mondelez/Nabisco's vanilla-wafer brand (food class); the owner checks it.

## Branding hand-off for Nilla (2026-11-18, final)
- Manifest: `~/ardia-work/branding/nila/manifest.json` (234 entries, each tagged layer 1 or 2, id prefix
  `com.nilladigital.nilla`); `icons/INDEX.md`; strings in `strings/inventory.tsv` column `as_nilla` (1,496 user-visible
  lines, 139 flagged for hand-written copy). Rerun `node tools/verify-manifest.mjs <base>` and
  `node tools/inventory.mjs <base>` at the real base.
- Site icons move to `docs/brand/nilla/web/`; the README header icon moves to `docs/brand/nilla/app-icon-256.png`.
- Engine assets (product logos, `mac/app.icns`, `mac/Assets.car`, the Windows engine's `ardia_resources_win.txt` icon
  mapping) are Layer 2. `Assets.car` needs `actool` and `AppIcon.icon` an Icon Composer check, both on the Mac.
- Name risks for the owner: the NILLA wafers mark (Mondelez; famous-mark dilution argued in 2025) needs a trademark
  attorney before anything public, and stores should use "Nilla Browser"; no wafer or vanilla imagery. The Nix project
  nilla-nix/nilla also ships a `nilla` command (CLI name pending the owner).

## Owner answers (2026-11-18, latest)
- **CLI command: `nilla-browser`** (not `nilla`, which clashes with nilla-nix/nilla). This overrides every "`nilla`
  CLI" above: the console script, `install.sh` link, help text and examples all use `nilla-browser`. The Python
  package may stay `ardia_cli` until Layer 2 or become `nilla_browser_cli`, whichever the plan already schedules; the
  user-facing command is `nilla-browser`.
- **Copyright holder: Noor Chasib** ("Nilla, Copyright 2026 Noor Chasib. Nilla is a modified version of Ardia,
  forked on 2026-11-18."). D20 settled.

## Project scope (owner, 2026-11-18)
- Nilla is a **personal, non-commercial project**. No trademark attorney, no store listings planned; keep "Nilla
  Browser" as a store name only if one is ever made. Still avoid wafer or vanilla imagery.

## Guard hardening (owner, 2026-11-19): option 2, full hardening
The "never touch Ardia" guards must resolve where a path really leads before deciding: symlinks, Windows junctions,
relative paths (".", ".."), case variants on macOS, Windows path forms (trailing dots and spaces, extended "\\?\" paths,
8.3 short names), and planted marker files. Applies to the CLI config/schema/theme targets and the macOS default,
the Linux CLI home and launcher, Sync folders at the native filesystem boundary (defaults, picker inputs, probes,
reads, writes), nilla-dev-run (require real filesystem isolation, not just a user namespace) and the Windows
nilla-dev-run.ps1 (handle-based resolution). The rename gate gets positional same-line checks. Findings and fixes per
work/wave2/codex-preR.md; Codex rechecks afterwards.
