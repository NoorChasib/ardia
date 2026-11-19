# Privacy

Nilla is a personal, non-commercial browser project by Noor Chasib. This page covers the Nilla apps built from this
repository: the desktop browser on macOS, Linux and Windows, the iPhone and Android apps, and the `nilla-browser`
command.

## What Nilla sends to its developer

Nothing. Nilla has no account, no server and no analytics service. Every endpoint the apps could send to (usage
telemetry, crash and problem reports, kill switches, update feeds, release notes) is off in the code
(`packages/core/src/services.ts`, described in `docs/services.md`):

- **Usage data:** none is sent, from any app. Settings › Privacy says "Nilla sends no usage data." What each app
  keeps on your device, never uploaded:
  - the desktop browser keeps the events it counts in a local copy in its data folder for 7 days;
  - the iPhone and Android apps count nothing while "Share anonymous usage stats" is off; with it on, they keep a
    day's counts in the app's own storage;
  - the `nilla-browser` command keeps a 7-day local copy of the commands it ran in the browser data folder it was
    pointed at, and a short list of recent commands in its own folder.
- **Problem reports:** Report a Problem opens a GitHub issue draft in your browser, with a short template. Nothing is
  attached or uploaded unless you paste it into the issue yourself, and the issue is public on GitHub.
- **Crash reports:** none are sent.
- **Updates:** the apps don't check for updates.

## What stays on your device

Your history, bookmarks, tabs, passwords, settings and everything else you do in Nilla stay in Nilla's own data folder
and your system keychain or keyring. Nilla never reads or writes another browser's data, except when you ask it to
import from that browser.

## Sync

Sync is end-to-end encrypted and has no server. Nilla writes sealed files into a folder you choose (for example in
iCloud Drive or Dropbox), and the service that syncs that folder carries them between your devices. That service sees
encrypted files only; the key never leaves your devices (`docs/sync.md` has the details).

## Network traffic

None of this goes to Nilla's developer. Each of these sites and services has its own privacy policy.

**Traffic you start.** Like any browser, Nilla connects to the sites you visit and to the services you turn on:

- the search engine you pick, and its search suggestions while Search suggestions is on in Settings;
- accounts you connect yourself, such as a calendar or GitHub.

**Traffic that runs by itself.** These requests go out without you asking each time:

- Helium's list of search shortcuts (`services.helium.imput.net`), which Nilla downloads to keep its `!bang`
  shortcuts current;
- on the desktop, Chromium's own component updates and the filter lists of the bundled uBlock Origin, which the
  browser engine and the extension fetch on their own schedule, as they do in other Chromium browsers.

Nilla itself never checks for app updates.

## Questions

Open an issue at https://github.com/NoorChasib/nilla/issues.
