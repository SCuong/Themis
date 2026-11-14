# Notes for coding agents

## Workspace: one repository

- Work only in `V:\repos\Themis`. Remote: `https://github.com/SCuong/Themis`.
- Never develop in `V:\archives\Themis-legacy\*` (old `themis-ts-port`, `themis-e2e` clones) or in
  `V:\openteam-extension-v1.0.3` (old non-git copy; Chrome loads it unpacked, so leave it alone).
  `V:\openteam-extension-v1.0.3.zip` is the OpenTeam upstream reference only.
- Do not clone another Themis checkout to replace this one. Create a git worktree only on purpose, under
  `.claude/worktrees/` in this repo, and say so.

## Source of truth

- TypeScript in `src/` is the source. Vite builds it into `dist/` (`npm run build`); never edit `dist/`.
- The root files listed in `STATIC_FILES` in `vite.config.ts` (`team.html`, `team.css`, `team-ui.js`,
  `localization.js`, `composer-files.js`, ...) are hand-written and copied into `dist/` as they are.
- Do not sync code from OpenTeam upstream into Themis, and make no large architecture change unless asked.

## Git

- Before editing, check `git status`, the branch and HEAD. Other agents and the user may have changes here:
  never overwrite or discard them.
- Never `git reset --hard`, `git clean`, force-push, or merge into `main` on your own. Keep each change small
  and reviewable.

## Fixing bugs

- Reproduce the bug first; prefer a regression test that fails before the fix. Fix the root cause.
- Never call something FIXED without running the tests that prove it, and never claim a test ran when it did not.
- For async changes (prompt delivery, orchestration, frames), check race conditions and cancellation.
- Preserve user chats, notes, attachments and settings (storage formats, IndexedDB records).

## Verification

`npm run build`, then `npm run check` (types plus syntax of the built `dist/` files), `npm test`, and
`npm run test:frames` when frame rules or loading change. For UI or orchestration bugs, drive the real
extension in Playwright Chromium (below). Never use the user's real Chrome profile or data for tests, and
put temporary files in `test-results/` or the system temp dir, not elsewhere on `V:`.

## Testing: you can drive the real extension in a browser

Do not stop at the unit tests or ask the user to check by hand. This repo can load Themis unpacked in a
real browser with Playwright and drive it end to end. The extension is built from `src/` into `dist/`
(`npm ci`, then `npm run build`); every test below except the source-level unit tests needs that build.
Pick the cheapest test that proves your change:

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | Node tests: JSDOM fixtures for the site adapters (`provider-dom.test.cjs`), the built `dist/background.js` against a fake `chrome` API (`prompt-sync-harness.cjs`), and the UI fixture (`ui-browser.test.cjs`) | Google Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` for the UI fixture (see `ui-fixture.cjs`) |
| `npm run test:frames` | `frame-rules.browser.cjs`: loads `dist/` unpacked and checks the per-tab DNR rules that let the AI sites render in `team.html` iframes | Playwright Chromium, network, no sign-in |
| `npm run test:live` | `providers.live.cjs`: runs the content script's site adapters (from `src/content/sites/`) directly on each real site page | Signed-in profile (`npm run test:live:login`) |
| `npm run test:e2e` | `e2e.live.cjs`: the whole extension. It creates a group chat in `team.html` through the UI, adds one member per site, sends one `@all` prompt and checks that each member's token comes back under that member. It writes `test-results/e2e/summary.{json,md}` plus screenshots | Signed-in profile (`npm run test:e2e:login`), headed |

Only `npm test` runs in CI. The live tests use the user's real accounts and quota, so run them when your
change touches site adapters, prompt delivery or reply reading, and report what they show.

### How to load the extension in a browser

- Use **Playwright's Chromium**, not Google Chrome: `npx playwright-core install chromium`. For the real sites, start
  that binary yourself (`--user-data-dir`, `--remote-debugging-port`, `--disable-extensions-except=<repo>/dist`,
  `--load-extension=<repo>/dist`) and attach with `chromium.connectOverCDP(...)`, as `e2e.live.cjs` does. A browser
  launched by Playwright carries automation flags (`navigator.webdriver`), and signed-in Gemini then accepts a prompt
  but never answers. `launchPersistentContext` is fine for tests that do not need a site to reply (`test:frames`).
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
- With the automation flags gone (the CDP attach above), Claude and Grok load signed in. If a site still shows a
  Cloudflare check, report it as BLOCKED with
  the screenshot, never as PASS. ChatGPT, DeepSeek and Gemini work when signed in.
- `test-results/` is gitignored and holds live session cookies and private chat text. Never commit it or paste
  from it.

### Reporting

Report each site as PASS only when a real reply reached the Themis UI. Otherwise report FAIL, or BLOCKED for a
missing sign-in or a bot check. Include the evidence (screenshot or summary line).
