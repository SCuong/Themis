# Themis

**A Chrome extension workspace where several AI assistants work on one problem together: each takes a role, answers, critiques the others and checks the reasoning.**

Themis puts Claude, ChatGPT, Gemini, Grok and DeepSeek into one group chat. You give each member a persona (a product manager, a skeptic, a statistician, a contract reviewer, and so on), ask once, and read the answers side by side. You can let members see each other's replies and push back, keep them independent so their views don't contaminate each other, or lay the work out as a workflow with review steps.

Themis is a modified version of [OpenTeam](https://github.com/afumu/openteam) and is distributed under the **PolyForm Noncommercial License 1.0.0**. See [License and credits](#license-and-credits).

![Themis chat workspace](docs/screenshots/chat-light.png)

---

## Why

Asking one model gives you one model's blind spots. Asking several by hand means copying the same prompt into five tabs and comparing the answers yourself. Themis does the routing for you, keeps the conversation in one place, and makes disagreement visible: who said what, from which model, and with what persona.

It runs on the AI websites you already use, signed in with your own accounts, plus any API model you configure. Nothing goes through a Themis server, because there isn't one.

## What it does

Everything below is implemented in this repository and covered at least partly by the automated tests.

### Group chat with several models
- Members can run on **Gemini, ChatGPT, Claude, DeepSeek or Grok** through their websites, or on an **external API model** (OpenAI-compatible or Anthropic format, with your own base URL, API key and model name).
- Address members with `@Name`, `@all`, or turn on **Everyone replies** so the whole group answers each message.
- Replies arrive in one thread, labelled with the member's name, avatar and model.
- You can retry, stop, re-sync or quote a member's reply. If a reply is not picked up, you can jump straight to that member's AI page.

### Two ways to discuss
- **Collaborative mode:** members get the group's earlier messages as context, so they can build on each other or disagree.
- **Independent expert mode:** each member answers on its own, which is useful when you want separate opinions before comparing them.

### Orchestration
- A canvas for building a **workflow out of nodes**: each node is one or more members, and connections set the order. Members in the same node work in parallel.
- **Review steps** return a structured pass or fail decision with reasons; a failed review can send the work back for another round.
- A cap on node executions (default 50, at most 200) stops workflows from looping indefinitely.
- **Automatic orchestration** can draft a workflow from a task description. It needs an external API model.

![Orchestration canvas](docs/screenshots/orchestration.png)

### People library
- **308 personas** out of the box: about 38 thinking-style advisors inspired by public figures and organizations, more than 260 specialist roles from team templates, and 3 editable defaults.
- **45 team templates** (study, thesis writing, product reviews, contract review, data analysis, software development and more), each with several roles and detailed prompts.
- Create and edit your own personas, give each a default model, and add copies of them to any chat. Personas can also be drafted with AI from a short description, using an external API model.

![People library](docs/screenshots/people-library.png)

### Files and notes
- **Attach files** in the composer by picking them, pasting or dragging them onto the chat (up to 10 files, 25 MB each, 40 MB per message). Themis pastes them into each member's AI page.
- A **side viewer** opens attachments: images, video, audio, PDF, Markdown (rendered), DOCX (rendered with mammoth.js) and plain text.
- **Notes** per chat or global, with a rich-text editor.
- **Export** a chat's history as Markdown.

![File viewer](docs/screenshots/file-viewer.png)

### Housekeeping
- When you delete a chat, Themis can optionally delete the matching conversations on the AI sites as well. It asks first, and it is off unless you confirm.
- Chats are grouped by date in the sidebar.
- The interface is available in English and Vietnamese, with light and dark themes. It is laid out for narrow windows as well as wide ones.

<details>
<summary>Dark theme</summary>

![Dark theme](docs/screenshots/chat-dark.png)
</details>

> The screenshots show the real extension UI rendered by the project's test fixture with sample data (the sample messages are in Vietnamese). The embedded AI-site panels are not shown, because the test fixture does not load the real sites.

## How it works

Themis is a Manifest V3 Chrome extension. There is no backend.

| Part | Source | Built file | Role |
|---|---|---|---|
| Workspace page | `src/teamPage/`, `team.html`, `team-ui.js`, `composer-files.js`, `localization.js`, CSS | `team.js` | The chat, people library, orchestration canvas, notes and settings UI |
| Background service worker | `src/background/` | `background.js` | Stores state, routes messages to members, runs orchestration, calls external API models (via the Vercel AI SDK) |
| Content script | `src/content/` | `content.js` | Runs inside each AI site's page: types the prompt, pastes attachments, presses send and reads the reply back |
| Shared code | `src/group/`, `src/shared/` | `assets/imageAttachmentRepository.js` | Store schema and migrations, personas, team templates and helpers used by the other parts |
| Network rules | `src/background/frameRules.ts` | `background.js` | Lets the AI sites load inside workspace tabs only (see [Security and privacy](#security-and-privacy)) |

For website members, Themis embeds each AI site in a frame inside the workspace and drives it with the content script, using your existing signed-in session. Each member gets its own frame and its own conversation, so several members can use the same site. For API members, the background worker calls the provider directly with the key you entered.

Data lives in your browser: chats, personas and settings in `chrome.storage.local`, and images and attachments in IndexedDB.

**About this codebase:** `src/` is the TypeScript source of OpenTeam v1.0.3 (commit `8ef6f37`) with Themis's changes. `npm run build` bundles it with Vite and esbuild into `dist/`, together with the hand-written files that ship as they are (`team.html`, `team.css`, `team-refinements.css`, `team-ui.js`, `composer-files.js`, `localization.js`, `profile-avatars.js`, `manifest.json`, `vendor/`, `assets/icons/`, `assets/profile-atlas.webp`). `dist/` is build output and is not committed.

## Install

Themis is not on the Chrome Web Store. Load it as an unpacked extension:

1. Clone this repository, then build it (Node.js 24): `npm ci` and `npm run build`.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and select the `dist` folder.
4. Click the Themis icon in the toolbar to open the workspace.
5. Sign in to the AI sites you want to use (Gemini, ChatGPT, Claude, DeepSeek, Grok) in the same Chrome profile.
6. Optional: open **Models** to add an API model.

## Development

The checks and tests use Node.js (developed with Node.js 24).

```bash
npm ci
npm run build   # src/ and the hand-written files -> dist/ (the unpacked extension)
npm run check   # TypeScript type check and a syntax check of the built scripts
npm test        # unit, background-harness and browser UI tests (needs the build)
npm run hashes  # SHA-256 of every file in dist/
```

GitHub Actions runs `npm ci`, `npm run build`, `npm run check`, `npm test` and `npm run hashes` on every push and pull request (`.github/workflows/test.yml`).

**Reproducible builds.** Dependencies are pinned by `package-lock.json`, line endings by `.gitattributes`, and the build has no timestamps or random names, so two builds of the same commit give the same bytes. `npm run hashes` prints the hash of every file in `dist/` and one hash over the list; compare that last line between builds.

**Tests and source.** Tests that check a single part load it from `src/` through `test-support/source.cjs`, which bundles the module with esbuild on the fly (`test-support/*.ts` list what each group of tests uses). Tests of the whole extension run the built files in `dist/`.

**Live check against the real AI sites.** The tests above use simulated pages, so they cannot notice when a site changes its markup. `providers.live.cjs` runs the extension's own site adapters on the real sites: it sends one short prompt to each and waits for the reply.

```bash
npm run test:live:login   # once: sign in to each site in the Chrome window that opens, then close it
npm run test:live         # THEMIS_LIVE_SITES=chatgpt,claude limits the sites
```

It uses a separate Chrome profile in `test-results/live-profile`, uses a little of each account's quota, and is not run in CI.

**Frame rules in a real browser.** `npm run test:frames` loads `dist/` unpacked in Playwright's Chromium (branded Chrome ignores `--load-extension`; run `npx playwright-core install chromium` once) and checks that each AI site can be framed in a workspace tab, stays blocked in an ordinary tab, keeps working after a navigation inside the frame, and loses the exception when the workspace tab closes or navigates away. It needs network access but no sign-in. In an automated browser Claude and Grok show a Cloudflare check and DeepSeek a 403 page, so for those three it proves the frame is allowed, not that the app works.

**Whole-extension E2E against the real sites.** `e2e.live.cjs` starts Playwright's Chromium with `dist/` unpacked and attaches to it over the DevTools protocol (a browser launched by Playwright carries automation flags, and signed-in Gemini then never answers), creates a group chat in `team.html` through the real UI, adds one member per site, sends one `@all` prompt asking each member for its own token, and checks that each token comes back under the right member:

```
npx playwright-core install chromium   # once; branded Chrome ignores --load-extension
npm run test:e2e:login                 # sign in to each site in the window that opens (plain Chromium, no automation), then close it
npm run test:e2e                       # THEMIS_E2E_SITES=chatgpt,gemini limits the sites
```

Each site is reported as PASS (a real reply reached the Themis UI), FAIL, or BLOCKED (a bot check or a missing sign-in stopped it). `test-results/e2e/` gets `summary.json`, `summary.md`, `team.png`, one screenshot per site frame, and the console errors. It runs headed on its own profile (`test-results/e2e-profile`), clears Themis's stored chats (not the site sign-ins) at the start of each run, exits non-zero unless every site passes, and is not run in CI.

**Comparing with upstream.** `npm run rebuild:upstream` builds OpenTeam v1.0.3 (commit `8ef6f37`) from its own repository into `test-results/upstream/dist` and lists which files of `dist/` are identical to it. Since `src/` started as that exact source (the first commit of the port builds byte-identical to the upstream release), `git log -p -- src` shows every change Themis made to it.

- The browser UI tests drive Google Chrome through `playwright-core` and expect Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` (see `ui-fixture.cjs`). Change that path on macOS or Linux.
- `prompt-sync-harness.cjs` loads the built `dist/background.js` against a fake `chrome` API, so message routing can be tested without a browser.
- `node preview-server.cjs 5173` serves the built workspace page from `dist/` at `http://localhost:5173/team.html` for UI work, with sample data and no real AI sites.

**Current results** (at the commit in this repository): `npm run build` and `npm run check` pass, `npm test` runs 72 tests and `npm run test:frames` 8. One layout test (`ui-redesign.test.cjs`, "all workspaces and dialogs fit…") is intermittent: it sometimes times out when the whole suite runs in parallel, and passes when run on its own.

## Limitations

- **Depends on third-party websites.** Website members work by driving the AI sites' own pages. When a site changes its layout or behavior, sending, reading replies or attaching files can break until the selectors are updated.
- **Terms of service.** Automating a website may conflict with that site's terms. You are responsible for how you use Themis with your accounts.
- **Remote deletion is best effort.** Deleting conversations on the AI sites uses those sites' internal web endpoints, which are undocumented and can change. Themis reports which deletions failed, so you can remove those by hand.
- **Personas are prompts, not people.** The thinking-style advisors are written to reflect public ideas. They are not affiliated with or endorsed by the people or organizations they are named after, and they can be wrong.
- **Model output is not verified.** Reviews and critiques come from the models themselves. Treat them as input to your judgment, not as proof.
- **Chrome only.** Themis has only been used with desktop Google Chrome.

## Security and privacy

- **No Themis server.** Prompts go from your browser to the AI sites you use, and to any API provider you configure. Themis does not send data anywhere else.
- **Frame protection is relaxed only in workspace tabs.** To embed the AI sites, Themis removes their `Content-Security-Policy` and `X-Frame-Options` response headers for frames inside open Themis workspace tabs, using session rules limited to those tab IDs. The rule is updated as tabs open, close or navigate; any other tab, including other websites that try to frame the AI sites, keeps the sites' normal protection.
- **Host permissions.** Access to any site other than the AI sites (and OpenAI's image hosts, for saving ChatGPT reply images) is optional: when you save or test an API model, Chrome asks for access to that model's host only. It also has clipboard permissions, used as a fallback for reading a reply from an AI site when the reply cannot be read from the page directly.
- **Local storage.** Chats, personas and settings are stored in `chrome.storage.local`; attachments are stored in IndexedDB. **API keys for external models** are encrypted (AES-GCM) before they are stored, with a non-extractable key kept in the extension's IndexedDB, so a copy of `chrome.storage` does not reveal them. This is not a password vault: anyone who controls your Chrome profile can still run the extension and use the keys. Deleting a chat removes its messages, attachments, notes, highlights, model memories and workflows. Attachment deletes are recorded in a cleanup queue in the same write that deletes the chat; if IndexedDB fails, the task stays queued and is retried each time the extension starts.
- **Your accounts, your data.** Messages and attachments you send to a member are sent to that member's AI provider and are subject to that provider's policies.

## License and credits

Themis is based on **[OpenTeam](https://github.com/afumu/openteam)** by the OpenTeam contributors.

> Required Notice: Copyright (c) 2026 OpenTeam contributors.

Both OpenTeam and Themis are licensed under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**. You may use, modify and share Themis **for noncommercial purposes only**; see the license for what counts as noncommercial. This is a source-available license, not an OSI-approved open-source license.

[NOTICE](NOTICE) lists what Themis changed and the third-party software included:
- The bundled code carries over open-source libraries from the OpenTeam build, including markdown-it, linkify-it, Tiptap and ProseMirror, zod and the Vercel AI SDK, each under its own license.
- [Phosphor Icons](https://phosphoricons.com) are used for the interface icons, under the MIT License ([assets/icons/PHOSPHOR-LICENSE.txt](assets/icons/PHOSPHOR-LICENSE.txt)).
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) 1.8.0 is included under the BSD 2-Clause License ([vendor/mammoth-1.8.0.LICENSE](vendor/mammoth-1.8.0.LICENSE)).

Claude, ChatGPT, Gemini, Grok and DeepSeek are trademarks of their respective owners. Themis is an independent project and is not affiliated with any of them.
