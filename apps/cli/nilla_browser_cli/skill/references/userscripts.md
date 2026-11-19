# Userscripts

When the user wants a site to look or behave differently every time they visit it, write a userscript instead of
driving the page by hand. `nilla-browser scripts` takes TypeScript or JavaScript with a Violentmonkey `==UserScript==` header,
so existing `.user.js` files work too. `nilla-browser scripts --help` and each command's `--help` explain the details.

- Start from `nilla-browser scripts new`, or from a script the user already has.
- Read the real page (`nilla-browser browse snapshot`, `nilla-browser browse get html <sel>`) before writing selectors, and keep the
  script small and robust to the site changing.
- Iterate with `nilla-browser scripts test` until it passes cleanly on the pages it targets. It runs in a tab of its own and
  reports what ran, what logged and what threw.
- Install only once the user is happy with it. `nilla-browser scripts list` and `uninstall` manage what's installed.
