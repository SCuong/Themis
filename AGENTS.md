# Notes for coding agents

## Testing: you can drive the real extension in a browser

Do not stop at the unit tests or ask the user to check by hand. This repo can load Themis unpacked in a
real browser with Playwright and drive it end to end. Pick the cheapest test that proves your change:

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | Node tests: JSDOM fixtures for the site adapters (`provider-dom.test.cjs`), the real `background.js` against a fake `chrome` API (`prompt-sync-harness.cjs`), and the UI fixture (`ui-browser.test.cjs`) | Google Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` for the UI fixture (see `ui-fixture.cjs`) |
| `npm run test:frames` | `frame-rules.browser.cjs`: loads Themis unpacked and checks the per-tab DNR rules that let the AI sites render in `team.html` iframes | Playwright Chromium, network, no sign-in |
| `npm run test:live` | `providers.live.cjs`: runs the `content.js` site adapter directly on each real site page | Signed-in profile (`npm run test:live:login`) |
| `npm run test:e2e` | `e2e.live.cjs`: the whole extension. It creates a group chat in `team.html` through the UI, adds one member per site, sends one `@all` prompt and checks that each member's token comes back under that member. It writes `test-results/e2e/summary.{json,md}` plus screenshots | Signed-in profile (`npm run test:e2e:login`), headed |

Only `npm test` runs in CI. The live tests use the user's real accounts and quota, so run them when your
change touches site adapters, prompt delivery or reply reading, and report what they show.

### How to load the extension in a browser

- Use **Playwright's Chromium**, not Google Chrome: `npx playwright-core install chromium`, then
  `chromium.launchPersistentContext(profileDir, { channel: 'chromium', args: ['--disable-extensions-except=<repo>', '--load-extension=<repo>'] })`.
  Branded Chrome ignores `--load-extension`.
- The service worker is `context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')`. The extension id
  is `new URL(worker.url()).host` (it is fixed at `cnccbifloajlkjglmiojkpimjciamlpe` by the manifest `key`). Open
  `chrome-extension://<id>/team.html` and call `chrome.*` APIs with `worker.evaluate(...)`.
- Each member's iframe has the title `"<member> <site> chat"` inside `#iframe-host`. `#iframe-host` is a fixed layer
  behind the app, so raise its `z-index` before you screenshot a frame.
- Claude in Chrome cannot open `chrome-extension://` pages, and computer use only gets read access to browsers.
  Use Playwright.

### Sign-in and bot checks

- Never type credentials. `npm run test:e2e:login` opens plain Chromium (not Playwright, so it carries no automation
  flags) on `test-results/e2e-profile` with Themis loaded. The user signs in, then closes the window. The window must
  be closed before a test run, because Chrome locks the profile.
- Always pass `--load-extension` when you open that profile. If it is opened once without the extension, Chrome marks
  the unpacked extension disabled (`disable_reasons` in `Default/Preferences`). Every iframe is then refused, and
  `test:e2e` stops with "Themis added no frame rule".
- Even when signed in, Claude and Grok show a Cloudflare check in automated Chromium. Report them as BLOCKED with
  the screenshot, never as PASS. ChatGPT, DeepSeek and Gemini work when signed in.
- `test-results/` is gitignored and holds live session cookies and private chat text. Never commit it or paste
  from it.

### Reporting

Report each site as PASS only when a real reply reached the Themis UI. Otherwise report FAIL, or BLOCKED for a
missing sign-in or a bot check. Include the evidence (screenshot or summary line).
