# Releasing

**Not set up yet.** Nilla has published no release, and its builds are development builds only: no GitHub release,
appcast, store upload, engine publish or tester hand-out. CI uploads logs and smoke results, never an installable app,
package or archive. Nobody, agents included, publishes any of these until the owner grants it for that release.

The release machinery is still the shape Ardia used: `.github/workflows/release.yml`, `scripts/release.sh` and its
stages in `scripts/release/`, `scripts/linux/release.sh` and the Windows packaging in `scripts/windows`. Ardia's guide
to it is archived in `docs/history/ardia/releasing.md`; read it for how the stages work, not for its accounts, hosts or
keys, none of which are Nilla's. The first Nilla version is `0.1.0`.

## What a release still needs

| Need | For | Today |
| --- | --- | --- |
| Nilla's own engines (Layer 2), published on `NoorChasib/nilla` with their pins updated | every desktop platform | the pins point at Ardia's engines, whose own pages still say Ardia, so no build is published |
| An Apple Developer ID team, its certificate and a provisioning profile for `com.nilladigital.nilla` | signing the Mac app; keychain groups, passkeys and saved cards | ad hoc builds |
| An App Store Connect API key | notarizing the Mac app and its DMG | none |
| A Sparkle EdDSA key pair, the public half in `SUPublicEDKey` (`apps/browser/macos/Nilla-macOS/Info.plist`) | signed Mac updates | `SUFeedURL` and `SUPublicEDKey` are empty, which blocks every update check |
| An update host: GitHub Releases on `NoorChasib/nilla` (the Mac appcast, the Windows feed and its approved download prefix, the Linux release list), with no server of its own | updates on every platform | every endpoint in `packages/core/src/services.ts` is empty (`docs/services.md`) |
| An Authenticode certificate | the Windows app and installer | unsigned, and built only in CI or a disposable VM |
| An Android keystore, and an Apple team for the iPhone app | the phone apps | not uploaded anywhere |
| Nilla's Apache-2.0 text and `NOTICE` under the phone apps' Open Source Licenses, checked in each build | the phone apps' licence obligations | not checked for Nilla |
| The engine source archives, per platform (below) | GPL-3.0 §6(d) | not built for Nilla |

When these exist, write a Nilla release guide here, replacing this page, with Nilla's own secrets, hosts and steps.

## Source and licenses

Every binary Nilla publishes (DMG, zip, engine archive, Windows installers, Linux packages, CLI tarballs) will have
its source next to it, kept for as long as the binary stays up. That's GPL-3.0 §6(d) for the GPL parts (the engine
with Helium's patches, uBlock Origin), and it's how we work anyway.

- Every release carries, as its own assets, the source of each platform's engine: `scripts/engine-source.sh` packs the
  Helium sources (`helium-chromium`, `helium-macos`, `helium-linux`) with the Linux patch set, and
  `scripts/windows/engine-source.sh` the Windows engine's. Never only a link to an archive on someone else's
  release, Ardia's included: Nilla has to keep it available itself.
- Every release's notes end with a Source section (`release.sh` writes it). It links the tag's tree: the app, the
  engine's patches, `gn_defines.sh`, the step scripts and the release flow, plus the engine source archives above.
- Never delete or move a `v*` tag, or a release's source asset, while its release is up. A release can come down;
  its tag stays.
- About Nilla and Settings › Advanced › "Source and licenses" link the running version's tag. Every package carries
  `LICENSE`, `LICENSE.Apache-2.0` and `NOTICE`, plus the third-party texts for what it bundles (the Mac app in
  `Contents/Resources/Licenses`).
- Release notes follow `docs/release-notes/README.md`.
