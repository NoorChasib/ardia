# Config and themes

When the user wants a setting changed for good, or set up from their dotfiles, edit `~/.config/nilla/config.json`
(on Linux `$ARDIA_CONFIG_HOME/ardia/config/config.json`; `nilla-browser config path` prints the folder) with `nilla-browser config` instead
of clicking through Settings. Nilla reads the file at launch and whenever it changes, and never writes it; these
commands don't need Nilla running.

```sh
nilla-browser config init
nilla-browser config list
nilla-browser config set tabLayout top
nilla-browser config set shortcuts.newTab cmd+shift+n
nilla-browser config unset tabLayout
nilla-browser config check
```

`init` creates the folder, `config.json` and the schemas; `list` shows every setting with its allowed values,
default and file value; shortcuts are one per command (`''` unbinds); `unset` leaves Nilla's current value in place;
`check` reports what Nilla would complain about.

To change how Nilla looks (colours, fonts, text sizes, row heights, corners, which sidebar parts show, icons),
use `nilla-browser theme set`, one key at a time. It edits the active theme and a running Nilla restyles at once, no
restart; with no active theme it creates `themes/custom.json` and makes it active.

```sh
nilla-browser theme set dark.accent '#FF9F5A'
nilla-browser theme set type.family "Avenir Next"
nilla-browser theme set metrics.rowHeight 40
nilla-browser theme set metrics.radius.row 14
nilla-browser theme set layout.hide '["navButtons"]'
nilla-browser theme set icons.plus plus.circle
nilla-browser theme get metrics.rowHeight
nilla-browser theme unset metrics.rowHeight
```

Themes live in `themes/NAME.json` in that folder: `dark` and `light` colour roles, plus `type` (font `family`,
`mono`, `scale`, `sizes`, `weights`), `metrics` (`rowHeight`, `rowGap`, `pinnedHeight`, `sidebarWidth`, `radius`),
`layout` (`hide` sidebar parts, `addressField` and `newTab` top or bottom) and `icons` (SF Symbol swaps). KEY is the
dotted path (`type.sizes.body`, `metrics.radius.row`); under `icons` the rest is one symbol name
(`icons.chevron.down`). Every key is optional; a block left out is Nilla's own look. `set` checks the value first and
refuses a bad one with the allowed range; `get` prints Nilla's default for a key the theme doesn't set; `unset` gives
the key back to Nilla. `--theme NAME` works on another theme. `nilla-browser theme new NAME` writes every role and look key
with Nilla's values; the ranges and defaults are in `theme.schema.json`. `nilla-browser theme use NAME` (or `none`) picks
one, and `nilla-browser theme check` checks it in Nilla's words; a bad key is skipped on its own and the rest applies. Ask
before replacing the user's own theme or config values. Settings that grant control or send data somewhere (`cliControl`, custom search URLs,
page engines) can't go in the file; tell the user where they are in Settings instead.

To land on a new tab at launch while keeping the session, set `launchActions`:
`nilla-browser config set launchActions '["newTab"]'`.
